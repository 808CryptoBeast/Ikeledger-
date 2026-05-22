# Supabase Deployment Order

Run these files in this exact order inside Supabase SQL Editor.

1. `supabase/migrations/20260522_001_ikeledger_foundation.sql`
2. `supabase/migrations/20260522_002_reward_guardrails.sql`
3. `supabase/migrations/20260522_003_constraints_and_updated_at.sql`
4. `supabase/migrations/20260522_004_rpc_functions.sql`

Optional one-shot file:

- `supabase/sql/bootstrap_ikeledger.sql` (contains 001 + 002 only)

After deployment, verify:

- All seven tables exist under `public`
- RLS is enabled on all seven tables
- Functions exist:
  - `public.link_wallet_connection`
  - `public.log_security_event`
  - `public.award_mana_event`
- Triggers exist:
  - `trg_prevent_duplicate_lesson_reward`
  - `trg_recompute_profile_mana_insert`
  - `trg_recompute_profile_mana_delete`
  - `trg_recompute_profile_mana_update`
  - `trg_profiles_set_updated_at`
