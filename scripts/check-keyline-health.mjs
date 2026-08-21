#!/usr/bin/env node

import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { parseLink, buildOutbound } from "./link-runtime.mjs";

const COUNTRY_BY_FLAG = {
    "🇪🇺": "Europe",
    "🇨🇾": "Cyprus",
    "🇫🇮": "Finland",
    "🇫🇷": "France",
    "🇩🇪": "Germany",
    "🇳🇱": "Netherlands",
    "🇸🇪": "Sweden",
    "🇬🇧": "United Kingdom",
    "🇺🇸": "United States",
    "🇨🇦": "Canada",
    "🇦🇹": "Austria",
    "🇮🇹": "Italy",
    "🇪🇸": "Spain",
    "🇵🇱": "Poland",
    "🇨🇿": "Czech Republic",
    "🇳🇴": "Norway",
    "🇩🇰": "Denmark",
    "🇧🇪": "Belgium",
    "🇨🇭": "Switzerland",
    "🇪🇪": "Estonia",
    "🇱🇹": "Lithuania",
    "🇱🇻": "Latvia",
    "🇷🇴": "Romania",
    "🇧🇬": "Bulgaria",
    "🇹🇷": "Turkey",
    "🇬🇪": "Georgia",
    "🇰🇿": "Kazakhstan",
    "🇷🇺": "Russia",
};

const COUNTRY_ALIASES = {
    "russian federation": "Russia",
    "russia": "Russia",
    "россия": "Russia",
    "российская федерация": "Russia",
};

function normalizeCountryName(value = "") {
    const raw = String(value || "")
        .trim();

    if (!raw) return "";

    const cleaned = raw
        .replace(/\|.*$/u, "")
        .replace(/\bGAMING\b.*$/iu, "")
        .replace(/\s+/gu, " ")
        .trim();

    const aliasKey = cleaned.toLowerCase();

    const aliases = {
        ...COUNTRY_ALIASES,
        "the netherlands": "Netherlands",
        "netherlands": "Netherlands",
        "россия": "Russia",
        "российская федерация": "Russia",
        "russian federation": "Russia",
    };

    return aliases[aliasKey] || cleaned;
}

const WHITE_LIST_GEO_CACHE = new Map();

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

const HEALTH_CANDIDATES_FILE =
    process.env.HEALTH_CANDIDATES_FILE ||
    path.join(ROOT, "config", "keyline-health-candidates.json");

const UPDATE_STATUS_FILE =
    path.join(ROOT, "config", "keyline-update-status.json");

const HEALTH_REPORT_FILE =
    path.join(ROOT, "config", "keyline-health-report.json");

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
        Number(process.env.HEALTHCHECK_QUALITY_MIN_KBPS) || 300
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
        5000,
        Number(process.env.HEALTHCHECK_QUALITY_PROBE_INTERVAL_MS) || 5000
    );

const WHITE_LIST_SPEED_PROBE_COUNT = Math.max(
    1,
    Number(process.env.HEALTHCHECK_WHITE_LIST_SPEED_PROBE_COUNT) || 3
);
const WHITE_LIST_SPEED_MIN_PASSES = Math.max(
    1,
    Math.min(
        WHITE_LIST_SPEED_PROBE_COUNT,
        Number(process.env.HEALTHCHECK_WHITE_LIST_SPEED_MIN_PASSES) || 1
    )
);
const WHITE_LIST_SPEED_MIN_KBPS = Math.max(
    64,
    Number(process.env.HEALTHCHECK_WHITE_LIST_SPEED_MIN_KBPS) || 300
);
const WHITE_LIST_FALLBACK_MIN_KBPS = Math.max(
    64,
    Number(process.env.HEALTHCHECK_WHITE_LIST_FALLBACK_MIN_KBPS) || 200
);
const WHITE_LIST_SPEED_MIN_BYTES = Math.max(
    16384,
    Number(process.env.HEALTHCHECK_WHITE_LIST_SPEED_MIN_BYTES) || 32768
);


const INDEPENDENT_SPEED_PROVIDER_MIN_PASSES =
    Math.max(
        2,
        Math.min(
            3,
            Number(process.env.HEALTHCHECK_SPEED_MIN_PROVIDER_PASSES) || 2
        )
    );

const INDEPENDENT_SPEED_MIN_MEDIAN_KBPS =
    Math.max(
        64,
        Number(process.env.HEALTHCHECK_SPEED_MIN_MEDIAN_KBPS) || 128
    );

const INDEPENDENT_SPEED_TIMEOUT_MS =
    Math.max(
        5000,
        Number(process.env.HEALTHCHECK_SPEED_TIMEOUT_MS) || 18000
    );

const INDEPENDENT_SPEED_PROVIDERS = [
    {
        id: "cloudflare",
        label: "Cloudflare",
        type: "curl",
        url:
            process.env.HEALTHCHECK_CLOUDFLARE_URL ||
            "https://speed.cloudflare.com/__down?bytes=4194304"
    },
    {
        id: "hetzner",
        label: "Hetzner",
        type: "curl",
        url:
            process.env.HEALTHCHECK_HETZNER_URL ||
            "https://fsn1-speed.hetzner.com/10MB.bin"
    },
    {
        id: "mlab",
        label: "M-Lab NDT7",
        type: "ndt7"
    }
];

const MLAB_PROBE_SCRIPT =
    process.env.HEALTHCHECK_MLAB_PROBE_SCRIPT ||
    path.join(
        ROOT,
        "scripts",
        "ndt7-probe.py"
    );

const PYTHON_BIN =
    process.env.HEALTHCHECK_PYTHON ||
    "python3";

const HEALTH_CONCURRENCY =
    Math.max(
        1,
        Math.min(
            8,
            Number(process.env.HEALTHCHECK_CONCURRENCY) || 8
        )
    );

const MAX_VISIBLE_COUNTRIES =
    Math.max(
        1,
        Number(process.env.HEALTHCHECK_MAX_COUNTRIES) || 20
    );

const COUNTRY_POOL_SIZE =
    Math.max(
        2,
        Math.min(
            8,
            Number(process.env.HEALTHCHECK_COUNTRY_POOL_SIZE) || 6
        )
    );

const GAMING_MIN_KBPS =
    Math.max(
        128,
        Number(process.env.HEALTHCHECK_GAMING_MIN_KBPS) || 512
    );

const GAMING_MAX_LATENCY_MS =
    Math.max(
        20,
        Number(process.env.HEALTHCHECK_GAMING_MAX_LATENCY_MS) || 90
    );

const GAMING_MAX_LATENCY_SPREAD_MS =
    Math.max(
        5,
        Number(process.env.HEALTHCHECK_GAMING_MAX_LATENCY_SPREAD_MS) || 25
    );

const GAMING_MIN_QUALITY_PASSES =
    Math.max(
        1,
        Math.min(
            QUALITY_PROBE_COUNT,
            Number(process.env.HEALTHCHECK_GAMING_MIN_QUALITY_PASSES) || QUALITY_PROBE_COUNT
        )
    );

const HEALTH_STATE_FILE =
    path.join(
        ROOT,
        "config",
        ".keyline-state.json"
    );

const GAMING_STATE_FILE =
    path.join(
        ROOT,
        "config",
        "gaming.json"
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

const HEALTH_MIN_TARGET_PASSES = Math.max(
    1,
    Math.min(
        HEALTH_TARGET_URLS.length,
        Number(process.env.HEALTHCHECK_MIN_TARGET_PASSES) || 2
    )
);

function extractWhiteListCountryFromRemarks(remarks = "") {
    const value = String(remarks || "").trim();

    const flagMatch = value.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u)?.[0] || "";
    if (flagMatch && COUNTRY_BY_FLAG[flagMatch]) {
        return COUNTRY_BY_FLAG[flagMatch];
    }

    const patterns = [
        ["Cyprus", /\bCyprus\b/i],
        ["Finland", /\bFinland\b/i],
        ["France", /\bFrance\b/i],
        ["Germany", /\bGermany\b/i],
        ["Netherlands", /\b(?:The\s+)?Netherlands\b/i],
        ["Sweden", /\bSweden\b/i],
        ["United Kingdom", /\bUnited Kingdom\b/i],
        ["United States", /\bUnited States\b/i],
        ["Canada", /\bCanada\b/i],
        ["Austria", /\bAustria\b/i],
        ["Italy", /\bItaly\b/i],
        ["Spain", /\bSpain\b/i],
        ["Poland", /\bPoland\b/i],
        ["Czech Republic", /\bCzech Republic\b/i],
        ["Norway", /\bNorway\b/i],
        ["Denmark", /\bDenmark\b/i],
        ["Belgium", /\bBelgium\b/i],
        ["Switzerland", /\bSwitzerland\b/i],
        ["Estonia", /\bEstonia\b/i],
        ["Lithuania", /\bLithuania\b/i],
        ["Latvia", /\bLatvia\b/i],
        ["Romania", /\bRomania\b/i],
        ["Bulgaria", /\bBulgaria\b/i],
        ["Turkey", /\bTurkey\b/i],
        ["Georgia", /\bGeorgia\b/i],
        ["Kazakhstan", /\bKazakhstan\b/i],
        ["Russia", /\b(?:Russia|Russian\s+Federation)\b/i],
    ];

    for (const [country, pattern] of patterns) {
        if (pattern.test(value)) return country;
    }

    return "";
}

async function resolveWhiteListCountry(link, remarks = "") {
    const fromRemarks = extractWhiteListCountryFromRemarks(remarks);
    if (fromRemarks) return fromRemarks;

    try {
        const url = new URL(String(link || ""));
        const host = url.hostname;
        if (!host) return "";

        if (WHITE_LIST_GEO_CACHE.has(host)) {
            return WHITE_LIST_GEO_CACHE.get(host);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(
                `https://ipwho.is/${encodeURIComponent(host)}?fields=success,country`,
                { signal: controller.signal, headers: { accept: "application/json" } }
            );

            if (!response.ok) return "";
            const data = await response.json();
            const country =
                data?.success && typeof data?.country === "string"
                    ? data.country.trim()
                    : "";

            if (country) WHITE_LIST_GEO_CACHE.set(host, normalizeCountryName(country));
            return normalizeCountryName(country);
        } finally {
            clearTimeout(timeout);
        }
    } catch {
        return "";
    }
}

function countryFlag(country = "") {
    const normalized = normalizeCountryName(country);

    if (!normalized) return "";

    const direct = Object.entries(COUNTRY_BY_FLAG).find(
        ([, value]) =>
            normalizeCountryName(value).toLowerCase() ===
            normalized.toLowerCase()
    );

    return direct?.[0] || "";
}

function setLinkRemark(link, remark) {
    const raw = String(link || "").trim();
    if (!raw) return raw;

    // White List display names belong exclusively to index.json.
    // Strip any upstream fragment from the published .link URI so HAPP
    // cannot mistake an upstream remark for the location name/flag.
    const hashIndex = raw.indexOf("#");
    return hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
}

function sleep(ms) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
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
    return entries.map(
        item => {
            if (!item || typeof item !== "object") {
                return item;
            }

            if (
                MANAGED_REGULAR_RE.test(
                    String(item.id || "")
                )
            ) {
                return {
                    ...item,
                    remarks:
                        String(item.remarks || "")
                            .replace(/\s+\d+\s*$/u, "")
                            .trim()
                };
            }

            return item;
        }
    );
}

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
                gamingEligible: Boolean(result?.gaming?.eligible),
                gamingScore: Number(result?.gaming?.score) || 0,
                lastMedianLatencyMs: Number(result?.gaming?.medianLatencyMs) || 0,
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
            gamingEligible: Boolean(result?.gaming?.eligible),
            gamingScore: Number(result?.gaming?.score) || 0,
            lastMedianLatencyMs: Number(result?.gaming?.medianLatencyMs) || 0,
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
        const startedAt =
            Date.now();

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

                    latencyMs:
                        Math.max(
                            Date.now() -
                            startedAt,
                            0
                        ),

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
    let attempts = 0;

    for (
        let attempt = 1;
        attempt <= REQUEST_RETRIES;
        attempt += 1
    ) {
        attempts += 1;

        const result =
            await runCurlOnce(
                socksPort,
                targetUrl
            );

        if (result.ok) {
            return {
                ok:
                    true,
                targetUrl,
                latencyMs:
                    Number(result.latencyMs) || 0,
                attempts,
                error:
                    ""
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
        ok:
            false,
        targetUrl,
        latencyMs:
            0,
        attempts,
        error:
            errors.join("; ").slice(0, 1000)
    };
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



async function runIndependentCurlSpeedProvider(
    socksPort,
    provider
) {
    const startedAt = Date.now();
    const probeUrl = (() => {
        try {
            const url = new URL(provider.url);
            url.searchParams.set(
                "hc_probe",
                `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
            );
            return url.toString();
        } catch {
            return provider.url;
        }
    })();

    return await new Promise(resolve => {
        const args = [
            "--silent",
            "--show-error",
            "--fail",
            "--connect-timeout",
            "5",
            "--max-time",
            String(
                Math.ceil(
                    INDEPENDENT_SPEED_TIMEOUT_MS / 1000
                )
            ),
            "--proxy",
            `socks5h://127.0.0.1:${socksPort}`,
            "--location",
            probeUrl,
            "--output",
            "/dev/null",
            "--write-out",
            "%{http_code}\\n%{size_download}\\n%{time_total}\\n"
        ];

        const child = spawn(
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

        const timeout = setTimeout(
            () => {
                child.kill("SIGKILL");
            },
            INDEPENDENT_SPEED_TIMEOUT_MS
        );

        child.once(
            "exit",
            code => {
                clearTimeout(timeout);

                const lines = stdout
                    .trim()
                    .split(/\r?\n/)
                    .map(value => value.trim());

                const httpCode =
                    Number(lines[0] || 0) || 0;
                const bytes =
                    Number(lines[1] || 0) || 0;
                const curlSeconds =
                    Number(lines[2] || 0);

                const elapsedSeconds =
                    Number.isFinite(curlSeconds) && curlSeconds > 0
                        ? curlSeconds
                        : Math.max(
                            (Date.now() - startedAt) / 1000,
                            0.001
                        );

                const kbps =
                    bytes > 0
                        ? (bytes / 1024) / elapsedSeconds
                        : 0;

                const partialTransferAllowed =
                    code === 28 &&
                    httpCode >= 200 &&
                    httpCode < 400 &&
                    bytes >= 262144;

                const ok =
                    (code === 0 || partialTransferAllowed) &&
                    httpCode >= 200 &&
                    httpCode < 400 &&
                    bytes > 0 &&
                    kbps >= INDEPENDENT_SPEED_MIN_MEDIAN_KBPS;

                resolve({
                    provider: provider.id,
                    label: provider.label,
                    type: provider.type,
                    ok,
                    url: provider.url,
                    httpCode,
                    bytes,
                    elapsedMs: Math.round(elapsedSeconds * 1000),
                    kbps:
                        Math.round(kbps * 10) / 10,
                    error:
                        ok
                            ? ""
                            : (
                                stderr.trim() ||
                                `provider failed: HTTP ${httpCode || "?"}, ` +
                                `${bytes} bytes, ` +
                                `${Math.round(kbps * 10) / 10} KB/s`
                            ).slice(0, 500)
                });
            }
        );
    });
}

async function runMlabSpeedProvider(
    socksPort
) {
    const startedAt = Date.now();

    return await new Promise(resolve => {
        const args = [
            MLAB_PROBE_SCRIPT,
            "--socks-port",
            String(socksPort),
            "--timeout",
            String(
                Math.ceil(
                    INDEPENDENT_SPEED_TIMEOUT_MS / 1000
                )
            )
        ];

        const child = spawn(
            PYTHON_BIN,
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

        const timeout = setTimeout(
            () => {
                child.kill("SIGKILL");
            },
            INDEPENDENT_SPEED_TIMEOUT_MS + 2000
        );

        child.once(
            "exit",
            code => {
                clearTimeout(timeout);

                let payload = null;
                try {
                    payload = JSON.parse(
                        stdout.trim()
                    );
                } catch {}

                const kbps =
                    Number(
                        payload?.kbps
                    ) || 0;

                const ok =
                    code === 0 &&
                    payload?.ok === true &&
                    kbps >= INDEPENDENT_SPEED_MIN_MEDIAN_KBPS;

                resolve({
                    provider: "mlab",
                    label: "M-Lab NDT7",
                    type: "ndt7",
                    ok,
                    url:
                        payload?.serviceUrl ||
                        "https://locate.measurementlab.net/v2/nearest/ndt/ndt7",
                    httpCode:
                        payload?.websocketCode ||
                        0,
                    bytes:
                        Number(payload?.bytes) || 0,
                    elapsedMs:
                        Number(payload?.elapsedMs) ||
                        Math.max(Date.now() - startedAt, 0),
                    kbps:
                        Math.round(kbps * 10) / 10,
                    error:
                        ok
                            ? ""
                            : String(
                                payload?.error ||
                                stderr.trim() ||
                                "M-Lab NDT7 probe failed"
                            ).slice(0, 500),
                    server:
                        payload?.server || ""
                });
            }
        );
    });
}

async function runIndependentSpeedCheck(
    socksPort
) {
    // Providers are measured sequentially on purpose. Running them in parallel
    // would make all three share the same VPN connection and distort the
    // measured throughput.
    const providers = [];

    for (const provider of INDEPENDENT_SPEED_PROVIDERS) {
        let result;

        if (provider.type === "ndt7") {
            result =
                await runMlabSpeedProvider(
                    socksPort
                );
        } else {
            result =
                await runIndependentCurlSpeedProvider(
                    socksPort,
                    provider
                );
        }

        providers.push(result);

        // One failed measurement should not invalidate the candidate if the
        // other independent measurement systems agree that the route works.
        if (
            providers.filter(item => item.ok).length >=
            INDEPENDENT_SPEED_PROVIDER_MIN_PASSES
        ) {
            // Continue to collect all providers for diagnostics.
            continue;
        }
    }

    const successful =
        providers.filter(
            provider =>
                provider?.ok &&
                Number.isFinite(
                    Number(provider.kbps)
                )
        );

    const speeds =
        successful.map(
            provider =>
                Number(provider.kbps)
        );

    const medianKbps =
        speeds.length
            ? median(speeds)
            : 0;

    const ok =
        successful.length >=
            INDEPENDENT_SPEED_PROVIDER_MIN_PASSES &&
        medianKbps >=
            INDEPENDENT_SPEED_MIN_MEDIAN_KBPS;

    const maxKbps =
        speeds.length
            ? Math.max(...speeds)
            : 0;

    const minKbps =
        speeds.length
            ? Math.min(...speeds)
            : 0;

    return {
        ok,
        providerCount:
            providers.length,
        requiredProviders:
            INDEPENDENT_SPEED_PROVIDER_MIN_PASSES,
        passedCount:
            successful.length,
        failedCount:
            providers.length - successful.length,
        medianKbps:
            Math.round(medianKbps * 10) / 10,
        minKbps:
            Math.round(minKbps * 10) / 10,
        maxKbps:
            Math.round(maxKbps * 10) / 10,
        kbps:
            Math.round(medianKbps * 10) / 10,
        bytes:
            successful.length
                ? Math.round(
                    successful.reduce(
                        (sum, provider) =>
                            sum +
                            (Number(provider.bytes) || 0),
                        0
                    ) /
                    successful.length
                )
                : 0,
        probes:
            providers,
        providers:
            providers.map(
                provider => ({
                    provider:
                        provider.provider,
                    label:
                        provider.label,
                    ok:
                        Boolean(provider.ok),
                    kbps:
                        Number(provider.kbps) || 0,
                    bytes:
                        Number(provider.bytes) || 0,
                    elapsedMs:
                        Number(provider.elapsedMs) || 0,
                    httpCode:
                        Number(provider.httpCode) || 0,
                    server:
                        provider.server || "",
                    error:
                        provider.error || ""
                })
            ),
        error:
            ok
                ? ""
                : (
                    `independent speed check failed: ` +
                    `${successful.length}/${providers.length} providers passed; ` +
                    `median ${Math.round(medianKbps * 10) / 10} KB/s ` +
                    `(minimum ${INDEPENDENT_SPEED_MIN_MEDIAN_KBPS} KB/s)`
                )
    };
}



function median(values) {
    const sorted =
        values
            .filter(Number.isFinite)
            .sort((a, b) => a - b);

    if (!sorted.length) return 0;

    const middle =
        Math.floor(sorted.length / 2);

    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values) {
    const normalized =
        values.filter(Number.isFinite);

    if (normalized.length < 2) return 0;

    const mean =
        normalized.reduce(
            (sum, value) => sum + value,
            0
        ) / normalized.length;

    const variance =
        normalized.reduce(
            (sum, value) =>
                sum + Math.pow(value - mean, 2),
            0
        ) / normalized.length;

    return Math.sqrt(variance);
}


function directTcpLatencyProbe(
    hostname,
    port,
    timeoutMs = TCP_TIMEOUT_MS
) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const socket = net.createConnection({
            host: hostname,
            port: Number(port),
            timeout: timeoutMs,
        });

        let settled = false;

        const finish = result => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(result);
        };

        socket.once("connect", () => {
            finish({
                ok: true,
                latencyMs: Math.max(Date.now() - startedAt, 0),
            });
        });

        socket.once("timeout", () => {
            finish({
                ok: false,
                latencyMs: 0,
                error: "TCP latency probe timeout",
            });
        });

        socket.once("error", error => {
            finish({
                ok: false,
                latencyMs: 0,
                error: error?.message || "TCP latency probe failed",
            });
        });
    });
}

async function measureGamingLatency(link) {
    let server;

    try {
        server = parseLink(link);
    } catch (error) {
        return {
            ok: false,
            samples: [],
            medianLatencyMs: 0,
            maxLatencyMs: Infinity,
            latencySpreadMs: Infinity,
            latencyStdDevMs: Infinity,
            error: error?.message || "unable to parse server link",
        };
    }

    const protocol = String(server?.protocol || "").toLowerCase();

    // Gaming latency must represent the endpoint's actual network reachability.
    // Keep the ordinary health probes unchanged; this is an additional metric
    // used only after a candidate has already passed health + quality.
    if (!server?.address || !server?.port) {
        return {
            ok: false,
            samples: [],
            medianLatencyMs: 0,
            maxLatencyMs: Infinity,
            latencySpreadMs: Infinity,
            latencyStdDevMs: Infinity,
            error: "missing endpoint address/port",
        };
    }

    // Hysteria is UDP/QUIC-oriented, while this probe measures TCP handshake
    // time. Do not incorrectly label a Hysteria endpoint as Gaming-eligible.
    if (protocol === "hysteria2" || protocol === "hysteria") {
        return {
            ok: false,
            samples: [],
            medianLatencyMs: 0,
            maxLatencyMs: Infinity,
            latencySpreadMs: Infinity,
            latencyStdDevMs: Infinity,
            error: "direct TCP latency metric is not valid for Hysteria",
        };
    }

    const samples = [];
    const errors = [];

    for (let index = 0; index < 3; index += 1) {
        const result = await directTcpLatencyProbe(
            server.address,
            server.port,
            TCP_TIMEOUT_MS
        );

        if (!result.ok) {
            errors.push(
                `probe ${index + 1}: ${result.error || "failed"}`
            );
        } else {
            samples.push(Number(result.latencyMs));
        }

        if (index < 2) {
            await sleep(250);
        }
    }

    const finite = samples.filter(Number.isFinite);

    if (finite.length !== 3) {
        return {
            ok: false,
            samples: finite,
            medianLatencyMs: finite.length ? median(finite) : 0,
            maxLatencyMs: finite.length ? Math.max(...finite) : Infinity,
            latencySpreadMs: finite.length
                ? Math.max(...finite) - Math.min(...finite)
                : Infinity,
            latencyStdDevMs: standardDeviation(finite),
            error: errors.join("; ").slice(0, 500) || "not all latency probes passed",
        };
    }

    return {
        ok: true,
        samples: finite,
        medianLatencyMs: median(finite),
        maxLatencyMs: Math.max(...finite),
        latencySpreadMs: Math.max(...finite) - Math.min(...finite),
        latencyStdDevMs: standardDeviation(finite),
        error: "",
    };
}

function getGamingMetrics(
    remote,
    quality,
    gamingLatency
) {
    const latencies =
        Array.isArray(gamingLatency?.samples)
            ? gamingLatency.samples.filter(Number.isFinite)
            : [];

    const medianLatencyMs =
        Number.isFinite(Number(gamingLatency?.medianLatencyMs))
            ? Number(gamingLatency.medianLatencyMs)
            : median(latencies);

    const maxLatencyMs =
        Number.isFinite(Number(gamingLatency?.maxLatencyMs))
            ? Number(gamingLatency.maxLatencyMs)
            : (latencies.length ? Math.max(...latencies) : Infinity);

    const latencySpreadMs =
        Number.isFinite(Number(gamingLatency?.latencySpreadMs))
            ? Number(gamingLatency.latencySpreadMs)
            : (
                latencies.length
                    ? Math.max(...latencies) - Math.min(...latencies)
                    : Infinity
            );

    const latencyStdDevMs =
        Number.isFinite(Number(gamingLatency?.latencyStdDevMs))
            ? Number(gamingLatency.latencyStdDevMs)
            : standardDeviation(latencies);

    const qualityPassed =
        Number(quality?.passedCount) || 0;

    const enoughIndependentSpeedProviders =
        qualityPassed >= GAMING_MIN_QUALITY_PASSES &&
        Number(quality?.kbps) >= GAMING_MIN_KBPS;

    const eligible =
        enoughIndependentSpeedProviders &&
        gamingLatency?.ok === true &&
        latencies.length === 3 &&
        maxLatencyMs <= GAMING_MAX_LATENCY_MS &&
        latencySpreadMs <= GAMING_MAX_LATENCY_SPREAD_MS;

    const speedScore =
        Math.min(
            25,
            (Number(quality?.kbps) / Math.max(GAMING_MIN_KBPS, 1)) * 25
        );

    const latencyScore =
        Math.max(
            0,
            50 * (
                1 -
                Math.min(
                    medianLatencyMs / Math.max(GAMING_MAX_LATENCY_MS, 1),
                    1
                )
            )
        );

    const stabilityScore =
        enoughIndependentSpeedProviders &&
        latencies.length === 3
            ? Math.min(
                25,
                (qualityPassed /
                    Math.max(
                        INDEPENDENT_SPEED_PROVIDERS.length,
                        1
                    )) * 25
            )
            : 0;

    return {
        eligible,
        medianLatencyMs:
            Number.isFinite(medianLatencyMs)
                ? Math.round(medianLatencyMs)
                : 0,
        maxLatencyMs:
            Number.isFinite(maxLatencyMs)
                ? Math.round(maxLatencyMs)
                : 0,
        latencySpreadMs:
            Number.isFinite(latencySpreadMs)
                ? Math.round(latencySpreadMs)
                : 0,
        latencyStdDevMs:
            Number.isFinite(latencyStdDevMs)
                ? Math.round(latencyStdDevMs * 10) / 10
                : 0,
        latencySamples:
            latencies.map(value => Math.round(value)),
        speedScore:
            Math.round(speedScore * 10) / 10,
        latencyScore:
            Math.round(latencyScore * 10) / 10,
        stabilityScore,
        score:
            Math.round(
                (
                    speedScore +
                    latencyScore +
                    stabilityScore
                ) * 10
            ) / 10,
    };
}

async function readGamingAssignments() {
    try {
        const text =
            await fs.readFile(
                GAMING_STATE_FILE,
                "utf8"
            );

        const parsed =
            JSON.parse(text);

        return Array.isArray(parsed)
            ? parsed
            : [];
    } catch {
        return [];
    }
}

async function writeGamingAssignments(
    assignments
) {
    await fs.writeFile(
        GAMING_STATE_FILE,
        `${JSON.stringify(assignments, null, 2)}\n`,
        "utf8"
    );
}

function buildCountryHealthPool(
    healthResults,
    whiteListOnly = false
) {
    const groups = new Map();

    for (const result of healthResults) {
        if (!result.ok) continue;
        if (Boolean(result.whiteList) !== Boolean(whiteListOnly)) continue;
        if (!result.country) continue;

        const bucket = groups.get(result.country) || [];
        bucket.push(result);
        groups.set(result.country, bucket);
    }

    const entries = [...groups.entries()]
        .map(([country, members]) => {
            const sorted = [...members].sort((a, b) => {
                const aSpeed = Number(a.quality?.kbps) || 0;
                const bSpeed = Number(b.quality?.kbps) || 0;
                if (aSpeed !== bSpeed) return bSpeed - aSpeed;

                const aLatency = Number(a.gaming?.medianLatencyMs) || Infinity;
                const bLatency = Number(b.gaming?.medianLatencyMs) || Infinity;
                return aLatency - bLatency;
            });

            const bestSpeed = Number(sorted[0]?.quality?.kbps) || 0;

            if (
                whiteListOnly &&
                bestSpeed < WHITE_LIST_FALLBACK_MIN_KBPS
            ) {
                return null;
            }

            const top = sorted.slice(0, COUNTRY_POOL_SIZE);
            const speeds = top
                .map(item => Number(item.quality?.kbps))
                .filter(Number.isFinite);

            const secondSpeed = speeds[1] || 0;
            const thirdSpeed = speeds[2] || 0;
            const goodCount = speeds.filter(
                speed => speed >= WHITE_LIST_SPEED_MIN_KBPS
            ).length;

            const countryScore = whiteListOnly
                ? (
                    bestSpeed * 0.50 +
                    secondSpeed * 0.25 +
                    thirdSpeed * 0.15 +
                    goodCount * 50
                )
                : (
                    bestSpeed * 0.50 +
                    secondSpeed * 0.25 +
                    thirdSpeed * 0.15 +
                    speeds.length * 10
                );

            return {
                country,
                members: top,
                whiteList: Boolean(whiteListOnly),
                countryScore: Math.round(countryScore * 10) / 10,
                bestSpeed: Math.round(bestSpeed * 10) / 10,
                goodServerCount: goodCount,
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.countryScore - a.countryScore);

    if (!whiteListOnly) {
        return entries.slice(0, MAX_VISIBLE_COUNTRIES);
    }

    // Strong countries (best >= 300 KB/s) always rank ahead of the rare
    // 200-300 KB/s fallback countries. Fallbacks only fill the remaining
    // country slots up to the global 20-country cap.
    const strong = entries.filter(
        country => country.bestSpeed >= WHITE_LIST_SPEED_MIN_KBPS
    );
    const fallback = entries.filter(
        country => country.bestSpeed < WHITE_LIST_SPEED_MIN_KBPS
    );

    return [...strong, ...fallback].slice(0, MAX_VISIBLE_COUNTRIES);
}

function sanitizeId(
    value
) {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function extractFlag(
    remarks = ""
) {
    return String(remarks).match(
        /[\u{1F1E6}-\u{1F1FF}]{2}/u
    )?.[0] || "";
}

async function buildGamingAssignments(
    selectedCountries,
    healthResults,
    candidateItems
) {
    const previous =
        await readGamingAssignments();

    const byFingerprint =
        new Map(
            healthResults.map(
                result => [
                    result.linkFingerprint,
                    result
                ]
            )
        );

    const candidateByFingerprint =
        new Map(
            (Array.isArray(candidateItems) ? candidateItems : [])
                .map(item => [
                    fingerprintLink(item?.link || ""),
                    item
                ])
                .filter(([fingerprint, item]) => fingerprint && item)
        );

    const candidatesByCountry =
        new Map();

    for (const result of healthResults) {
        if (
            !result.ok ||
            !result.gaming?.eligible
        ) {
            continue;
        }

        const bucket =
            candidatesByCountry.get(result.country) || [];

        bucket.push(result);
        candidatesByCountry.set(result.country, bucket);
    }

    const output = [];

    for (const countryEntry of selectedCountries) {
        const candidates =
            candidatesByCountry.get(
                countryEntry.country
            ) || [];

        if (!candidates.length) continue;

        const old =
            previous.find(
                item =>
                    item?.country ===
                    countryEntry.country
            );

        const oldResult =
            old?.linkFingerprint
                ? byFingerprint.get(old.linkFingerprint)
                : null;

        const selected =
            oldResult?.ok &&
            oldResult?.gaming?.eligible
                ? oldResult
                : [...candidates].sort(
                    (a, b) =>
                        Number(b.gaming?.score || 0) -
                        Number(a.gaming?.score || 0)
                )[0];

        const selectedItem =
            candidateByFingerprint.get(
                selected.linkFingerprint
            );

        const selectedLink =
            String(
                selectedItem?.link || ""
            ).trim();

        if (!selectedLink) {
            console.warn(
                `Gaming candidate ${selected.id} has no source link for ${countryEntry.country}; skipping.`
            );
            continue;
        }

        output.push({
            id:
                `gaming-${sanitizeId(countryEntry.country)}`,
            country:
                countryEntry.country,
            flag:
                extractFlag(selected.remarks),
            remarks:
                `${extractFlag(selected.remarks)} ${countryEntry.country} GAMING`.trim(),
            linkFingerprint:
                selected.linkFingerprint,
            link:
                selectedLink,
            quality:
                selected.quality,
            gaming:
                selected.gaming
        });
    }

    return output.filter(
        item => item.link
    );
}

async function main() {
    await fs.access(
        XRAY_BIN
    );

    let index = [];

    const candidateText =
        await fs.readFile(
            HEALTH_CANDIDATES_FILE,
            "utf8"
        );

    const candidates =
        JSON.parse(candidateText);

    if (!Array.isArray(candidates)) {
        throw new Error(
            `${path.basename(HEALTH_CANDIDATES_FILE)} must be an array`
        );
    }

    index = candidates;

    let updateStatus = null;
    try {
        updateStatus = JSON.parse(
            await fs.readFile(UPDATE_STATUS_FILE, "utf8")
        );
    } catch {
        throw new Error(
            "Keyline update status is missing; refusing to health-check a potentially stale candidate manifest."
        );
    }

    if (updateStatus?.refreshed !== true) {
        throw new Error(
            `Keyline refresh was not performed (${updateStatus?.reason || "unknown reason"}); refusing to reuse the previous candidate manifest.`
        );
    }

    const manifestText = await fs.readFile(HEALTH_CANDIDATES_FILE, "utf8");
    const manifestSha256 = crypto.createHash("sha256").update(manifestText).digest("hex");
    if (updateStatus.manifestSha256 !== manifestSha256) {
        throw new Error(
            `Keyline manifest generation mismatch: status=${updateStatus.manifestSha256 || "missing"}, manifest=${manifestSha256}`
        );
    }

    const missingManifestLinks = [];
    for (const candidate of candidates.filter(item => isManagedKeylineId(item?.id))) {
        const linkFile = path.join(LINKS_DIR, `${candidate.id}.link`);
        try {
            await fs.access(linkFile);
        } catch {
            missingManifestLinks.push(candidate.id);
        }
    }
    if (missingManifestLinks.length) {
        throw new Error(
            `Fresh health manifest is out of sync with config/links: ${missingManifestLinks.length} managed .link files are missing. First ids: ${missingManifestLinks.slice(0, 10).join(", ")}`
        );
    }


    const committedIndexText = await fs.readFile(
        INDEX_FILE,
        "utf8"
    );

    const committedIndex = JSON.parse(committedIndexText);

    if (!Array.isArray(committedIndex)) {
        throw new Error("index.json must be an array");
    }

    const managedCandidateIds = new Set(
        index
            .filter(item => isManagedKeylineId(item?.id))
            .map(item => item.id)
    );

    const nextIndexSeed = committedIndex.filter(
        item => !isManagedKeylineId(item?.id)
    );

    let diagnosticReport = {};
    try {
        diagnosticReport = JSON.parse(
            await fs.readFile(path.join(ROOT, "keyline-report.json"), "utf8")
        );
    } catch {}

    const candidateMap = diagnosticReport.candidateMap || {};

    const expectedCandidateCount =
        Number(diagnosticReport.totalBeforeHealthCheck) || 0;

    if (
        expectedCandidateCount > 0 &&
        index.length !== expectedCandidateCount
    ) {
        throw new Error(
            `Health candidate manifest mismatch: ` +
            `manifest=${index.length}, expected=${expectedCandidateCount}. ` +
            `Refusing to fall back to index.json.`
        );
    }

    const nextIndex =
        [...nextIndexSeed];

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

            const isWhiteListCandidate =
                MANAGED_WHITE_LIST_RE.test(String(item.id || "")) ||
                Boolean(checkedLinkMeta.get(item.id)?.sourceMeta?.whiteList);

            if (isWhiteListCandidate) {
                // White List uses an independent health policy:
                // TCP + Xray startup + real speed probes.
                //
                // Do not use Google/gstatic/Cloudflare connectivity gates here:
                // many otherwise usable White List routes intentionally do not
                // pass those synthetic probes.
                //
                // Do not use Telegram as a mandatory gate either: Telegram can
                // be temporarily degraded and must never invalidate the whole
                // White List pool.
                const quality =
                    await runIndependentSpeedCheck(
                        xray.socksPort
                    );

                if (!quality.ok) {
                    return {
                        item,
                        ok: false,
                        reason:
                            `TCP + Xray passed, but White List speed probes failed: ` +
                            `${quality.passedCount}/${quality.probeCount}; ` +
                            `${quality.error || "speed probes failed"}`,
                        quality,
                    };
                }

                return {
                    item,
                    ok: true,
                    protocol,
                    stages:
                        `TCP + Xray + speed ${quality.passedCount}/${quality.probeCount} ` +
                        `(median ${quality.kbps} KB/s)`,
                    quality,
                    gaming: null,
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

            const passedTargets = remote.filter(result => result?.ok);
            const failedTargets = remote.filter(result => !result?.ok);

            const quality =
                await runIndependentSpeedCheck(
                    xray.socksPort
                );

            if (!quality.ok) {
                const details = failedTargets
                    .map(result =>
                        `${result.targetUrl}: ${result.error || "proxy request failed"}`
                    )
                    .join(" | ");

                return {
                    item,
                    ok: false,
                    reason:
                        `TCP + Xray started; independent speed check failed ` +
                        `(${quality.passedCount}/${quality.providerCount} providers, ` +
                        `median ${quality.medianKbps} KB/s). ` +
                        `Synthetic HTTPS diagnostics: ${passedTargets.length}/${targets.length} passed` +
                        `${details ? `; ${details}` : ""}`,
                    quality,
                    remote,
                };
            }

            const gamingLatency = await measureGamingLatency(item.link);
            const gaming = getGamingMetrics(remote, quality, gamingLatency);

            return {
                item,
                ok: true,
                protocol,
                stages:
                    `TCP + Xray + ${targets.length}/${targets.length} HTTPS + ` +
                    `quality ${quality.passedCount}/${quality.probeCount} probes passed ` +
                    `(avg passing ${quality.kbps} KB/s)`,
                quality,
                gaming: {
                    ...gaming,
                    latencyProbeError: gamingLatency.error || "",
                },
                remote,
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
            const isWhiteList = Boolean(
                meta.sourceMeta?.whiteList ||
                MANAGED_WHITE_LIST_RE.test(String(item.id || ""))
            );

            const remarkCountry =
                isWhiteList
                    ? normalizeCountryName(
                        extractWhiteListCountryFromRemarks(
                            String(item.remarks || "")
                        )
                    )
                    : "";

            let resolvedCountry =
                isWhiteList && result.ok
                    ? (
                        remarkCountry ||
                        await resolveWhiteListCountry(
                            String(item.link || ""),
                            String(item.remarks || "")
                        )
                    )
                    : (
                        meta.sourceMeta?.country ||
                        String(item.remarks || "")
                            .replace(/^\S+\s*/, "")
                            .replace(/\s+\d+$/, "")
                    );

            if (isWhiteList) {
                resolvedCountry = normalizeCountryName(resolvedCountry);
            }

            if (isWhiteList && result.ok && !resolvedCountry) {
                resolvedCountry = "Europe";
            }

            healthResults.push({
                id: item.id,
                remarks: item.remarks || "",
                country: resolvedCountry,
                whiteList: isWhiteList,
                source: meta.sourceMeta?.source || "retained/manual",
                linkFingerprint: meta.linkFingerprint || "",
                ok: result.ok,
                protocol: result.protocol || "",
                stages: result.stages || "",
                reason: result.reason || "",
                quality: result.quality || null,
                gaming: result.gaming || null,
                remote: result.remote || [],
                telegram: result.telegram || null
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

    if (
        checked > 0 &&
        passed === 0
    ) {
        throw new Error(
            "All Keyline servers failed health checks; " +
            "existing generated pool is preserved."
        );
    }

    const selectedCountries =
        buildCountryHealthPool(healthResults, false);

    const selectedWhiteListCountries =
        buildCountryHealthPool(healthResults, true);

    const selectedRegularFingerprints =
        new Set(
            selectedCountries.flatMap(
                country => country.members.map(member => member.linkFingerprint)
            )
        );

    const selectedWhiteListFingerprints =
        new Set(
            selectedWhiteListCountries.flatMap(
                country => country.members.map(member => member.linkFingerprint)
            )
        );

    const selectedRegularIds =
        new Set(
            healthResults
                .filter(result =>
                    result.ok &&
                    !result.whiteList &&
                    selectedRegularFingerprints.has(result.linkFingerprint)
                )
                .map(result => result.id)
        );

    const selectedWhiteListIds =
        new Set(
            healthResults
                .filter(result =>
                    result.ok &&
                    result.whiteList &&
                    selectedWhiteListFingerprints.has(result.linkFingerprint)
                )
                .map(result => result.id)
        );

    for (const item of managedItems) {
        const id =
            String(item.id || "");

        if (MANAGED_WHITE_LIST_RE.test(id)) {
            if (selectedWhiteListIds.has(id)) {
                const result = healthResults.find(
                    candidate => candidate.id === id && candidate.ok
                );
                nextIndex.push({
                    ...item,
                    remarks: result?.country
                        ? `${countryFlag(result.country) || "🇪🇺"} 🏳️ LTE ${result.country}`
                        : item.remarks,
                    country: result?.country || item.country || "",
                    whiteList: true,
                });
            }
            continue;
        }

        if (selectedRegularIds.has(id)) {
            nextIndex.push(item);
        }
    }

    const gamingAssignments =
        await buildGamingAssignments(
            selectedCountries,
            healthResults,
            candidates
        );

    await updateHealthHistory(
        healthResults
    );

    await writeGamingAssignments(
        gamingAssignments
    );

    const selectedRegularOrder =
        selectedCountries.flatMap(
            country => country.members.map(member => member.id)
        );

    const selectedWhiteListOrder =
        selectedWhiteListCountries.flatMap(
            country => country.members.map(member => member.id)
        );

    const regularById =
        new Map(
            nextIndex
                .filter(
                    item =>
                        MANAGED_REGULAR_RE.test(
                            String(item.id || "")
                        )
                )
                .map(
                    item => [
                        item.id,
                        item
                    ]
                )
        );

    // Preserve selected White List entries in their own map before the
    // output array is rebuilt. The previous implementation cleared
    // `nextIndex` and then attempted to read the White List items back from
    // that now-empty array, which silently dropped every selected LTE pool.
    const selectedWhiteListById =
        new Map(
            nextIndex
                .filter(
                    item =>
                        MANAGED_WHITE_LIST_RE.test(
                            String(item.id || "")
                        )
                )
                .map(
                    item => [
                        item.id,
                        item
                    ]
                )
        );

    const nonManaged =
        nextIndex.filter(
            item =>
                !isManagedKeylineId(
                    item?.id
                )
        );

    nextIndex.length = 0;
    nextIndex.push(
        ...nonManaged,
        ...selectedRegularOrder
            .map(id => regularById.get(id))
            .filter(Boolean),
        ...selectedWhiteListOrder
            .map(id => selectedWhiteListById.get(id))
            .filter(Boolean)
    );

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

    // HAPP receives the location label from index.json. Keep the individual
    // .link URI purely technical: strip the upstream fragment/remark so it
    // cannot override or confuse the display name stored in index.json.
    for (const item of normalizedIndex) {
        if (
            !item ||
            !item.whiteList ||
            !MANAGED_WHITE_LIST_RE.test(String(item.id || "")) ||
            !String(item.remarks || "").trim()
        ) {
            continue;
        }

        const displayLink = setLinkRemark(item.link, item.remarks);
        if (!displayLink) continue;

        item.link = displayLink;

        const linkPath = path.join(stageDir, `${item.id}.link`);
        try {
            await fs.writeFile(
                linkPath,
                `${displayLink}\\n`,
                "utf8"
            );
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }

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
        if (
            !entry.isFile() ||
            (!entry.name.endsWith(".link") && !entry.name.endsWith(".json"))
        ) continue;

        const id = entry.name.replace(/\.(?:link|json)$/i, "");

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
        minTargetPasses: HEALTH_MIN_TARGET_PASSES,
        independentSpeedCheck: {
            providers: INDEPENDENT_SPEED_PROVIDERS,
            timeoutMs: INDEPENDENT_SPEED_TIMEOUT_MS,
            minimumProviderPasses: INDEPENDENT_SPEED_PROVIDER_MIN_PASSES,
            minimumMedianKbps: INDEPENDENT_SPEED_MIN_MEDIAN_KBPS,
            mlabProbeScript: MLAB_PROBE_SCRIPT,
        },
        gamingCriteria: {
            minKbps:
                GAMING_MIN_KBPS,
            maxLatencyMs:
                GAMING_MAX_LATENCY_MS,
            maxLatencySpreadMs:
                GAMING_MAX_LATENCY_SPREAD_MS,
            minQualityPasses:
                GAMING_MIN_QUALITY_PASSES,
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
        maxVisibleCountries:
            MAX_VISIBLE_COUNTRIES,
        countryPoolSize:
            COUNTRY_POOL_SIZE,
        selectedCountries:
            selectedCountries.map(
                country => ({
                    country: country.country,
                    members: country.members.map(member => ({
                        id: member.id,
                        kbps: Number(member.quality?.kbps) || 0
                    })),
                    score: country.countryScore
                })
            ),
        selectedWhiteListCountries:
            selectedWhiteListCountries.map(
                country => ({
                    country: country.country,
                    members: country.members.map(member => ({
                        id: member.id,
                        kbps: Number(member.quality?.kbps) || 0
                    })),
                    score: country.countryScore
                })
            ),
        gaming:
            gamingAssignments,
    };

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

    if (process.env.GITHUB_STEP_SUMMARY) {
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
            `- HTTPS health targets: ${HEALTH_TARGET_URLS.length} configured; ${HEALTH_MIN_TARGET_PASSES} must pass`,
            `- Independent speed providers: ${INDEPENDENT_SPEED_PROVIDERS.map(provider => provider.label).join(", ")}`,
            `- Independent speed rule: ${INDEPENDENT_SPEED_PROVIDER_MIN_PASSES}/${INDEPENDENT_SPEED_PROVIDERS.length} providers + median >= ${INDEPENDENT_SPEED_MIN_MEDIAN_KBPS} KB/s`,
            `- Synthetic HTTPS targets are diagnostics only; they no longer decide server eligibility`,
            `- Independent speed tests run sequentially per candidate to avoid sharing one VPN route between providers`,
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
    await fs.writeFile(HEALTH_REPORT_FILE, `${JSON.stringify({
        generatedAt: report.healthGeneratedAt,
        generationId: report.generationId,
        manifestSha256: report.manifestSha256,
        candidates: report.totalBeforeHealthCheck ?? report.stageComparison?.candidatesBeforeHealthCheck ?? 0,
        checked,
        passed,
        failed,
        healthCheckBySource: report.healthCheckBySource || {},
        healthCheckByCountry: report.healthCheckByCountry || {},
        failureReasons: Object.fromEntries([...byReason.entries()]),
        finalManagedServers: report.finalManagedServers ?? 0,
        results: healthResults,
    }, null, 2)}\n`, "utf8");

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
