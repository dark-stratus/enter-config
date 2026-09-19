# Russia checker experiment v3

Generated: 2026-09-19T17:37:57.394Z
Scope: lte
Core Check-Host nodes: ru1.node.check-host.net, ru2.node.check-host.net, ru3.node.check-host.net
TCP strong threshold: 2/3; TCP minimum threshold: 1/3; non-pass TCP recheck: enabled

> Production files are untouched. This experiment uses only source-health-candidates.json + transport checks. No routing, Xray, speed tests, Fast/Gaming logic or production publication are involved.

## LTE

Candidates: **164**
Protocols: **vless=152**, **hysteria2=12**
Unique endpoints: **65**
Verdicts: **PASS=49**, **UNKNOWN=11**, **PASS-UDP-STRONG=5**
HAPP-ready links: **139**
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

## Globalping secondary Russian source

Online Russian probes discovered: **167**
Diagnostic cities: Moscow (103; eyeball=11; dc=92), Saint Petersburg (20; eyeball=2; dc=18), Yekaterinburg (2; eyeball=0; dc=2), Kazan (2; eyeball=1; dc=1), Novosibirsk (8; eyeball=2; dc=6), Samara (1; eyeball=0; dc=1), Krasnodar (2; eyeball=1; dc=1), Ufa (1; eyeball=1; dc=0), Kursk (2; eyeball=2; dc=0)
Recovery cities: Yekaterinburg (2 probes), Kazan (2 probes), Novosibirsk (8 probes)

For endpoints without a normal Check-Host PASS, v3 performs an independent Globalping MTR from up to three additional Russian cities. At least one reached target city is enough to recover the endpoint into the broad LTE list. This remains a transport/network check, not a proxy-protocol handshake.

## Files for your manual test

- `locations-lte.txt` — broad LTE test list: normal Check-Host passes plus Globalping-recovered endpoints.
- `locations-lte-strong.txt` — stronger Check-Host subset.
- `locations-lte-partial.txt` — exactly-1/3 Check-Host TCP subset.
- `locations-lte-globalping-recovered.txt` — endpoints recovered specifically by the second Russian source.
- `lte-hysteria-all.txt` — all original Hysteria/Hysteria2/TUIC LTE candidates.
- `lte-hysteria-passing.txt` — UDP transport-screened Hysteria/Hysteria2/TUIC links.
- `globalping-city-diagnostic.json` — current Russian probe inventory and recovery cities.
- `check-host-russia-nodes.json` — current Check-Host Russian nodes.

