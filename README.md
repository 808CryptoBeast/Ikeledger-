# IkeLedger

> Where ancestral knowledge meets verifiable value.

IkeLedger is an XRPL-powered wallet dashboard and identity layer connecting ancestral knowledge, cultural learning, digital identity, and verifiable value through credentials, Mana rewards, and proof-of-learning records.

---

## What is built

### Command Center and sign-in
- Command Center is the user landing page for XRPL network, XRP market, AMM, and liquidity overview metrics
- XRP Market Overview includes live source chips, last-updated time, and a cached fallback so brief API misses do not blank the panel
- Issued asset and AMM / LP market tables include load-more pagination, watchlist buttons, and risk scoring
- Account Intelligence monitors connected accounts for wallet health, reserve pressure, security posture, asset exposure, AMM/NFT signals, whale flow, and DEX activity
- Xumm/email sign-in appears in a popup overlay instead of replacing the dashboard
- Email/password profile sign-in through Supabase Auth with email verification
- Email profiles are profile-only until an XRPL wallet is connected or created
- Xumm/Xaman sign-in uses the official SDK flow and links the approved XRPL account automatically
- Xumm sessions use IkeLedger's public app key; users never enter an API key
- Wallet-only pages and DEX transaction tools are gated until the user has a connected or created XRPL account

### Core wallet
- Read-only XRPL public address lookup via WebSocket
- Network selection — Testnet (default) and Mainnet
- Mainnet warning banner with real-asset notice
- Wallet meta grid plus integrated wallet status panel - provider, address, verified status, balances, reserves, ledger objects, and last sync
- Portfolio Intelligence KPI tiles — Total XRP, Available XRP, assets, issued tokens, NFTs, AMM positions
- Full transaction history with type classification
- Token holdings and issued token display
- NFT viewer with decoded XRPL NFT URI support, IPFS/HTTP metadata lookup, and image thumbnails
- AMM / LP position viewer
- Account Intelligence page with watched accounts, live XRPL stream filters, account health score, risk alerts, and plain-language event insight
- Optional market proxy/cache server for XRPL.to, CoinGecko, and token image requests
- DEX access panel with live order book loading, chart controls, risk/reward analysis, OfferCreate previews, and Xumm/Xaman signing requests
- Transaction consent modal before any signing flow

### Mobile experience
- Sticky top banner with compact IkeLedger branding, profile access, and price/network context
- Drawer navigation for the full app map, including AMM / LP, Activity, Create Wallet, Security, Settings, and Credentials
- Bottom mobile nav for the highest-use pages: Home, Wallet, Account Intelligence, DEX, NFTs, and Profile
- Xumm/Xaman sign-in uses the official mobile deep-link flow when opened on the same device
- DEX, token, NFT, and Account Intelligence panels collapse into single-column mobile layouts with horizontal table scrolling where needed

### Account creation
- In-browser Ed25519 keypair generation — zero external dependencies, zero network calls
- Uses `crypto.subtle.generateKey` (Web Crypto API)
- XRPL address derived via SHA-256 → RIPEMD-160 → Base58Check (same algorithm as the XRPL)
- 6-item security gate with all acknowledgement checkboxes required before generating
- Private key shown once behind a reveal button, never stored anywhere
- Keys cleared from memory the moment the user navigates away
- Step-by-step wallet activation guide (send 2 XRP minimum to activate)
- Correct XRPL reserves: **1 XRP base reserve**, **0.2 XRP per owned object** (updated December 2024)

### Profile and identity
- Profile photo upload via drag-and-drop, file picker, or phone camera (base64 in localStorage)
- Rich identity display — display name, handle, home realm, bio
- Avatar style customizer — glow color, glow intensity, border color, border width, avatar shape (circle / rounded / square)
- Avatar status ring — animated glow ring showing wallet state:
  - Green pulse = verified and funded on-chain
  - Amber pulse = address loaded, not yet queried
  - Red = queried, zero balance (needs funding)
  - Dim gray = no wallet connected
- Profile wallet card — full account details (address, balance KPIs, sequence, trust lines, NFT count, reserve breakdown)
- Fund Wallet card — copyable address, reserve amounts, 4-step activation guide

### Security
- Sensitive input blocking — seed phrases and private keys are blocked at paste and type
- Security event log with risk levels (Safe / Low / Medium / High / Blocked)
- Anti-abuse guardrails
- Private keys never stored, never transmitted

### Settings and customization
- Dark / light / system theme
- Accent color selector (XRP Blue / Mana Gold / Emerald)
- Supabase builder sync (optional, admin-gated)
- Clear session and disconnect controls

### Credentials and Mana
- Mana balance and reward tracking
- Proof-of-learning record scaffold
- Badge and credential display
- Pikoverse · Ikeverse · Living Knowledge Platform ecosystem alignment

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + ES Modules (no build step) |
| XRPL | WebSocket via `wss://` endpoints — read-only, no keys held |
| Signing | Official Xumm SDK sign-in plus Xaman transaction payloads using IkeLedger's public app key (no user API key or private key ever touches this app) |
| App auth | Supabase Auth for optional email/password profiles; Xumm/Xaman for wallet-backed profile sign-in |
| Storage | `localStorage` for local session, public wallet address, profile, appearance |
| Sync (optional) | Supabase RPC — profiles, Mana, credentials, security logs |
| Key generation | `crypto.subtle` (Web Crypto API) + pure-JS RIPEMD-160 |

---

## Quick start

```
Open index.html in a modern browser.
No build, no install, no server required.
```

---

## File structure

```
index.html                        — App shell and all page sections
ikeledger/
  css/ikeledger.css               — Full design system and component styles
  js/
    ikeledger-config.js           — Networks, storage keys, constants
    ikeledger-ui.js               — All rendering, state, and event handlers
    ikeledger-wallet.js           — Wallet state, address, profile, session
    ikeledger-xrpl.js             — WebSocket XRPL client, account snapshot
    ikeledger-keygen.js           — In-browser XRPL keypair generation (no deps)
    ikeledger-security.js         — Risk levels, event log, input screening
    ikeledger-rewards.js          — Mana and learning reward calculations
    ikeledger-xaman.js            — XRPL payment transaction builder
    ikeledger-xumm.js             — Official Xumm SDK sign-in and Xaman transaction payloads
    ikeledger-supabase.js         — Optional Supabase sync client
    ikeledger-cdn.js              — CDN import helper with fallback chain
  server/
    market-proxy.mjs              — Optional local market/image cache proxy
  assets/images/                  — App icons and network imagery
  docs/                           — Security, wallet-flow, credential model docs
  supabase/                       — SQL migrations and deploy order
```

---

## Security baseline

- IkeLedger never requests, stores, or transmits seed phrases, private keys, or recovery phrases.
- Private keys generated on the Create Wallet page exist only in browser memory and are cleared on navigation.
- Email/password profiles do not expose XRPL wallet data until the user links or creates a wallet.
- Only local session state, appearance preferences, profile settings, and public wallet addresses are persisted in `localStorage`.
- All signing is delegated to Xaman — no transaction is submitted without user approval in their own wallet app.
