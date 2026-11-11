-- Limits are DB-owned; authenticated callers cannot choose their own quota or window.
-- Apply after migration 007 in staging first, then validate before production.

drop function if exists public.check_rate_limit(uuid, text, integer, integer);

create or replace function public.check_rate_limit(p_bucket text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer;
  v_window_seconds integer;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  case p_bucket
    when 'story_generation' then v_limit := 5; v_window_seconds := 60;
    when 'illustration_generation' then v_limit := 5; v_window_seconds := 60;
    when 'activity_generation' then v_limit := 10; v_window_seconds := 60;
    when 'activity_attempt' then v_limit := 30; v_window_seconds := 60;
    else raise exception 'invalid_rate_limit_bucket' using errcode = '22023';
  end case;

  insert into public.api_rate_limits(user_id, bucket, window_started_at, request_count)
  values (v_user_id, p_bucket, now(), 1)
  on conflict (user_id, bucket) do update set
    window_started_at = case
      when now() - api_rate_limits.window_started_at >= make_interval(secs => v_window_seconds)
        then now()
      else api_rate_limits.window_started_at
    end,
    request_count = case
      when now() - api_rate_limits.window_started_at >= make_interval(secs => v_window_seconds)
        then 1
      else api_rate_limits.request_count + 1
    end;

  select request_count into v_count
  from public.api_rate_limits
  where user_id = v_user_id and bucket = p_bucket;

  return v_count <= v_limit;
end;
$$;

revoke all on function public.check_rate_limit(text) from public, anon;
grant execute on function public.check_rate_limit(text) to authenticated;

-- Atomically reserve the illustration row and its position while holding the story lock.
create or replace function public.reserve_illustration(
  p_story_id uuid,
  p_character_id uuid,
  p_prompt text
)
returns table(illustration_id uuid, position integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_position integer;
  v_illustration_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_prompt is null or length(trim(p_prompt)) not between 1 and 5000 then
    raise exception 'invalid_illustration_prompt' using errcode = '22023';
  end if;

  perform 1 from public.stories
  where id = p_story_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'story_not_found' using errcode = '42501';
  end if;

  if p_character_id is not null then
    perform 1 from public.characters
    where id = p_character_id and user_id = v_user_id;

    if not found then
      raise exception 'character_not_found' using errcode = '42501';
    end if;
  end if;

  select coalesce(max(i.position), -1) + 1 into v_position
  from public.illustrations i
  where i.story_id = p_story_id;

  insert into public.illustrations(story_id, character_id, prompt, position, generation_status)
  values (p_story_id, p_character_id, p_prompt, v_position, 'processing')
  returning id into v_illustration_id;

  return query select v_illustration_id, v_position;
end;
$$;

revoke all on function public.reserve_illustration(uuid, uuid, text) from public, anon;
grant execute on function public.reserve_illustration(uuid, uuid, text) to authenticated;
