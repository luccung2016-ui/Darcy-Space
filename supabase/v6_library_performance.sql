-- =====================================================================
-- Darcy Space v6 · Library ghim tài liệu + phân loại lại "Khác"
--                · Nhắc cập nhật số liệu Performance mỗi thứ Hai
-- Chạy file này MỘT LẦN trong Supabase → SQL Editor (sau telegram_reminders.sql).
-- Chạy lại vẫn an toàn.
-- =====================================================================

-- 1) Library: cột ghim tài liệu ------------------------------------------
alter table public.library_resources add column if not exists pinned boolean not null default false;

-- 2) Library: phân loại lại các tài liệu đang để "Khác" ---------------------
update public.library_resources set resource_type = 'Hub / Công cụ'
where resource_type ilike 'khác' and name ilike 'marketing hub%';

update public.library_resources set resource_type = 'Báo cáo'
where resource_type ilike 'khác' and (name ilike '%report%' or name ilike '%báo cáo%');

update public.library_resources set resource_type = 'Source / Folder'
where resource_type ilike 'khác' and (name ilike '%materials%' or name ilike '%source%' or name ilike '%folder%');

-- Gộp các cách viết khác nhau ("KHÁC", "khác") về một tên
update public.library_resources set resource_type = 'Khác'
where resource_type ilike 'khác' and resource_type <> 'Khác';

-- 3) Telegram: nhắc cập nhật số liệu tuần trước (thứ Hai 09:25) -----------
create or replace function darcy_bot.performance_reminder(force boolean default false) returns boolean
language plpgsql set search_path = public, darcy_bot as $$
declare
  today date := vn_now()::date;
  last_monday date := date_trunc('week', vn_now())::date - 7;
  fb_last date;
  tt_last date;
  fb_ok boolean;
  tt_ok boolean;
begin
  if not force then
    if not claim('performance|' || today) then return false; end if;
  end if;
  select max(period_start::date) into fb_last from performance_facebook;
  select max(period_start::date) into tt_last from performance_tiktok;
  fb_ok := coalesce(fb_last >= last_monday, false);
  tt_ok := coalesce(tt_last >= last_monday, false);

  perform send(
    '📊 <b>Nhắc cập nhật số liệu Performance</b>' || chr(10) ||
    'Tuần trước: ' || to_char(last_monday, 'DD/MM') || ' – ' || to_char(last_monday + 6, 'DD/MM/YYYY') || chr(10) || chr(10) ||
    case when fb_ok then '✅' else '⏳' end || ' Facebook · kỳ gần nhất đã nhập: ' ||
      coalesce(to_char(fb_last, 'DD/MM/YYYY'), 'chưa có') || chr(10) ||
    case when tt_ok then '✅' else '⏳' end || ' TikTok · kỳ gần nhất đã nhập: ' ||
      coalesce(to_char(tt_last, 'DD/MM/YYYY'), 'chưa có') || chr(10) || chr(10) ||
    case when fb_ok and tt_ok
         then 'Số liệu tuần trước đã đủ, tuyệt vời 🎉'
         else 'Vào <b>Hiệu quả kênh</b> → <b>＋ Cập nhật số liệu</b> để nhập số liệu tuần trước nhé.' end ||
    chr(10) || chr(10) || '👉 <a href="https://luccung2016-ui.github.io/Darcy-Space/">Mở Darcy''s Space</a>'
  );
  return true;
end $$;

revoke all on all functions in schema darcy_bot from public, anon, authenticated;

-- pg_cron dùng giờ UTC: 02:25 UTC thứ Hai = 09:25 thứ Hai giờ Việt Nam
select cron.unschedule(jobid) from cron.job where jobname = 'darcy-performance-reminder';
select cron.schedule('darcy-performance-reminder', '25 2 * * 1', 'select darcy_bot.performance_reminder()');

-- KIỂM TRA (chạy riêng):
--   select darcy_bot.performance_reminder(true);   -- gửi thử ngay
--   select jobname, schedule, active from cron.job where jobname like 'darcy-%';
