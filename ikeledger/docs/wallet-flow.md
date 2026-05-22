# Wallet Flow

## Phase 1 and 2 baseline flow

1. User selects network (default: XRPL Testnet).
2. User enters a public XRPL address.
3. App validates address format and secret safety.
4. App runs read-only ledger queries.
5. UI displays status, balance, trust lines, NFTs, and recent transactions.
6. User can disconnect or clear session at any time.

## Future flow

1. Connect through trusted wallet provider (Xaman first).
2. Show plain-language transaction preview.
3. Require explicit approval before signing.
4. Store only non-sensitive linkage metadata.
