-- Additional constraints and updated_at maintenance

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_row_updated_at();

alter table public.wallet_connections
  drop constraint if exists wallet_connections_network_check;

alter table public.wallet_connections
  add constraint wallet_connections_network_check
  check (network in ('xrpl-mainnet', 'xrpl-testnet', 'xrpl-devnet'));

alter table public.security_events
  drop constraint if exists security_events_risk_level_check;

alter table public.security_events
  add constraint security_events_risk_level_check
  check (risk_level in ('Safe', 'Low Risk', 'Medium Risk', 'High Risk', 'Blocked'));

alter table public.mana_events
  drop constraint if exists mana_events_amount_nonzero_check;

alter table public.mana_events
  add constraint mana_events_amount_nonzero_check
  check (mana_amount <> 0);

create index if not exists idx_wallet_connections_wallet_network
  on public.wallet_connections (wallet_address, network);

create index if not exists idx_security_events_event_type_created
  on public.security_events (event_type, created_at desc);
