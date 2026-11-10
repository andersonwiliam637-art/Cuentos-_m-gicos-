-- Fase 7: billing y Fase 8: endurecimiento operativo.
create unique index if not exists subscriptions_one_current_per_user_idx on public.subscriptions(user_id) where status in ('trialing','active','past_due','unpaid','incomplete');
create index if not exists subscriptions_customer_idx on public.subscriptions(stripe_subscription_id);

-- El cliente nunca puede insertar/actualizar billing directamente.
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (auth.uid() = user_id);
drop policy if exists subscriptions_insert_own on public.subscriptions;
drop policy if exists subscriptions_update_own on public.subscriptions;
drop policy if exists subscriptions_delete_own on public.subscriptions;

-- Activities: client may read/submit only their own records.
drop policy if exists educational_activities_insert_own on public.educational_activities;
create policy educational_activities_insert_own on public.educational_activities for insert to authenticated with check (auth.uid() = user_id);
