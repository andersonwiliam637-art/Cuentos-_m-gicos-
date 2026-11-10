-- Fases 13–16: biblioteca, seguridad de contenido, rate limiting y preparación operativa.

create table if not exists public.api_rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key(user_id, bucket)
);
alter table public.api_rate_limits enable row level security;

create or replace function public.check_rate_limit(p_user_id uuid, p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_count integer; v_started timestamptz;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not_authorized'; end if;
  insert into public.api_rate_limits(user_id,bucket,window_started_at,request_count)
  values(p_user_id,p_bucket,now(),1)
  on conflict(user_id,bucket) do update set
    window_started_at = case when now() - api_rate_limits.window_started_at >= make_interval(secs => p_window_seconds) then now() else api_rate_limits.window_started_at end,
    request_count = case when now() - api_rate_limits.window_started_at >= make_interval(secs => p_window_seconds) then 1 else api_rate_limits.request_count + 1 end;
  select request_count, window_started_at into v_count,v_started from public.api_rate_limits where user_id=p_user_id and bucket=p_bucket;
  return v_count <= p_limit;
end; $$;
grant execute on function public.check_rate_limit(uuid,text,integer,integer) to authenticated;

create index if not exists safety_events_user_created_idx on public.safety_events(user_id,created_at desc);
create index if not exists payment_events_created_idx on public.payment_events(created_at desc);

-- Evita que un perfil de aprendizaje pueda ser vinculado a actividades de otra cuenta.
drop policy if exists educational_activities_select_own on public.educational_activities;
create policy educational_activities_select_own on public.educational_activities for select to authenticated
using (auth.uid() = user_id);

-- Solo el adulto propietario puede consultar sus propios agregados.
drop policy if exists learner_progress_update_own on public.learner_progress;
create policy learner_progress_update_own on public.learner_progress for update to authenticated
using (exists(select 1 from public.learner_profiles lp where lp.id=learner_id and lp.user_id=auth.uid()))
with check (exists(select 1 from public.learner_profiles lp where lp.id=learner_id and lp.user_id=auth.uid()));
