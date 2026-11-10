-- Fase 4.5: hardening + Fase 5: ilustraciones y personajes

create extension if not exists pgcrypto;

-- Profiles: prevent clients from changing billing/security fields.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if new.plan_type is distinct from old.plan_type
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.id is distinct from old.id
       or new.email is distinct from old.email then
      raise exception 'protected_profile_fields';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_fields on public.profiles;
create trigger protect_profile_fields
before update on public.profiles
for each row execute function public.protect_profile_fields();

drop policy if exists profiles_update_safe on public.profiles;
create policy profiles_update_public_fields on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Generation jobs make quota reservation explicit and recoverable after crashes.
create table if not exists public.story_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('reserved','completed','failed')),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  story_id uuid references public.stories(id) on delete set null,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists story_generation_jobs_user_status_idx
  on public.story_generation_jobs(user_id, status, created_at desc);

alter table public.story_generation_jobs enable row level security;
create policy story_generation_jobs_select_own on public.story_generation_jobs
for select to authenticated using (auth.uid() = user_id);

create or replace function public.reserve_story_generation(p_user_id uuid)
returns table(job_id uuid, allowed boolean, used integer, limit_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan public.plan_type;
  v_limit integer;
  v_used integer;
  v_active integer;
  v_job uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not_authorized'; end if;

  select plan_type into v_plan from public.profiles where id = p_user_id for update;
  if v_plan is null then raise exception 'profile_not_found'; end if;

  -- Free users: two successful stories in a rolling 30-day window.
  if v_plan = 'free' then v_limit := 2; else v_limit := 1000000; end if;

  -- Expire abandoned reservations.
  update public.story_generation_jobs
     set status = 'failed', error_code = 'reservation_expired', completed_at = now()
   where user_id = p_user_id and status = 'reserved' and expires_at < now();

  select count(*)::int into v_used
  from public.stories
  where user_id = p_user_id and created_at >= now() - interval '30 days';

  select count(*)::int into v_active
  from public.story_generation_jobs
  where user_id = p_user_id and status = 'reserved' and expires_at >= now();

  if v_used + v_active >= v_limit then
    return query select null::uuid, false, v_used + v_active, v_limit;
    return;
  end if;

  insert into public.story_generation_jobs(user_id, status)
  values (p_user_id, 'reserved')
  returning id into v_job;

  return query select v_job, true, v_used + v_active + 1, v_limit;
end;
$$;

grant execute on function public.reserve_story_generation(uuid) to authenticated;

create or replace function public.complete_story_generation(p_job_id uuid, p_story_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.story_generation_jobs
     set status = 'completed', story_id = p_story_id, completed_at = now()
   where id = p_job_id and user_id = auth.uid() and status = 'reserved';
  if not found then raise exception 'invalid_generation_job'; end if;
end;
$$;
grant execute on function public.complete_story_generation(uuid, uuid) to authenticated;

create or replace function public.fail_story_generation(p_job_id uuid, p_error_code text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.story_generation_jobs
     set status = 'failed', error_code = left(coalesce(p_error_code,'generation_failed'), 100), completed_at = now()
   where id = p_job_id and user_id = auth.uid() and status = 'reserved';
end;
$$;
grant execute on function public.fail_story_generation(uuid, text) to authenticated;

-- Phase 5: persistent characters and illustration metadata.
create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '',
  visual_traits text not null default '',
  favorite_interests text[] not null default '{}',
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists characters_user_id_idx on public.characters(user_id, created_at desc);
create trigger characters_updated_at before update on public.characters
for each row execute function public.set_updated_at();

alter table public.characters enable row level security;
create policy characters_select_own on public.characters for select to authenticated using (auth.uid() = user_id);
create policy characters_insert_own on public.characters for insert to authenticated with check (auth.uid() = user_id);
create policy characters_update_own on public.characters for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy characters_delete_own on public.characters for delete to authenticated using (auth.uid() = user_id);

-- Add character linkage to illustrations without forcing it on existing stories.
alter table public.illustrations add column if not exists character_id uuid references public.characters(id) on delete set null;
alter table public.illustrations add column if not exists generation_status text not null default 'pending'
  check (generation_status in ('pending','processing','completed','failed'));
alter table public.illustrations add column if not exists error_message text;
create index if not exists illustrations_story_position_idx on public.illustrations(story_id, position);

create policy illustrations_insert_story_owner on public.illustrations
for insert to authenticated
with check (exists(select 1 from public.stories s where s.id=story_id and s.user_id=auth.uid()));
create policy illustrations_update_story_owner on public.illustrations
for update to authenticated
using (exists(select 1 from public.stories s where s.id=story_id and s.user_id=auth.uid()))
with check (exists(select 1 from public.stories s where s.id=story_id and s.user_id=auth.uid()));
create policy illustrations_delete_story_owner on public.illustrations
for delete to authenticated
using (exists(select 1 from public.stories s where s.id=story_id and s.user_id=auth.uid()));

-- Storage bucket for generated art. Keep objects private; access is mediated by authenticated app routes.
insert into storage.buckets (id, name, public)
values ('story-art', 'story-art', false)
on conflict (id) do nothing;

create policy story_art_select_own on storage.objects for select to authenticated
using (bucket_id = 'story-art' and (storage.foldername(name))[1] = auth.uid()::text);
create policy story_art_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'story-art' and (storage.foldername(name))[1] = auth.uid()::text);
create policy story_art_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'story-art' and (storage.foldername(name))[1] = auth.uid()::text);
