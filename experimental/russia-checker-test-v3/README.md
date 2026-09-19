# Russia checker experiment v3 — LTE only

This is the single experimental v3 path. Do not create v4/v5: edit these files in place.

## Purpose

Test LTE/whitelist links without changing production. The experiment uses three layers: Check-Host for the Russian transport baseline, exact-link Xray for the original proxy protocol, and host.tools as an independent multi-region TCP source. Globalping is not used by the main test.

## host.tools

host.tools exposes a public `/api/v1/network/tcp` endpoint with no API key. The tool is multi-region and reports TCP open/closed/filtered state per region; the free API is limited to 100 requests/hour. v3 caps itself at 80 requests and reserves 15. citehttps://host.tools/api-docs

Only **Russian cities other than Moscow and Saint Petersburg** can produce a host.tools recovery verdict. One passing city gives `PASS-HOSTTOOLS`; two or more distinct non-core Russian cities give `PASS-HOSTTOOLS-STRONG`. A host.tools failure never removes a server. citehttps://host.tools/network/tcp

The host.tools stage is used for TCP endpoints only. Hysteria/Hysteria2/TUIC remain UDP-screened and then go through exact-link Xray.

## Exact-link Xray

Xray now tests **every LTE link**, not only Check-Host transport passes. Protocol schemes are never rewritten: VLESS stays VLESS, Trojan stays Trojan, Hysteria2 stays Hysteria2, TUIC stays TUIC. The existing Cloudflare download fallback remains enabled. The lightweight `cp.cloudflare.com/generate_204` target is also included because it is already used by production health-check logic.

## Recovery order

1. Check-Host baseline.
2. Exact-link Xray for all LTE links.
3. host.tools for TCP endpoints that still have no Xray success.
4. Any endpoint recovered from a non-core Russian city is tested through Xray once more.

The broad `locations-lte.txt` is intentionally permissive for the experiment: host.tools recovery is kept even if GitHub's non-Russian Xray runner cannot reproduce the link.

## Outputs

- `results/locations-lte.txt` — broad HAPP test list.
- `results/locations-lte-xray-verified.txt` — exact-link Xray verified links.
- `results/locations-lte-xray-review.txt` — Xray failures/inconclusive links.
- `results/locations-lte-hosttools-recovered.txt` — links whose TCP endpoint was reachable from at least one non-core Russian city according to host.tools.
- `results/hosttools-russia-diagnostic.json` — per-endpoint host.tools results and city observations.
- `results/locations-lte-strong.txt` / `partial.txt` — Check-Host strength buckets.
- `results/lte-hysteria-all.txt` — all original Hysteria/Hysteria2/TUIC links unchanged.
- `results/lte-hysteria-passing.txt` — Hysteria-family UDP non-refusal screen.
- `results/results.md` — human-readable report.

## Production boundary

No production routing, publication, Fast/Gaming logic or production health files are changed.
