-- Verify IkeLedger Supabase setup

-- Tables
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles',
    'wallet_connections',
    'lesson_progress',
    'mana_events',
    'badges',
    'credentials',
    'security_events'
  )
order by table_name;

-- RLS enabled
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles',
    'wallet_connections',
    'lesson_progress',
    'mana_events',
    'badges',
    'credentials',
    'security_events'
  )
order by tablename;

-- Triggers
select tgname as trigger_name, c.relname as table_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and tgname in (
    'trg_prevent_duplicate_lesson_reward',
    'trg_recompute_profile_mana_insert',
    'trg_recompute_profile_mana_delete',
    'trg_recompute_profile_mana_update',
    'trg_profiles_set_updated_at'
  )
order by tgname;

-- Functions
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'link_wallet_connection',
    'log_security_event',
    'award_mana_event'
  )
order by routine_name;
