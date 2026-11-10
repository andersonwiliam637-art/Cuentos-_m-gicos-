-- Production hardening: privileged atomic RPCs enforce auth.uid() and cannot be called as another user.
-- Apply after migrations 001-006 in staging first.

create or replace function public.reserve_story_generation(p_user_id uuid)
returns table(job_id uuid, allowed boolean, used integer, limit_count integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan public.plan_type; v_limit integer; v_used integer; v_active integer; v_job uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not_authorized' using errcode = '42501'; end if;
  select plan_type into v_plan from public.profiles where id = p_user_id for update;
  if v_plan is null then raise exception 'profile_not_found'; end if;
  v_limit := case when v_plan = 'free' then 2 else 1000000 end;
  update public.story_generation_jobs set status='failed', error_code='reservation_expired', completed_at=now()
   where user_id=p_user_id and status='reserved' and expires_at < now();
  select count(*)::int into v_used from public.stories where user_id=p_user_id and created_at >= now()-interval '30 days';
  select count(*)::int into v_active from public.story_generation_jobs where user_id=p_user_id and status='reserved' and expires_at >= now();
  if v_used + v_active >= v_limit then return query select null::uuid,false,v_used+v_active,v_limit; return; end if;
  insert into public.story_generation_jobs(user_id,status) values(p_user_id,'reserved') returning id into v_job;
  return query select v_job,true,v_used+v_active+1,v_limit;
end; $$;

create or replace function public.complete_story_generation(p_job_id uuid, p_story_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_story_owner uuid;
begin
  if auth.uid() is null then raise exception 'not_authorized' using errcode='42501'; end if;
  select user_id into v_story_owner from public.stories where id=p_story_id;
  if v_story_owner is distinct from auth.uid() then raise exception 'story_not_owned' using errcode='42501'; end if;
  update public.story_generation_jobs set status='completed',story_id=p_story_id,completed_at=now()
   where id=p_job_id and user_id=auth.uid() and status='reserved';
  if not found then raise exception 'invalid_generation_job'; end if;
end; $$;

create or replace function public.fail_story_generation(p_job_id uuid, p_error_code text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not_authorized' using errcode='42501'; end if;
  update public.story_generation_jobs set status='failed',error_code=left(coalesce(p_error_code,'generation_failed'),100),completed_at=now()
   where id=p_job_id and user_id=auth.uid() and status='reserved';
end; $$;

create or replace function public.check_rate_limit(p_user_id uuid, p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not_authorized' using errcode='42501'; end if;
  if p_bucket is null or length(p_bucket) not between 1 and 80 or p_limit < 1 or p_window_seconds < 1 then raise exception 'invalid_rate_limit_parameters'; end if;
  insert into public.api_rate_limits(user_id,bucket,window_started_at,request_count) values(p_user_id,p_bucket,now(),1)
  on conflict(user_id,bucket) do update set
    window_started_at=case when now()-api_rate_limits.window_started_at >= make_interval(secs=>p_window_seconds) then now() else api_rate_limits.window_started_at end,
    request_count=case when now()-api_rate_limits.window_started_at >= make_interval(secs=>p_window_seconds) then 1 else api_rate_limits.request_count+1 end;
  select request_count into v_count from public.api_rate_limits where user_id=p_user_id and bucket=p_bucket;
  return v_count <= p_limit;
end; $$;

revoke all on function public.reserve_story_generation(uuid) from public, anon;
revoke all on function public.complete_story_generation(uuid,uuid) from public, anon;
revoke all on function public.fail_story_generation(uuid,text) from public, anon;
revoke all on function public.check_rate_limit(uuid,text,integer,integer) from public, anon;
grant execute on function public.reserve_story_generation(uuid) to authenticated;
grant execute on function public.complete_story_generation(uuid,uuid) to authenticated;
grant execute on function public.fail_story_generation(uuid,text) to authenticated;
grant execute on function public.check_rate_limit(uuid,text,integer,integer) to authenticated;

-- Recurrente-only production billing metadata. Existing records are preserved.
alter table public.payment_orders add column if not exists external_subscription_id text;
create index if not exists payment_orders_recurrente_subscription_idx on public.payment_orders(external_subscription_id) where external_subscription_id is not null;
