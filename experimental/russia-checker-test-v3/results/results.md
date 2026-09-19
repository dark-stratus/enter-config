# Russia checker experiment v3

Generated: 2026-09-19T18:03:58.318Z
Scope: lte
Core Check-Host nodes: ru1.node.check-host.net, ru2.node.check-host.net, ru3.node.check-host.net
TCP strong threshold: 2/3; TCP minimum threshold: 1/3; non-pass TCP recheck: enabled; exact-link Xray: enabled

> Production files are untouched. This experiment uses source-health-candidates.json + Russian transport checks + an exact-link Xray validation stage. No routing, Fast/Gaming logic or production publication is involved.

## LTE

Candidates: **164**
Protocols: **vless=152**, **hysteria2=12**
Unique endpoints: **65**
Verdicts: **PASS=52**, **FAIL=2**, **UNKNOWN=7**, **PASS-PARTIAL=1**, **PASS-UDP-STRONG=3**
HAPP-ready transport links: **121**
Exact-link Xray: **PASS-XRAY=30**, **FAIL-XRAY=91**
Copy all transport candidates: [locations-lte.txt](./locations-lte.txt)
Exact-link Xray verified: [locations-lte-xray-verified.txt](./locations-lte-xray-verified.txt)
Needs manual review: [locations-lte-xray-review.txt](./locations-lte-xray-review.txt)
Transport-only remainder: [locations-lte-transport-only.txt](./locations-lte-transport-only.txt)
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

`PASS-UDP-*` means the Russian gate did not receive an explicit UDP refusal. Check-Host itself documents the silent UDP state as `Open or filtered`, so this is a transport screening result, not proof of a successful Hysteria/QUIC handshake.

The exact-link Xray stage uses the real parsed protocol from `scripts/link-runtime.mjs` and therefore keeps Hysteria2 as Hysteria2 instead of coercing it into VLESS.
## Check-Host Russia nodes

- ru1.node.check-host.net: Moscow
- ru2.node.check-host.net: Moscow
- ru3.node.check-host.net: Saint Petersburg

## Globalping diagnostic-only

Online Russian probes discovered: **166**
Diagnostic cities: Moscow (102; eyeball=11; dc=91), Saint Petersburg (20; eyeball=2; dc=18), Yekaterinburg (2; eyeball=0; dc=2), Kazan (2; eyeball=1; dc=1), Novosibirsk (8; eyeball=2; dc=6), Samara (1; eyeball=0; dc=1), Krasnodar (2; eyeball=1; dc=1), Ufa (1; eyeball=1; dc=0), Kursk (2; eyeball=2; dc=0)

No Globalping measurements are created by v3; it is inventory-only. This avoids burning the 250 unauthenticated tests/hour budget on a recovery pass.
The active Russian reachability gate remains Check-Host. Exact-link Xray runs from the GitHub runner and is a protocol/configuration validation layer, not a substitute for a Russian vantage point.

## Files for your manual test

- `locations-lte.txt` — broad LTE test list: normal Check-Host passes plus Globalping-recovered endpoints.
- `locations-lte-strong.txt` — stronger Check-Host subset.
- `locations-lte-partial.txt` — exactly-1/3 Check-Host TCP subset.
- `locations-lte-globalping-recovered.txt` — endpoints recovered specifically by the second Russian source.
- `lte-hysteria-all.txt` — all original Hysteria/Hysteria2/TUIC LTE candidates.
- `lte-hysteria-passing.txt` — UDP transport-screened Hysteria/Hysteria2/TUIC links.
- `globalping-city-diagnostic.json` — current Russian probe inventory and recovery cities.
- `check-host-russia-nodes.json` — current Check-Host Russian nodes.

