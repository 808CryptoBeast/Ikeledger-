# IkeLedger

Where ancestral knowledge meets verifiable value.

## What this prototype includes

- Read-only XRPL public address lookup
- Network selection with Testnet default
- Mainnet warning banner
- Wallet status and session controls
- Sensitive input blocking for secrets and seed-like content
- Security event feed (non-sensitive)
- Mana and badge preview panel
- Plain-language transaction history and preview

## Run locally

Open `ikeledger/index.html` in a modern browser.

## Phase alignment

This scaffold implements the Version 0.1 target:

- Public XRPL address lookup
- Network selector
- XRP balance display
- Basic transaction activity display
- Safety reminders and warnings

## Security baseline

IkeLedger does not request or store seed phrases, private keys, or recovery phrases.
Only non-sensitive settings are stored in local storage.
