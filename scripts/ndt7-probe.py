#!/usr/bin/env python3
"""
M-Lab NDT7 download probe through a local Xray SOCKS5 proxy.

The caller resolves the M-Lab Locate target through the candidate's SOCKS
proxy and passes the resulting WSS /ndt/v7/download service URL here.
"""

import argparse
import json
import sys
import time

try:
    import websocket
except Exception as exc:
    print(
        json.dumps(
            {
                "ok": False,
                "error": f"websocket-client unavailable: {exc}",
            }
        )
    )
    sys.exit(2)

try:
    import python_socks  # noqa: F401
except Exception as exc:
    print(
        json.dumps(
            {
                "ok": False,
                "error": f"python-socks unavailable: {exc}",
            }
        )
    )
    sys.exit(2)


SUBPROTOCOL = "net.measurementlab.ndt.v7"
USER_AGENT = "enter-config-healthcheck/1.1"


def run_probe(
    socks_port: int,
    timeout: float,
    service_url: str,
) -> dict:
    started = time.monotonic()

    if not service_url.startswith("wss://"):
        raise RuntimeError("M-Lab service URL must use wss://")

    if "/ndt/v7/download" not in service_url:
        raise RuntimeError(
            "M-Lab service URL is not an ndt7 download endpoint"
        )

    ws = websocket.create_connection(
        service_url,
        timeout=min(timeout, 12.0),
        subprotocols=[SUBPROTOCOL],
        header=[
            f"User-Agent: {USER_AGENT}",
            "Cache-Control: no-cache",
        ],
        http_proxy_host="127.0.0.1",
        http_proxy_port=socks_port,
        proxy_type="socks5h",
        http_proxy_timeout=min(timeout, 8.0),
        enable_multithread=True,
    )

    connected = time.monotonic()
    total_binary_bytes = 0
    latest_num_bytes = 0
    latest_elapsed_us = 0

    # NDT7 is a bounded measurement. Leave enough time for the final
    # application-level Measurement result while keeping the overall probe
    # under the health-check timeout.
    deadline = min(
        connected + max(4.0, min(timeout - 1.0, 12.0)),
        connected + 12.0,
    )

    ws.settimeout(1.0)

    try:
        while time.monotonic() < deadline:
            try:
                message = ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            except Exception:
                break

            if message is None:
                break

            if isinstance(message, bytes):
                total_binary_bytes += len(message)
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

    elapsed = max(
        time.monotonic() - connected,
        0.001,
    )

    measured_bytes = max(
        total_binary_bytes,
        latest_num_bytes,
    )

    measured_seconds = (
        latest_elapsed_us / 1_000_000.0
        if latest_elapsed_us > 0
        else elapsed
    )

    kbps = (
        (measured_bytes / 1024.0)
        / max(measured_seconds, 0.001)
    )

    host = service_url.split("/")[2]

    return {
        "ok": measured_bytes > 0,
        "serviceUrl": service_url,
        "server": host,
        "bytes": measured_bytes,
        "elapsedMs": round(measured_seconds * 1000),
        "kbps": round(kbps, 1),
        "websocketCode": 101,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--socks-port",
        type=int,
        required=True,
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
    )
    parser.add_argument(
        "--service-url",
        required=True,
        help="Pre-resolved M-Lab ndt7 WSS download URL",
    )
    args = parser.parse_args()

    try:
        result = run_probe(
            args.socks_port,
            args.timeout,
            args.service_url,
        )
    except Exception as exc:
        result = {
            "ok": False,
            "bytes": 0,
            "elapsedMs": 0,
            "kbps": 0,
            "websocketCode": 0,
            "server": "",
            "serviceUrl": args.service_url,
            "error": str(exc),
        }

    print(
        json.dumps(
            result,
            ensure_ascii=False,
        )
    )
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
