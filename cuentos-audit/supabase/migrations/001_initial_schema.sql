create extension if not exists pgcrypto;

create type public.plan_type as enum ('free','family','premium');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  plan_type public.plan_type not null default 'free',
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  protagonist_name text not null,
  age_range text,
  moral_lesson text,
  story_content text not null,
  is_premium boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stories_user_id_created_at_idx on public.stories(user_id, created_at desc);

create table public.illustrations (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  image_url text,
  prompt text,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  unique(story_id, position)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stripe_subscription_id text unique,
  status text not null check (status in ('trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired')),
  price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_id_idx on public.subscriptions(user_id);

create table public.story_usage (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  period_start date not null default current_date,
  stories_created integer not null default 0 check (stories_created >= 0),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger stories_updated_at before update on public.stories for each row execute function public.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
create trigger story_usage_updated_at before update on public.story_usage for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,email) values(new.id,new.email) on conflict (id) do nothing;
  insert into public.story_usage(user_id) values(new.id) on conflict (user_id) do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.consume_story_quota(p_user_id uuid)
returns table(allowed boolean, used integer, limit_count integer)
language plpgsql security invoker set search_path = public as $$
declare v_plan public.plan_type; v_count integer; v_limit integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not_authorized'; end if;
  select plan_type into v_plan from public.profiles where id=p_user_id;
  if v_plan = 'free' then v_limit := 2; else v_limit := 1000000; end if;
  insert into public.story_usage(user_id,period_start,stories_created) values(p_user_id,current_date,0) on conflict(user_id) do nothing;
  update public.story_usage set period_start = current_date, stories_created = 0 where user_id=p_user_id and period_start < current_date - 30;
  update public.story_usage set stories_created=stories_created+1 where user_id=p_user_id and stories_created < v_limit returning stories_created into v_count;
  if v_count is null then select stories_created into v_count from public.story_usage where user_id=p_user_id; return query select false,v_count,v_limit; else return query select true,v_count,v_limit; end if;
end; $$;

grant execute on function public.consume_story_quota(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.stories enable row level security;
alter table public.illustrations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.story_usage enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "profiles_update_safe" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "stories_select_own" on public.stories for select to authenticated using (auth.uid() = user_id);
create policy "stories_insert_own" on public.stories for insert to authenticated with check (auth.uid() = user_id);
create policy "stories_update_own" on public.stories for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "stories_delete_own" on public.stories for delete to authenticated using (auth.uid() = user_id);
create policy "illustrations_select_story_owner" on public.illustrations for select to authenticated using (exists(select 1 from public.stories s where s.id=story_id and s.user_id=auth.uid()));
create policy "subscriptions_select_own" on public.subscriptions for select to authenticated using (auth.uid() = user_id);
create policy "usage_select_own" on public.story_usage for select to authenticated using (auth.uid() = user_id);
