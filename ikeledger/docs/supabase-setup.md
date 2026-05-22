# Supabase Setup and RLS

## Included migrations

- `supabase/migrations/20260522_001_ikeledger_foundation.sql`
- `supabase/migrations/20260522_002_reward_guardrails.sql`
- `supabase/migrations/20260522_003_constraints_and_updated_at.sql`
- `supabase/migrations/20260522_004_rpc_functions.sql`

## What this enables

- Profiles, wallet connections, lesson progress, mana events, badges, credentials, security events
- Row Level Security policies scoped to authenticated user ownership
- Reward guardrails to block duplicate lesson farming
- Automatic profile mana balance recompute triggers

## What does not require Supabase

Core IkeLedger wallet features do not require Supabase:

- XRPL network selection
- Read-only public address lookup
- XRP balance and account overview
- Trust line, token, NFT, and AMM read-only display
- Transaction history and preview UI

Supabase is optional and should be treated as the app-layer persistence system for profile, learning, rewards, badges, credentials, and safe event logging.

## Apply migrations

1. Create Supabase project and enable email or wallet-linked auth.
2. Run migration files in order using Supabase CLI or SQL editor.
3. Verify RLS is enabled on all listed tables.
4. Create service-role-only admin workflows for large reward approvals.

Deployment order is documented in `supabase/sql/deploy_order.md`.

## Frontend integration targets

- Write wallet linkage events to `wallet_connections`
- Write reward grants to `mana_events`
- Write blocked-secret and signing events to `security_events`
- Read profile and badges through user-scoped policies

## Helper RPC functions

- `public.link_wallet_connection(...)`
- `public.log_security_event(...)`
- `public.award_mana_event(...)`

## Security reminder

Never store seed phrases, private keys, or raw signing secrets in Supabase tables or logs.