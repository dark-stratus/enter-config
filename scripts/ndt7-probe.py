#!/usr/bin/env python3
"""
Minimal M-Lab NDT7 download probe through a local SOCKS5 proxy.

The locate API is queried directly from the GitHub runner. The selected
measurement WebSocket is then reached through the candidate's local Xray
SOCKS5 proxy. This keeps the measurement destination independent from the
candidate VPN endpoint.
"""

import argparse
import json
import ssl
import sys
import time
import urllib.request

try:
    import websocket
except Exception as exc:  # pragma: no cover
    print(
        json.dumps(
            {
                "ok": False,
                "error": f"websocket-client unavailable: {exc}",
            }
        )
    )
    sys.exit(2)


LOCATE_URL = "https://locate.measurementlab.net/v2/nearest/ndt/ndt7"
SUBPROTOCOL = "net.measurementlab.ndt.v7"
USER_AGENT = "enter-config-healthcheck/1.0"


def locate_service_url(timeout: float) -> str:
    request = urllib.request.Request(
        LOCATE_URL,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(
                f"M-Lab Locate returned HTTP {response.status}"
            )
        payload = json.loads(response.read().decode("utf-8"))

    results = payload.get("results") or payload.get("result") or []
    if not results:
        raise RuntimeError("M-Lab Locate returned no ndt7 targets")

    for result in results:
        urls = result.get("urls") or {}
        for key, value in urls.items():
            if "/ndt/v7/download" in key or "/ndt/v7/download" in value:
                if value.startswith("wss://"):
                    return value

    raise RuntimeError("M-Lab Locate response has no WSS download URL")


def run_probe(socks_port: int, timeout: float) -> dict:
    started = time.monotonic()
    service_url = locate_service_url(min(timeout, 10.0))

    ws = websocket.create_connection(
        service_url,
        timeout=min(timeout, 10.0),
        subprotocols=[SUBPROTOCOL],
        http_proxy_host="127.0.0.1",
        http_proxy_port=socks_port,
        proxy_type="socks5h",
        enable_multithread=True,
        origin=None,
    )

    connected = time.monotonic()
    total_bytes = 0
    latest_num_bytes = 0
    latest_elapsed_us = 0

    deadline = min(
        connected + max(3.0, min(timeout - 1.0, 7.0)),
        connected + 7.0,
    )

    ws.settimeout(1.0)

    try:
        while time.monotonic() < deadline:
            try:
                message = ws.recv()
            except websocket.WebSocketTimeoutException:
                # No frame during this one-second read window. Keep the
                # connection alive and continue until the probe deadline.
                continue
            except Exception:
                # The server may close after its own test duration. We keep
                # whatever application-level data we already collected.
                break

            if message is None:
                break

            if isinstance(message, bytes):
                total_bytes += len(message)
                continue

            if isinstance(message, str):
                try:
                    obj = json.loads(message)
                except Exception:
                    continue

                app_info = obj.get("AppInfo") or {}
                if isinstance(app_info, dict):
                    value = app_info.get("NumBytes")
                    elapsed = app_info.get("ElapsedTime")
                    if isinstance(value, (int, float)):
                        latest_num_bytes = max(
                            latest_num_bytes,
                            int(value),
                        )
                    if isinstance(elapsed, (int, float)):
                        latest_elapsed_us = max(
                            latest_elapsed_us,
                            int(elapsed),
                        )
    finally:
        try:
            ws.close()
        except Exception:
            pass

    elapsed = max(time.monotonic() - connected, 0.001)

    measured_bytes = max(
        total_bytes,
        latest_num_bytes,
    )

    measured_seconds = (
        latest_elapsed_us / 1_000_000.0
        if latest_elapsed_us > 0
        else elapsed
    )

    kbps = (
        (measured_bytes / 1024.0) / max(measured_seconds, 0.001)
    )

    return {
        "ok": measured_bytes > 0,
        "serviceUrl": service_url,
        "server": service_url.split("/")[2],
        "bytes": measured_bytes,
        "elapsedMs": round(measured_seconds * 1000),
        "kbps": round(kbps, 1),
        "websocketCode": 101,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socks-port", type=int, required=True)
    parser.add_argument("--timeout", type=float, default=18.0)
    args = parser.parse_args()

    try:
        result = run_probe(
            args.socks_port,
            args.timeout,
        )
    except Exception as exc:
        result = {
            "ok": False,
            "bytes": 0,
            "elapsedMs": 0,
            "kbps": 0,
            "websocketCode": 0,
            "error": str(exc),
        }

    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
