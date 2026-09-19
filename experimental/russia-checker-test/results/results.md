# Russia checker experiment

Generated: 2026-09-19T15:43:57.731Z
Scope: all
Check-Host nodes: ru2.node.check-host.net, ru3.node.check-host.net
Check-Host quorum: 2/2

> This is an isolated experiment. It does not use routing, Xray, speed tests, DNS policies, Fast/Gaming selection, or the production publication gate.

## REGULAR

Candidates: **580**
Unique endpoints checked: **409**
Endpoint verdicts: **PASS=81**, **UNKNOWN=304**, **FAIL=24**
HAPP-ready links: **107**
Copy from [locations-regular.txt](./locations-regular.txt).

## LTE

Candidates: **164**
Unique endpoints checked: **65**
Endpoint verdicts: **PASS=19**, **UNKNOWN=45**, **FAIL=1**
HAPP-ready links: **46**
Copy from [locations-lte.txt](./locations-lte.txt).

## How to read UDP / Hysteria results

`PASS-UDP-FILTERED` means neither Russian Check-Host node returned an explicit UDP refusal. Check-Host documents silent UDP results as `open or filtered`, so this is intentionally **not** treated as proof that a Hysteria/QUIC handshake works.

For TCP (VLESS/Trojan/etc.), `PASS` means the endpoint accepted a TCP connection from the required Russian checker quorum.

## Globalping city diagnostic

Online Russian probes discovered: **0**.
Cities selected: none.
Sampled regular endpoints: **12**.

This section is diagnostic-only and does not affect the link lists.

## Current baseline from the supplied production snapshot

The supplied candidate manifest contains 744 candidates: 580 regular and 164 LTE/white-list. It contains 695 VLESS, 25 Hysteria2, and 24 Trojan candidates. In the current production health report, all 12 LTE Hysteria2 candidates failed at the preliminary TCP step; this experiment removes that protocol-incompatible gate.

The supplied production configuration currently exposes only three Russian Check-Host nodes: two in Moscow (`ru1`, `ru2`) and one in Saint Petersburg (`ru3`). The experiment therefore keeps Check-Host as the transport gate and uses Globalping only to add city-level diagnostics.

