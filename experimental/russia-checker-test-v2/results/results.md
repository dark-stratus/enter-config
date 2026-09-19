# Russia checker experiment v2

Generated: 2026-09-19T16:28:11.165Z
Scope: all
Core Check-Host gate: ru2.node.check-host.net, ru3.node.check-host.net
Core quorum: 2/2

> Production files are untouched. This experiment uses only source-health-candidates.json + transport checks. No routing, Xray, speed tests, Fast/Gaming logic or production publication are involved.

## REGULAR

Candidates: **580**
Protocols: **vless=543**, **hysteria2=13**, **trojan=24**
Unique endpoints: **409**
Verdicts: **FAIL=375**, **UNKNOWN=21**, **PASS-UDP-NOT-REFUSED=13**
HAPP-ready links: **13**
Copy: [locations-regular.txt](./locations-regular.txt)

## LTE

Candidates: **164**
Protocols: **vless=152**, **hysteria2=12**
Unique endpoints: **65**
Verdicts: **UNKNOWN=3**, **FAIL=57**, **PASS-UDP-NOT-REFUSED=5**
HAPP-ready links: **12**
Copy: [locations-lte.txt](./locations-lte.txt)

## Hysteria / UDP

Hysteria/Hysteria2/TUIC are detected from the URI scheme and checked with Check-Host UDP, never TCP. The original link is copied to the output unchanged; no Hysteria link is converted to VLESS.

`PASS-UDP-NOT-REFUSED` means the Russian gate did not receive an explicit UDP refusal. Check-Host itself documents the silent UDP state as `Open or filtered`, so this is a transport screening result, not proof of a successful Hysteria/QUIC handshake. Those links are deliberately left in the HAPP test list for manual verification.

## Check-Host Russia nodes

- ru1.node.check-host.net: Moscow
- ru2.node.check-host.net: Moscow
- ru3.node.check-host.net: Saint Petersburg

## Globalping city diagnostic

Online Russian probes discovered: **164**
Selected cities: Moscow (102 probes), Saint Petersburg (19 probes), Yekaterinburg (2 probes), Kazan (2 probes), Novosibirsk (9 probes), Samara (1 probes), Krasnodar (2 probes), Ufa (1 probes), Tomsk (2 probes)

This diagnostic is independent of the candidate verdicts. It exists to answer which Russian cities Globalping can currently source probes from; the city checks use TCP/443 to check-host.net only to verify that the selected probe can execute a measurement.

## Files for your manual test

- `locations-lte.txt` — all passing LTE links, with their original URI schemes preserved.
- `lte-hysteria-all.txt` — every Hysteria/Hysteria2/TUIC LTE candidate before filtering.
- `lte-hysteria-passing.txt` — Hysteria/Hysteria2/TUIC links that passed the UDP transport screen.
- `globalping-city-diagnostic.json` — live Globalping Russian-city inventory + city probes.
- `check-host-russia-nodes.json` — live Check-Host Russian node inventory.

