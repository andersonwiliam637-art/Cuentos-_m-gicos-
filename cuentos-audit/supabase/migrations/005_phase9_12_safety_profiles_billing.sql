-- Fases 9–12: seguridad educativa, perfiles de aprendizaje y billing agnóstico.

-- Nunca dejamos answerKey en una tabla legible por el cliente.
create table if not exists public.educational_answer_keys (
  activity_id uuid primary key references public.educational_activities(id) on delete cascade,
  answer_key text not null check (char_length(answer_key) between 1 and 500),
  explanation text not null check (char_length(explanation) between 1 and 800),
  created_at timestamptz not null default now()
);
alter table public.educational_answer_keys enable row level security;
-- Sin policies SELECT/INSERT/UPDATE/DELETE para authenticated: solo server/service-role.

-- Elimina cualquier clave que pudiera existir en payload por versiones anteriores.
update public.educational_activities
set payload = payload - 'answerKey' - 'explanation'
where payload ? 'answerKey' or payload ? 'explanation';

-- Perfiles de aprendizaje mínimos: gestionados por el adulto, sin nombre legal ni datos sensibles.
create table if not exists public.learner_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 40),
  age integer not null check (age between 4 and 12),
  interests text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists learner_profiles_user_idx on public.learner_profiles(user_id, created_at desc);
alter table public.learner_profiles enable row level security;
create policy learner_profiles_select_own on public.learner_profiles for select to authenticated using (auth.uid() = user_id);
create policy learner_profiles_insert_own on public.learner_profiles for insert to authenticated with check (auth.uid() = user_id);
create policy learner_profiles_update_own on public.learner_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy learner_profiles_delete_own on public.learner_profiles for delete to authenticated using (auth.uid() = user_id);
create trigger learner_profiles_updated_at before update on public.learner_profiles for each row execute function public.set_updated_at();

-- Métricas agregadas para el adulto; no guardamos transcripciones innecesarias.
create table if not exists public.learner_progress (
  learner_id uuid primary key references public.learner_profiles(id) on delete cascade,
  stories_completed integer not null default 0 check (stories_completed >= 0),
  activities_attempted integer not null default 0 check (activities_attempted >= 0),
  activities_correct integer not null default 0 check (activities_correct >= 0),
  updated_at timestamptz not null default now()
);
alter table public.learner_progress enable row level security;
create policy learner_progress_select_own on public.learner_progress for select to authenticated
using (exists (select 1 from public.learner_profiles lp where lp.id = learner_id and lp.user_id = auth.uid()));

-- Billing agnóstico: no elegimos proveedor todavía.
create table if not exists public.payment_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('recurrente','stripe','binance_pay','telegram_stars','manual')),
  external_customer_id text,
  created_at timestamptz not null default now(),
  unique(provider, external_customer_id)
);
create index if not exists payment_customers_user_idx on public.payment_customers(user_id);

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('recurrente','stripe','binance_pay','telegram_stars','manual')),
  external_order_id text,
  product_code text not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null check (char_length(currency) between 3 and 10),
  status text not null check (status in ('pending','paid','failed','refunded','canceled')) default 'pending',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_order_id)
);
create index if not exists payment_orders_user_idx on public.payment_orders(user_id, created_at desc);
create index if not exists payment_orders_status_idx on public.payment_orders(status, created_at desc);
alter table public.payment_customers enable row level security;
alter table public.payment_orders enable row level security;
create policy payment_customers_select_own on public.payment_customers for select to authenticated using (auth.uid() = user_id);
create policy payment_orders_select_own on public.payment_orders for select to authenticated using (auth.uid() = user_id);

-- Eventos de proveedor: idempotencia y auditoría. Solo server/service-role escribe.
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('recurrente','stripe','binance_pay','telegram_stars','manual')),
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}',
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, external_event_id)
);
alter table public.payment_events enable row level security;

-- Eventos de seguridad de contenido. No contienen el contenido completo.
create table if not exists public.safety_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('input_blocked','output_blocked','generation_failed','rate_limited')),
  source text not null,
  risk_code text,
  created_at timestamptz not null default now()
);
alter table public.safety_events enable row level security;

-- Función server-side para registrar progreso sin exponer la clave.
create or replace function public.record_activity_attempt(p_activity_id uuid, p_is_correct boolean, p_feedback text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare v_user uuid; v_learner uuid;
begin
  select user_id into v_user from public.educational_activities where id = p_activity_id;
  if v_user is null or v_user <> auth.uid() then raise exception 'activity_not_found'; end if;
  insert into public.activity_attempts(activity_id,user_id,answer,is_correct,feedback)
  values(p_activity_id,auth.uid(),'{}'::jsonb,p_is_correct,left(p_feedback,500));
end;
$$;
grant execute on function public.record_activity_attempt(uuid,boolean,text) to authenticated;

-- Vincula actividades con el perfil de aprendizaje sin aceptar perfiles de otra cuenta.
alter table public.educational_activities add column if not exists learner_id uuid references public.learner_profiles(id) on delete set null;
create index if not exists educational_activities_learner_idx on public.educational_activities(learner_id, created_at desc);

drop policy if exists educational_activities_insert_own on public.educational_activities;
create policy educational_activities_insert_own on public.educational_activities for insert to authenticated
with check (
  auth.uid() = user_id
  and (learner_id is null or exists (select 1 from public.learner_profiles lp where lp.id = learner_id and lp.user_id = auth.uid()))
);

create or replace function public.update_learner_progress()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_learner uuid; v_user uuid;
begin
  select learner_id, user_id into v_learner, v_user from public.educational_activities where id = new.activity_id;
  if v_learner is not null and v_user = new.user_id then
    insert into public.learner_progress(learner_id,activities_attempted,activities_correct)
    values(v_learner,1,case when new.is_correct then 1 else 0 end)
    on conflict (learner_id) do update set
      activities_attempted = learner_progress.activities_attempted + 1,
      activities_correct = learner_progress.activities_correct + case when new.is_correct then 1 else 0 end,
      updated_at = now();
  end if;
  return new;
end; $$;

drop trigger if exists activity_attempt_progress on public.activity_attempts;
create trigger activity_attempt_progress after insert on public.activity_attempts for each row execute function public.update_learner_progress();
