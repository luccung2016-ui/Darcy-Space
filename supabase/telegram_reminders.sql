-- =====================================================================
-- Darcy Space · Telegram reminders chạy trực tiếp trong Supabase
--   • Nhắc lịch trình (personal_schedule) đúng phút, theo reminder_minutes
--   • 08:00 hằng ngày: Daily Brief (việc hôm nay, tới hạn, quá hạn, lịch)
--   • 18:00 hằng ngày: Tổng kết ngày + xem trước ngày mai
-- Chạy file này MỘT LẦN trong Supabase → SQL Editor. Chạy lại vẫn an toàn.
-- Trước đó, lưu bot token và chat id vào Vault (xem BƯỚC 0 bên dưới).
-- =====================================================================

-- BƯỚC 0 (chạy riêng, thay giá trị thật — KHÔNG commit token lên GitHub):
--   select vault.create_secret('123456:ABC...', 'telegram_bot_token');
--   select vault.create_secret('-100123456789', 'telegram_chat_id');
-- Đổi token sau này:
--   select vault.update_secret(id, 'token-moi') from vault.secrets where name = 'telegram_bot_token';

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Schema riêng, không mở ra REST API nên trình duyệt không gọi được các hàm này.
create schema if not exists darcy_bot;
revoke all on schema darcy_bot from public, anon, authenticated;

create table if not exists darcy_bot.sent_log (
  key text primary key,
  sent_at timestamptz not null default now()
);
alter table darcy_bot.sent_log enable row level security;

-- Giờ Việt Nam ---------------------------------------------------------
create or replace function darcy_bot.vn_now() returns timestamp
language sql stable as $$ select now() at time zone 'Asia/Ho_Chi_Minh' $$;

create or replace function darcy_bot.is_done(status text) returns boolean
language sql immutable as $$
  select coalesce(status, '') in ('Hoàn thành', 'Đã hoàn thành', 'Đã chốt', 'Đã đăng')
$$;

create or replace function darcy_bot.wd_label(n int) returns text
language sql immutable as $$ select case when n = 7 then 'CN' else 'T' || (n + 1) end $$;

create or replace function darcy_bot.esc(value text) returns text
language sql immutable as $$
  select replace(replace(replace(coalesce(value, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

-- Gửi tin nhắn Telegram (HTML) -----------------------------------------
-- Hàng đợi gửi: mỗi tin được lưu lại để tự gửi lại nếu Telegram lỗi/timeout
create table if not exists darcy_bot.outbox (
  id bigserial primary key,
  message text not null,
  request_id bigint,
  attempts int not null default 1,
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);
alter table darcy_bot.outbox enable row level security;

-- Gửi thẳng 1 request HTTP tới Telegram (timeout 20 giây)
create or replace function darcy_bot.post_telegram(message text) returns bigint
language plpgsql security definer set search_path = public, extensions, darcy_bot as $$
declare
  bot_token text;
  chat text;
begin
  select decrypted_secret into bot_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into chat from vault.decrypted_secrets where name = 'telegram_chat_id';
  if bot_token is null or chat is null then
    raise exception 'Thiếu telegram_bot_token hoặc telegram_chat_id trong Vault';
  end if;
  return net.http_post(
    url := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
    body := jsonb_build_object('chat_id', chat, 'text', message, 'parse_mode', 'HTML', 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000
  );
end $$;

create or replace function darcy_bot.send(message text) returns bigint
language plpgsql security definer set search_path = public, extensions, darcy_bot as $$
declare
  req bigint := post_telegram(message);
begin
  insert into outbox(message, request_id) values (message, req);
  return req;
end $$;

-- Gửi lại tin bị lỗi (tối đa 5 lần, trong vòng 6 tiếng) — chạy mỗi phút
create or replace function darcy_bot.retry_failed() returns int
language plpgsql security definer set search_path = public, extensions, darcy_bot as $$
declare
  item record;
  resp record;
  retried int := 0;
begin
  for item in
    select * from outbox
    where not delivered and attempts < 5 and created_at > now() - interval '6 hours'
    order by id
  loop
    select status_code, timed_out into resp from net._http_response where id = item.request_id;
    if not found then
      continue;  -- request chưa xử lý xong
    end if;
    if resp.status_code = 200 then
      update outbox set delivered = true where id = item.id;
    else
      update outbox set request_id = post_telegram(item.message), attempts = attempts + 1 where id = item.id;
      retried := retried + 1;
    end if;
  end loop;
  return retried;
end $$;

-- Ghi nhận đã gửi; trả về false nếu key đã gửi trước đó (chống gửi trùng)
create or replace function darcy_bot.claim(sent_key text) returns boolean
language plpgsql as $$
begin
  insert into darcy_bot.sent_log(key) values (sent_key);
  return true;
exception when unique_violation then
  return false;
end $$;

-- Danh sách task theo ngày (dùng chung cho 08:00 và 18:00) ---------------
-- kind: today | due | overdue | done_today | tomorrow
create or replace function darcy_bot.task_lines(p_kind text, p_day date) returns setof text
language sql stable set search_path = public, darcy_bot as $$
  with params as (
    select p_day as d,
           extract(isodow from p_day)::int as wd,
           (p_day - (extract(isodow from p_day)::int - 1))::date as week_start
  ),
  t as (
    select tk.*,
           coalesce(p.name, '') as project_name,
           case when tk.work_mode = 'routine'
                then coalesce((select i.status from task_weekly_instances i
                               where i.task_id = tk.id and i.week_start::date = (select week_start from params)), 'Chưa bắt đầu')
                else tk.status end as eff_status,
           (select i.updated_at::timestamptz from task_weekly_instances i
             where i.task_id = tk.id and i.week_start::date = (select week_start from params)) as inst_updated
    from tasks tk left join projects p on p.id = tk.project_id
  ),
  labelled as (
    select t.*,
           '• ' || esc(t.name) ||
           case when t.project_name <> '' then ' <i>[' || esc(t.project_name) || ']</i>' else '' end as label
    from t
  )
  select line from (
    -- Task cố định theo tuần
    select 1 as ord, l.label ||
           case when p_kind = 'overdue' then ' — trễ lịch tuần ' || ((select wd from params) - l.weekday_end::int) || ' ngày'
                when p_kind = 'due' then ' — hạn tuần hôm nay'
                else ' — ' || wd_label(l.weekday_start::int) || '→' || wd_label(l.weekday_end::int) end as line
    from labelled l, params
    where l.work_mode = 'routine' and l.weekday_start is not null and l.weekday_end is not null
      and case p_kind
            when 'today'      then not is_done(l.eff_status) and params.wd >= l.weekday_start::int and params.wd < l.weekday_end::int
            when 'due'        then not is_done(l.eff_status) and params.wd = l.weekday_end::int
            when 'overdue'    then not is_done(l.eff_status) and params.wd > l.weekday_end::int
            when 'done_today' then is_done(l.eff_status) and (l.inst_updated at time zone 'Asia/Ho_Chi_Minh')::date = params.d
            when 'tomorrow'   then not is_done(l.eff_status) and params.wd = l.weekday_start::int
            else false end
    union all
    -- Task theo project / phát sinh
    select 2, l.label ||
           case when p_kind = 'overdue' then ' — trễ ' || (params.d - l.deadline::date) || ' ngày'
                when p_kind in ('today', 'tomorrow') and l.deadline is not null and l.deadline::date > params.d
                  then ' — hạn ' || to_char(l.deadline::date, 'DD/MM')
                else '' end
    from labelled l, params
    where l.work_mode is distinct from 'routine'
      and case p_kind
            when 'today'      then not is_done(l.status) and l.execution_date::date <= params.d
                                   and coalesce(l.deadline::date, l.execution_date::date + 1) > params.d
                                   and l.execution_date is not null
            when 'due'        then not is_done(l.status) and l.deadline::date = params.d
            when 'overdue'    then not is_done(l.status) and l.deadline::date < params.d
            when 'done_today' then is_done(l.status) and (l.updated_at::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date = params.d
            when 'tomorrow'   then not is_done(l.status) and (l.execution_date::date = params.d or l.deadline::date = params.d)
            else false end
  ) x
  order by ord, line
$$;

create or replace function darcy_bot.schedule_lines(p_day date) returns setof text
language sql stable set search_path = public, darcy_bot as $$
  select '• ' || coalesce(to_char(s.start_time::time, 'HH24:MI') || ' · ', '') || esc(s.title) ||
         coalesce(' — 📍 ' || nullif(esc(s.location), ''), '')
  from personal_schedule s
  where s.event_date::date = p_day and not coalesce(s.completed, false)
  order by s.start_time nulls last
$$;

create or replace function darcy_bot.block(title text, lines text[], empty_text text, max_items int default 12)
returns text language sql immutable as $$
  select '<b>' || title || '</b>' || chr(10) ||
         case when coalesce(array_length(lines, 1), 0) = 0 then empty_text
              else array_to_string(lines[1:max_items], chr(10)) ||
                   case when array_length(lines, 1) > max_items
                        then chr(10) || '… và ' || (array_length(lines, 1) - max_items) || ' việc khác' else '' end
         end
$$;

-- 1) Nhắc lịch trình — chạy mỗi phút ------------------------------------
create or replace function darcy_bot.schedule_reminders() returns int
language plpgsql set search_path = public, darcy_bot as $$
declare
  rec record;
  now_vn timestamp := vn_now();
  event_at timestamp;
  minutes_left int;
  sent int := 0;
begin
  for rec in
    select * from personal_schedule
    where not coalesce(completed, false)
      and reminder_minutes is not null and start_time is not null
      and event_date::date between now_vn::date and (now_vn + interval '2 days')::date
  loop
    event_at := rec.event_date::date + rec.start_time::time;
    -- Đến giờ nhắc và sự kiện chưa bắt đầu quá 5 phút → gửi (kể cả khi trễ vài phút)
    if now_vn >= event_at - make_interval(mins => rec.reminder_minutes::int)
       and now_vn < event_at + interval '5 minutes' then
      -- claim() tách riêng để chỉ ghi log khi thật sự đến giờ gửi
      continue when not claim('schedule|' || rec.id || '|' || event_at || '|' || rec.reminder_minutes);
      minutes_left := greatest(0, ceil(extract(epoch from (event_at - now_vn)) / 60)::int);
      perform send(
        '🔔 <b>Nhắc lịch: ' || esc(rec.title) || '</b>' || chr(10) ||
        '⏰ ' || to_char(rec.start_time::time, 'HH24:MI') ||
        coalesce(' → ' || to_char(rec.end_time::time, 'HH24:MI'), '') ||
        ' · ' || case when minutes_left = 0 then 'bắt đầu ngay bây giờ' else 'còn ' || minutes_left || ' phút' end ||
        coalesce(chr(10) || '📍 ' || nullif(esc(rec.location), ''), '') ||
        coalesce(chr(10) || '📝 ' || nullif(esc(rec.notes), ''), '') ||
        coalesce(chr(10) || '🔗 ' || nullif(esc(rec.url), ''), '')
      );
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end $$;

-- 2) Daily Brief 08:00 ----------------------------------------------------
create or replace function darcy_bot.daily_brief(force boolean default false) returns boolean
language plpgsql set search_path = public, darcy_bot as $$
declare
  today date := vn_now()::date;
  today_lines text[]; due_lines text[]; overdue_lines text[]; schedule_list text[]; project_lines text[];
begin
  if not force then
    if not claim('brief|' || today) then return false; end if;
  end if;
  today_lines   := array(select task_lines('today', today));
  due_lines     := array(select task_lines('due', today));
  overdue_lines := array(select task_lines('overdue', today));
  schedule_list := array(select schedule_lines(today));
  project_lines := array(
    select '• ' || esc(name) || ' — ' ||
           case when deadline::date = today then 'hạn hôm nay' else 'còn ' || (deadline::date - today) || ' ngày' end
    from projects
    where not is_done(status) and deadline::date between today and today + 7
    order by deadline);

  perform send(
    '☀️ <b>Chào buổi sáng Darcy!</b> · ' || to_char(today, 'DD/MM/YYYY') || chr(10) ||
    'Hôm nay: <b>' || coalesce(array_length(today_lines, 1), 0) || '</b> việc · <b>' ||
    coalesce(array_length(due_lines, 1), 0) || '</b> deadline · <b>' ||
    coalesce(array_length(overdue_lines, 1), 0) || '</b> quá hạn · <b>' ||
    coalesce(array_length(schedule_list, 1), 0) || '</b> lịch hẹn' || chr(10) || chr(10) ||
    block('🔴 Quá hạn — xử lý trước', overdue_lines, '• Không có, tuyệt vời 🎉') || chr(10) || chr(10) ||
    block('⏰ Tới hạn hôm nay', due_lines, '• Không có deadline hôm nay') || chr(10) || chr(10) ||
    block('🗓 Việc đang làm (chưa tới hạn)', today_lines, '• Không có việc nào khác') || chr(10) || chr(10) ||
    block('◷ Lịch trình', schedule_list, '• Không có lịch hẹn') ||
    case when coalesce(array_length(project_lines, 1), 0) > 0
         then chr(10) || chr(10) || block('▣ Project sắp tới hạn (7 ngày)', project_lines, '') else '' end ||
    chr(10) || chr(10) || '👉 <a href="https://luccung2016-ui.github.io/Darcy-Space/">Mở Darcy''s Space</a>'
  );
  return true;
end $$;

-- 3) Tổng kết 18:00 + xem trước ngày mai -----------------------------------
create or replace function darcy_bot.evening_recap(force boolean default false) returns boolean
language plpgsql set search_path = public, darcy_bot as $$
declare
  today date := vn_now()::date;
  tomorrow date := vn_now()::date + 1;
  done_lines text[]; left_lines text[]; overdue_lines text[]; tomorrow_lines text[]; tomorrow_schedule text[];
begin
  if not force then
    if not claim('recap|' || today) then return false; end if;
  end if;
  done_lines        := array(select task_lines('done_today', today));
  left_lines        := array(select task_lines('due', today));
  overdue_lines     := array(select task_lines('overdue', today));
  tomorrow_lines    := array(select task_lines('tomorrow', tomorrow));
  tomorrow_schedule := array(select schedule_lines(tomorrow));

  perform send(
    '🌙 <b>Tổng kết ngày</b> · ' || to_char(today, 'DD/MM/YYYY') || chr(10) || chr(10) ||
    block('✅ Đã hoàn thành hôm nay (' || coalesce(array_length(done_lines, 1), 0) || ')', done_lines, '• Chưa ghi nhận việc hoàn thành nào') || chr(10) || chr(10) ||
    block('⏳ Deadline hôm nay chưa xong', left_lines, '• Không còn, xong hết rồi 🎉') || chr(10) || chr(10) ||
    block('🔴 Đang quá hạn', overdue_lines, '• Không có') || chr(10) || chr(10) ||
    block('📅 Ngày mai · việc bắt đầu / tới hạn', tomorrow_lines, '• Chưa có việc nào') || chr(10) || chr(10) ||
    block('◷ Lịch trình ngày mai', tomorrow_schedule, '• Không có lịch hẹn') ||
    chr(10) || chr(10) || '👉 <a href="https://luccung2016-ui.github.io/Darcy-Space/">Mở Darcy''s Space</a>'
  );
  return true;
end $$;

revoke all on all functions in schema darcy_bot from public, anon, authenticated;
revoke all on all tables in schema darcy_bot from public, anon, authenticated;

-- Lịch chạy (pg_cron dùng giờ UTC: 01:00 UTC = 08:00 VN, 11:00 UTC = 18:00 VN)
select cron.unschedule(jobid) from cron.job
where jobname in ('darcy-schedule-reminders', 'darcy-daily-brief', 'darcy-evening-recap', 'darcy-retry-failed');

select cron.schedule('darcy-schedule-reminders', '* * * * *', 'select darcy_bot.schedule_reminders()');
select cron.schedule('darcy-daily-brief',        '0 1 * * *', 'select darcy_bot.daily_brief()');
select cron.schedule('darcy-evening-recap',      '0 11 * * *', 'select darcy_bot.evening_recap()');
select cron.schedule('darcy-retry-failed',       '* * * * *', 'select darcy_bot.retry_failed()');

-- Dọn log cũ mỗi Chủ nhật
select cron.unschedule(jobid) from cron.job where jobname = 'darcy-cleanup-log';
select cron.schedule('darcy-cleanup-log', '0 20 * * 0', $$delete from darcy_bot.sent_log where sent_at < now() - interval '30 days'; delete from darcy_bot.outbox where created_at < now() - interval '30 days'$$);

-- KIỂM TRA SAU KHI CÀI (chạy riêng từng dòng):
--   select darcy_bot.send('✅ Darcy Space đã kết nối Telegram');
--   select darcy_bot.daily_brief(true);     -- gửi thử Daily Brief ngay
--   select darcy_bot.evening_recap(true);   -- gửi thử Tổng kết ngay
--   select jobname, schedule, active from cron.job where jobname like 'darcy-%';
--   select status_code, content from net._http_response order by created desc limit 5;
