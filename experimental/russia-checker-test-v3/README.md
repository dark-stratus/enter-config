# Russia checker experiment v3 — LTE only

This is the single experimental v3 path. Do not create v4/v5: edit these files in place.

## Purpose

Test LTE/whitelist links without changing production files.

The experiment answers three separate questions:

1. **Russian transport reachability** — Check-Host from the currently configured Russian nodes (`ru1`, `ru2`, `ru3`).
2. **Additional Russian geography** — a capped Globalping MTR check from Russian cities other than Moscow and Saint Petersburg.
3. **Exact-link protocol validation** — Xray builds the exact VLESS/Trojan/Hysteria2 link from `scripts/link-runtime.mjs` and tests real HTTP traffic through that tunnel.

The Xray stage runs on GitHub Actions, so it is **not itself a Russian vantage point**. It validates the exact link/protocol/configuration from the runner.

## Protocol handling

Protocol schemes are never rewritten:

- `vless://` stays VLESS.
- `trojan://` stays Trojan.
- `hysteria2://` stays Hysteria2.
- Hysteria-family links are screened with UDP, never with a TCP pre-check.

The Xray verifier uses the actual parser/builder from `scripts/link-runtime.mjs`.

Some source links contain `extra=null` on VLESS xhttp. The experiment normalizes only that test input before building the Xray probe config so the shared runtime does not dereference `null.mode`. The original published link is never changed.

## Exact-link Xray verification

The normal Xray test tries the configured public HTTPS targets.

If those targets fail, v3 runs the same type of **real Cloudflare download check already used by production health**:

- Cloudflare download endpoint
- HTTP 2xx/3xx
- at least 256 KiB downloaded
- at least 1024 KB/s
- up to 9 seconds

This is a fallback verifier only. It is deliberately not a global speed gate for every link.

Output:

`results/locations-lte-xray-verified.txt` — links that pass either the normal exact-link Xray test or the Cloudflare speed fallback.

`results/locations-lte-xray-cloudflare-speed.txt` — links recovered specifically by the Cloudflare download fallback.

`results/locations-lte-xray-review.txt` — links that still fail exact-link Xray.

## Additional Russian-city check

Globalping is used as a second Russian geographic source, not as a replacement for Check-Host.

The experiment discovers currently online Russian probes and then chooses up to four cities, excluding Moscow and Saint Petersburg. The preferred cities are:

1. Yekaterinburg
2. Kazan
3. Novosibirsk
4. Krasnodar

If one of those is unavailable, another non-Moscow/non-SPb Russian city with an online probe is selected.

For a candidate endpoint, v3 performs one MTR measurement using the selected cities and the correct transport:

- TCP endpoints → TCP MTR to the endpoint port.
- Hysteria/Hysteria2/TUIC endpoints → UDP MTR to the endpoint port.

A Globalping result is considered a **transport recovery**, not proof that the proxy protocol itself works in HAPP.

The anonymous Globalping API allows 250 measurement tests/hour and up to 50 probes per measurement. v3 therefore:

- checks `/limits` before starting recovery,
- uses at most 45 endpoints per run,
- uses four city probes at most (about 180 tests),
- keeps a reserve of 10 tests,
- stops immediately on HTTP 429.

An API token can be supplied through the GitHub secret `GLOBALPING_API_TOKEN` for the higher authenticated allowance.

## Recovery order

Globalping recovery runs after the first Check-Host pass and exact-link Xray stage.

The highest priority goes to:

1. endpoints that failed/are unknown in Check-Host,
2. partial Check-Host endpoints,
3. endpoints where all available exact-link Xray candidates failed.

If Globalping reaches the endpoint from at least one selected Russian city, the endpoint is temporarily admitted as `PASS-GLOBALPING` for the experiment and its links are tested through Xray once more.

This gives us a useful three-way comparison:

`Russia transport` + `other Russian city transport` + `exact link through Xray`.

## Outputs

`results/locations-lte.txt` — broad HAPP test list, including endpoints recovered by Globalping.

`results/locations-lte-strong.txt` — links from strong Check-Host endpoint results.

`results/locations-lte-partial.txt` — links from partial Check-Host TCP results.

`results/locations-lte-globalping-recovered.txt` — links recovered specifically by the additional Russian-city checker.

`results/locations-lte-xray-verified.txt` — exact-link Xray verified links, including Cloudflare-speed fallback successes.

`results/locations-lte-xray-cloudflare-speed.txt` — Cloudflare-speed fallback successes only.

`results/locations-lte-xray-review.txt` — links that still fail or remain inconclusive under exact-link Xray.

`results/locations-lte-transport-only.txt` — transport candidates not confirmed by exact-link Xray.

`results/lte-hysteria-all.txt` — all original Hysteria/Hysteria2/TUIC LTE candidates, unchanged.

`results/lte-hysteria-passing.txt` — Hysteria-family links that pass the UDP transport screen. This does not prove the QUIC/application handshake.

`results/globalping-city-diagnostic.json` — current Russian Globalping probe inventory, selected recovery cities and rate-limit state.

`results/check-host-russia-nodes.json` — current Check-Host Russian nodes.

## Production boundary

No production routing, publication, Fast/Gaming logic, or production health files are changed by this experiment.

The eventual production Russia checker can reuse the additional-city mechanism, but publication criteria should be chosen only after comparing these experimental lists with real HAPP results in Russia.
