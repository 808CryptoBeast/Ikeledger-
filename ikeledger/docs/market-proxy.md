# IkeLedger Market Proxy

IkeLedger can use public market APIs directly, but a small proxy gives you better control over:

- XRPL.to and CoinGecko rate limits
- Token image CORS / cross-origin blocking
- Short-lived market response caching
- Future production allowlists and request logging

## Local proxy

Run this from the repository root:

```bash
node ikeledger/server/market-proxy.mjs
```

The proxy starts at:

```text
http://127.0.0.1:8788
```

In IkeLedger, open `Settings` and enter that URL in `Market Proxy`.

## Endpoints

```text
GET /market?url=<encoded-api-url>
GET /image?url=<encoded-image-url>&w=96&h=96
GET /dex-history?network=xrpl-mainnet&issuer=<issuer>&currency=<currency>&period=1d
```

The proxy only allows known market/image hosts:

- `api.xrpl.to`
- `www.xrpl.to`
- `api.coingecko.com`
- `ipfs.io`
- `arweave.net`
- `ipfs.firstledger.net`

## DEX history indexer

`/dex-history` is the safer path for rebuilding issued-token charts. It queries XRPL
`account_tx` server-side, reconstructs executed DEX fills from Offer metadata, caches
the result, and returns both trade points and candles. This keeps the browser from
crawling public XRPL nodes directly.

Supported `period` values:

- `5m`
- `15m`
- `1h`
- `4h`
- `1d`
- `1w`

Example:

```text
http://127.0.0.1:8788/dex-history?network=xrpl-mainnet&issuer=rIssuer...&currency=CSC&period=1d
```

Tuning environment variables:

- `DEX_HISTORY_CACHE_MS` - default `600000`
- `DEX_HISTORY_MAX_PAGES` - default `60`

## Production note

Deploy this behind HTTPS before using it in production. Keep the host allowlist tight so it does not become an open proxy.
