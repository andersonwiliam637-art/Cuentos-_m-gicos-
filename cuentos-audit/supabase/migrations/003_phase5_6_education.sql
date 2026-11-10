-- Fase 5.5 + 6: edición segura, URLs firmadas y actividades educativas.

-- A character belongs to the authenticated adult account. The client never supplies user_id for updates.
create or replace function public.update_character(p_character_id uuid, p_name text, p_description text, p_visual_traits text, p_interests text[])
returns public.characters
language plpgsql
security invoker
set search_path = public
as $$
declare v_character public.characters;
begin
  update public.characters
     set name = left(trim(p_name), 60),
         description = left(coalesce(trim(p_description), ''), 500),
         visual_traits = left(coalesce(trim(p_visual_traits), ''), 500),
         favorite_interests = coalesce(p_interests, '{}')
   where id = p_character_id and user_id = auth.uid()
   returning * into v_character;
  if not found then raise exception 'character_not_found'; end if;
  return v_character;
end;
$$;
grant execute on function public.update_character(uuid,text,text,text,text[]) to authenticated;

create table if not exists public.educational_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  story_id uuid references public.stories(id) on delete set null,
  character_id uuid references public.characters(id) on delete set null,
  activity_type text not null check (activity_type in ('comprehension','math','science','vocabulary','logic','creativity','values')),
  age integer not null check (age between 4 and 12),
  title text not null check (char_length(title) between 1 and 120),
  instructions text not null check (char_length(instructions) between 1 and 1500),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists educational_activities_user_created_idx on public.educational_activities(user_id, created_at desc);
create index if not exists educational_activities_story_idx on public.educational_activities(story_id, created_at desc);

create table if not exists public.activity_attempts (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.educational_activities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answer jsonb not null default '{}'::jsonb,
  is_correct boolean,
  feedback text,
  created_at timestamptz not null default now()
);
create index if not exists activity_attempts_user_created_idx on public.activity_attempts(user_id, created_at desc);
create index if not exists activity_attempts_activity_idx on public.activity_attempts(activity_id, created_at desc);

alter table public.educational_activities enable row level security;
alter table public.activity_attempts enable row level security;
create policy educational_activities_select_own on public.educational_activities for select to authenticated using (auth.uid() = user_id);
create policy educational_activities_insert_own on public.educational_activities for insert to authenticated with check (auth.uid() = user_id);
create policy activity_attempts_select_own on public.activity_attempts for select to authenticated using (auth.uid() = user_id);
create policy activity_attempts_insert_own on public.activity_attempts for insert to authenticated with check (auth.uid() = user_id and exists (select 1 from public.educational_activities a where a.id = activity_id and a.user_id = auth.uid()));

-- Keep the activity's answer key server-readable only. It is stored under payload.answerKey.
-- Client-facing routes must strip it before returning an activity.
