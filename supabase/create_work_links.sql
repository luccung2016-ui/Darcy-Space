create table if not exists public.work_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  url text not null check (url ~* '^https?://'),
  document_type text not null default 'Khác'
    check (document_type in (
      'Google Docs Content',
      'Canva Visual',
      'Drive/Source',
      'Facebook/TikTok Post',
      'Website',
      'Khác'
    )),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_links_exactly_one_parent
    check ((task_id is not null) <> (project_id is not null))
);

create index if not exists work_links_task_position_idx
  on public.work_links(task_id, position)
  where task_id is not null;

create index if not exists work_links_project_position_idx
  on public.work_links(project_id, position)
  where project_id is not null;

alter table public.work_links enable row level security;

grant select, insert, update, delete
  on public.work_links
  to authenticated;

drop policy if exists authenticated_read_work_links on public.work_links;
create policy authenticated_read_work_links
  on public.work_links for select
  to authenticated
  using (true);

drop policy if exists authenticated_insert_work_links on public.work_links;
create policy authenticated_insert_work_links
  on public.work_links for insert
  to authenticated
  with check (true);

drop policy if exists authenticated_update_work_links on public.work_links;
create policy authenticated_update_work_links
  on public.work_links for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists authenticated_delete_work_links on public.work_links;
create policy authenticated_delete_work_links
  on public.work_links for delete
  to authenticated
  using (true);

comment on table public.work_links is
  'Named working-file links attached to exactly one task or project.';
