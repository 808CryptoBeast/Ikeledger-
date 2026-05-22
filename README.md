# IkeLedger

IkeLedger is an XRPL-powered wallet and connection layer bridging ancestral knowledge, cultural learning, digital identity, and verifiable value through rewards, credentials, and proof-of-learning records.

## Project scaffold

The repository now includes a working Phase 1 foundation in [ikeledger](ikeledger):

- Read-only XRPL address lookup
- Network selection with Testnet default
- Mainnet warning and safety reminders
- Sensitive secret input blocking
- Wallet session controls (disconnect and clear)
- Mana, badge, and activity preview panels
- Security and wallet-flow documentation

## Architecture note

Supabase is optional for the core wallet UI.

- XRPL wallet lookup, balances, assets, NFTs, AMM views, and transaction history work without Supabase.
- Supabase is only needed for ecosystem persistence such as profiles, wallet linkage records, Mana, badges, credentials, and security logs.

## Quick start

Open [index.html](index.html) in a browser to run IkeLedger.
