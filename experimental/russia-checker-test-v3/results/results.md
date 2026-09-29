# Russia checker experiment v3

Generated: 2026-09-29T17:44:20.004Z
Scope: lte
Core Check-Host nodes: ru1.node.check-host.net, ru2.node.check-host.net, ru3.node.check-host.net
TCP strong threshold: 2/3; TCP minimum threshold: 1/3; non-pass TCP recheck: enabled; exact-link Xray: enabled

> Production files are untouched. This experiment uses source-health-candidates.json + Russian transport checks + an exact-link Xray validation stage. No routing, Fast/Gaming logic or production publication is involved.

## LTE

Candidates: **153**
Protocols: **vless=138**, **hysteria2=15**
Unique endpoints: **58**
Verdicts: **FAIL=1**, **PASS=51**, **PASS-PARTIAL=1**, **PASS-UDP-STRONG=5**
Check-Host transport links: **137**
Exact-link Xray: **FAIL-XRAY=71**, **PASS-XRAY=82**
Copy Check-Host transport list: [locations-lte.txt](./locations-lte.txt)
Exact-link Xray verified: [locations-lte-xray-verified.txt](./locations-lte-xray-verified.txt)
Needs manual review: [locations-lte-xray-review.txt](./locations-lte-xray-review.txt)
Transport-only remainder: [locations-lte-transport-only.txt](./locations-lte-transport-only.txt)
Globalping transport diagnostic: [locations-lte-globalping-transport.txt](./locations-lte-globalping-transport.txt)
Globalping gate + Xray (GitHub runner) intersection: [locations-lte-globalping-recovered.txt](./locations-lte-globalping-recovered.txt)
Strong only: [locations-lte-strong.txt](./locations-lte-strong.txt)
Partial only: [locations-lte-partial.txt](./locations-lte-partial.txt)

## Why v3 should recover VLESS/Trojan

The previous v2 parser treated Check-Host TCP results of the documented form [{"time":0.03,"address":"..."}] as non-reachable because it expected an object with .time directly. v3 parses the first result object correctly.

The experiment also keeps protocol schemes unchanged: vless:// stays VLESS, trojan:// stays Trojan, hysteria2:// stays Hysteria2, etc.

## Recheck and LTE stage order

Every non-passing TCP endpoint gets one second Check-Host measurement. LTE selection order is: Russia Gate -> exact-link Xray -> Globalping -> response-latency filter. Host.tools remains diagnostic-only.

Response-latency policy: count post-Globalping links with known direct Xray HTTP response latency <= **2500 ms**. If that count is at least **15**, keep **2500 ms**; otherwise expand to **5000 ms**.

Cloudflare download-fallback Xray passes are latency-unknown for this filter because their elapsed time is a 4 MB download duration, not a lightweight response latency; they are listed separately for manual review.

## Hysteria / UDP

Hysteria/Hysteria2/TUIC are detected from the URI scheme. UDP transport screening is kept as diagnostics only; a non-refused UDP port does not prove a Hysteria/QUIC handshake.

`lte-hysteria-passing.txt` now contains only links that passed the exact-link Xray stage. Globalping is not used to certify UDP/Hysteria because it can measure UDP reachability but cannot perform the original protocol handshake.

The exact-link Xray stage uses the real parsed protocol from `scripts/link-runtime.mjs`, so Hysteria2 remains Hysteria2 instead of being converted to VLESS.
## Check-Host Russia nodes

- ru1.node.check-host.net: Moscow
- ru2.node.check-host.net: Moscow
- ru3.node.check-host.net: Saint Petersburg

## Globalping — additional Russian cities

Online Russian probes discovered: **174**
Inventory cities: Moscow (109; eyeball=13; dc=96), Saint Petersburg (25; eyeball=2; dc=23), Yekaterinburg (1; eyeball=0; dc=1), Kazan (1; eyeball=0; dc=1), Novosibirsk (8; eyeball=2; dc=6), Krasnodar (1; eyeball=1; dc=0), Ufa (1; eyeball=1; dc=0), Kursk (2; eyeball=2; dc=0), Tomsk (2; eyeball=2; dc=0), Bol'sherech'ye (1; eyeball=1; dc=0), Kostroma (1; eyeball=1; dc=0), Nizhniy Novgorod (1; eyeball=1; dc=0)
Gate cities (non-core, eyeball only): **Novosibirsk (eyeball=2), Krasnodar (eyeball=1), Ufa (eyeball=1)**
Globalping remaining budget before run: **473 tests**; reset: 2121 s.

Globalping gate is bounded only by the live Globalping test budget, uses exactly **3 non-core Russian eyeball cities** per endpoint and accepts **2/3** as the normal strict gate.
Globalping result: **17 strict 2/3 endpoint passes / 18 attempted**; **16** reached all 3 cities.
Comparison files: `locations-lte-before-globalping.txt` = exact-link Xray PASS before Globalping; `locations-lte-globalping-2of3.txt` = strict TCP endpoints with at least 2/3 Globalping city passes; `locations-lte-globalping-3of3.txt` = strict TCP endpoints with 3/3 passes.
Globalping is a transport/network gate only. It does not run a VLESS, Trojan or Hysteria2 client, so Globalping PASS is never sufficient by itself to publish a working HAPP link.
Hysteria/Hysteria2/TUIC links that passed exact-link Xray are kept in the safe result because the Globalping gate is intentionally TCP-only.
Fallback protection is fail-open: a Globalping API/limit/measurement outage, rate-limit stop, or untested endpoint keeps the pre-Globalping Xray-passing link instead of deleting it. A real Globalping FAIL is still excluded from the safe result.
The exact-link Xray stage runs on the GitHub Actions runner, not inside the Russian ISP. Therefore the strict Globalping files are transport evidence from additional Russian eyeball probes, while `locations-lte-globalping-recovered.txt` is the safe post-GP shortlist with fail-open protection.

## Files for your manual test

- `locations-lte.txt` — Russian Check-Host baseline (transport signal; not protocol proof).
- `locations-lte-xray-verified.txt` — exact-link Xray verified links.
- `locations-lte-before-globalping.txt` — the same Xray-passing links immediately before the Globalping stage; use this to measure what Globalping actually removes.
- `locations-lte-globalping-2of3.txt` — strict TCP Globalping pass from at least 2 of 3 selected non-Moscow/non-Saint-Petersburg Russian eyeball cities.
- `locations-lte-globalping-3of3.txt` — strict TCP Globalping pass from all 3 selected cities.
- `locations-lte-globalping-recovered.txt` — safe post-Globalping result: strict 2/3 passes plus fail-open links when Globalping was unavailable, rate-limited, or did not return a result; UDP/Hysteria Xray-passing links are retained because Globalping is TCP-only.
- `locations-lte-xray-cloudflare-speed.txt` — links recovered specifically by the Cloudflare real-download fallback.
- `locations-lte-xray-review.txt` — links that still failed exact-link Xray.
- `lte-hysteria-all.txt` — all original Hysteria/Hysteria2/TUIC LTE candidates.
- `lte-hysteria-passing.txt` — Hysteria-family links that passed exact-link Xray.
- `globalping-city-diagnostic.json` — current Russian probe inventory and selected gate cities.
- `check-host-russia-nodes.json` — current Check-Host Russian nodes.

