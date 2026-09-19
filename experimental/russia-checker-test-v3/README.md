# Russia checker experiment v3 — LTE only

This is the single experimental v3 path. Do not create v4/v5: edit these files in place.

## Purpose

Test LTE/whitelist links without changing production. The experiment uses Check-Host for the Russian transport baseline, exact-link Xray for the original proxy protocol, and authenticated Globalping as an additional Russian-city **transport** source. host.tools remains optional and is disabled by default in the workflow.

## Important: Globalping is not a VPN protocol checker

Globalping currently provides network measurements such as ping, traceroute, DNS, MTR and HTTP. It does not run the original VLESS/Trojan/Hysteria2 client. Therefore a Globalping PASS means only that the requested network measurement reached the endpoint; it must never be treated as proof that the same VPN link works in HAPP.

The v3 workflow now enforces this boundary: Globalping recovery never promotes an endpoint into the broad working list, and UDP/Hysteria transport non-refusal never becomes a working verdict.

## Globalping — Russian city selection

The workflow expects a GitHub Actions secret named `GLOBALPING_API_TOKEN`. Authenticated accounts currently get 500 free measurement tests/hour. v3 uses three Russian non-core cities when available, requires `eyeball-network` probes, and requires at least two distinct valid cities to reach the endpoint before marking a Globalping transport recovery as strong. Moscow and Saint Petersburg are excluded from this recovery stage.

The implementation uses `results[].probe.city` / `results[].probe.country` / `results[].probe.tags` from the measurement response. The older code incorrectly looked for `results[].probe.location.*`, which is why the saved diagnostic could show empty city names and could not prove that the requested probe actually came from the intended Russian city.

The Globalping location request also explicitly asks for the `eyeball-network` tag. This matters because Globalping distinguishes ordinary-user/ISP probes from datacenter probes. A recovery row is rejected unless the returned probe matches the requested city, is in Russia, and carries `eyeball-network`.

## Exact-link Xray

Xray tests the **original link unchanged**: VLESS stays VLESS, Trojan stays Trojan, Hysteria2 stays Hysteria2, TUIC stays TUIC. The normal HTTPS targets and the Cloudflare real-download fallback remain enabled.

Important limitation: this exact-link Xray process runs on the GitHub Actions runner, not inside a Russian mobile ISP. Therefore `locations-lte-xray-verified.txt` proves protocol-level connectivity from the CI runner, not from a Russian LTE connection.

`locations-lte-globalping-recovered.txt` is the intersection of (1) a strong Russian eyeball Globalping transport recovery and (2) an Xray PASS from the GitHub runner. It is a **shortlist for manual testing**, not a claim that HAPP will work in Russia.

## Hysteria / UDP

Hysteria/Hysteria2/TUIC are detected from their original URI schemes. UDP transport screening is diagnostic only. `Open or filtered` / non-refused UDP is not enough to prove a QUIC/Hysteria handshake. `lte-hysteria-passing.txt` now contains only Hysteria-family links that passed the exact-link Xray stage.

## Recovery order

1. Check-Host Russian transport baseline.
2. Exact-link Xray for all LTE links.
3. Globalping transport recovery for remaining TCP endpoints, from non-core Russian eyeball probes.
4. Optional host.tools transport recovery.

Neither Globalping nor host.tools can directly certify a VPN protocol. They are diagnostic/recovery sources only.

## Outputs

- `results/locations-lte.txt` — Check-Host Russian transport baseline only; not protocol proof.
- `results/locations-lte-xray-verified.txt` — exact-link Xray verified links.
- `results/locations-lte-xray-review.txt` — Xray failures/inconclusive links.
- `results/locations-lte-globalping-transport.txt` — strong Globalping Russian eyeball transport recoveries; diagnostic only.
- `results/locations-lte-globalping-recovered.txt` — Globalping strong transport recovery + Xray PASS on GitHub runner; manual-test shortlist only.
- `results/locations-lte-hosttools-recovered.txt` — host.tools transport recoveries from non-core Russian cities.
- `results/locations-lte-strong.txt` / `partial.txt` — Check-Host strength buckets.
- `results/lte-hysteria-all.txt` — all original Hysteria/Hysteria2/TUIC links unchanged.
- `results/lte-hysteria-passing.txt` — Hysteria-family links that passed exact-link Xray.
- `results/results.md` — human-readable report with the above limitations.

## Production boundary

No production routing, publication, Fast/Gaming logic or production health files are changed.
