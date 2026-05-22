# IkeLedger Security Model

## Non-negotiable rules

1. Never collect seed phrases, private keys, or recovery secrets.
2. Default to read-only mode before any signing workflow.
3. Require clear transaction previews before future signing support.
4. Log only non-sensitive security metadata.

## Sensitive input blocking

The UI blocks values that resemble:

- Family seeds
- Secret keys
- Recovery phrases
- 12+ word phrase patterns

When blocked, the value is cleared immediately and a warning is shown.

## Local storage policy

Allowed:

- Last selected network
- Public wallet address
- Connection preference
- Theme and UI preferences
- Non-sensitive progress IDs

Forbidden:

- Private keys
- Seed phrases
- Raw secret payloads
- Personal identity documents
