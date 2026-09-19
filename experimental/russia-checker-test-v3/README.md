# Russia checker experiment v3 — LTE only

This is the single experimental v3 path. Do not create v4/v5: edit these files in place.

## Purpose

Test LTE/whitelist links without changing production files.

The pipeline is intentionally split into two different questions:

1. **Russian transport reachability** — Check-Host from `ru1/ru2/ru3`.
2. **Exact-link protocol validation** — Xray builds the exact VLESS/Trojan/Hysteria2 link from `scripts/link-runtime.mjs` and tests real HTTP traffic through that tunnel.

The Xray stage runs on GitHub Actions, so it is **not itself a Russian vantage point**. It validates that the exact link/protocol/config can establish a real proxy tunnel from the runner. This is a second-stage diagnostic, not a production Russia gate.

## Globalping

Globalping is diagnostic-only in v3. The workflow may list currently online Russian probes and their cities, but it creates **no measurements**. This avoids consuming the hourly Globalping measurement budget during the experiment.

## Outputs

`results/locations-lte.txt` — broad transport candidates.

`results/locations-lte-xray-verified.txt` — exact links that successfully establish an Xray tunnel to at least one public HTTP target.

`results/locations-lte-xray-review.txt` — links whose Russian transport passed but the exact Xray test failed or was inconclusive from GitHub.

`results/locations-lte-transport-only.txt` — transport candidates not confirmed by exact-link Xray.

`results/lte-hysteria-all.txt` — all original Hysteria/Hysteria2/TUIC candidates, unchanged.

`results/lte-hysteria-passing.txt` — Hysteria-family links that pass the UDP transport screen. This does not prove the QUIC/application handshake.

## Important

Protocol schemes are never rewritten. `vless://` remains VLESS, `trojan://` remains Trojan, `hysteria2://` remains Hysteria2.

For production later, the useful evidence will be the intersection between:
- Russian transport reachability,
- exact-link Xray success,
- and your manual HAPP results in Russia.

Do not copy the broad `locations-lte.txt` into production automatically.
