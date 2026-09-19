# Experimental Russia checker

This directory is intentionally isolated from the production checker. Delete this directory and the matching workflow when the experiment is finished.

## What the experiment tests

The experiment has two independent parts:

1. **Check-Host Russia transport test**
   - uses only `ru2.node.check-host.net` (Moscow) and `ru3.node.check-host.net` (Saint Petersburg);
   - TCP protocols (VLESS, Trojan, etc.) require a positive TCP connection from both nodes;
   - UDP protocols (Hysteria/Hysteria2/TUIC) use Check-Host UDP instead of an invalid TCP probe;
   - UDP is deliberately reported as `PASS-UDP-FILTERED` rather than ordinary `PASS`, because Check-Host correctly treats silent UDP as `open or filtered`, which cannot prove a QUIC/Hysteria handshake.

2. **Globalping city diagnostic**
   - discovers currently online Russian probes;
   - prefers major Russian cities when probes exist and fills remaining slots from the live probe list;
   - performs host-level ping diagnostics on a small regular sample;
   - never changes the final link lists.

There is **no routing, no Xray startup, no speed test, no Fast/Gaming selection and no production publication step** in this experiment.

## How to run

Run the GitHub Actions workflow named `EXPERIMENTAL — Russia checker` manually.

The workflow commits only new files under `experimental/russia-checker-test/results/`. Open `results.md`, then copy the raw links from:

- `locations-regular.txt`
- `locations-lte.txt`

Paste the LTE list into HAPP first. That is the important test for recovering Hysteria2 and other LTE candidates without the production health pipeline interfering.

## Important interpretation

For TCP, `PASS` means the remote port accepted a TCP connection from the Russian checker quorum.

For UDP, `PASS-UDP-FILTERED` means there was no explicit UDP refusal from the Russian checker quorum. It is intentionally not described as proof that Hysteria works end-to-end. The final arbiter for Hysteria remains the user's real HAPP connection test, unless later we add controlled Russian client probes capable of performing an actual Hysteria handshake.

## Why this is a better experiment than changing production now

The current production snapshot has 12 LTE Hysteria2 candidates that fail on `TCP unreachable`. That check is protocol-incompatible with UDP/QUIC, so the experimental path removes exactly that false-negative source without changing anything else in production.
