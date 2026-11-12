-- Cuentos Mágicos monthly plans, transparent entitlements, and server-enforced AI quotas.
-- Apply only after migrations 001-008 have been verified in a dedicated staging database.

alter table public.profiles
  add column if not exists plan_code text not null default 'free';

-- Preserve access for any pre-existing legacy plan values.
update public.profiles
set plan_code = case plan_type::text
  when 'family' then 'family_premium'
  when 'premium' then 'plus_family'
  else 'free'
end
where plan_code = 'free' and plan_type::text <> 'free';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_plan_code_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_plan_code_check
      check (plan_code in ('free', 'basic', 'family_premium', 'plus_family'));
  end if;
end $$;

create table if not exists public.ai_monthly_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  month_start date not null,
  story_generations integer not null default 0 check (story_generations >= 0),
  activity_generations integer not null default 0 check (activity_generations >= 0),
  illustration_generations integer not null default 0 check (illustration_generations >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month_start)
);

alter table public.ai_monthly_usage enable row level security;
-- No client policies: usage reservations are written only by SECURITY DEFINER RPCs.

create or replace function public.reserve_monthly_ai_usage(p_bucket text)
returns table(allowed boolean, used integer, limit_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan text;
  v_month date := date_trunc('month', now() at time zone 'America/Guatemala')::date;
  v_limit integer;
  v_used integer;
begin
  if v_user_id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_bucket not in ('story', 'activity', 'illustration') then
    raise exception 'invalid_ai_usage_bucket' using errcode = '22023';
  end if;

  -- Serialize quota reservations for one account, including concurrent requests.
  select plan_code into v_plan
  from public.profiles
  where id = v_user_id
  for update;

  if v_plan is null then
    raise exception 'profile_not_found';
  end if;

  v_limit := case v_plan
    when 'basic' then case p_bucket when 'story' then 8 when 'activity' then 12 else 3 end
    when 'family_premium' then case p_bucket when 'story' then 20 when 'activity' then 30 else 10 end
    when 'plus_family' then case p_bucket when 'story' then 40 when 'activity' then 60 else 20 end
    when 'family' then case p_bucket when 'story' then 20 when 'activity' then 30 else 10 end
    when 'premium' then case p_bucket when 'story' then 40 when 'activity' then 60 else 20 end
    else case p_bucket when 'story' then 2 when 'activity' then 3 else 0 end
  end;

  insert into public.ai_monthly_usage(user_id, month_start)
  values (v_user_id, v_month)
  on conflict (user_id, month_start) do nothing;

  if p_bucket = 'story' then
    select story_generations into v_used
    from public.ai_monthly_usage
    where user_id = v_user_id and month_start = v_month
    for update;
  elsif p_bucket = 'activity' then
    select activity_generations into v_used
    from public.ai_monthly_usage
    where user_id = v_user_id and month_start = v_month
    for update;
  else
    select illustration_generations into v_used
    from public.ai_monthly_usage
    where user_id = v_user_id and month_start = v_month
    for update;
  end if;

  if v_used >= v_limit then
    return query select false, v_used, v_limit;
    return;
  end if;

  if p_bucket = 'story' then
    update public.ai_monthly_usage
      set story_generations = story_generations + 1, updated_at = now()
      where user_id = v_user_id and month_start = v_month
      returning story_generations into v_used;
  elsif p_bucket = 'activity' then
    update public.ai_monthly_usage
      set activity_generations = activity_generations + 1, updated_at = now()
      where user_id = v_user_id and month_start = v_month
      returning activity_generations into v_used;
  else
    update public.ai_monthly_usage
      set illustration_generations = illustration_generations + 1, updated_at = now()
      where user_id = v_user_id and month_start = v_month
      returning illustration_generations into v_used;
  end if;

  return query select true, v_used, v_limit;
end;
$$;

revoke all on function public.reserve_monthly_ai_usage(text) from public, anon;
grant execute on function public.reserve_monthly_ai_usage(text) to authenticated;

-- Story generation now consumes a monthly entitlement instead of the former
-- effectively-unlimited paid-plan value.
create or replace function public.reserve_story_generation(p_user_id uuid)
returns table(job_id uuid, allowed boolean, used integer, limit_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job uuid;
  v_allowed boolean;
  v_used integer;
  v_limit integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select allowed, used, limit_count
    into v_allowed, v_used, v_limit
  from public.reserve_monthly_ai_usage('story');

  if not v_allowed then
    return query select null::uuid, false, v_used, v_limit;
    return;
  end if;

  update public.story_generation_jobs
    set status = 'failed', error_code = 'reservation_expired', completed_at = now()
    where user_id = p_user_id and status = 'reserved' and expires_at < now();

  insert into public.story_generation_jobs(user_id, status)
    values (p_user_id, 'reserved')
    returning id into v_job;

  return query select v_job, true, v_used, v_limit;
end;
$$;

revoke all on function public.reserve_story_generation(uuid) from public, anon;
grant execute on function public.reserve_story_generation(uuid) to authenticated;

-- Enforce the profile count at the database boundary to prevent concurrent
-- requests from exceeding a plan's profile allowance.
create or replace function public.enforce_learner_profile_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  if auth.uid() is not null and auth.uid() <> new.user_id then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select plan_code into v_plan
  from public.profiles
  where id = new.user_id
  for update;

  if v_plan is null then
    raise exception 'profile_not_found';
  end if;

  v_limit := case v_plan
    when 'basic' then 1
    when 'family_premium' then 3
    when 'plus_family' then 5
    when 'family' then 3
    when 'premium' then 5
    else 1
  end;

  select count(*)::integer into v_count
  from public.learner_profiles
  where user_id = new.user_id;

  if v_count >= v_limit then
    raise exception 'learner_profile_limit_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists learner_profile_plan_limit on public.learner_profiles;
create trigger learner_profile_plan_limit
before insert on public.learner_profiles
for each row execute function public.enforce_learner_profile_limit();

-- Trigger execution does not require exposing the SECURITY DEFINER trigger
-- function as a callable RPC endpoint.
revoke all on function public.enforce_learner_profile_limit() from public, anon, authenticated;

