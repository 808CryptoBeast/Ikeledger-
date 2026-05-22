# Supabase Setup and RLS

## Included migrations

- `supabase/migrations/20260522_001_ikeledger_foundation.sql`
- `supabase/migrations/20260522_002_reward_guardrails.sql`

## What this enables

- Profiles, wallet connections, lesson progress, mana events, badges, credentials, security events
- Row Level Security policies scoped to authenticated user ownership
- Reward guardrails to block duplicate lesson farming
- Automatic profile mana balance recompute triggers

## Apply migrations

1. Create Supabase project and enable email or wallet-linked auth.
2. Run migration files in order using Supabase CLI or SQL editor.
3. Verify RLS is enabled on all listed tables.
4. Create service-role-only admin workflows for large reward approvals.

## Frontend integration targets

- Write wallet linkage events to `wallet_connections`
- Write reward grants to `mana_events`
- Write blocked-secret and signing events to `security_events`
- Read profile and badges through user-scoped policies

## Security reminder

Never store seed phrases, private keys, or raw signing secrets in Supabase tables or logs.