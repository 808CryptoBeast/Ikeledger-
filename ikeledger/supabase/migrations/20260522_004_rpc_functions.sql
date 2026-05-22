-- Helper RPC functions for wallet linking, security logging, and mana awarding

create or replace function public.link_wallet_connection(
  p_wallet_address text,
  p_network text default 'xrpl-testnet',
  p_provider text default 'xaman',
  p_verified boolean default false
)
returns public.wallet_connections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.wallet_connections;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.wallet_connections (
    user_id,
    wallet_address,
    network,
    provider,
    verified,
    connected_at,
    last_used_at
  )
  values (
    v_user_id,
    p_wallet_address,
    p_network,
    p_provider,
    p_verified,
    now(),
    now()
  )
  on conflict (user_id, wallet_address, network)
  do update set
    provider = excluded.provider,
    verified = excluded.verified,
    last_used_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.log_security_event(
  p_event_type text,
  p_risk_level text,
  p_wallet_address text default null,
  p_details jsonb default '{}'::jsonb
)
returns public.security_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.security_events;
begin
  insert into public.security_events (
    user_id,
    wallet_address,
    event_type,
    risk_level,
    details,
    created_at
  )
  values (
    v_user_id,
    p_wallet_address,
    p_event_type,
    p_risk_level,
    coalesce(p_details, '{}'::jsonb),
    now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.award_mana_event(
  p_event_type text,
  p_mana_amount integer,
  p_reason text default null,
  p_lesson_id text default null
)
returns public.mana_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.mana_events;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.mana_events (
    user_id,
    lesson_id,
    event_type,
    mana_amount,
    reason,
    created_at
  )
  values (
    v_user_id,
    p_lesson_id,
    p_event_type,
    p_mana_amount,
    p_reason,
    now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.link_wallet_connection(text, text, text, boolean) to authenticated;
grant execute on function public.log_security_event(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.award_mana_event(text, integer, text, text) to authenticated;
