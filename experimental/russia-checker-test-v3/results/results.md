# Russia checker experiment v3

Generated: 2026-09-19T19:38:09.344Z
Scope: lte
Core Check-Host nodes: ru1.node.check-host.net, ru2.node.check-host.net, ru3.node.check-host.net
TCP strong threshold: 2/3; TCP minimum threshold: 1/3; non-pass TCP recheck: enabled; exact-link Xray: enabled

> Production files are untouched. This experiment uses source-health-candidates.json + Russian transport checks + an exact-link Xray validation stage. No routing, Fast/Gaming logic or production publication is involved.

## LTE

Candidates: **164**
Protocols: **vless=152**, **hysteria2=12**
Unique endpoints: **65**
Verdicts: **PASS=52**, **UNKNOWN=4**, **FAIL=3**, **PASS-PARTIAL=1**, **PASS-UDP-STRONG=5**
HAPP-ready transport links: **150**
Exact-link Xray: **PASS-XRAY=43**, **FAIL-XRAY=121**
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

After transport screening, the experiment starts an exact-link Xray test. Links that fail the normal HTTPS targets get the same Cloudflare real-download check used by production health (4 MB, HTTP 2xx/3xx, meaningful download, minimum throughput). This is a fallback verifier, not a replacement for the normal target checks.

For production later, we can choose which verdict tiers to publish after comparing them with your HAPP results.

## Hysteria / UDP

Hysteria/Hysteria2/TUIC are detected from the URI scheme and checked with Check-Host UDP, never TCP. The original link is copied to the output unchanged; no Hysteria link is converted to VLESS.

`PASS-UDP-*` means the Russian gate did not receive an explicit UDP refusal. Check-Host itself documents the silent UDP state as `Open or filtered`, so this is a transport screening result, not proof of a successful Hysteria/QUIC handshake.

The exact-link Xray stage uses the real parsed protocol from `scripts/link-runtime.mjs` and therefore keeps Hysteria2 as Hysteria2 instead of coercing it into VLESS.
## Check-Host Russia nodes

- ru1.node.check-host.net: Moscow
- ru2.node.check-host.net: Moscow
- ru3.node.check-host.net: Saint Petersburg

## Globalping — additional Russian cities

Online Russian probes discovered: **0**
Inventory cities: none
Recovery cities: none
Globalping rate-limit status was unavailable, so recovery measurements are not started.

Recovery is capped at **45 endpoints** and reserves **10 tests**. With four cities, one endpoint costs four Globalping tests. The run stops immediately on HTTP 429.
This is the extra Russian checker intended to be reusable later for ordinary locations. It is used as a second geographic transport signal, not as proof of a working proxy protocol.

## Files for your manual test

- `locations-lte.txt` — broad LTE test list: normal Check-Host passes plus Globalping-recovered endpoints.
- `locations-lte-strong.txt` — stronger Check-Host subset.
- `locations-lte-partial.txt` — exactly-1/3 Check-Host TCP subset.
- `locations-lte-globalping-recovered.txt` — endpoints recovered specifically by the additional Russian-city checker.
- `locations-lte-xray-verified.txt` — exact-link Xray verified links, including the Cloudflare speed fallback.
- `locations-lte-xray-cloudflare-speed.txt` — links recovered specifically by the production-style Cloudflare real-download fallback.
- `locations-lte-xray-review.txt` — links that still failed exact-link Xray.
- `lte-hysteria-all.txt` — all original Hysteria/Hysteria2/TUIC LTE candidates.
- `lte-hysteria-passing.txt` — UDP transport-screened Hysteria/Hysteria2/TUIC links.
- `globalping-city-diagnostic.json` — current Russian probe inventory, rate-limit state and selected recovery cities.
- `check-host-russia-nodes.json` — current Check-Host Russian nodes.

