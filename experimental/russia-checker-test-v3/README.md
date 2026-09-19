# Russia checker experiment v3 — LTE only

This folder is the isolated LTE experiment. No production files are changed.

## Goal

Find LTE endpoints that are actually reachable from Russia without destroying protocol identity.

`vless://` stays VLESS, `trojan://` stays Trojan, `hysteria://` / `hysteria2://` stay Hysteria, and `tuic://` stays TUIC.

## Russian checks

### Check-Host

TCP endpoints use the three currently available Russian Check-Host nodes:

- Moscow (`ru1`)
- Moscow (`ru2`)
- Saint Petersburg (`ru3`)

TCP non-passes are rechecked once to recover transient failures.

Hysteria/Hysteria2/TUIC are checked as UDP, never TCP.

### Globalping recovery

Globalping is now an **active secondary Russian source**, not just a city diagnostic. Its public API supports MTR measurements with TCP or UDP and an explicit destination port. The current public API also exposes a large live probe inventory and location targeting by city/country. citeturn858787search0turn858787search5

The experiment discovers Russian probes and selects up to three additional cities, preferring:

1. Yekaterinburg
2. Kazan
3. Novosibirsk

with automatic fallback to other currently available Russian cities.

For an endpoint that did not get a normal Check-Host PASS, v3 runs one Globalping MTR measurement from those cities. If at least one city reaches the endpoint, the endpoint is recovered into `locations-lte.txt`.

Globalping recovery is therefore a **network/transport recovery source**, not proof of a successful VLESS/Trojan/Hysteria handshake. MTR supports TCP/UDP port probing but does not implement the proxy application protocol itself. citeturn858787search4turn668036search0

## Output

- `locations-lte.txt` — broad HAPP test list, including Globalping recoveries.
- `locations-lte-globalping-recovered.txt` — only endpoints recovered by Globalping.
- `locations-lte-strong.txt` — strict Check-Host subset.
- `locations-lte-partial.txt` — exactly-1/3 TCP subset.
- `lte-hysteria-all.txt` — every original Hysteria/Hysteria2/TUIC candidate.
- `lte-hysteria-passing.txt` — UDP-screened Hysteria/Hysteria2/TUIC list.
- `results.md` / `results.json` — full verdicts and provenance.
- `globalping-city-diagnostic.json` — current Russian probes/cities and the selected recovery cities.

## Rate limits

Globalping documents 250 free tests/hour for unauthenticated requests and up to 50 probes per measurement. Recovery is serialized and uses at most three Russian probes per endpoint, while city discovery itself is a no-cost probe listing call. citeturn858787search0
