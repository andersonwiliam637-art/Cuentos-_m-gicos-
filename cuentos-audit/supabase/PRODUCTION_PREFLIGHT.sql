-- Cuentos Mágicos AI — diagnóstico SOLO LECTURA antes de aplicar migraciones.
-- Proyecto esperado: uoiugltuadzfntzscihh
-- Ejecutar en Supabase SQL Editor. Este archivo NO crea, modifica ni elimina datos.

-- 1) Tablas críticas presentes y estado RLS.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in (
    'profiles','stories','illustrations','story_usage','story_generation_jobs',
    'characters','educational_activities','activity_attempts','educational_answer_keys',
    'learner_profiles','learner_progress','payment_customers','payment_orders',
    'payment_events','safety_events','api_rate_limits'
  )
order by c.relname;

-- 2) Tablas críticas que faltan. Resultado vacío = existen todas.
with expected(table_name) as (values
 ('profiles'),('stories'),('illustrations'),('story_usage'),('story_generation_jobs'),
 ('characters'),('educational_activities'),('activity_attempts'),('educational_answer_keys'),
 ('learner_profiles'),('learner_progress'),('payment_customers'),('payment_orders'),
 ('payment_events'),('safety_events'),('api_rate_limits')
)
select e.table_name as missing_table
from expected e
left join information_schema.tables t
  on t.table_schema='public' and t.table_name=e.table_name
where t.table_name is null
order by e.table_name;

-- 3) Políticas de seguridad existentes para tablas públicas.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname='public'
  and tablename in (
    'profiles','stories','illustrations','story_generation_jobs','characters',
    'educational_activities','activity_attempts','educational_answer_keys',
    'learner_profiles','learner_progress','payment_customers','payment_orders',
    'payment_events','safety_events','api_rate_limits'
  )
order by tablename, policyname;

-- 4) RPCs críticas instaladas y tipo de seguridad.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'reserve_story_generation','complete_story_generation','fail_story_generation',
    'check_rate_limit','record_activity_attempt','handle_new_user'
  )
order by p.proname;

-- 5) Columnas de facturación requeridas por el webhook Recurrente.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public'
  and ((table_name='payment_orders' and column_name in
        ('provider','external_order_id','external_subscription_id','product_code','status','user_id'))
    or (table_name='payment_events' and column_name in
        ('provider','external_event_id','event_type','payload','processed_at'))
    or (table_name='profiles' and column_name='plan_type'))
order by table_name, ordinal_position;

-- Importante: revisa los resultados antes de aplicar cualquier migración.
-- No ejecutes la secuencia 001-007 a ciegas si este proyecto ya tiene tablas/datos.
