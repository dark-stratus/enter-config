# Russia checker experiment v3

Generated: 2026-09-19T17:02:56.979Z
Scope: lte
Core Check-Host nodes: ru1.node.check-host.net, ru2.node.check-host.net, ru3.node.check-host.net
TCP strong threshold: 2/3; TCP minimum threshold: 1/3; non-pass TCP recheck: enabled

> Production files are untouched. This experiment uses only source-health-candidates.json + transport checks. No routing, Xray, speed tests, Fast/Gaming logic or production publication are involved.

## LTE

Candidates: **164**
Protocols: **vless=152**, **hysteria2=12**
Unique endpoints: **65**
Verdicts: **PASS=52**, **UNKNOWN=6**, **PASS-PARTIAL=1**, **FAIL=1**, **PASS-UDP-STRONG=5**
HAPP-ready links: **146**
Copy all: [locations-lte.txt](./locations-lte.txt)
Strong only: [locations-lte-strong.txt](./locations-lte-strong.txt)
Partial only: [locations-lte-partial.txt](./locations-lte-partial.txt)

## Why v3 should recover VLESS/Trojan

The previous v2 parser treated Check-Host TCP results of the documented form [{"time":0.03,"address":"..."}] as non-reachable because it expected an object with .time directly. v3 parses the first result object correctly.

The experiment also keeps protocol schemes unchanged: vless:// stays VLESS, trojan:// stays Trojan, hysteria2:// stays Hysteria2, etc.

## Recheck strategy

Every non-passing TCP endpoint gets one second Check-Host measurement. A server can therefore recover from a transient timeout or asymmetric first measurement. The report keeps both attempts.

For production later, we can choose whether to publish all TCP 1/3+ results or only the stronger subset after your HAPP test.

## Hysteria / UDP

Hysteria/Hysteria2/TUIC are detected from the URI scheme and checked with Check-Host UDP, never TCP. The original link is copied to the output unchanged; no Hysteria link is converted to VLESS.

`PASS-UDP-*` means the Russian gate did not receive an explicit UDP refusal. Check-Host itself documents the silent UDP state as `Open or filtered`, so this is a transport screening result, not proof of a successful Hysteria/QUIC handshake. Those links are deliberately left in the HAPP test list for manual verification.

## Check-Host Russia nodes

- ru1.node.check-host.net: Moscow
- ru2.node.check-host.net: Moscow
- ru3.node.check-host.net: Saint Petersburg

## Globalping city diagnostic

Online Russian probes discovered: **166**
Selected cities: Moscow (101 probes), Saint Petersburg (20 probes), Yekaterinburg (2 probes), Kazan (2 probes), Novosibirsk (9 probes), Samara (1 probes), Krasnodar (2 probes), Ufa (1 probes), Kursk (2 probes)

This diagnostic is independent of the candidate verdicts. It exists to answer which Russian cities Globalping can currently source probes from; the city checks use TCP/443 to check-host.net only to verify that the selected probe can execute a measurement.

## Files for your manual test

- `locations-lte.txt` — broad LTE test list: TCP endpoints with at least 1/3 Russian TCP confirmations, plus UDP endpoints that are not explicitly refused.
- `locations-lte-strong.txt` — stronger subset: TCP 2/3+; UDP 2/3+ non-refused.
- `locations-lte-partial.txt` — TCP endpoints confirmed by exactly 1/3 nodes (useful for testing asymmetric routes).
- `lte-hysteria-all.txt` — every Hysteria/Hysteria2/TUIC LTE candidate before filtering.
- `lte-hysteria-passing.txt` — Hysteria/Hysteria2/TUIC links that passed the UDP transport screen.
- `globalping-city-diagnostic.json` — live Globalping Russian-city inventory + city probes.
- `check-host-russia-nodes.json` — live Check-Host Russian node inventory.

