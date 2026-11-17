-- JEE OneShot OS isolated cloud snapshot table.
-- This migration was applied to project bztsnkejidzjjlaghtly for this build.
create table if not exists public.jee_one_shot_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb
    check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 1000000),
  updated_at timestamptz not null default now()
);
alter table public.jee_one_shot_progress enable row level security;
drop policy if exists jee_one_shot_progress_select on public.jee_one_shot_progress;
drop policy if exists jee_one_shot_progress_insert on public.jee_one_shot_progress;
drop policy if exists jee_one_shot_progress_update on public.jee_one_shot_progress;
drop policy if exists jee_one_shot_progress_delete on public.jee_one_shot_progress;
create policy jee_one_shot_progress_select on public.jee_one_shot_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy jee_one_shot_progress_insert on public.jee_one_shot_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy jee_one_shot_progress_update on public.jee_one_shot_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy jee_one_shot_progress_delete on public.jee_one_shot_progress for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.jee_one_shot_progress to authenticated;
