# IkeLedger — Developer Reference

## Current build state

All features below are implemented and functional in the current codebase.

### Pages

| Page | Status | Notes |
|---|---|---|
| Command Center (dashboard) | Complete | XRPL network, XRP market, AMM, liquidity, security, and account overview; sign-in opens as an overlay |
| Wallet Status | Complete | Account overview, reserve system info, connection mode |
| Tokens | Complete | Wallet holdings plus top issued asset tables with stats, watchlists, load-more controls, and risk scoring |
| NFTs & Listings | Complete | Combined NFT viewer and listings page with decoded NFT URI, IPFS/HTTP metadata lookup, image thumbnails, and offer details |
| DEX Access | Complete | Live order book, trading ticket, chart controls, risk/reward analysis, and Xumm/Xaman OfferCreate signing |
| AMM / LP | Complete | Position viewer, top AMM / LP pool table, watchlists, and risk notice |
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

**Mobile model**
- Full navigation remains available from the slide-out sidebar
- Bottom navigation is reserved for high-frequency paths: Home, Wallet, Account Intelligence, DEX, NFTs, and Profile
- Xumm/Xaman sign-in is optimized for same-device mobile deep links while desktop users can continue using QR signing
- Wide market, token, AMM, and DEX data views keep horizontal scrolling on small screens instead of compressing critical columns into unreadable text


**ikeledger-keygen.js** — Self-contained browser XRPL keypair generation
- Ed25519 via Web Crypto API (`crypto.subtle`)
- Pure-JS RIPEMD-160 (no external dependency)
- SHA-256 via Web Crypto
- Base58Check with XRPL alphabet
- Returns `{ classicAddress, publicKey, privateKey }` — private key never stored

**ikeledger-xrpl.js** — WebSocket XRPL client
- `ensureXrplConnection(network)` and `requestXrplCommand(network, command)` — shared persistent WebSocket service used by snapshots, market metrics, DEX books, and Account Intelligence
- `fetchAccountSnapshot(address, network)` — queries account_info, account_lines, account_tx, account_nfts, gateway_balances, account_objects, server_info using the shared service
- `fetchAccountTransactionsPage`, `fetchAccountLinesPage`, and `fetchAccountNftsPage` — marker-based pagination helpers for deeper account loading
- `fetchNftOfferSummaries` — lazy marketplace offer lookup for selected/visible NFTs instead of scanning every NFT on account load
- Returns typed snapshot object with account, markers, tokenHoldings, issuedTokenEntries, nftItems (including decoded URI), amm, valueMix, txItems

**Market data flow**
- XRP price and XRPL network metrics refresh independently from chart history so brief API misses do not blank the market card
- XRP chart points are cached per timeframe for five minutes unless the user changes timeframe
- Top issued assets load up to 200 ranked items, then live XRPL price probing is limited to visible rows plus watched tokens
- Token logos prefer XRPScan/xrplmeta sources because several XRPL.to image URLs block third-party hotlinking

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
- [ ] **Mobile QA pass**: Verify Xumm same-device sign-in, Account Intelligence stream, DEX signing, NFT viewer, and token/AMM tables on iPhone and Android screen sizes.
- [ ] **Pagination UI**: Expose "Load more" actions for wallet transaction history, trust lines, and NFT inventory using the new marker helpers.

### Medium priority
- [ ] **DEX execution follow-up**: Add offer status monitoring after a signed OfferCreate so users can see whether the order filled, partially filled, or stayed open
- [ ] **AMM live pool data**: Use `amm_info` command to show current pool reserves, trading fee, and LP token supply
- [ ] **Profile/fund QR polish**: Add a larger scannable receive QR to the profile and fund wallet cards for quick mobile deposits.
- [ ] **Create Wallet mobile shortcut**: Add a contextual Create Wallet shortcut on Wallet Status for profile-only users without crowding the bottom nav.

### Lower priority
- [ ] **Supabase credential anchoring**: Wire earned Mana and lesson completions to Supabase RPC for cross-device persistence
- [ ] **Profile photo compression**: The FileReader approach stores full-resolution base64. Add canvas-based resize before storing to keep localStorage usage under 1 MB
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
