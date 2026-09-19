# Russia checker experiment v3 — LTE only

This folder is fully isolated from production. It does not modify or invoke the production health gate, routing, Xray, Fast/Gaming selection, or publication pipeline.

## What changed from v2

1. **Fixed Check-Host TCP parsing.** Check-Host documents TCP results as an array such as `[{"time":0.03,"address":"..."}]`. v2 incorrectly treated the whole array as the node result, so successful VLESS/Trojan TCP endpoints became `FAIL`. v3 parses the result object correctly.
2. **All protocols are preserved.** URI scheme is never rewritten. VLESS, Trojan, Hysteria/Hysteria2, TUIC, and other schemes are emitted unchanged.
3. **Three Russian Check-Host nodes.** `ru1`, `ru2`, `ru3`. This adds independent Russian observation without pretending they are three cities: ru1/ru2 are Moscow; ru3 is Saint Petersburg.
4. **TCP tiers.** `2/3+` is strong. `1/3` is partial and is also emitted into the broad list for manual HAPP testing.
5. **One TCP recheck.** Non-passing TCP endpoints are measured a second time, so a transient timeout or asymmetric first result can recover.
6. **UDP stays explicitly provisional.** Check-Host UDP can tell us that a port was not explicitly refused, but it cannot prove a Hysteria/QUIC application handshake.

## Important limitation for Hysteria

There is no reliable application-level Hysteria handshake check through the public Globalping API used here. Globalping currently supports ping/traceroute/MTR/DNS/HTTP measurements, not a generic TCP/UDP service check. Therefore v3 does **not** pretend that a UDP `open or filtered` result proves Hysteria works. Those links remain in the manual HAPP test list.

## Outputs

- `results/locations-lte.txt` — broad manual test list.
- `results/locations-lte-strong.txt` — stronger 2/3+ subset.
- `results/locations-lte-partial.txt` — exactly 1/3 TCP-confirmed subset.
- `results/lte-hysteria-all.txt` — all Hysteria-family LTE candidates.
- `results/lte-hysteria-passing.txt` — UDP-screened Hysteria-family candidates.
- `results/globalping-city-diagnostic.json` — diagnostic-only Russian city inventory.

## Why the old result was misleading

The saved v2 result contained `580 regular` candidates and `164 LTE` candidates, with LTE represented as `152 VLESS + 12 Hysteria2`. After replaying the saved TCP node payloads with the corrected parser, the LTE set contains many successful TCP observations that v2 falsely called unreachable. The v3 live run is the authoritative test; the replay is only evidence of the parser defect.
