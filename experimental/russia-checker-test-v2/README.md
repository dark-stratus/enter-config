# Experimental Russia checker v2

This directory is a replacement experiment for `russia-checker-test`. It does **not** modify production checker files.

## What changed

### 1. Protocol is never rewritten
The checker reads the URI scheme directly:

- `vless://` → TCP
- `trojan://` → TCP
- `hysteria://` / `hysteria2://` → UDP
- `tuic://` → UDP

The exact original link is copied into the HAPP-ready output. The checker never converts Hysteria/TUIC to VLESS.

### 2. LTE has only a Russia transport gate in this experiment
For LTE/whitelist candidates there are no Xray tests, speed tests, routing tests or other production gates. Only the two core Russian Check-Host nodes are used:

- `ru2.node.check-host.net` — Moscow
- `ru3.node.check-host.net` — Saint Petersburg

TCP candidates must be positively reachable from both nodes.

UDP candidates are tested with Check-Host UDP. An explicit UDP refusal fails the endpoint. A silent `Open or filtered`-type result is kept as `PASS-UDP-NOT-REFUSED` so Hysteria is not killed by a TCP-only test. This still cannot prove a real Hysteria/QUIC handshake; the passing Hysteria list is for manual HAPP verification.

### 3. Rate limiting is treated as retryable
Check-Host `429` responses and `Retry-After` are honored. Creation requests are intentionally throttled and concurrent polling is bounded, so the experiment should not turn a temporary 429 into a fake server failure.

### 4. Globalping city diagnostic is fixed
The previous experiment incorrectly expected `/v1/probes` to return `{ probes: [...] }` and looked for `probe.country` / `probe.city`. The current Globalping API returns a probe array whose location lives under `probe.location.country` / `probe.location.city`. The v2 script handles the documented shape.

Globalping is diagnostic-only. It cannot add or remove any HAPP link.

## Outputs

`locations-lte.txt` is the file to paste into HAPP.

`lte-hysteria-all.txt` and `lte-hysteria-passing.txt` let us see exactly what happened to the Hysteria pool.

`globalping-city-diagnostic.json` shows how many Russian probes were online and which cities were selectable at run time.

`check-host-russia-nodes.json` shows the live Russian Check-Host inventory.
