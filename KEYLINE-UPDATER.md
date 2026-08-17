# Keyline updater

This is an intentionally isolated temporary adapter for Keyline. `enter-main` does not need to know anything about it: the Worker continues to read `config/links/index.json` and the individual `.link` files.

## Keyline URLs

The updater supports **any number of Keyline subscription URLs**.

Preferred GitHub Actions Secret:

`KEYLINE_URLS`

Put one already-issued Keyline `/sub/...` URL per line. For example, 10 URLs means **10 Keyline HTTP reads per eligible refresh**. Duplicates are removed, so the same URL is read only once.

A JSON array is also accepted in `KEYLINE_URLS`.

For backward compatibility, a single `KEYLINE_URL` is accepted when `KEYLINE_URLS` is not set.

Optional:

`KEYLINE_WHITE_LIST_URLS`

This is another multiline list. Every entry from these subscriptions is treated as White List automatically.

CAPTCHA is not handled by this updater. It consumes already-issued `/sub/...` subscription URLs.

## Pools

### Manual / permanent servers

Every existing entry whose ID is **not** `keyline-regular-*` or `keyline-whitelist-*` is preserved.

That includes:

- the five permanent `europe-*.link` servers;
- the permanent manual `whitelist-*.link` servers;
- any other manual `.link` servers already present in `config/links/` and listed in `index.json`.

Manual entries do not count toward the Keyline limits and are never removed by the updater.

The active index is ordered so the permanent Europe entries and other normal manual entries remain before the permanent manual White List entries. The manual `whitelist-1` therefore remains the first White List item in the visible subscription.

### Keyline-managed regular pool

`keyline-regular-01.link` ... `keyline-regular-40.link` — maximum **40 regular servers across all configured Keyline URLs combined**.

Only locations that do **not** look like White List / bypass locations enter this pool.

For every regular server, Keyline's original descriptive text is discarded for the visible name. The name is normalized to:

`🇦🇱 Albania 1`

If another Albania server is present, it becomes:

`🇦🇱 Albania 2`

and so on. The numbering is based on the normalized country name, so `🇦🇱 Албания N1 (YouTube без рекламы)` becomes exactly `🇦🇱 Albania 1`, with no extra feature text.

The same rule applies to all countries. Unsupported promotional/noise-only names without a recognizable country flag are ignored.

### Automatic White List pool

`keyline-whitelist-01.link` ... `keyline-whitelist-20.link` — maximum **20 automatic White List entries across all configured Keyline URLs combined**.

A Keyline entry is classified as White List when its source `remarks` contains a relevant marker such as:

- `white list` / `whitelist`;
- `Белые`, `Белый`, `Белого`, etc.;
- `Обход...`;
- `Глушилки...`;
- `LTE`;
- other configured White List markers;
- an explicit White Flag marker.

These entries are placed **after the permanent `whitelist-1`**.

Their visible names use the same country normalization as the regular pool. For example:

`🇷🇺 Белый интернет` → `🇷🇺 Russia 1`

`🇷🇺 Москва whitelist` → `🇷🇺 Russia 2`

The White List keyword itself is deliberately removed from the visible name.

### Auto White List

If a source contains the Keyline `🚀 Авто выбор` profile and that same source also contains at least one White List entry, the updater adds one extra automatic White List entry:

`⚡ Auto White List`

It is placed immediately after the permanent manual White List and before the individual automatic White List locations.

This special Auto White List entry counts toward the same 20-entry automatic White List limit.

### Limits

If fewer than 40 regular or fewer than 20 automatic White List entries are available, the updater simply creates fewer entries. Nothing is padded, duplicated, or fabricated to reach the limit.

## Refresh and failure behavior

On every eligible refresh, each configured Keyline URL is fetched once normally. If a request is transiently broken, times out, or returns invalid JSON, that same URL is retried up to 2 additional times (3 attempts total). URLs are still deduplicated, so the same configured URL is not processed as separate sources.

If **any** configured URL fails after its retries, is expired, returns invalid JSON, or fails validation, the updater does not replace the pool. The existing Keyline servers remain untouched and the next hourly workflow run tries again. The workflow log identifies the failing source and includes response length/content-type/a short response preview without printing the secret URL itself.

After a successful refresh, the updater waits 12 hours before another real refresh. The GitHub Actions workflow still wakes every hour so failures are retried after about one hour.

The write is staged before the live `config/links` directory is replaced, so a normal write failure does not leave the live pool half-deleted.

## Removal

The temporary adapter consists of:

- `.github/workflows/update-keyline.yml`
- `scripts/update-keyline.mjs`
- `.keyline-state.json`
- this documentation file
- generated `keyline-*.link` entries

Deleting these removes the automation without requiring changes to `enter-main`.

## GitHub Actions runtime

The workflow uses `actions/checkout@v7` and `actions/setup-node@v7` with Node.js 24 to avoid the Node.js 20 deprecation warning on current GitHub-hosted runners.


## Keyline request client identity

Keyline `/sub/...` endpoints are fetched using the same public request-header shape observed from a normal Windows Happ client:

- `User-Agent: Happ/2.16.2/Windows/2605221224503`
- `X-App-Version: 2.16.2`
- `X-Device-Locale: RU`
- `X-Device-Os: Windows`
- `X-Device-Model: LAPTOP-<generated>_x86_64`
- `X-Hwid: <generated UUID>`
- `X-Ver-Os: 10_10.0.19045`

The generated HWID and device model are stored in `.keyline-state.json` after a successful refresh, so all configured Keyline sources are fetched as the same logical Happ device. The generated device identity contains no project/brand name.


### Keyline subscription response formats

Keyline may return a subscription as either a JSON array or a `text/plain` Base64-encoded profile. The updater detects both formats. For Base64 profiles it decodes the payload, removes `#profile-*` metadata lines, and accepts supported URI lines (`vless://`, `trojan://`, `hysteria2://`). Unsupported protocols are ignored rather than emitted as broken `.link` files.
