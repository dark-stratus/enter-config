# Keyline updater

This is an intentionally isolated adapter for the Keyline source. The VPN Worker does not need to know about it. Removing the files listed below removes the automation without changing the client-facing config format.

## Pools

### Protected manual servers

- `europe-*.link` — your five permanent Europe servers. They are never touched by the updater and do not count toward the Keyline regular limit.
- `whitelist-*.link` — your permanent White List servers. They are never touched by the updater and do not count toward the Keyline White List limit.

To add another permanent White List server, add another `whitelist-N.link` file and its matching `whitelist-N` entry to `config/links/index.json`. The updater will preserve it on every successful refresh.

### Keyline-managed servers

- `keyline-regular-01.link` ... `keyline-regular-40.link` — maximum 40 regular locations.
- `keyline-whitelist-01.link` ... `keyline-whitelist-20.link` — maximum 20 Keyline White List locations.

Fewer than 40 or 20 is valid. Missing slots are simply left empty.

## Failure behavior

A successful refresh replaces only the Keyline-managed pool. Manual Europe and manual White List files remain untouched.

If the Keyline URL is unavailable, expired, invalid, returns no usable regular servers, or another validation step fails, the updater exits with an error and does not update the repository. The existing working pool therefore remains in place.

The workflow runs once per hour. After a successful refresh it waits 12 hours before doing another refresh. After a failed refresh it tries again on the next hourly run.

## Keyline URL

The CAPTCHA is not automated here. Put the already-issued Keyline `/sub/...` URL into the GitHub repository Secret `KEYLINE_URL`.

An optional second secret `KEYLINE_WHITE_LIST_URL` is supported for a separate Keyline White List subscription. If it is not set, the regular source is used on its own.

## Removal

The temporary adapter consists of:

- `.github/workflows/update-keyline.yml`
- `scripts/update-keyline.mjs`
- `.keyline-state.json`
- this documentation file

Deleting those files removes the automation. The existing `.link` files and `index.json` format used by `enter-main` remain unchanged.
