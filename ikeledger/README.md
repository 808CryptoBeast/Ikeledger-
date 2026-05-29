# IkeLedger — Developer Reference

## Current build state

All features below are implemented and functional in the current codebase.

### Pages

| Page | Status | Notes |
|---|---|---|
| Command Center (dashboard) | Complete | XRPL network, XRP market, AMM, liquidity, security, and account overview; sign-in opens as an overlay |
| Wallet Status | Complete | Account overview, reserve system info, connection mode |
| Tokens | Complete | Token holdings, trust line safety info |
| NFT Viewer | Complete | Grid view with decoded NFT URI, IPFS/HTTP metadata lookup, image thumbnails, filter scaffold |
| NFT Listings | Complete | Offers and listings display |
| DEX Access | Complete | Live order book, trading ticket, chart controls, risk/reward analysis, and Xumm/Xaman OfferCreate signing |
| AMM / LP | Complete | Position viewer, risk notice |
| Activity | Complete | Transaction history, raw JSON toggle |
| Account Intelligence | Complete | Watched accounts, live XRPL stream filters, health score, reserve/security/asset/AMM/NFT/market signals, and risk alerts |
| Credentials & Mana | Complete | Earned credentials, Mana info, privacy controls |
| Security Center | Complete | Safety checklist, session event log |
| Profile | Complete | Photo upload, identity display, avatar customizer, wallet card, fund wallet |
| Create Wallet | Complete | Ed25519 keygen, 6-step security gate, key display, activation guide |
| Settings | Complete | Appearance, privacy controls, network info |

### Key modules

**ikeledger-xumm.js** - Official Xumm SDK sign-in flow
- Uses IkeLedger's built-in public Xaman app key; users do not enter an API key
- signInWithXumm(xumm) opens the official Xumm sign-in flow and resolves the approved XRPL account
- createTxFlow(xumm, txJson) creates transaction signing QR payloads and listens for signing results

**Command Center auth model**
- Email/password creates or opens an IkeLedger profile only; wallet-only pages stay locked until a wallet is connected or created
- Xumm/Xaman sign-in creates a wallet-backed profile when no profile exists
- Connecting Xumm while already signed in by email links the approved XRPL account to that email profile
- DEX access requires a Xumm signing wallet or an XRPL wallet created inside IkeLedger
- Clearing the session signs out of email auth and Xumm; disconnecting only removes the wallet connection


**ikeledger-keygen.js** — Self-contained browser XRPL keypair generation
- Ed25519 via Web Crypto API (`crypto.subtle`)
- Pure-JS RIPEMD-160 (no external dependency)
- SHA-256 via Web Crypto
- Base58Check with XRPL alphabet
- Returns `{ classicAddress, publicKey, privateKey }` — private key never stored

**ikeledger-xrpl.js** — WebSocket XRPL client
- `fetchAccountSnapshot(address, network)` — queries account_info, account_lines, account_tx, account_nfts, gateway_balances, account_objects, server_info
- Returns typed snapshot object with account, tokenHoldings, issuedTokenEntries, nftItems (including decoded URI), amm, valueMix, txItems

**ikeledger-wallet.js** — Wallet state
- `hydrateWalletState()` — restore from localStorage on boot
- `lookupReadOnlyAddress(address)` — queries XRPL and updates state
- `clearSessionStorage()` — clears wallet/profile data, preserves appearance preferences (theme, avatar style, profile photo)

### XRPL reserves (current as of December 2024)
- Base reserve: **1 XRP** — required to activate any account, locked permanently
- Owner reserve: **0.2 XRP** per owned ledger object (trust lines, NFTs, DEX offers, escrows, payment channels)
- Minimum first deposit recommended: **2 XRP** (1 reserve + 1 spendable)

---

## Next steps

### High priority
- [ ] **Network icon strip - wire button actions**: Network button focuses the network selector; Mainnet/Testnet buttons switch the active network; Chart scrolls to the market chart; Market opens CoinGecko XRP page; Explorer opens XRPL Explorer for the loaded address.
- [ ] **QR code for address sharing**: Show a scannable QR on the profile and fund wallet cards so mobile users can receive XRP without typing the address.

### Medium priority
- [ ] **DEX execution follow-up**: Add offer status monitoring after a signed OfferCreate so users can see whether the order filled, partially filled, or stayed open
- [ ] **AMM live pool data**: Use `amm_info` command to show current pool reserves, trading fee, and LP token supply
- [ ] **Accent color system**: The accent selector (XRP Blue / Mana Gold / Emerald) is in the settings drawer but CSS variables for the accent are not yet wired — connect `accentSelect` to a set of `:root` overrides
- [ ] **Mobile bottom nav — add Create Wallet**: Add Create Wallet as a bottom nav item or make it reachable from the Wallet page

### Lower priority
- [ ] **Supabase credential anchoring**: Wire earned Mana and lesson completions to Supabase RPC for cross-device persistence
- [ ] **Profile photo compression**: The FileReader approach stores full-resolution base64. Add canvas-based resize before storing to keep localStorage usage under 1 MB
- [ ] **Pagination for transaction history**: `account_tx` currently fetches the latest 10 — add a "load more" marker-based pagination
- [ ] **Trust line search / filter**: When a user holds many tokens, add a search input to the token holdings list
- [ ] **Export wallet info**: Allow users to copy or download a text summary of their address, public key, and network for safekeeping
- [ ] **Destination tag field**: Add an optional destination tag input to the payment flow for exchange withdrawals

### Future / ecosystem
- [ ] **Mana token XRPL integration**: Issue Mana as a real XRPL token with IOU trust lines anchored to the Ikeverse account
- [ ] **Credential NFT minting**: Mint proof-of-learning completions as on-chain NFTs via Xaman signing
- [ ] **Multi-account support**: Allow watching multiple XRPL addresses under one profile, switchable from the sidebar
- [ ] **Offline mode / PWA**: Add a service worker and manifest so IkeLedger can be installed and used offline for read-only views
- [ ] **Hardware wallet support**: Ledger hardware signing via `@ledgerhq/hw-transport-webusb` as an alternative to Xaman

---

## Running locally

```
Open index.html directly in Chrome, Firefox, or Safari.
No build tool, no server, no npm install required.
```

The only network calls made at runtime:
- XRPL WebSocket endpoints (`wss://`) — for account data, DEX books, and network metrics
- CoinGecko API — for XRP live price and chart data
