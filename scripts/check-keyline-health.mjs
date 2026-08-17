#!/usr/bin/env node

import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { parseLink, buildOutbound } from "./link-runtime.mjs";

const ROOT =
    path.resolve(
        process.env.GITHUB_WORKSPACE ||
        process.cwd()
    );

const LINKS_DIR =
    path.join(
        ROOT,
        "config",
        "links"
    );

const INDEX_FILE =
    path.join(
        LINKS_DIR,
        "index.json"
    );

const XRAY_BIN =
    process.env.XRAY_BIN ||
    path.join(
        ROOT,
        ".xray",
        "xray"
    );

const TCP_TIMEOUT_MS =
    2500;

const XRAY_START_TIMEOUT_MS =
    2500;

const REQUEST_TIMEOUT_MS =
    8000;

const REQUEST_RETRIES =
    2;

// Connectivity-only probes can report success even when real traffic is
// effectively unusable. Run a small real download through every candidate
// after the 3 HTTPS connectivity probes.
const QUALITY_DOWNLOAD_URL =
    process.env.HEALTHCHECK_QUALITY_URL ||
    "https://speed.cloudflare.com/__down?bytes=1048576";

const QUALITY_DOWNLOAD_TIMEOUT_MS =
    Math.max(
        5000,
        Number(process.env.HEALTHCHECK_QUALITY_TIMEOUT_MS) || 20000
    );

const QUALITY_MIN_BYTES =
    Math.max(
        16384,
        Number(process.env.HEALTHCHECK_QUALITY_MIN_BYTES) || 1048576
    );

const QUALITY_MIN_KBPS =
    Math.max(
        16,
        Number(process.env.HEALTHCHECK_QUALITY_MIN_KBPS) || 640
    );

const QUALITY_PROBE_COUNT =
    Math.max(
        1,
        Number(process.env.HEALTHCHECK_QUALITY_PROBE_COUNT) || 3
    );

const QUALITY_MIN_PASSES =
    Math.max(
        1,
        Math.min(
            QUALITY_PROBE_COUNT,
            Number(process.env.HEALTHCHECK_QUALITY_MIN_PASSES) || 2
        )
    );

const QUALITY_PROBE_INTERVAL_MS =
    Math.max(
        1000,
        Number(process.env.HEALTHCHECK_QUALITY_PROBE_INTERVAL_MS) || 5000
    );

const HEALTH_CONCURRENCY =
    Math.max(
        1,
        Math.min(
            12,
            Number(process.env.HEALTHCHECK_CONCURRENCY) || 8
        )
    );

const HEALTH_TARGET_URLS = String(
    process.env.HEALTHCHECK_TARGET_URLS ||
    [
        "https://www.gstatic.com/generate_204",
        "https://www.google.com/generate_204",
        "https://cp.cloudflare.com/generate_204"
    ].join(",")
)
    .split(/[,\r\n;]+/)
    .map(value => value.trim())
    .filter(Boolean);

function sleep(ms) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

function safeDecode(value) {
    try {
        return decodeURIComponent(
            String(value ?? "")
        );
    } catch {
        return String(value ?? "");
    }
}

function fingerprintLink(link) {
    return crypto.createHash("sha256").update(String(link)).digest("hex").slice(0, 12);
}

const MANAGED_REGULAR_RE = /^keyline-regular-\d+$/i;
const MANAGED_WHITE_LIST_RE = /^keyline-whitelist-\d+$/i;

function isManagedKeylineId(id) {
    const value = String(id ?? "").trim();
    return MANAGED_REGULAR_RE.test(value) || MANAGED_WHITE_LIST_RE.test(value);
}

function renumberIndex(entries) {
    const regular = [];
    const whiteList = [];
    const other = [];

    for (const item of entries) {
        if (!item || typeof item !== "object") continue;

        if (MANAGED_WHITE_LIST_RE.test(String(item.id || ""))) {
            whiteList.push(item);
            continue;
        }

        if (MANAGED_REGULAR_RE.test(String(item.id || ""))) {
            regular.push(item);
            continue;
        }

        other.push(item);
    }

    // Keep the physical filenames/IDs stable. Only the human-facing
    // country number is compacted after health-check filtering.
    const countryCounters = new Map();

    const normalizedRegular = regular.map(item => {
        const remarks = String(item.remarks || "").trim();
        const match = remarks.match(/^(\S+)\s+(.+?)\s+\d+\s*$/u);

        if (!match) return item;

        const flag = match[1];
        const country = match[2];
        const next = (countryCounters.get(country) || 0) + 1;
        countryCounters.set(country, next);

        return {
            ...item,
            remarks: `${flag} ${country} ${next}`,
        };
    });

    // Keep the original generated ordering. This is important: health-check
    // workers complete in arbitrary order, but the user's subscription must
    // not be re-shuffled just because one probe finished faster than another.
    return [
        ...other,
        ...normalizedRegular,
        ...whiteList,
    ];
}


const HEALTH_STATE_FILE = path.join(ROOT, ".keyline-state.json");

async function updateHealthHistory(results) {
    let state = {};
    try {
        state = JSON.parse(await fs.readFile(HEALTH_STATE_FILE, "utf8"));
    } catch {}

    const history =
        state.healthHistory && typeof state.healthHistory === "object"
            ? state.healthHistory
            : {};
    const now = Date.now();

    for (const result of results) {
        const link = String(result?.item?.link || "").trim();
        if (!link) continue;

        const fingerprint = fingerprintLink(link);
        const previous = history[fingerprint] || {};

        if (result.ok) {
            history[fingerprint] = {
                lastStatus: "pass",
                consecutiveFailures: 0,
                lastCheckedAt: now,
                lastPassedAt: now,
                lastKbps: Number(result?.quality?.kbps) || 0,
                lastBytes: Number(result?.quality?.bytes) || 0,
            };
            continue;
        }

        history[fingerprint] = {
            lastStatus: "fail",
            consecutiveFailures: (Number(previous.consecutiveFailures) || 0) + 1,
            lastCheckedAt: now,
            lastPassedAt: Number(previous.lastPassedAt) || 0,
            lastKbps: Number(result?.quality?.kbps) || 0,
            lastBytes: Number(result?.quality?.bytes) || 0,
            lastReason: String(result.reason || "health check failed").slice(0, 500),
            quarantineUntil: now + 90 * 60 * 1000,
        };
    }

    for (const [fingerprint, entry] of Object.entries(history)) {
        const checkedAt = Number(entry?.lastCheckedAt) || 0;
        if (checkedAt && checkedAt < now - 14 * 24 * 60 * 60 * 1000) {
            delete history[fingerprint];
        }
    }

    state.healthHistory = history;
    await fs.writeFile(
        HEALTH_STATE_FILE,
        `${JSON.stringify(state, null, 2)}\n`,
        "utf8"
    );
}

function getProtocol(link) {
    return String(link)
        .split("://")[0]
        .toLowerCase();
}

function tcpProbe(
    hostname,
    port
) {
    return new Promise(resolve => {
        const socket =
            net.createConnection({
                host:
                    hostname,

                port:
                    Number(port),

                timeout:
                    TCP_TIMEOUT_MS,
            });

        let settled =
            false;

        const finish =
            result => {
                if (settled) return;

                settled =
                    true;

                socket.destroy();
                resolve(result);
            };

        socket.once(
            "connect",
            () =>
                finish(true)
        );

        socket.once(
            "timeout",
            () =>
                finish(false)
        );

        socket.once(
            "error",
            () =>
                finish(false)
        );
    });
}

function buildXrayConfig(link, socksPort) {
    const server = parseLink(link);
    const outbound = buildOutbound(server, "proxy");

    return {
        log: { loglevel: "none" },
        inbounds: [
            {
                listen: "127.0.0.1",
                port: socksPort,
                protocol: "socks",
                settings: { udp: false },
                sniffing: { enabled: false },
                tag: "socks",
            },
        ],
        outbounds: [
            outbound,
            { protocol: "freedom", tag: "direct" },
            { protocol: "blackhole", tag: "block" },
        ],
    };
}

function getFreePort() {
    return new Promise(
        (resolve, reject) => {
            const server =
                net.createServer();

            server.once(
                "error",
                reject
            );

            server.listen(
                0,
                "127.0.0.1",
                () => {
                    const address =
                        server.address();

                    const port =
                        typeof address ===
                        "object" &&
                        address
                            ? address.port
                            : null;

                    server.close(
                        error => {
                            if (error) {
                                reject(error);
                                return;
                            }

                            resolve(
                                port
                            );
                        }
                    );
                }
            );
        }
    );
}

async function waitForPort(
    port
) {
    const started =
        Date.now();

    while (
        Date.now() -
        started <
        XRAY_START_TIMEOUT_MS
    ) {
        const available =
            await tcpProbe(
                "127.0.0.1",
                port
            );

        if (available) {
            return true;
        }

        await sleep(100);
    }

    return false;
}

async function startXray(link) {
    const socksPort = await getFreePort();
    const tempDir = await fs.mkdtemp(
        path.join(
            os.tmpdir(),
            "keyline-xray-"
        )
    );
    const configPath = path.join(
        tempDir,
        "config.json"
    );

    const config = buildXrayConfig(
        link,
        socksPort
    );

    await fs.writeFile(
        configPath,
        JSON.stringify(
            config,
            null,
            2
        ),
        "utf8"
    );

    let child = null;
    let stderr = "";
    let settled = false;

    const cleanup = async () => {
        if (child && !child.killed) {
            child.kill("SIGTERM");

            await new Promise(resolve => {
                const force = setTimeout(
                    () => {
                        try {
                            child.kill("SIGKILL");
                        } catch {}
                        resolve();
                    },
                    1000
                );

                child.once(
                    "exit",
                    () => {
                        clearTimeout(force);
                        resolve();
                    }
                );
            });
        }

        await fs.rm(
            tempDir,
            {
                recursive: true,
                force: true
            }
        );
    };

    try {
        child = spawn(
            XRAY_BIN,
            [
                "run",
                "-c",
                configPath
            ],
            {
                stdio: [
                    "ignore",
                    "ignore",
                    "pipe"
                ]
            }
        );

        child.stderr.on(
            "data",
            chunk => {
                stderr += String(chunk);
                if (stderr.length > 4000) {
                    stderr = stderr.slice(-4000);
                }
            }
        );

        const exitPromise = new Promise(resolve => {
            child.once(
                "error",
                error => {
                    if (settled) return;
                    settled = true;
                    resolve({
                        ok: false,
                        error:
                            error?.message ||
                            "failed to start xray"
                    });
                }
            );

            child.once(
                "exit",
                (code, signal) => {
                    if (settled) return;
                    settled = true;

                    const details =
                        stderr.trim() ||
                        `xray exited with code ${code}` +
                        (signal
                            ? ` (${signal})`
                            : "");

                    resolve({
                        ok: false,
                        error: details.slice(0, 500)
                    });
                }
            );
        });

        const started = await Promise.race([
            waitForPort(socksPort).then(
                available => ({
                    ok: available
                })
            ),
            exitPromise
        ]);

        if (!started?.ok) {
            await cleanup();

            return {
                ok: false,
                error:
                    started?.error ||
                    "xray SOCKS port did not open"
            };
        }

        return {
            ok: true,
            socksPort,
            stop: cleanup
        };
    } catch (error) {
        await cleanup();

        return {
            ok: false,
            error:
                error?.message ||
                "xray startup error"
        };
    }
}

function runCurlOnce(
    socksPort,
    targetUrl
) {
    return new Promise(resolve => {
        const args = [
            "--silent",
            "--show-error",
            "--fail",
            "--connect-timeout",
            "4",
            "--max-time",
            String(
                Math.ceil(
                    REQUEST_TIMEOUT_MS /
                    1000
                )
            ),
            "--proxy",
            `socks5h://127.0.0.1:${socksPort}`,
            targetUrl,
            "--output",
            "/dev/null",
        ];

        const child =
            spawn(
                "curl",
                args,
                {
                    stdio:
                        [
                            "ignore",
                            "ignore",
                            "pipe"
                        ]
                }
            );

        let stderr = "";

        child.stderr.on(
            "data",
            chunk => {
                stderr +=
                    String(chunk);
            }
        );

        const timeout =
            setTimeout(
                () => {
                    child.kill(
                        "SIGKILL"
                    );
                },
                REQUEST_TIMEOUT_MS
            );

        child.once(
            "exit",
            code => {
                clearTimeout(
                    timeout
                );

                resolve({
                    ok:
                        code === 0,

                    error:
                        stderr
                            .trim()
                            .slice(
                                0,
                                240
                            )
                });
            }
        );
    });
}

async function probeTargetOnceWithRetries(
    socksPort,
    targetUrl
) {
    const errors = [];

    for (
        let attempt = 1;
        attempt <= REQUEST_RETRIES;
        attempt += 1
    ) {
        const result =
            await runCurlOnce(
                socksPort,
                targetUrl
            );

        if (result.ok) {
            return {
                ok: true,
                targetUrl,
                error: ""
            };
        }

        errors.push(
            `${targetUrl} attempt ${attempt}: ${result.error || "curl failed"}`
        );

        if (attempt < REQUEST_RETRIES) {
            await sleep(150);
        }
    }

    return {
        ok: false,
        targetUrl,
        error: errors.join("; ").slice(0, 1000)
    };
}

async function runCurl(
    socksPort
) {
    const probes =
        HEALTH_TARGET_URLS.map(
            targetUrl =>
                probeTargetOnceWithRetries(
                    socksPort,
                    targetUrl
                )
        );

    return await Promise.all(
        probes
    );
}

function buildQualityProbeUrl(probeIndex) {
    try {
        const url = new URL(QUALITY_DOWNLOAD_URL);
        url.searchParams.set(
            "hc_probe",
            `${Date.now()}-${process.pid}-${probeIndex}-${Math.random().toString(36).slice(2)}`
        );
        return url.toString();
    } catch {
        return `${QUALITY_DOWNLOAD_URL}${QUALITY_DOWNLOAD_URL.includes("?") ? "&" : "?"}hc_probe=${Date.now()}-${probeIndex}-${Math.random().toString(36).slice(2)}`;
    }
}

async function runSingleQualityDownload(
    socksPort,
    probeIndex
) {
    const startedAt =
        Date.now();

    const probeUrl = buildQualityProbeUrl(probeIndex);

    return await new Promise(resolve => {
        const args = [
            "--silent",
            "--show-error",
            "--fail-with-body",
            "--connect-timeout",
            "4",
            "--max-time",
            String(
                Math.ceil(
                    QUALITY_DOWNLOAD_TIMEOUT_MS / 1000
                )
            ),
            "--proxy",
            `socks5h://127.0.0.1:${socksPort}`,
            "--output",
            "/dev/null",
            "--write-out",
            "%{http_code} %{size_download} %{time_total}",
            probeUrl,
        ];

        const child =
            spawn(
                "curl",
                args,
                {
                    stdio: [
                        "ignore",
                        "pipe",
                        "pipe"
                    ]
                }
            );

        let stdout = "";
        let stderr = "";

        child.stdout.on(
            "data",
            chunk => {
                stdout += String(chunk);
            }
        );

        child.stderr.on(
            "data",
            chunk => {
                stderr += String(chunk);
            }
        );

        const timeout =
            setTimeout(
                () => {
                    child.kill("SIGKILL");
                },
                QUALITY_DOWNLOAD_TIMEOUT_MS
            );

        child.once(
            "exit",
            code => {
                clearTimeout(timeout);

                const [httpCodeRaw, bytesRaw, timeRaw] =
                    stdout.trim().split(/\s+/);

                const httpCode =
                    Number(httpCodeRaw);

                const bytes =
                    Number(bytesRaw);

                const curlSeconds =
                    Number(timeRaw);

                const elapsedSeconds =
                    Number.isFinite(curlSeconds) && curlSeconds > 0
                        ? curlSeconds
                        : Math.max(
                            (Date.now() - startedAt) / 1000,
                            0.001
                        );

                const kbps =
                    Number.isFinite(bytes)
                        ? (bytes / 1024) / elapsedSeconds
                        : 0;

                const ok =
                    code === 0 &&
                    httpCode >= 200 &&
                    httpCode < 400 &&
                    bytes >= QUALITY_MIN_BYTES &&
                    kbps >= QUALITY_MIN_KBPS;

                resolve({
                    probeIndex,
                    ok,
                    url: probeUrl,
                    httpCode,
                    bytes: Number.isFinite(bytes) ? bytes : 0,
                    elapsedMs: Math.round(elapsedSeconds * 1000),
                    kbps: Math.round(kbps * 10) / 10,
                    error: ok
                        ? ""
                        : (
                            stderr.trim() ||
                            `quality threshold failed: ` +
                            `${bytes || 0} bytes, ` +
                            `${Math.round(kbps * 10) / 10} KB/s, ` +
                            `HTTP ${httpCodeRaw || "?"}`
                        ).slice(0, 600)
                });
            }
        );
    });
}

async function runQualityDownload(
    socksPort
) {
    const probes = [];

    for (
        let probeIndex = 1;
        probeIndex <= QUALITY_PROBE_COUNT;
        probeIndex += 1
    ) {
        const result =
            await runSingleQualityDownload(
                socksPort,
                probeIndex
            );

        probes.push(result);

        if (
            probeIndex < QUALITY_PROBE_COUNT
        ) {
            await sleep(
                QUALITY_PROBE_INTERVAL_MS
            );
        }
    }

    const passed =
        probes.filter(
            probe => probe?.ok
        );

    const ok =
        passed.length >= QUALITY_MIN_PASSES;

    const kbpsValues =
        probes
            .map(probe => Number(probe?.kbps))
            .filter(Number.isFinite);

    const passingKbps =
        passed
            .map(probe => Number(probe?.kbps))
            .filter(Number.isFinite);

    const averageBytes =
        probes.length
            ? Math.round(
                probes.reduce(
                    (sum, probe) => sum + (Number(probe?.bytes) || 0),
                    0
                ) / probes.length
            )
            : 0;

    const httpCodes = [
        ...new Set(
            probes
                .map(probe => Number(probe?.httpCode))
                .filter(Number.isFinite)
        ),
    ];

    const probeDetails = probes
        .map(probe =>
            `#${probe.probeIndex}: ` +
            `${Number(probe.bytes) || 0} bytes, ` +
            `${Number(probe.kbps) || 0} KB/s, ` +
            `HTTP ${Number.isFinite(Number(probe.httpCode)) ? probe.httpCode : "?"}`
        )
        .join(" | ");

    return {
        ok,
        url: QUALITY_DOWNLOAD_URL,
        probeCount: probes.length,
        requiredPasses: QUALITY_MIN_PASSES,
        intervalMs: QUALITY_PROBE_INTERVAL_MS,
        passedCount: passed.length,
        failedCount: probes.length - passed.length,
        bytes: averageBytes,
        httpCode: httpCodes.join("/"),
        kbps: passingKbps.length
            ? Math.round(
                (
                    passingKbps.reduce(
                        (sum, value) => sum + value,
                        0
                    ) / passingKbps.length
                ) * 10
            ) / 10
            : (
                kbpsValues.length
                    ? Math.round(
                        (
                            kbpsValues.reduce(
                                (sum, value) => sum + value,
                                0
                            ) / kbpsValues.length
                        ) * 10
                    ) / 10
                    : 0
            ),
        probes,
        error: ok
            ? ""
            : (
                `quality threshold failed: ` +
                `${passed.length}/${probes.length} probes passed; ` +
                `required ${QUALITY_MIN_PASSES}/${QUALITY_PROBE_COUNT}; ` +
                `${probeDetails}`
            ).slice(0, 1000)
    };
}

async function main() {
    await fs.access(
        XRAY_BIN
    );

    const indexText =
        await fs.readFile(
            INDEX_FILE,
            "utf8"
        );

    const index =
        JSON.parse(
            indexText
        );

    if (
        !Array.isArray(index)
    ) {
        throw new Error(
            "index.json must be an array"
        );
    }

    let diagnosticReport = {};
    try {
        diagnosticReport = JSON.parse(
            await fs.readFile(path.join(ROOT, "keyline-report.json"), "utf8")
        );
    } catch {}

    const candidateMap = diagnosticReport.candidateMap || {};

    const nextIndex =
        [];

    let passed =
        0;

    let failed =
        0;

    const managedItems =
        [];

    const healthResults = [];

    for (
        const item of index
    ) {
        if (
            isManagedKeylineId(
                item?.id
            )
        ) {
            managedItems.push(
                item
            );
        } else {
            nextIndex.push(
                item
            );
        }
    }

    const checked =
        managedItems.length;

    let cursor =
        0;

    const checkedLinkMeta = new Map();

    async function checkItem(
        item
    ) {
        const linkFile =
            path.join(
                LINKS_DIR,
                `${item.id}.link`
            );

        let link;

        try {
            link =
                (
                    await fs.readFile(
                        linkFile,
                        "utf8"
                    )
                ).trim();
        } catch {
            return {
                item,
                ok:
                    false,

                reason:
                    "missing link file"
            };
        }

        const linkFingerprint = fingerprintLink(link);
        checkedLinkMeta.set(item.id, {
            linkFingerprint,
            sourceMeta: candidateMap[linkFingerprint] || null,
        });

        let url;

        try {
            url =
                new URL(
                    link
                );
        } catch {
            return {
                item,
                ok:
                    false,

                reason:
                    "invalid URL"
            };
        }

        const protocol =
            getProtocol(
                link
            );

        const stage1 =
            await tcpProbe(
                url.hostname,
                url.port
            );

        if (!stage1) {
            return {
                item,
                ok:
                    false,

                reason:
                    "TCP unreachable"
            };
        }

        let xray = null;

        try {
            xray = await startXray(link);

            if (!xray.ok) {
                return {
                    item,
                    ok: false,
                    reason: `1/3 real stages passed; xray-startup: ${xray.error}`,
                };
            }

            const targets = [...new Set(
                HEALTH_TARGET_URLS
                    .map(value => String(value || "").trim())
                    .filter(Boolean)
            )];

            if (targets.length < 2) {
                throw new Error("Need at least two distinct health-check target URLs");
            }

            const remote = await Promise.all(
                targets.map(target =>
                    probeTargetOnceWithRetries(
                        xray.socksPort,
                        target
                    )
                )
            );

            const failedTargets = remote.filter(
                result => !result?.ok
            );

            if (failedTargets.length > 0) {
                const details = failedTargets
                    .map(result =>
                        `${result.targetUrl}: ${result.error || "proxy request failed"}`
                    )
                    .join(" | ");

                return {
                    item,
                    ok: false,
                    reason:
                        `TCP reachable, Xray SOCKS started, ` +
                        `${targets.length - failedTargets.length}/${targets.length} ` +
                        `HTTPS proxy probes passed; ${details}`,
                };
            }

            const quality =
                await runQualityDownload(
                    xray.socksPort
                );

            if (!quality.ok) {
                return {
                    item,
                    ok: false,
                    reason:
                        `TCP + Xray + ${targets.length}/${targets.length} HTTPS passed, ` +
                        `but real traffic quality failed: ` +
                        `${quality.bytes} bytes, ${quality.kbps} KB/s, ` +
                        `HTTP ${quality.httpCode || "?"}; ` +
                        `${quality.error || "download threshold not met"}`,
                    quality,
                };
            }

            return {
                item,
                ok: true,
                protocol,
                stages:
                    `TCP + Xray + ${targets.length}/${targets.length} HTTPS + ` +
                    `quality ${quality.passedCount}/${quality.probeCount} probes passed ` +
                    `(avg passing ${quality.kbps} KB/s)`,
                quality,
            };

        } catch (error) {
            return {
                item,
                ok: false,
                reason: error?.message || "xray health probe error",
            };
        } finally {
            if (xray?.stop) await xray.stop();
        }
    }

    async function worker() {
        while (true) {
            const item =
                managedItems[
                    cursor++
                ];

            if (!item) {
                return;
            }

            const result =
                await checkItem(
                    item
                );

            const meta = checkedLinkMeta.get(item.id) || {};
            healthResults.push({
                id: item.id,
                remarks: item.remarks || "",
                country: meta.sourceMeta?.country || String(item.remarks || "").replace(/^\S+\s*/, "").replace(/\s+\d+$/, ""),
                source: meta.sourceMeta?.source || "retained/manual",
                linkFingerprint: meta.linkFingerprint || "",
                ok: result.ok,
                protocol: result.protocol || "",
                stages: result.stages || "",
                reason: result.reason || "",
                quality: result.quality || null
            });

            if (result.ok) {
                console.log(
                    `HEALTH PASS ${item.id}: ${result.protocol}`
                );

                passed +=
                    1;

                continue;
            }

            console.log(
                `HEALTH FAIL ${item.id}: ${result.reason}`
            );

            failed +=
                1;

            // Keep the live links directory untouched while checks run.
            // Failed entries are removed only from the atomic staged pool below.
        }
    }

    const workerCount =
        Math.min(
            HEALTH_CONCURRENCY,
            managedItems.length ||
            1
        );

    await Promise.all(
        Array.from(
            {
                length:
                    workerCount
            },
            () =>
                worker()
        )
    );

    const passedManagedIds = new Set(
        healthResults
            .filter(result => result.ok)
            .map(result => result.id)
    );

    for (const item of managedItems) {
        if (passedManagedIds.has(item.id)) {
            nextIndex.push(item);
        }
    }

    await updateHealthHistory(healthResults);

    if (
        checked > 0 &&
        passed === 0
    ) {
        throw new Error(
            "All Keyline servers failed health checks; " +
            "existing generated pool is preserved."
        );
    }

    const normalizedIndex =
        renumberIndex(
            nextIndex
        );

    const stageDir = path.join(
        ROOT,
        `.health-stage-${process.pid}`
    );
    const backupDir = `${LINKS_DIR}.health-backup-${process.pid}`;

    await fs.rm(stageDir, { recursive: true, force: true });
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.cp(LINKS_DIR, stageDir, { recursive: true });

    const allowedManagedIds = new Set(
        normalizedIndex
            .filter(item => isManagedKeylineId(item?.id))
            .map(item => item.id)
    );

    const stagedFiles = await fs.readdir(
        stageDir,
        { withFileTypes: true }
    );

    for (const entry of stagedFiles) {
        if (!entry.isFile() || !entry.name.endsWith(".link")) continue;

        const id = entry.name.slice(0, -5);

        if (
            isManagedKeylineId(id) &&
            !allowedManagedIds.has(id)
        ) {
            await fs.rm(
                path.join(stageDir, entry.name),
                { force: true }
            );
        }
    }

    await fs.writeFile(
        path.join(stageDir, "index.json"),
        `${JSON.stringify(
            normalizedIndex,
            null,
            2
        )}\n`,
        "utf8"
    );

    await fs.rename(LINKS_DIR, backupDir);

    try {
        await fs.rename(stageDir, LINKS_DIR);
    } catch (error) {
        await fs.rename(backupDir, LINKS_DIR);
        throw error;
    }

    await fs.rm(
        backupDir,
        {
            recursive: true,
            force: true
        }
    );

    const reportFile = path.join(ROOT, "keyline-report.json");
    let report = {};
    try {
        report = JSON.parse(await fs.readFile(reportFile, "utf8"));
    } catch {}

    report.healthCheck = {
        generatedAt: new Date().toISOString(),
        checked,
        passed,
        failed,
        concurrency: HEALTH_CONCURRENCY,
        targets: HEALTH_TARGET_URLS,
        qualityProbe: {
            url: QUALITY_DOWNLOAD_URL,
            timeoutMs: QUALITY_DOWNLOAD_TIMEOUT_MS,
            minBytes: QUALITY_MIN_BYTES,
            minKbps: QUALITY_MIN_KBPS,
            probeCount: QUALITY_PROBE_COUNT,
            requiredPasses: QUALITY_MIN_PASSES,
            intervalMs: QUALITY_PROBE_INTERVAL_MS,
        },
        quarantine: {
            durationMinutes: 90,
            policy: "failed endpoints are hidden from the active subscription immediately, but are not permanently blacklisted and may return after a later successful health check",
        },
        results: healthResults,
    };
    report.finalManagedServers = normalizedIndex.filter(item => isManagedKeylineId(item?.id)).length;

    const finalFingerprints = new Set(
        normalizedIndex
            .filter(item => isManagedKeylineId(item?.id))
            .map(item => fingerprintLink(item.link || ""))
            .filter(Boolean)
    );

    const removedByHealth = healthResults.filter(
        item => !item.ok
    );

    report.stageComparison = {
        candidatesBeforeHealthCheck:
            report.totalBeforeHealthCheck ?? 0,
        checked,
        healthPassed:
            passed,
        healthFailed:
            failed,
        finalManagedServers:
            report.finalManagedServers,
        removedByHealthCheck:
            removedByHealth,
        finalLinkFingerprints:
            [...finalFingerprints],
    };

    if (process.env.GITHUB_STEP_SUMMARY) {
        const byReason = new Map();
        const bySource = new Map();
        const byCountry = new Map();
        for (const item of healthResults) {
            if (!item.ok) {
                const key = item.reason || "unknown";
                byReason.set(key, (byReason.get(key) || 0) + 1);
            }
            const sourceKey = item.source || "retained/manual";
            const sourceRow = bySource.get(sourceKey) || { checked: 0, passed: 0, failed: 0 };
            sourceRow.checked += 1;
            sourceRow[item.ok ? "passed" : "failed"] += 1;
            bySource.set(sourceKey, sourceRow);
            const countryKey = item.country || "Unknown";
            const countryRow = byCountry.get(countryKey) || { checked: 0, passed: 0, failed: 0 };
            countryRow.checked += 1;
            countryRow[item.ok ? "passed" : "failed"] += 1;
            byCountry.set(countryKey, countryRow);
        }
        report.healthCheckBySource = Object.fromEntries(
            [...bySource.entries()].map(([key, value]) => [key, value])
        );
        report.healthCheckByCountry = Object.fromEntries(
            [...byCountry.entries()].map(([key, value]) => [key, value])
        );
        const lines = [
            "## Keyline refresh report",
            `- Sources: ${report.sourceCount ?? "?"} / configured ${report.configuredSourceCount ?? "?"}`,
            `- Raw entries: ${report.totalRawEntries ?? "?"}`,
            `- Parsed before dedupe: ${report.freshBeforeDedupe ?? "?"}`,
            `- After dedupe: ${report.afterDedupe ?? "?"}`,
            `- Fresh regular / whitelist: ${report.freshRegular ?? "?"} / ${report.freshWhiteList ?? "?"}`,
            `- Retained from previous pool: ${report.retainedFromPreviousPool ?? "?"}`,
            `- Before health-check: ${report.totalBeforeHealthCheck ?? "?"}`,
            `- Health-check: **${passed} passed / ${failed} failed**`,
            `- Quality probe: ${QUALITY_DOWNLOAD_URL}`,
            `- Quality threshold: >= ${QUALITY_MIN_BYTES} bytes and >= ${QUALITY_MIN_KBPS} KB/s`,
            `- Quality probes: ${QUALITY_PROBE_COUNT} total; ${QUALITY_MIN_PASSES} must pass; ${QUALITY_PROBE_INTERVAL_MS / 1000}s between probes`,
            `- Temporary quarantine: 90 minutes after a failed health check`,
            `- Final managed servers: **${report.finalManagedServers}**`,
        ];
        if (Array.isArray(report.sourceFailures) && report.sourceFailures.length) {
            lines.push("", "### Source fetch failures");
            for (const failure of report.sourceFailures) {
                lines.push(`- **${failure.label}** — ${failure.message}`);
            }
        }
        if (Array.isArray(report.sourceChanges) && report.sourceChanges.length) {
            lines.push("", "### Source URL changes (fingerprints)");
            for (const change of report.sourceChanges) {
                lines.push(`- **${change.label}** — ${change.previous} → ${change.current}`);
            }
        }
        if (byReason.size) {
            lines.push("", "### Health failures");
            for (const [reason, count] of byReason) lines.push(`- ${count} × ${reason}`);
        }
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
    }

    await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(
        `Keyline health check complete: ${passed} passed, ${failed} removed.`
    );
}

main().catch(
    error => {
        console.error(
            `Keyline health check failed: ${error.message}`
        );

        process.exitCode =
            1;
    }
);
