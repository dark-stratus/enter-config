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
    "🇦🇪": "United Arab Emirates",
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
    "🇦🇪": "United Arab Emirates",
};

const COUNTRY_ALIASES = {
    "russian federation": "Russia",
    "russia": "Russia",
    "россия": "Russia",
    "российская федерация": "Russia",
    "united arab emirates": "United Arab Emirates",
    "uae": "United Arab Emirates",
    "оаэ": "United Arab Emirates",
    "объединенные арабские эмираты": "United Arab Emirates",
    "объединённые арабские эмираты": "United Arab Emirates",
};


const SOURCE_REGISTRY = {
    15: "igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt (TOP mobile VLESS)",
    16: "Baarcuda/vpn-configs — top100.txt (Top 100 fastest configs)",
    17: "mehrtat/vless-collector — sub.txt (xray-tested VLESS collector)",
    18: "morpheusadam/v2ray-config — subs/bundles/best.txt (measured best bundle)",
    21: "igareck/vpn-configs-for-russia — Vless-Reality-White-Lists-Rus-Mobile.txt (whitelist)",
    22: "igareck/vpn-configs-for-russia — Vless-Reality-White-Lists-Rus-Mobile-2.txt (whitelist)",
    23: "igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt (whitelist)",
    24: "igareck/vpn-configs-for-russia — WHITE-CIDR-RU-checked.txt (whitelist)",
    25: "igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt (whitelist)",
    26: "zieng2/wl — vless_universal.txt (whitelist)",
};

function formatSourceOrigin(url = "") {
    const raw = String(url || "").trim();
    if (!raw) return "—";

    try {
        const parsed = new URL(raw);
        const host = parsed.hostname.toLowerCase();
        let path = parsed.pathname.replace(/^\/+|\/+$/g, "");

        if (host === "raw.githubusercontent.com") {
            const parts = path.split("/").filter(Boolean);
            if (parts.length >= 4) {
                const owner = parts[0];
                const repo = parts[1];
                const file = parts.slice(3).join("/");
                const filename = file.split("/").pop() || file;
                return `${owner}/${repo} — ${filename}`;
            }
        }

        if (host === "github.com") {
            const parts = path.split("/").filter(Boolean);
            const rawIndex = parts.indexOf("raw");
            if (parts.length >= 4 && rawIndex >= 2) {
                const owner = parts[0];
                const repo = parts[1];
                const file = parts.slice(rawIndex + 2).join("/");
                const filename = file.split("/").pop() || file;
                return `${owner}/${repo} — ${filename}`;
            }
        }
    } catch {
        // Non-URL or unsupported URL formats are intentionally shown as "—".
    }

    return "—";
}

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
        "united arab emirates": "United Arab Emirates",
        "uae": "United Arab Emirates",
        "оаэ": "United Arab Emirates",
        "объединенные арабские эмираты": "United Arab Emirates",
        "объединённые арабские эмираты": "United Arab Emirates",
    };

    return aliases[aliasKey] || cleaned;
}

const WHITE_LIST_GEO_CACHE = new Map();

const ROOT =
    path.resolve(
        process.env.GITHUB_WORKSPACE ||
        process.cwd()
    );

const SERVICE_ENDPOINTS_FILE =
    path.join(ROOT, "config", "service-endpoints.json");

let serviceEndpoints = {};
try {
    serviceEndpoints = JSON.parse(
        await fs.readFile(SERVICE_ENDPOINTS_FILE, "utf8")
    );
} catch (error) {
    throw new Error(
        `Service endpoint configuration is unavailable: ${error?.message || error}`
    );
}

const SERVICE_BASE_URL =
    String(
        process.env.SERVICE_BASE_URL ||
        serviceEndpoints.serviceBaseUrl ||
        ""
    ).trim();

if (!SERVICE_BASE_URL) {
    throw new Error(
        "UPDATE connectivity URL is not configured in config/service-endpoints.json"
    );
}

try {
    new URL(SERVICE_BASE_URL);
} catch {
    throw new Error(
        `Invalid UPDATE connectivity URL: ${SERVICE_BASE_URL}`
    );
}

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
    path.join(ROOT, "config", "source-health-candidates.json");

const HEALTHCHECK_MODE =
    String(process.env.HEALTHCHECK_MODE || "health").trim().toLowerCase();

const RUSSIA_GATE_FILE =
    process.env.RUSSIA_GATE_FILE ||
    path.join(ROOT, "config", "source-russia-gate.json");

const RUSSIA_GATE_DIAGNOSTICS_FILE =
    process.env.RUSSIA_GATE_DIAGNOSTICS_FILE ||
    path.join(ROOT, "russia-gate-diagnostics.json");

const UPDATE_STATUS_FILE =
    path.join(ROOT, "config", "source-update-status.json");

const HEALTH_REPORT_FILE =
    path.join(ROOT, "config", "source-health-report.json");

const UPDATE_VPN_POOL_FILE =
    path.join(ROOT, "config", "source-update-pool.json");

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

const CHECK_HOST_API_BASE =
    process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_API_BASE ||
    "https://check-host.net";
const CHECK_HOST_RUSSIA_NODES = String(
    process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_NODES ||
    "ru1.node.check-host.net,ru2.node.check-host.net,ru3.node.check-host.net"
).split(/[,\r\n;]+/).map(v => v.trim()).filter(Boolean);
let ACTIVE_CHECK_HOST_RUSSIA_NODES = [...CHECK_HOST_RUSSIA_NODES];
const CHECK_HOST_GATE_QUORUM = Math.max(1, Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_QUORUM) || 2);
let ACTIVE_CHECK_HOST_GATE_QUORUM = CHECK_HOST_GATE_QUORUM;
const CHECK_HOST_TIMEOUT_MS = Math.max(5000, Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_TIMEOUT_MS) || 12000);
// Check-Host creation and result retrieval have very different latency profiles.
// A slow /check-result request must never occupy a worker for the full create timeout,
// otherwise a small pool of stuck result calls can collapse the coordinator throughput.
const CHECK_HOST_CREATE_TIMEOUT_MS = Math.max(
    4000,
    Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_CREATE_TIMEOUT_MS) || 8000
);
const CHECK_HOST_RESULT_TIMEOUT_MS = Math.max(
    1500,
    Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_RESULT_TIMEOUT_MS) || 2500
);
const CHECK_HOST_POLL_MS = Math.max(250, Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_POLL_MS) || 700);
const CHECK_HOST_MAX_POLL_MS = Math.max(CHECK_HOST_POLL_MS, Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_MAX_POLL_MS) || 5000);
const CHECK_HOST_GRACE_POLL_MS = Math.max(0, Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_GRACE_POLL_MS) || 1000);
const CHECK_HOST_PREFLIGHT_QUORUM = 2;
// Check-Host is asynchronous: creating a request and fetching its result are
// separate API operations. Both operations share one global adaptive budget because
// the provider rate-limits the runner as a whole. A bounded worker pool prevents
// dozens of request_ids from competing for a tiny result-polling budget.
const CHECK_HOST_API_MIN_INTERVAL_MS = Math.max(
    100,
    Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_API_MIN_INTERVAL_MS) || 200
);
const CHECK_HOST_CREATE_MIN_INTERVAL_MS = Math.max(
    100,
    Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_CREATE_MIN_INTERVAL_MS) || CHECK_HOST_API_MIN_INTERVAL_MS
);
const CHECK_HOST_RESULT_MIN_INTERVAL_MS = Math.max(
    100,
    Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_RESULT_MIN_INTERVAL_MS) || CHECK_HOST_API_MIN_INTERVAL_MS
);


const GLOBALPING_API_BASE =
    process.env.HEALTHCHECK_GLOBALPING_API_BASE ||
    "https://api.globalping.io/v1";
const GLOBALPING_TOKEN = String(
    process.env.HEALTHCHECK_GLOBALPING_API_TOKEN ||
    process.env.GLOBALPING_API_TOKEN ||
    ""
).trim();
const GLOBALPING_TIMEOUT_MS = Math.max(5000, Number(process.env.HEALTHCHECK_GLOBALPING_TIMEOUT_MS) || 10000);
const GLOBALPING_PROBE_LIMIT = 1;
// Globalping is diagnostics only. One probe/measurement consumes one free test.
// Keep this hard-capped at the anonymous free allowance so it can never become
// a hidden dependency of the Russia reachability gate.
const GLOBALPING_MAX_CANDIDATES_PER_CYCLE = Math.min(
    250,
    Math.max(1, Number(process.env.HEALTHCHECK_GLOBALPING_MAX_CANDIDATES_PER_CYCLE) || 250)
);
const RUSSIA_GATE_STATE_MAX_AGE_MS = Math.max(5 * 60 * 1000, Number(process.env.HEALTHCHECK_RUSSIA_GATE_STATE_MAX_AGE_MS) || 6 * 60 * 60 * 1000);
const RUSSIA_GATE_USE_CACHE =
    /^(1|true|yes)$/i.test(
        String(process.env.HEALTHCHECK_RUSSIA_GATE_USE_CACHE || "0").trim()
    );
// Bump whenever the gate semantics change so old cached verdicts cannot be
// reused after changing providers or reachability rules.
const RUSSIA_GATE_ALGORITHM_VERSION = Math.max(1, Number(process.env.HEALTHCHECK_RUSSIA_GATE_ALGORITHM_VERSION) || 33);
// Russia Gate is deliberately single-process. A per-shard limiter would create
// multiple independent API streams and can trigger Check-Host 429 responses.
const RUSSIA_GATE_SHARD_INDEX = 0;
const RUSSIA_GATE_SHARD_COUNT = 1;
const RUSSIA_GATE_SHARD_OUTPUT = "";
const RUSSIA_GATE_SHARD_MODE = false;
const CHECK_HOST_CONCURRENCY = Math.max(2, Math.min(12, Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_CONCURRENCY) || 6));
const CHECK_HOST_MAX_IN_FLIGHT = Math.max(2, Math.min(12, Number(process.env.HEALTHCHECK_RUSSIA_MAX_IN_FLIGHT) || CHECK_HOST_CONCURRENCY));
const GLOBALPING_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.HEALTHCHECK_GLOBALPING_CONCURRENCY) || 4));

// Speed providers are called from many candidate workers. Keep their concurrency
// bounded globally, not per candidate, so 16 health workers cannot fan out into
// dozens of simultaneous upstream measurements and trigger provider throttling.
const SPEED_PROVIDER_GLOBAL_CONCURRENCY = Math.max(2, Math.min(20, Number(process.env.HEALTHCHECK_SPEED_PROVIDER_GLOBAL_CONCURRENCY) || 20));
const MLAB_LOCATE_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.HEALTHCHECK_MLAB_LOCATE_CONCURRENCY) || 3));
const YANDEX_PROBE_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.HEALTHCHECK_YANDEX_PROBE_CONCURRENCY) || 3));

const CONNECTION_TIME_MAX_MEDIAN_MS =
    Math.max(500, Number(process.env.HEALTHCHECK_MAX_MEDIAN_CONNECTION_MS) || 2500);

const CONNECTION_TIME_MAX_SINGLE_MS =
    Math.max(1000, Number(process.env.HEALTHCHECK_MAX_SINGLE_CONNECTION_MS) || 6000);

// White-list nodes are a fallback for users who otherwise have no working
// internet path. Their connection-time gate is intentionally much more
// tolerant than the regular/faster pools. A slow but working white-list
// node is preferable to showing no usable fallback at all.
const WHITE_LIST_CONNECTION_TIME_MAX_MEDIAN_MS =
    Math.max(5000, Number(process.env.HEALTHCHECK_WHITELIST_MAX_MEDIAN_CONNECTION_MS) || 5000);

const WHITE_LIST_CONNECTION_TIME_MAX_SINGLE_MS =
    Math.max(8000, Number(process.env.HEALTHCHECK_WHITELIST_MAX_SINGLE_CONNECTION_MS) || 8000);

// Connectivity-only probes can report success even when real traffic is
// effectively unusable. Run a small real download through every candidate
// after the 3 HTTPS connectivity probes.
const INDEPENDENT_SPEED_PROVIDER_MIN_PASSES =
    Math.max(
        1,
        Math.min(
            3,
            Number(process.env.HEALTHCHECK_SPEED_MIN_PROVIDER_PASSES) || 1
        )
    );

const INDEPENDENT_SPEED_MIN_MEDIAN_KBPS =
    Math.max(
        64,
        Number(process.env.HEALTHCHECK_SPEED_MIN_MEDIAN_KBPS) || 1024
    );

const INDEPENDENT_SPEED_TIMEOUT_MS =
    Math.max(
        5000,
        Number(process.env.HEALTHCHECK_SPEED_TIMEOUT_MS) || 9000
    );

const MLAB_LOCATE_TIMEOUT_MS =
    Math.max(
        3000,
        Number(process.env.HEALTHCHECK_MLAB_LOCATE_TIMEOUT_MS) || 6000
    );

const MLAB_LOCATE_URL =
    process.env.HEALTHCHECK_MLAB_LOCATE_URL ||
    "https://locate.measurementlab.net/v2/nearest/ndt/ndt7";

const YANDEX_PROBES_URL =
    process.env.HEALTHCHECK_YANDEX_PROBES_URL ||
    "https://yandex.ru/internet/api/v0/get-probes";

const YANDEX_PROBE_TIMEOUT_MS =
    Math.max(
        5000,
        Number(process.env.HEALTHCHECK_YANDEX_TIMEOUT_MS) || 7000
    );

const REQUIRED_SPEED_PROVIDER_IDS = new Set(
    String(
        process.env.HEALTHCHECK_REQUIRED_SPEED_PROVIDER_IDS ||
        ""
    )
        .split(/[,\r\n;]+/)
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
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
        type: "curl-fallback",
        urls: [
            process.env.HEALTHCHECK_HETZNER_URL ||
                "https://fsn1-speed.hetzner.com/100MB.bin",
            process.env.HEALTHCHECK_HETZNER_FALLBACK_URL ||
                "https://nbg1-speed.hetzner.com/100MB.bin",
        ]
    },
    {
        id: "mlab",
        label: "M-Lab NDT7",
        type: "ndt7"
    },
    {
        id: "yandex",
        label: "Yandex Internetometer",
        type: "yandex"
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
        Math.min(20, Number(process.env.HEALTHCHECK_CONCURRENCY) || 16)
    );

const MAX_VISIBLE_COUNTRIES =
    Math.max(
        1,
        Number(process.env.HEALTHCHECK_MAX_COUNTRIES) || 20
    );

const COUNTRY_POOL_SIZE =
    Math.max(
        1,
        Math.min(
            3,
            Number(process.env.HEALTHCHECK_COUNTRY_POOL_SIZE) || 3
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

const GAMING_BACKUP_MAX_LATENCY_MS =
    Math.max(
        GAMING_MAX_LATENCY_MS,
        Number(process.env.HEALTHCHECK_GAMING_BACKUP_MAX_LATENCY_MS) || 180
    );

const GAMING_BACKUP_MAX_LATENCY_SPREAD_MS =
    Math.max(
        GAMING_MAX_LATENCY_SPREAD_MS,
        Number(process.env.HEALTHCHECK_GAMING_BACKUP_MAX_LATENCY_SPREAD_MS) || 50
    );

const GAMING_BASE_SPEED_PROVIDER_COUNT = 3;

const GAMING_BACKUP_MIN_QUALITY_PASSES =
    Math.max(
        1,
        Math.min(
            GAMING_BASE_SPEED_PROVIDER_COUNT,
            Number(process.env.HEALTHCHECK_GAMING_BACKUP_MIN_QUALITY_PASSES) || 1
        )
    );

const SPEED_PROVIDER_CONCURRENCY =
    Math.max(
        1,
        Math.min(
            INDEPENDENT_SPEED_PROVIDERS.length,
            Number(process.env.HEALTHCHECK_SPEED_PROVIDER_CONCURRENCY) || 4
        )
    );

const FAST_TOP_N = Math.max(1, Number(process.env.HEALTHCHECK_FAST_TOP_N) || 3);
const FEATURED_COUNTRY_ORDER = [
    "Netherlands",
    "Germany",
    "Sweden",
    "Finland",
    "Estonia",
    "Poland",
];
const FEATURED_COUNTRIES = new Set(FEATURED_COUNTRY_ORDER.map(country => country.toLowerCase()));

function calculateFeaturedTargetCounts(ordinaryCountryCount) {
    const count = Math.max(0, Number(ordinaryCountryCount) || 0);
    if (count < 3) {
        return {
            total: Math.min(1, count),
            fast: Math.min(1, count),
            gaming: 0,
        };
    }

    // Featured locations must never outnumber the remaining ordinary locations.
    // The 40% target matches the requested 10 -> 4 and 15 -> 6 examples while
    // preserving at least half of the country locations as ordinary choices.
    const total = Math.min(
        Math.floor(count * 0.4),
        Math.floor(count / 2)
    );

    return {
        total,
        fast: Math.ceil(total / 2),
        gaming: Math.floor(total / 2),
    };
}
const FAST_SERVERS_PER_COUNTRY = Math.max(
    1,
    Math.min(3, Number(process.env.HEALTHCHECK_FAST_SERVERS_PER_COUNTRY) || 3)
);
const GAMING_TOP_N = Math.max(1, Number(process.env.HEALTHCHECK_GAMING_TOP_N) || 3);
const GAMING_SERVERS_PER_COUNTRY = Math.max(
    1,
    Math.min(2, Number(process.env.HEALTHCHECK_GAMING_SERVERS_PER_COUNTRY) || 2)
);

const GAMING_MIN_QUALITY_PASSES =
    Math.max(
        1,
        Math.min(
            GAMING_BASE_SPEED_PROVIDER_COUNT,
            Number(process.env.HEALTHCHECK_GAMING_MIN_QUALITY_PASSES) || 1
        )
    );

const HEALTH_STATE_FILE =
    path.join(
        ROOT,
        "config",
        ".source-state.json"
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

const WHITE_LIST_HEALTH_TARGET_URLS = String(
    process.env.HEALTHCHECK_WHITE_LIST_TARGET_URLS ||
    [
        "https://ya.ru/",
        "https://yandex.ru/"
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
        ["United Arab Emirates", /\b(?:United\s+Arab\s+Emirates|UAE)\b/i],
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

function stripLinkRemark(link) {
    const raw = String(link || "").trim();
    if (!raw) return raw;

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

const MANAGED_REGULAR_RE = /^source-regular-\d+$/i;
const MANAGED_WHITE_LIST_RE = /^source-whitelist-\d+$/i;

function isManagedSourceId(id) {
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


function createLimiter(limit) {
    let active = 0;
    const queue = [];
    const pump = () => {
        while (active < limit && queue.length) {
            const next = queue.shift();
            active += 1;
            Promise.resolve().then(next.fn).then(next.resolve, next.reject).finally(() => {
                active -= 1;
                pump();
            });
        }
    };
    return fn => new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        pump();
    });
}

const checkHostHttpLimiter = createLimiter(CHECK_HOST_CONCURRENCY);
const globalpingLimiter = createLimiter(GLOBALPING_CONCURRENCY);
const speedProviderLimiter = createLimiter(SPEED_PROVIDER_GLOBAL_CONCURRENCY);
const mlabLocateLimiter = createLimiter(MLAB_LOCATE_CONCURRENCY);
const yandexProbeLimiter = createLimiter(YANDEX_PROBE_CONCURRENCY);

function isLteCandidate(item, sourceMeta = null) {
    return Boolean(sourceMeta?.whiteList || item?.whiteList === true || MANAGED_WHITE_LIST_RE.test(String(item?.id || "")));
}

function getTransportType(protocol = "") {
    return ["hysteria", "hysteria2", "tuic"].includes(String(protocol).trim().toLowerCase()) ? "udp" : "tcp";
}

async function requestJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: { accept: "application/json", ...(options.headers || {}) }
        });
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            const error = new Error(`non-JSON response (${response.status})`);
            error.status = response.status;
            const retryAfter = Number(response.headers.get("retry-after"));
            if (Number.isFinite(retryAfter) && retryAfter >= 0) {
                error.retryAfterMs = retryAfter * 1000;
            }
            throw error;
        }
        if (!response.ok) {
            const error = new Error(String(data?.error?.message || data?.message || text || `HTTP ${response.status}`));
            error.status = response.status;
            const retryAfter = Number(response.headers.get("retry-after"));
            if (Number.isFinite(retryAfter) && retryAfter >= 0) {
                error.retryAfterMs = retryAfter * 1000;
            }
            throw error;
        }
        return data;
    } finally {
        clearTimeout(timer);
    }
}

async function requestJsonWithRetries(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, retries = REQUEST_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await requestJson(url, options, timeoutMs);
        } catch (error) {
            lastError = error;
            const status = Number(error?.status || 0);
            const retryable =
                status === 429 ||
                status === 408 ||
                status >= 500 ||
                /aborted|timeout/i.test(String(error?.message || ""));
            if (!retryable || attempt >= retries) throw error;

            const serverDelay = Number(error?.retryAfterMs);
                const exponential = status === 429
                ? 5000 * (2 ** attempt)
                : 750 * (attempt + 1);
            const jitter = Math.floor(Math.random() * 250);
            const delay = Number.isFinite(serverDelay)
                ? Math.max(serverDelay, exponential)
                : exponential;

            await sleep(Math.min(8000, delay + jitter));
        }
    }
    throw lastError || new Error("request failed");
}

const CHECK_HOST_TOTAL_MIN_INTERVAL_MS = Math.max(
    250,
    Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_TOTAL_MIN_INTERVAL_MS) ||
        Math.max(CHECK_HOST_API_MIN_INTERVAL_MS, CHECK_HOST_CREATE_MIN_INTERVAL_MS, CHECK_HOST_RESULT_MIN_INTERVAL_MS)
);

const checkHostRateState = {
    nextAt: 0,
    intervalMs: CHECK_HOST_TOTAL_MIN_INTERVAL_MS,
    minIntervalMs: CHECK_HOST_TOTAL_MIN_INTERVAL_MS,
    maxIntervalMs: 1800,
    cooldownUntil: 0,
};

const checkHostRateTelemetry = {
    calls: 0,
    rateLimited429: 0,
    serverErrors5xx: 0,
    requestTimeouts: 0,
    otherErrors: 0,
    maxIntervalMs: CHECK_HOST_TOTAL_MIN_INTERVAL_MS,
    events: [],
};

const CHECK_HOST_RATE_EVENT_LIMIT = 250;

let checkHostRateQueueTail = Promise.resolve();

async function scheduleCheckHostApiRequest(fn, kind = "result") {
    // Check-Host exposes one API budget to the runner. The previous scheduler
    // reserved future slots before requests actually started. That meant that
    // after a 429 increased interval/cooldown, already-reserved old slots kept
    // firing at the old rate and created a burst of additional 429s.
    //
    // Serialize admission to the global queue instead: a caller receives its
    // slot only after the previous call has finished, and the current interval
    // is therefore always the interval that was actually in force.
    let releaseQueueTurn;
    const queueTurn = new Promise(resolve => {
        releaseQueueTurn = resolve;
    });
    const previous = checkHostRateQueueTail;
    checkHostRateQueueTail = previous.then(() => queueTurn, () => queueTurn);
    await previous.catch(() => {});

    const state = checkHostRateState;
    const queuedAt = Date.now();
    let startedAt = 0;

    try {
        const waitUntil = Math.max(Date.now(), state.nextAt, state.cooldownUntil);
        if (waitUntil > Date.now()) {
            await sleep(waitUntil - Date.now());
        }

        const cooldownWait = state.cooldownUntil - Date.now();
        if (cooldownWait > 0) await sleep(cooldownWait);

        // Only now reserve the next slot, immediately before starting the API
        // call. This prevents stale pre-reserved slots after adaptive backoff.
        startedAt = Date.now();
        state.nextAt = startedAt + state.intervalMs;

        try {
            checkHostRateTelemetry.calls += 1;
            const result = await checkHostHttpLimiter(fn);

            state.intervalMs = Math.max(
                state.minIntervalMs,
                Math.round(state.intervalMs * 0.96)
            );
            return result;
        } catch (error) {
            const status = Number(error?.status || 0);
            const message = String(error?.message || "");
            if (status === 429) checkHostRateTelemetry.rateLimited429 += 1;
            else if (status >= 500) checkHostRateTelemetry.serverErrors5xx += 1;
            else if (/aborted|timeout|timed out/i.test(message)) checkHostRateTelemetry.requestTimeouts += 1;
            else checkHostRateTelemetry.otherErrors += 1;

            const beforeIntervalMs = state.intervalMs;
            let retryAfterMs = null;
            if (status === 429 || status >= 500) {
                const parsedRetryAfter = Number(error?.retryAfterMs);
                retryAfterMs = Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : null;
                const multiplier = status === 429 ? 2.0 : 1.5;

                state.intervalMs = Math.min(
                    state.maxIntervalMs,
                    Math.max(
                        state.minIntervalMs,
                        Math.round(state.intervalMs * multiplier)
                    )
                );
                checkHostRateTelemetry.maxIntervalMs = Math.max(
                    checkHostRateTelemetry.maxIntervalMs,
                    state.intervalMs
                );

                const baseCooldownMs = status === 429 ? 3000 : 1200;
                const cooldownMs = Number.isFinite(retryAfterMs)
                    ? Math.max(baseCooldownMs, retryAfterMs)
                    : baseCooldownMs;

                state.cooldownUntil = Date.now() + Math.min(12000, cooldownMs);
                state.nextAt = Math.max(state.nextAt, state.cooldownUntil);
            }

            if (checkHostRateTelemetry.events.length < CHECK_HOST_RATE_EVENT_LIMIT) {
                checkHostRateTelemetry.events.push({
                    kind,
                    status,
                    beforeIntervalMs,
                    afterIntervalMs: state.intervalMs,
                    retryAfterMs,
                    cooldownMs: state.cooldownUntil > Date.now()
                        ? state.cooldownUntil - Date.now()
                        : 0,
                    queueWaitMs: startedAt && queuedAt ? Math.max(0, startedAt - queuedAt) : 0,
                    timestamp: new Date().toISOString(),
                });
            }

            throw error;
        }
    } finally {
        releaseQueueTurn();
    }
}


function parseCheckHostNode(raw, node, transport = "tcp") {
    if (raw == null) {
        return { node, reachable: false, inconclusive: true, latencyMs: 0, error: "still performing" };
    }

    const first = Array.isArray(raw) ? raw[0] : raw;
    if (first && typeof first === "object") {
        if (Number.isFinite(Number(first.time))) {
            return {
                node,
                reachable: true,
                inconclusive: false,
                latencyMs: Number(first.time) * 1000,
                error: ""
            };
        }

        const error = String(first.error || first.message || "").trim();
        if (transport === "udp" && /open or filtered|filtered|timeout|timed? out/i.test(error)) {
            return {
                node,
                reachable: false,
                inconclusive: true,
                latencyMs: 0,
                error: error || "open or filtered"
            };
        }

        return {
            node,
            reachable: false,
            inconclusive: false,
            latencyMs: 0,
            error: error || "unreachable"
        };
    }

    return {
        node,
        reachable: false,
        inconclusive: transport === "udp",
        latencyMs: 0,
        error: String(first || "unreachable")
    };
}

async function resolveRussianCheckHostNodes() {
    const configured = CHECK_HOST_RUSSIA_NODES
        .map(value => String(value).trim())
        .filter(Boolean);

    if (!configured.length) {
        throw new Error(
            "No Russian Check-Host nodes configured; set HEALTHCHECK_RUSSIA_CHECK_HOST_NODES"
        );
    }

    // Never call /nodes/hosts during the hourly gate. That discovery endpoint
    // has its own rate limit and became the source of HTTP 429 failures when
    // several gate shards started together.
    return configured;
}

async function checkHostProviderPreflight() {
    const configured = CHECK_HOST_RUSSIA_NODES
        .map(value => String(value).trim())
        .filter(Boolean);
    let lastProbe = null;
    const nodeProbes = [];

    // Probe every configured Russian checker independently. This is deliberately
    // separate from the candidate gate: it lets us distinguish 2 live checkers,
    // 1 live checker, and a total checker outage before choosing the gate mode.
    for (const node of configured) {
        try {
            const request = await createCheckHostRequest(
                new URL("https://check-host.net:443"),
                "https",
                [node]
            );
            const probe = await pollCheckHostRequest(request, {
                maxPollMs: Math.min(5000, CHECK_HOST_MAX_POLL_MS),
                gracePollMs: Math.min(1000, CHECK_HOST_GRACE_POLL_MS),
                requiredReachable: 1,
            });
            const nodeResult = Array.isArray(probe?.results)
                ? probe.results.find(row => row?.node === node)
                : null;
            const reachable = nodeResult?.reachable === true;
            nodeProbes.push({
                node,
                reachable,
                inconclusive: Boolean(nodeResult?.inconclusive),
                timeout: /timeout|timed out|aborted/i.test(String(nodeResult?.error || probe?.error || "")),
                rateLimited: Boolean(probe?.rateLimited),
                error: nodeResult?.error || probe?.error || "",
                latencyMs: Number(nodeResult?.latencyMs) || 0,
            });
            lastProbe = probe;
        } catch (error) {
            nodeProbes.push({
                node,
                reachable: false,
                inconclusive: false,
                timeout: /timeout|timed out|aborted/i.test(String(error?.message || "")),
                rateLimited: Number(error?.status || 0) === 429,
                error: error?.message || String(error),
                latencyMs: 0,
            });
        }
    }

    const liveNodes = nodeProbes.filter(row => row.reachable).map(row => row.node);
    const preferredPairs = [
        ["ru2.node.check-host.net", "ru3.node.check-host.net"],
        ["ru1.node.check-host.net", "ru3.node.check-host.net"],
        ["ru1.node.check-host.net", "ru2.node.check-host.net"],
    ];
    const selectedPair = preferredPairs.find(pair => pair.every(node => liveNodes.includes(node))) || null;

    if (selectedPair) {
        return {
            nodeProbes,
            liveNodes,
            selectedLiveNodes: selectedPair,
            nodesTested: configured.length,
            nodesReachable: liveNodes.length,
            quorumRequired: 2,
            quorumMet: true,
            checkerMode: "dual",
        };
    }

    if (liveNodes.length === 1) {
        return {
            nodeProbes,
            liveNodes,
            selectedLiveNodes: liveNodes,
            nodesTested: configured.length,
            nodesReachable: 1,
            quorumRequired: 1,
            quorumMet: true,
            checkerMode: "single",
            warning: "Only one Russian Check-Host node is available; Russia Gate is running in single-checker warning mode.",
        };
    }

    return {
        nodeProbes,
        liveNodes: [],
        selectedLiveNodes: [],
        nodesTested: configured.length,
        nodesReachable: 0,
        quorumRequired: 0,
        quorumMet: false,
        checkerMode: "skipped",
        warning: "No Russian Check-Host nodes are available; Russia Gate is skipped and candidates proceed directly to Heavy.",
        lastProbe,
    };
}

async function createCheckHostRequest(url, protocol, nodes) {
    const transport = getTransportType(protocol);
    const checkType = transport === "udp" ? "udp" : "tcp";
    const params = new URLSearchParams({
        host: `${url.hostname}:${Number(url.port || 443)}`,
        max_nodes: String(nodes.length)
    });
    for (const node of nodes) params.append("node", node);

    const createUrl = `${CHECK_HOST_API_BASE}/check-${checkType}?${params}`;
    for (let createAttempt = 0; createAttempt < 4; createAttempt += 1) {
        try {
            const created = await scheduleCheckHostApiRequest(
                () => requestJson(
                    createUrl,
                    { headers: { "user-agent": "enter-config-russia-health/1.0" } },
                    CHECK_HOST_CREATE_TIMEOUT_MS
                ),
                "create"
            );
            const requestId = String(created?.request_id || "").trim();
            if (!requestId) throw new Error("missing Check-Host request_id");
            return { requestId, transport, checkType, nodes: [...nodes], createdAt: Date.now() };
        } catch (error) {
            const status = Number(error?.status || 0);
            // Creation is not idempotent: a timeout/5xx may have created the
            // request even if the response never reached us. Never replay such
            // a request. HTTP 429 is the only safe create retry because the
            // provider rejected the request before issuing a request_id.
            if (status !== 429 || createAttempt >= 3) throw error;

            const serverDelay = Number(error?.retryAfterMs);
            const backoff = 2000 * Math.min(4, createAttempt + 1);
            const delay = Number.isFinite(serverDelay) ? Math.max(serverDelay, backoff) : backoff;
            await sleep(Math.min(20000, delay));
        }
    }
    throw new Error("Check-Host create failed");
}

function evaluateCheckHostPayload(payload, transport, nodes, requiredReachable = ACTIVE_CHECK_HOST_GATE_QUORUM) {
    const parsed = nodes.map(node => parseCheckHostNode(payload?.[node] ?? null, node, transport));
    const reachable = parsed.filter(x => x.reachable);
    const unresolved = parsed.filter(x => x.inconclusive);

    if (reachable.length >= requiredReachable) {
        return {
            done: true,
            result: {
                provider: "check-host",
                ok: true,
                unavailable: false,
                inconclusive: false,
                transport,
                nodesTested: parsed.length,
                nodesReachable: reachable.length,
                nodesInconclusive: unresolved.length,
                quorumRequired: requiredReachable,
                quorumMet: true,
                minLatencyMs: Math.min(...reachable.map(x => x.latencyMs)),
                results: parsed
            }
        };
    }

    if (reachable.length + unresolved.length < requiredReachable) {
        return {
            done: true,
            result: {
                provider: "check-host",
                ok: false,
                unavailable: false,
                inconclusive: false,
                transport,
                nodesTested: parsed.length,
                nodesReachable: reachable.length,
                nodesInconclusive: unresolved.length,
                quorumRequired: requiredReachable,
                quorumMet: false,
                minLatencyMs: reachable.length ? Math.min(...reachable.map(x => x.latencyMs)) : 0,
                results: parsed
            }
        };
    }

    return { done: false, parsed };
}

async function pollCheckHostRequest(request, options = {}) {
    const pollLimitMs = Math.max(
        CHECK_HOST_POLL_MS,
        Number(options.maxPollMs) || CHECK_HOST_MAX_POLL_MS
    );
    const gracePollMs = Math.max(
        0,
        Number(options.gracePollMs) || CHECK_HOST_GRACE_POLL_MS
    );
    const requiredReachable = Math.max(1, Number(options.requiredReachable) || ACTIVE_CHECK_HOST_GATE_QUORUM);
    const totalPollLimitMs = pollLimitMs + gracePollMs;
    const started = Date.now();
    let pollDelayMs = Math.max(900, Math.min(2500, CHECK_HOST_POLL_MS));
    let firstPoll = true;
    let transientErrors = 0;
    let lastError = null;

    while (Date.now() - started <= totalPollLimitMs) {
        await sleep(firstPoll ? 500 : pollDelayMs);
        firstPoll = false;

        try {
            const payload = await scheduleCheckHostApiRequest(
                () => requestJson(
                    `${CHECK_HOST_API_BASE}/check-result/${encodeURIComponent(request.requestId)}`,
                    { headers: { "user-agent": "enter-config-russia-health/1.0" } },
                    CHECK_HOST_RESULT_TIMEOUT_MS
                ),
                "result"
            );
            transientErrors = 0;
            const evaluation = evaluateCheckHostPayload(payload, request.transport, request.nodes, requiredReachable);
            if (evaluation.done) return evaluation.result;
            pollDelayMs = Math.min(5000, Math.max(900, Math.round(pollDelayMs * 1.18)));
        } catch (error) {
            lastError = error;
            const status = Number(error?.status || 0);
            const retryable =
                status === 429 || status === 408 || status >= 500 ||
                /aborted|timeout|timed out|fetch failed/i.test(String(error?.message || ""));
            if (!retryable) throw error;

            transientErrors += 1;
            const serverDelay = Number(error?.retryAfterMs);
            const backoff = status === 429
                ? 1500 * Math.min(6, transientErrors)
                : 1000 * Math.min(6, transientErrors);
            const delay = Number.isFinite(serverDelay) ? Math.max(serverDelay, backoff) : backoff;
            await sleep(Math.min(12000, delay));
            pollDelayMs = Math.min(5000, Math.max(900, Math.round(pollDelayMs * 1.35)));
        }
    }

    console.warn(
        `RUSSIA CHECK-HOST POLL TIMEOUT: requestId=${request.requestId}; ` +
        `primary=${Math.round(pollLimitMs / 1000)}s; ` +
        `grace=${Math.round(gracePollMs / 1000)}s; ` +
        `no duplicate request will be created`
    );

    return {
        provider: "check-host",
        ok: false,
        unavailable: true,
        inconclusive: request.transport === "udp",
        transport: request.transport,
        checkType: request.checkType,
        requestId: request.requestId,
        rateLimited: Number(lastError?.status || 0) === 429,
        error: lastError?.message
            ? `Check-Host polling timeout after transient errors: ${lastError.message}`
            : "Check-Host polling timeout"
    };
}

async function checkHostRussia(url, protocol, nodes = ACTIVE_CHECK_HOST_RUSSIA_NODES, options = {}) {
    try {
        if (nodes.length !== 3) {
            throw new Error(`Russia gate requires exactly 3 configured Check-Host nodes; got ${nodes.length}`);
        }
        const request = await createCheckHostRequest(url, protocol, nodes);
        return await pollCheckHostRequest(request, options);
    } catch (error) {
        return {
            provider: "check-host",
            ok: false,
            unavailable: true,
            inconclusive: false,
            transport: getTransportType(protocol),
            checkType: getTransportType(protocol) === "udp" ? "udp" : "tcp",
            rateLimited: Number(error?.status || 0) === 429,
            error: error?.message || String(error)
        };
    }
}

async function checkHostRussiaQuorum(url, protocol, nodes = ACTIVE_CHECK_HOST_RUSSIA_NODES) {
    const allNodes = [...new Set(nodes.map(value => String(value).trim()).filter(Boolean))];
    if (allNodes.length !== 3 || CHECK_HOST_PREFLIGHT_QUORUM !== 2) {
        throw new Error(
            `Russia gate requires exactly 3 configured Check-Host nodes and quorum 2/3; ` +
            `got nodes=${allNodes.length}, quorum=${CHECK_HOST_PREFLIGHT_QUORUM}`
        );
    }

    // Preflight sanity check only: require 2 of the 3 configured Russian nodes.
    // The publication gate itself uses the historical positive-reachability rule
    // below: any one definitive reachable result is sufficient to PASS.
    try {
        const request = await createCheckHostRequest(url, protocol, allNodes);
        return await pollCheckHostRequest(request, {
            maxPollMs: CHECK_HOST_MAX_POLL_MS,
            gracePollMs: CHECK_HOST_GRACE_POLL_MS,
        });
    } catch (error) {
        return {
            provider: "check-host",
            ok: false,
            unavailable: true,
            inconclusive: true,
            transport: getTransportType(protocol),
            checkType: getTransportType(protocol) === "udp" ? "udp" : "tcp",
            nodesTested: allNodes.length,
            nodesReachable: 0,
            nodesInconclusive: allNodes.length,
            quorumRequired: CHECK_HOST_PREFLIGHT_QUORUM,
            quorumMet: false,
            rateLimited: Number(error?.status || 0) === 429,
            error: error?.message || String(error),
        };
    }
}


async function runRussiaGateEndpointCoordinator(endpointGroups, { maxInFlight = CHECK_HOST_MAX_IN_FLIGHT } = {}) {
    const startedAt = Date.now();
    const outcomes = new Map();
    const createFailures = [];
    const diagnosticPendingRequests = [];
    let completed = 0;

    // Keep the provider-side asynchronous workset bounded. Creating hundreds of
    // Check-Host jobs up front makes the provider queue the checks itself; result
    // polling then observes many long-lived null responses. A bounded active
    // window preserves the same positive-reachability decision rule while preventing that
    // provider-side backlog.
    const activeWindow = Math.max(
        maxInFlight,
        Math.min(64, Number(process.env.HEALTHCHECK_RUSSIA_ACTIVE_WINDOW) || 64)
    );
    const coordinatorPollRounds = Math.max(
        2,
        Math.min(8, Number(process.env.HEALTHCHECK_RUSSIA_COORDINATOR_POLL_ROUNDS) || 8)
    );
    const coordinatorInitialDelayMs = Math.max(
        250,
        Math.min(5000, Number(process.env.HEALTHCHECK_RUSSIA_COORDINATOR_INITIAL_DELAY_MS) || 1000)
    );
    const coordinatorRoundDelayMs = Math.max(
        250,
        Math.min(5000, Number(process.env.HEALTHCHECK_RUSSIA_COORDINATOR_ROUND_DELAY_MS) || 700)
    );

    async function runBoundedPool(items, workerLimit, fn) {
        let cursor = 0;
        const workerCount = Math.max(1, Math.min(workerLimit, items.length || 1));
        const workers = Array.from({ length: workerCount }, async () => {
            while (true) {
                const index = cursor++;
                if (index >= items.length) return;
                await fn(items[index]);
            }
        });
        await Promise.all(workers);
    }

    const makeTimeoutProbe = (group, errorMessage) => ({
        required: true,
        skipped: false,
        gatePassed: false,
        gatePending: true,
        reason: errorMessage,
        providersUnavailable: true,
        transport: getTransportType(getProtocol(group.representative.link || "")),
        checkHost: {
            provider: "check-host",
            ok: false,
            unavailable: true,
            inconclusive: false,
            rateLimited: false,
            error: errorMessage
        },
        checkedAt: Date.now()
    });

    for (let batchStart = 0; batchStart < endpointGroups.length; batchStart += activeWindow) {
        const batch = endpointGroups.slice(batchStart, batchStart + activeWindow);
        const createdRequests = [];

        // Phase A: create only a bounded number of provider-side jobs.
        await runBoundedPool(batch, maxInFlight, async group => {
            let url;
            try {
                url = new URL(String(group.representative.link || "").trim());
            } catch {
                outcomes.set(group.key, {
                    required: true,
                    skipped: false,
                    gatePassed: false,
                    gatePending: false,
                    reason: "invalid URL",
                    checkedAt: Date.now()
                });
                completed += 1;
                return;
            }

            try {
                const request = await createCheckHostRequest(
                    url,
                    group.representative.protocol || getProtocol(group.representative.link || ""),
                    ACTIVE_CHECK_HOST_RUSSIA_NODES
                );
                createdRequests.push({ group, url, request });
            } catch (error) {
                const message = `Check-Host create failed: ${error?.message || String(error)}`;
                outcomes.set(group.key, makeTimeoutProbe(group, message));
                createFailures.push(group.key);
                completed += 1;
            }
        });

        let pending = [...createdRequests];
        if (pending.length) await sleep(coordinatorInitialDelayMs);

        // Phase B: drain this provider-side window before creating the next one.
        // No endpoint is polled in a worker-local loop; pending jobs simply move
        // to the next centralized result round.
        for (let round = 0; round < coordinatorPollRounds && pending.length; round += 1) {
            const current = pending;
            const nextPending = [];

            await runBoundedPool(current, maxInFlight, async entry => {
                try {
                    const payload = await scheduleCheckHostApiRequest(
                        () => requestJson(
                            `${CHECK_HOST_API_BASE}/check-result/${encodeURIComponent(entry.request.requestId)}`,
                            { headers: { "user-agent": "enter-config-russia-health/1.0" } },
                            CHECK_HOST_RESULT_TIMEOUT_MS
                        ),
                        "result"
                    );

                    const evaluation = evaluateCheckHostPayload(
                        payload,
                        entry.request.transport,
                        entry.request.nodes
                    );

                    if (evaluation.done) {
                        const probe = await checkRussiaReachabilityFromProbe(
                            entry.group.representative,
                            entry.url,
                            entry.group.representative.protocol || getProtocol(entry.group.representative.link || ""),
                            evaluation.result
                        );
                        outcomes.set(entry.group.key, probe);
                        completed += 1;
                    } else {
                        nextPending.push(entry);
                    }
                } catch (error) {
                    const status = Number(error?.status || 0);
                    const transient =
                        status === 429 || status === 408 || status >= 500 ||
                        /aborted|timeout|timed out|fetch failed/i.test(String(error?.message || ""));

                    if (transient && round + 1 < coordinatorPollRounds) {
                        nextPending.push(entry);
                    } else {
                        const message = `Check-Host result failed: ${error?.message || String(error)}`;
                        const probe = makeTimeoutProbe(entry.group, message);
                        probe.checkHost.rateLimited = status === 429;
                        outcomes.set(entry.group.key, probe);
                        completed += 1;
                    }
                }
            });

            pending = nextPending;

            const elapsed = Math.max(1, Date.now() - startedAt);
            const rate = completed / (elapsed / 1000);
            const remaining = Math.max(0, endpointGroups.length - completed);
            const eta = rate > 0 ? Math.round(remaining / rate) : 0;
            console.log(
                `RUSSIA COORDINATOR POLL BATCH ${Math.floor(batchStart / activeWindow) + 1}: ` +
                `round ${round + 1}/${coordinatorPollRounds}; ` +
                `batch=${batchStart + 1}-${Math.min(batchStart + activeWindow, endpointGroups.length)}; ` +
                `resolved=${completed}/${endpointGroups.length}; pendingInBatch=${pending.length}; ` +
                `rate=${rate.toFixed(2)}/s; eta=${eta}s`
            );

            if (pending.length && round + 1 < coordinatorPollRounds) {
                await sleep(coordinatorRoundDelayMs);
            }
        }

        for (const entry of pending) {
            diagnosticPendingRequests.push({
                endpointKey: entry.group.key,
                requestId: entry.request.requestId,
                transport: entry.request.transport,
                checkType: entry.request.checkType,
                batchStart: batchStart + 1,
                batchEnd: Math.min(batchStart + activeWindow, endpointGroups.length),
            });
            outcomes.set(
                entry.group.key,
                makeTimeoutProbe(
                    entry.group,
                    `Check-Host polling unresolved after ${coordinatorPollRounds} bounded rounds in active window`
                )
            );
            completed += 1;
        }
    }

    const elapsed = Date.now() - startedAt;
    console.log(
        `RUSSIA GATE COORDINATOR COMPLETE: endpoints=${endpointGroups.length}/${endpointGroups.length}; ` +
        `activeWindow=${activeWindow}; inFlightMax=${maxInFlight}; elapsed=${Math.round(elapsed / 1000)}s; ` +
        `rate=${(endpointGroups.length / Math.max(1, elapsed / 1000)).toFixed(2)}/s; ` +
        `apiCalls=${checkHostRateTelemetry.calls}; 429=${checkHostRateTelemetry.rateLimited429}; ` +
        `5xx=${checkHostRateTelemetry.serverErrors5xx}; timeouts=${checkHostRateTelemetry.requestTimeouts}; ` +
        `otherErrors=${checkHostRateTelemetry.otherErrors}; maxAdaptiveInterval=${checkHostRateTelemetry.maxIntervalMs}ms`
    );

    return {
        outcomes,
        elapsedMs: elapsed,
        fatalProviderError: null,
        createdRequests: endpointGroups.length - createFailures.length,
        createFailures: createFailures.length,
        unresolved: [...outcomes.values()].filter(value => value?.gatePending).length,
        rateTelemetry: {
            calls: checkHostRateTelemetry.calls,
            rateLimited429: checkHostRateTelemetry.rateLimited429,
            serverErrors5xx: checkHostRateTelemetry.serverErrors5xx,
            requestTimeouts: checkHostRateTelemetry.requestTimeouts,
            otherErrors: checkHostRateTelemetry.otherErrors,
            maxIntervalMs: checkHostRateTelemetry.maxIntervalMs,
            events: checkHostRateTelemetry.events,
        },
        pendingRequests: diagnosticPendingRequests,
    };
}

async function checkRussiaReachabilityFromProbe(item, url, protocol, checkHost) {
    return {
        required: true,
        skipped: false,
        gatePassed: Boolean(checkHost.ok),
        gatePending: !checkHost.ok && Boolean(checkHost.unavailable || checkHost.inconclusive),
        anyReachable: Boolean(checkHost.ok),
        providersUnavailable: Boolean(checkHost.unavailable),
        transport: getTransportType(protocol),
        checkHost,
        globalping: {
            provider: "globalping",
            ok: false,
            unavailable: false,
            inconclusive: false,
            skipped: true,
            error: "diagnostic-only; not part of Russia gate"
        },
        minLatencyMs: Number(checkHost.minLatencyMs) > 0 ? Number(checkHost.minLatencyMs) : 0,
        checkedAt: Date.now()
    };
}

async function globalpingRussia(url, protocol) {
    const transport = getTransportType(protocol);
    const tcp = transport === "tcp";
    if (!tcp) {
        return { provider: "globalping", ok: false, unavailable: false, inconclusive: true, skipped: true, transport, protocol: "UDP", error: "Globalping free TCP probe is not a UDP service test" };
    }
    return globalpingLimiter(async () => {
        try {
            const headers = { "content-type": "application/json", "user-agent": "enter-config-russia-health/1.0" };
            if (GLOBALPING_TOKEN) headers.authorization = `Bearer ${GLOBALPING_TOKEN}`;
            const created = await requestJsonWithRetries(`${GLOBALPING_API_BASE}/measurements`, { method: "POST", headers, body: JSON.stringify({
                type: "ping", target: url.hostname, locations: [{ country: "RU", limit: GLOBALPING_PROBE_LIMIT }],
                measurementOptions: { packets: 2, protocol: tcp ? "TCP" : "ICMP", ...(tcp ? { port: Number(url.port || 443) } : {}) }
            }) }, GLOBALPING_TIMEOUT_MS);
            const measurementId = String(created?.id || "").trim();
            if (!measurementId) throw new Error("missing Globalping measurement id");
            const started = Date.now();
            while (Date.now() - started <= GLOBALPING_TIMEOUT_MS) {
                await sleep(700);
                const data = await requestJsonWithRetries(`${GLOBALPING_API_BASE}/measurements/${encodeURIComponent(measurementId)}`, { headers: { "user-agent": "enter-config-russia-health/1.0", ...(GLOBALPING_TOKEN ? { authorization: `Bearer ${GLOBALPING_TOKEN}` } : {}) } }, GLOBALPING_TIMEOUT_MS);
                if (String(data?.status || "").toLowerCase() === "in-progress") continue;
                const rows = Array.isArray(data?.results) ? data.results : [];
                const successful = rows.filter(row => {
                    const status = String(row?.result?.status || "").toLowerCase();
                    const stats = row?.result?.stats || {};
                    const avg = Number(stats.avg);
                    const loss = Number(stats.loss);
                    return status === "finished" && Number.isFinite(avg) && loss === 0;
                });
                const latencyValues = successful.map(r => Number(r?.result?.stats?.avg)).filter(Number.isFinite);
                return { provider: "globalping", ok: successful.length > 0, unavailable: false, inconclusive: false, transport, protocol: tcp ? "TCP" : "ICMP", probesTested: rows.length, probesReachable: successful.length, minLatencyMs: latencyValues.length ? Math.min(...latencyValues) : 0, results: rows.map(row => ({ status: row?.result?.status || "", probeCountry: row?.probe?.country || "", probeCity: row?.probe?.city || "", probeNetwork: row?.probe?.network || "", avgMs: Number(row?.result?.stats?.avg), loss: Number(row?.result?.stats?.loss) })) };
            }
            throw new Error("Globalping measurement timeout");
        } catch (error) {
            return { provider: "globalping", ok: false, unavailable: true, inconclusive: false, rateLimited: Number(error?.status || 0) === 429, transport, protocol: tcp ? "TCP" : "ICMP", error: error?.message || String(error) };
        }
    });
}

function russiaGateEndpointKey(item) {
    try {
        const url = new URL(String(item?.link || "").trim());
        const transport = getTransportType(getProtocol(item?.link || ""));
        return `${transport}|${url.hostname.toLowerCase()}|${Number(url.port || (transport === "udp" ? 443 : 443))}`;
    } catch {
        return `invalid|${fingerprintLink(String(item?.link || ""))}`;
    }
}

async function checkRussiaReachability(item, url, protocol, sourceMeta, options = {}) {
    if (isLteCandidate(item, sourceMeta)) {
        return {
            required: false,
            skipped: true,
            gatePassed: true,
            gatePending: false,
            reason: "LTE/white-list diagnostic only"
        };
    }

    // Check-Host is the sole source of truth for the Russia gate.
    // Globalping is intentionally NOT consulted here: its free quota,
    // rate limiting, probe availability, or outage must never change whether
    // a candidate is accepted or rejected by the publication gate.
    const checkHost = await checkHostRussia(url, protocol, ACTIVE_CHECK_HOST_RUSSIA_NODES, options);

    return {
        required: true,
        skipped: false,
        gatePassed: Boolean(checkHost.ok),
        // A Check-Host outage / unresolved result is UNKNOWN, not PASS.
        // The gate will stop publication rather than admit an unverified server.
        gatePending: !checkHost.ok && Boolean(checkHost.unavailable || checkHost.inconclusive),
        anyReachable: Boolean(checkHost.ok),
        providersUnavailable: Boolean(checkHost.unavailable),
        transport: getTransportType(protocol),
        checkHost,
        globalping: {
            provider: "globalping",
            ok: false,
            unavailable: false,
            inconclusive: false,
            skipped: true,
            error: "diagnostic-only; not part of Russia gate"
        },
        minLatencyMs: Number(checkHost.minLatencyMs) > 0 ? Number(checkHost.minLatencyMs) : 0,
        checkedAt: Date.now()
    };
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
    const WINDOW = 10;

    for (const result of results) {
        const link = String(result?.link || result?.item?.link || "").trim();
        if (!link) continue;

        const fingerprint = fingerprintLink(link);
        const previous = history[fingerprint] || {};
        const recentStatuses = Array.isArray(previous.recentStatuses)
            ? previous.recentStatuses.slice(-WINDOW + 1)
            : [];
        recentStatuses.push(result.ok ? "pass" : "fail");

        const recentPasses = recentStatuses.filter(status => status === "pass").length;
        const successRate = recentStatuses.length
            ? recentPasses / recentStatuses.length
            : 0;
        const recentFailures = recentStatuses.length - recentPasses;
        const consecutiveHealthyCycles = result.ok
            ? (Number(previous.consecutiveHealthyCycles) || 0) + 1
            : 0;
        const consecutiveFailures = result.ok
            ? 0
            : (Number(previous.consecutiveFailures) || 0) + 1;
        const stabilityScore =
            successRate * 0.60 +
            Math.min(consecutiveHealthyCycles / 3, 1) * 0.25 +
            (1 - (recentFailures / Math.max(recentStatuses.length, 1))) * 0.15;

        history[fingerprint] = {
            lastStatus: result.ok ? "pass" : "fail",
            consecutiveFailures,
            consecutiveHealthyCycles,
            successRate: Number(successRate.toFixed(4)),
            recentFailures,
            recentStatuses,
            stabilityScore: Number(stabilityScore.toFixed(4)),
            lastCheckedAt: now,
            lastPassedAt: result.ok ? now : (Number(previous.lastPassedAt) || 0),
            lastKbps: result.ok
                ? Number(result?.quality?.kbps) || 0
                : Number(previous.lastKbps) || Number(result?.quality?.kbps) || 0,
            lastBytes: result.ok
                ? Number(result?.quality?.bytes) || 0
                : Number(previous.lastBytes) || Number(result?.quality?.bytes) || 0,
            gamingEligible: Boolean(result?.gaming?.eligible),
            gamingScore: Number(result?.gaming?.score) || 0,
            lastMedianLatencyMs: result.ok
                ? Number(result?.connection?.medianMs || result?.gaming?.medianLatencyMs) || 0
                : Number(previous.lastMedianLatencyMs) || 0,
            lastServiceLatencyMs: result.ok
                ? Number(result?.updateConnectivity?.latencyMs) || 0
                : Number(previous.lastServiceLatencyMs) || 0,
            lastReason: result.ok
                ? ""
                : String(result.reason || "health check failed").slice(0, 500),
            quarantineUntil: result.ok ? 0 : now + 90 * 60 * 1000,
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

    return history;
}

function canonicalEndpointKey(link) {
    try {
        const url = new URL(String(link || "").trim());
        const protocol = String(url.protocol || "").toLowerCase();
        const host = String(url.hostname || "").toLowerCase();
        const port = String(url.port || "").trim();
        return `${protocol}|${host}|${port}`;
    } catch {
        return String(link || "").trim().toLowerCase();
    }
}

function selectUpdateVpnPool(healthResults, history, limit = 10) {
    const eligible = healthResults.filter(result => {
        if (!result?.whiteList || !result?.linkFingerprint || !result?.link) {
            return false;
        }

        // UPDATE VPN has a stricter gate than an ordinary whitelist health pass:
        // the node must reach the configured service endpoint through its own Xray path.
        if (!result?.ok || result?.updateConnectivity?.ok !== true) {
            return false;
        }

        return true;
    });

    // Prefer the best-scoring variant for each physical endpoint. Different
    // fingerprints/SNI values on the same host:port are not useful as separate
    // UPDATE slots because they fail together when that underlying endpoint dies.
    const bestByEndpoint = new Map();

    const scoreFor = result => {
        const h = history[result.linkFingerprint] || {};
        const hasHistory = Boolean(
            Number(h.lastCheckedAt) ||
            Array.isArray(h.recentStatuses) && h.recentStatuses.length
        );

        // A first observation should be neutral rather than treated as a zero
        // quality server. The current pass still counts as one healthy cycle.
        const stability = hasHistory
            ? Number(h.stabilityScore) || 0
            : 0.75;
        const consecutive = hasHistory
            ? (Number(h.consecutiveHealthyCycles) || (result.ok ? 1 : 0))
            : 1;
        const successRate = hasHistory
            ? (Number(h.successRate) || (result.ok ? 1 : 0))
            : (result.ok ? 1 : 0);
        const recentFailures = hasHistory
            ? (Number(h.recentFailures) || 0)
            : 0;

        const serviceLatency =
            Number(result?.updateConnectivity?.latencyMs) ||
            Number(h.lastServiceLatencyMs) ||
            Infinity;
        const speed =
            Number(result?.quality?.medianKbps ?? result?.quality?.kbps) ||
            Number(h.lastKbps) ||
            0;

        // UPDATE VPN is primarily about reliably reaching the service endpoint.
        // Service latency + historical stability dominate; speed is meaningful,
        // but deliberately remains secondary to connectivity and reliability.
        const stabilityPart = Math.max(0, Math.min(stability, 1)) * 0.30;
        const healthyPart = Math.min(consecutive / 3, 1) * 0.15;
        const successPart = Math.max(0, Math.min(successRate, 1)) * 0.10;
        const failurePart = Math.max(0, 1 - Math.min(recentFailures / 3, 1)) * 0.05;
        const serviceLatencyPart = Number.isFinite(serviceLatency)
            ? Math.max(0, 1 - Math.min(serviceLatency / 2500, 1)) * 0.30
            : 0;
        const speedPart = Math.min(
            Math.log1p(Math.max(speed, 0)) / Math.log1p(50000),
            1
        ) * 0.10;

        return stabilityPart +
            healthyPart +
            successPart +
            failurePart +
            serviceLatencyPart +
            speedPart;
    };

    for (const result of eligible) {
        const endpointKey = canonicalEndpointKey(result.link);
        const candidate = {
            result,
            score: scoreFor(result),
            endpointKey,
        };
        const existing = bestByEndpoint.get(endpointKey);
        if (!existing || candidate.score > existing.score) {
            bestByEndpoint.set(endpointKey, candidate);
        }
    }

    const selected = [...bestByEndpoint.values()]
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;

            const aLatency = Number(a.result?.updateConnectivity?.latencyMs) || Infinity;
            const bLatency = Number(b.result?.updateConnectivity?.latencyMs) || Infinity;
            if (aLatency !== bLatency) return aLatency - bLatency;

            const speed = resultSpeed(b.result) - resultSpeed(a.result);
            if (speed !== 0) return speed;

            return String(a.result.id).localeCompare(String(b.result.id));
        })
        .slice(0, limit);

    return selected.map(({ result, score, endpointKey }) => ({
        id: result.id,
        remarks: `${extractFlag(result.remarks) || countryFlag(result.country) || "🇪🇺"} 🏳️ LTE ${result.country || "Europe"}`.trim(),
        country: result.country || "Europe",
        whiteList: true,
        link: String(result.link || "").trim(),
        ...(result.configFile ? { configFile: result.configFile, sourceKind: result.sourceKind || "json" } : {}),
        score: Number(score.toFixed(6)),
        stabilityScore: Number((Number(history[result.linkFingerprint]?.stabilityScore) || (result.ok ? 0.75 : 0)).toFixed(4)),
        consecutiveHealthyCycles: Number(history[result.linkFingerprint]?.consecutiveHealthyCycles) || 1,
        successRate: Number(history[result.linkFingerprint]?.successRate) || 1,
        recentFailures: Number(history[result.linkFingerprint]?.recentFailures) || 0,
        serviceLatencyMs: Number(result?.updateConnectivity?.latencyMs) || Number(history[result.linkFingerprint]?.lastServiceLatencyMs) || 0,
        speedKbps: Number(resultSpeed(result)) || Number(history[result.linkFingerprint]?.lastKbps) || 0,
        currentHealth: Boolean(result.ok),
    }));
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
            "source-xray-"
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
        const startedAt = Date.now();
        const args = [
            "--silent",
            "--show-error",
            "--fail",
            "--connect-timeout",
            "4",
            "--max-time",
            String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
            "--proxy",
            `socks5h://127.0.0.1:${socksPort}`,
            targetUrl,
            "--output",
            "/dev/null",
            "--write-out",
            "\n%{time_total}\n%{time_starttransfer}\n",
        ];

        const child = spawn("curl", args, {
            stdio: ["ignore", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", chunk => {
            stdout += String(chunk);
        });

        child.stderr.on("data", chunk => {
            stderr += String(chunk);
        });

        const timeout = setTimeout(() => {
            child.kill("SIGKILL");
        }, REQUEST_TIMEOUT_MS);

        child.once("exit", code => {
            clearTimeout(timeout);

            const lines = stdout
                .trim()
                .split(/\r?\n/)
                .map(value => value.trim())
                .filter(Boolean);

            const totalSeconds = Number(lines.at(-2)) || 0;
            const firstByteSeconds = Number(lines.at(-1)) || 0;

            resolve({
                ok: code === 0,
                latencyMs: totalSeconds > 0
                    ? Math.round(totalSeconds * 1000)
                    : Math.max(Date.now() - startedAt, 0),
                firstByteMs: firstByteSeconds > 0
                    ? Math.round(firstByteSeconds * 1000)
                    : 0,
                error: stderr.trim().slice(0, 240)
            });
        });
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
                firstByteMs:
                    Number(result.firstByteMs) || 0,
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


async function runIndependentCurlSpeedProvider(
    socksPort,
    provider
) {
    const urls = Array.isArray(provider.urls)
        ? provider.urls
        : [provider.url];

    const attempts = [];

    for (const targetUrl of urls) {
        const startedAt = Date.now();

        const result = await new Promise(resolve => {
            const args = [
                "--silent",
                "--show-error",
                "--connect-timeout",
                "5",
                "--max-time",
                String(Math.ceil(INDEPENDENT_SPEED_TIMEOUT_MS / 1000)),
                "--proxy",
                `socks5h://127.0.0.1:${socksPort}`,
                "--http1.1",
                "--location",
                "--output",
                "/dev/null",
                "--write-out",
                "%{http_code}\\n%{size_download}\\n%{time_total}\\n",
                targetUrl,
            ];

            const child = spawn("curl", args, {
                stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", chunk => {
                stdout += String(chunk);
            });

            child.stderr.on("data", chunk => {
                stderr += String(chunk);
            });

            child.once("error", error => {
                resolve({
                    code: -1,
                    stdout,
                    stderr: error?.message || "curl spawn failed",
                    elapsedMs: Math.max(Date.now() - startedAt, 0),
                });
            });

            child.once("exit", code => {
                resolve({
                    code: Number(code),
                    stdout,
                    stderr,
                    elapsedMs: Math.max(Date.now() - startedAt, 0),
                });
            });
        });

        const lines = result.stdout
            .trim()
            .split(/\r?\n/)
            .map(value => value.trim());

        const httpCode = Number(lines[0] || 0) || 0;
        const bytes = Number(lines[1] || 0) || 0;
        const curlSeconds = Number(lines[2] || 0);
        const elapsedSeconds =
            Number.isFinite(curlSeconds) && curlSeconds > 0
                ? curlSeconds
                : Math.max(result.elapsedMs / 1000, 0.001);

        const kbps =
            bytes > 0
                ? (bytes / 1024) / elapsedSeconds
                : 0;

        const isHttpSuccess = httpCode >= 200 && httpCode < 400;
        const curlCompletedOrTimedOut =
            result.code === 0 || result.code === 28;
        const hasMeaningfulSample = bytes >= 256 * 1024;

        const ok =
            curlCompletedOrTimedOut &&
            isHttpSuccess &&
            hasMeaningfulSample &&
            kbps >= INDEPENDENT_SPEED_MIN_MEDIAN_KBPS;

        const error = ok
            ? ""
            : (
                result.stderr.trim() ||
                `provider failed: curl=${result.code}, HTTP=${httpCode || "?"}, ` +
                `${bytes} bytes, ${Math.round(kbps * 10) / 10} KB/s`
            ).slice(0, 500);

        const attempt = {
            provider: provider.id,
            label: provider.label,
            type: provider.type,
            ok,
            url: targetUrl,
            httpCode,
            bytes,
            elapsedMs: Math.round(elapsedSeconds * 1000),
            kbps: Math.round(kbps * 10) / 10,
            curlCode: result.code,
            error,
        };

        attempts.push(attempt);

        if (ok) {
            return {
                ...attempt,
                attempts: attempts.map(item => ({
                    url: item.url,
                    ok: Boolean(item.ok),
                    httpCode: Number(item.httpCode) || 0,
                    bytes: Number(item.bytes) || 0,
                    elapsedMs: Number(item.elapsedMs) || 0,
                    kbps: Number(item.kbps) || 0,
                    curlCode: Number(item.curlCode),
                    error: item.error || "",
                })),
            };
        }
    }

    const last = attempts.at(-1) || {
        provider: provider.id,
        label: provider.label,
        type: provider.type,
        ok: false,
        url: "",
        httpCode: 0,
        bytes: 0,
        elapsedMs: 0,
        kbps: 0,
        curlCode: -1,
        error: "no test URLs configured",
    };

    return {
        ...last,
        attempts: attempts.map(item => ({
            url: item.url,
            ok: Boolean(item.ok),
            httpCode: Number(item.httpCode) || 0,
            bytes: Number(item.bytes) || 0,
            elapsedMs: Number(item.elapsedMs) || 0,
            kbps: Number(item.kbps) || 0,
            curlCode: Number(item.curlCode),
            error: item.error || "",
        })),
    };
}

async function resolveMlabServiceUrlsViaSocks(
    socksPort
) {
    return mlabLocateLimiter(() => resolveMlabServiceUrlsViaSocksUnbounded(socksPort));
}

async function resolveMlabServiceUrlsViaSocksUnbounded(
    socksPort
) {
    const maxAttempts = 3;
    let lastError = "M-Lab Locate failed";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const result = await new Promise(resolve => {
            const args = [
                "--silent",
                "--show-error",
                "--location",
                "--connect-timeout",
                String(Math.max(3, Math.ceil(MLAB_LOCATE_TIMEOUT_MS / 1000))),
                "--max-time",
                String(Math.max(5, Math.ceil(MLAB_LOCATE_TIMEOUT_MS / 1000))),
                "--proxy",
                `socks5h://127.0.0.1:${socksPort}`,
                "--http1.1",
                "--user-agent",
                "enter-config-healthcheck/1.2 (M-Lab ndt7)",
                "--header",
                "Accept: application/json",
                "--write-out",
                "\\n__M_LAB_HTTP_CODE__:%{http_code}\\n",
                MLAB_LOCATE_URL,
            ];

            const child = spawn("curl", args, {
                stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", chunk => {
                stdout += String(chunk);
            });

            child.stderr.on("data", chunk => {
                stderr += String(chunk);
            });

            const timeout = setTimeout(() => {
                try {
                    child.kill("SIGTERM");
                } catch {}
            }, MLAB_LOCATE_TIMEOUT_MS + 1000);

            child.once("error", error => {
                clearTimeout(timeout);
                resolve({
                    code: -1,
                    stdout,
                    stderr: error?.message || "curl spawn failed",
                });
            });

            child.once("exit", code => {
                clearTimeout(timeout);
                resolve({ code: Number(code), stdout, stderr });
            });
        });

        const marker = "__M_LAB_HTTP_CODE__:";
        const markerIndex = result.stdout.lastIndexOf(marker);
        const httpCode = markerIndex >= 0
            ? Number(result.stdout.slice(markerIndex + marker.length).trim()) || 0
            : 0;
        const body = markerIndex >= 0
            ? result.stdout.slice(0, markerIndex).trim()
            : result.stdout.trim();

        if (httpCode === 204) {
            lastError = "M-Lab Locate returned 204 (no ndt7 capacity)";
        } else if (httpCode === 429) {
            lastError = "M-Lab Locate returned 429 (rate limited)";
        } else if (result.code !== 0 || httpCode < 200 || httpCode >= 300) {
            lastError = (
                result.stderr.trim() ||
                `M-Lab Locate HTTP ${httpCode || "?"}, curl ${result.code}`
            ).slice(0, 500);
        } else {
            try {
                const payload = JSON.parse(body);
                const results = Array.isArray(payload?.results)
                    ? payload.results
                    : [];
                const seen = new Set();
                const serviceUrls = [];

                for (const resultEntry of results) {
                    const urls = resultEntry?.urls || {};
                    const candidates = Object.entries(urls);

                    for (const [key, value] of candidates) {
                        const url = String(value || "").trim();
                        if (
                            url.startsWith("wss://") &&
                            (
                                key.includes("/ndt/v7/download") ||
                                url.includes("/ndt/v7/download")
                            ) &&
                            !seen.has(url)
                        ) {
                            seen.add(url);
                            serviceUrls.push({
                                serviceUrl: url,
                                machine: String(resultEntry?.machine || ""),
                            });
                        }
                    }

                    if (serviceUrls.length >= 4) break;
                }

                if (serviceUrls.length) {
                    return {
                        ok: true,
                        httpCode,
                        targets: serviceUrls,
                    };
                }

                lastError =
                    "M-Lab Locate returned no usable wss ndt7 download targets";
            } catch (error) {
                lastError =
                    `M-Lab Locate JSON parse failed: ${error?.message || error}`;
            }
        }

        if (attempt < maxAttempts) {
            const delayMs = httpCode === 429
                ? 1000 * attempt
                : 350 * attempt;
            await sleep(delayMs);
        }
    }

    return {
        ok: false,
        httpCode: 0,
        targets: [],
        error: lastError,
    };
}

async function runMlabSpeedProvider(
    socksPort
) {
    const startedAt = Date.now();
    const located = await resolveMlabServiceUrlsViaSocks(socksPort);

    if (!located.ok) {
        return {
            provider: "mlab",
            label: "M-Lab NDT7",
            type: "ndt7",
            ok: false,
            url: MLAB_LOCATE_URL,
            httpCode: located.httpCode || 0,
            bytes: 0,
            elapsedMs: Math.max(Date.now() - startedAt, 0),
            kbps: 0,
            error: located.error,
            server: "",
            attempts: [],
        };
    }

    const attempts = [];

    // M-Lab Locate can return several download services. The previous implementation
    // tried up to four targets sequentially, which could add multiple full speed-test
    // timeouts to every candidate. Two concurrent targets retain redundancy without
    // creating a long per-server tail.
    const targets = located.targets.slice(0, 2);
    const targetResults = [];
    const probeResults = await Promise.all(
        targets.map(async target => {
            const targetStartedAt = Date.now();
            const result = await new Promise(resolve => {
            const args = [
                MLAB_PROBE_SCRIPT,
                "--socks-port",
                String(socksPort),
                "--timeout",
                String(Math.ceil(INDEPENDENT_SPEED_TIMEOUT_MS / 1000)),
                "--service-url",
                target.serviceUrl,
            ];

            const child = spawn(PYTHON_BIN, args, {
                stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", chunk => {
                stdout += String(chunk);
            });

            child.stderr.on("data", chunk => {
                stderr += String(chunk);
            });

            const timeout = setTimeout(() => {
                try {
                    child.kill("SIGTERM");
                } catch {}
            }, INDEPENDENT_SPEED_TIMEOUT_MS + 3500);

            child.once("error", error => {
                clearTimeout(timeout);
                resolve({
                    code: -1,
                    stdout,
                    stderr: error?.message || "probe spawn failed",
                });
            });

            child.once("exit", code => {
                clearTimeout(timeout);
                resolve({ code: Number(code), stdout, stderr });
            });
        });

        let payload = null;
        try {
            payload = JSON.parse(result.stdout.trim());
        } catch {}

        const kbps = Number(payload?.kbps) || 0;
        const bytes = Number(payload?.bytes) || 0;
        const elapsedMs = Number(payload?.elapsedMs) ||
            Math.max(Date.now() - targetStartedAt, 0);
        const ok =
            result.code === 0 &&
            payload?.ok === true &&
            bytes >= 256 * 1024 &&
            kbps >= INDEPENDENT_SPEED_MIN_MEDIAN_KBPS;

        const attempt = {
            provider: "mlab",
            label: "M-Lab NDT7",
            type: "ndt7",
            ok,
            url: target.serviceUrl,
            httpCode: Number(payload?.websocketCode) || (result.code === 0 ? 101 : 0),
            bytes,
            elapsedMs,
            kbps: Math.round(kbps * 10) / 10,
            server: payload?.server || target.machine || "",
            error: ok
                ? ""
                : (
                    payload?.error ||
                    result.stderr.trim() ||
                    `M-Lab target failed with exit code ${result.code}`
                ).slice(0, 500),
        };

        return attempt;
        })
    );

    attempts.push(...probeResults);

    const successfulAttempt = attempts.find(item => item?.ok);
    if (successfulAttempt) {
        return {
            ...successfulAttempt,
            attempts: attempts.map(item => ({
                url: item.url,
                server: item.server || "",
                ok: Boolean(item.ok),
                httpCode: Number(item.httpCode) || 0,
                bytes: Number(item.bytes) || 0,
                elapsedMs: Number(item.elapsedMs) || 0,
                kbps: Number(item.kbps) || 0,
                error: item.error || "",
            })),
        };
    }

    const last = attempts.at(-1) || {
        provider: "mlab",
        label: "M-Lab NDT7",
        type: "ndt7",
        ok: false,
        url: "",
        httpCode: located.httpCode || 0,
        bytes: 0,
        elapsedMs: Math.max(Date.now() - startedAt, 0),
        kbps: 0,
        server: "",
        error: "M-Lab returned no usable successful target",
    };

    return {
        ...last,
        attempts: attempts.map(item => ({
            url: item.url,
            server: item.server || "",
            ok: Boolean(item.ok),
            httpCode: Number(item.httpCode) || 0,
            bytes: Number(item.bytes) || 0,
            elapsedMs: Number(item.elapsedMs) || 0,
            kbps: Number(item.kbps) || 0,
            error: item.error || "",
        })),
    };
}


async function resolveYandexDownloadProbesViaSocks(
    socksPort
) {
    return yandexProbeLimiter(() => resolveYandexDownloadProbesViaSocksUnbounded(socksPort));
}

async function resolveYandexDownloadProbesViaSocksUnbounded(
    socksPort
) {
    const maxAttempts = 2;
    let lastError = "Yandex Internetometer get-probes failed";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const startedAt = Date.now();

        const result = await new Promise(resolve => {
            const args = [
                "--silent",
                "--show-error",
                "--location",
                "--connect-timeout",
                "4",
                "--max-time",
                String(Math.ceil(YANDEX_PROBE_TIMEOUT_MS / 1000)),
                "--proxy",
                `socks5h://127.0.0.1:${socksPort}`,
                "--http1.1",
                "--user-agent",
                "enter-config-healthcheck/1.0 (Yandex Internetometer probe)",
                "--referer",
                "https://yandex.ru/internet/",
                "--header",
                "Accept: application/json",
                "--header",
                "Cache-Control: no-cache",
                "--header",
                "Accept-Encoding: identity",
                "--write-out",
                "\\n__YANDEX_HTTP_CODE__:%{http_code}\\n",
                `${YANDEX_PROBES_URL}?t=${Date.now()}`,
            ];

            const child = spawn("curl", args, {
                stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";

            child.stdout.on("data", chunk => {
                stdout += String(chunk);
            });

            child.stderr.on("data", chunk => {
                stderr += String(chunk);
            });

            const timeout = setTimeout(() => {
                try {
                    child.kill("SIGTERM");
                } catch {}
            }, YANDEX_PROBE_TIMEOUT_MS + 1000);

            child.once("error", error => {
                clearTimeout(timeout);
                resolve({
                    code: -1,
                    stdout,
                    stderr: error?.message || "curl spawn failed",
                    elapsedMs: Math.max(Date.now() - startedAt, 0),
                });
            });

            child.once("exit", code => {
                clearTimeout(timeout);
                resolve({
                    code: Number(code),
                    stdout,
                    stderr,
                    elapsedMs: Math.max(Date.now() - startedAt, 0),
                });
            });
        });

        const marker = "__YANDEX_HTTP_CODE__:";
        const markerIndex = result.stdout.lastIndexOf(marker);
        const httpCode =
            markerIndex >= 0
                ? Number(
                    result.stdout
                        .slice(markerIndex + marker.length)
                        .trim()
                ) || 0
                : 0;

        const body =
            markerIndex >= 0
                ? result.stdout.slice(0, markerIndex).trim()
                : result.stdout.trim();

        if (result.code === 0 && httpCode >= 200 && httpCode < 300) {
            try {
                const payload = JSON.parse(body);
                const probes = Array.isArray(
                    payload?.download?.probes
                )
                    ? payload.download.probes
                    : [];

                const preferred = probes.filter(probe =>
                    /50mb/i.test(String(probe?.url || ""))
                );

                const ordered = [
                    ...preferred,
                    ...probes.filter(
                        probe =>
                            !preferred.includes(probe)
                    ),
                ];

                const targets = [];
                const seenHosts = new Set();

                for (const probe of ordered) {
                    const url = String(probe?.url || "").trim();

                    if (!/^https:\/\//i.test(url)) continue;

                    let parsed;
                    try {
                        parsed = new URL(url);
                    } catch {
                        continue;
                    }

                    const host = parsed.hostname.toLowerCase();

                    if (!host || seenHosts.has(host)) continue;

                    seenHosts.add(host);
                    targets.push({
                        url,
                        host,
                        size: Number(probe?.size) || 0,
                    });

                    if (targets.length >= 3) break;
                }

                if (targets.length > 0) {
                    return {
                        ok: true,
                        httpCode,
                        targets,
                        elapsedMs: Math.max(Date.now() - startedAt, 0),
                    };
                }

                lastError =
                    "Yandex get-probes returned no usable download probes";
            } catch (error) {
                lastError =
                    `Yandex get-probes JSON parse failed: ${
                        error?.message || error
                    }`;
            }
        } else if (httpCode === 429) {
            lastError = "Yandex get-probes HTTP 429 (rate limited)";
        } else {
            lastError = (
                result.stderr.trim() ||
                `Yandex get-probes HTTP ${httpCode || "?"}, curl ${result.code}`
            ).slice(0, 500);
        }

        if (attempt < maxAttempts) {
            await sleep(httpCode === 429 ? 1000 : 350);
        }
    }

    return {
        ok: false,
        httpCode: 0,
        targets: [],
        error: lastError,
    };
}

async function runYandexDownloadOnce(
    socksPort,
    targetUrl
) {
    const startedAt = Date.now();

    return new Promise(resolve => {
        const args = [
            "--silent",
            "--show-error",
            "--location",
            "--connect-timeout",
            "4",
            "--max-time",
            String(Math.ceil(YANDEX_PROBE_TIMEOUT_MS / 1000)),
            "--proxy",
            `socks5h://127.0.0.1:${socksPort}`,
            "--http1.1",
            "--user-agent",
            "enter-config-healthcheck/1.0 (Yandex Internetometer probe)",
            "--referer",
            "https://yandex.ru/internet/",
            "--header",
            "Cache-Control: no-cache",
            "--header",
            "Accept-Encoding: identity",
            "--output",
            "/dev/null",
            "--write-out",
            "%{http_code}\\n%{size_download}\\n%{time_total}\\n",
            `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}rid=${crypto
                .randomBytes(8)
                .toString("hex")}`,
        ];

        const child = spawn("curl", args, {
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", chunk => {
            stdout += String(chunk);
        });

        child.stderr.on("data", chunk => {
            stderr += String(chunk);
        });

        child.once("error", error => {
            resolve({
                code: -1,
                stdout,
                stderr: error?.message || "curl spawn failed",
                elapsedMs: Math.max(Date.now() - startedAt, 0),
            });
        });

        child.once("exit", code => {
            resolve({
                code: Number(code),
                stdout,
                stderr,
                elapsedMs: Math.max(Date.now() - startedAt, 0),
            });
        });
    });
}

async function runYandexSpeedProvider(
    socksPort
) {
    const startedAt = Date.now();

    const located =
        await resolveYandexDownloadProbesViaSocks(
            socksPort
        );

    if (!located.ok) {
        return {
            provider: "yandex",
            label: "Yandex Internetometer",
            type: "yandex",
            ok: false,
            url: YANDEX_PROBES_URL,
            httpCode: located.httpCode || 0,
            bytes: 0,
            elapsedMs: Math.max(Date.now() - startedAt, 0),
            kbps: 0,
            server: "",
            targets: [],
            attempts: [],
            error: located.error,
        };
    }

    // Yandex's documented methodology measures several CDN nodes
    // concurrently and aggregates the received bytes over the test window.
    // Keep the same structure but use a short health-check window.
    const results = await Promise.all(
        located.targets.map(target =>
            runYandexDownloadOnce(
                socksPort,
                target.url
            )
        )
    );

    const attempts = [];
    let totalBytes = 0;
    let commonElapsedMs = 0;

    located.targets.forEach((target, index) => {
        const result = results[index];

        const lines =
            result.stdout
                .trim()
                .split(/\r?\n/)
                .map(value => value.trim());

        const httpCode =
            Number(lines[0] || 0) || 0;

        const bytes =
            Number(lines[1] || 0) || 0;

        const curlSeconds =
            Number(lines[2] || 0);

        const elapsedMs =
            Math.max(
                curlSeconds > 0
                    ? curlSeconds * 1000
                    : result.elapsedMs,
                1
            );

        const kbps =
            bytes > 0
                ? (bytes / 1024) /
                    (elapsedMs / 1000)
                : 0;

        const isHttpSuccess =
            httpCode >= 200 && httpCode < 400;

        const meaningful =
            bytes >= 256 * 1024;

        const completedOrTimedOut =
            result.code === 0 || result.code === 28;

        const ok =
            completedOrTimedOut &&
            isHttpSuccess &&
            meaningful &&
            kbps >= INDEPENDENT_SPEED_MIN_MEDIAN_KBPS;

        totalBytes += bytes;
        commonElapsedMs = Math.max(
            commonElapsedMs,
            elapsedMs
        );

        attempts.push({
            provider: "yandex",
            label: "Yandex Internetometer",
            type: "yandex",
            ok,
            url: target.url,
            server: target.host,
            httpCode,
            bytes,
            elapsedMs: Math.round(elapsedMs),
            kbps: Math.round(kbps * 10) / 10,
            curlCode: result.code,
            error: ok
                ? ""
                : (
                    result.stderr.trim() ||
                    `Yandex probe failed: curl=${result.code}, ` +
                    `HTTP=${httpCode || "?"}, ` +
                    `${bytes} bytes, ` +
                    `${Math.round(kbps * 10) / 10} KB/s`
                ).slice(0, 500),
        });
    });

    const successful = attempts.filter(
        attempt => attempt.ok
    );

    // Treat the Yandex CDN set as one provider. Aggregate bytes from all
    // selected CDN nodes over the same wall-clock measurement window.
    const aggregateKbps =
        totalBytes > 0 && commonElapsedMs > 0
            ? (totalBytes / 1024) /
                (commonElapsedMs / 1000)
            : 0;

    const ok =
        successful.length > 0 &&
        aggregateKbps >=
            INDEPENDENT_SPEED_MIN_MEDIAN_KBPS;

    return {
        provider: "yandex",
        label: "Yandex Internetometer",
        type: "yandex",
        ok,
        url: YANDEX_PROBES_URL,
        httpCode: successful.length
            ? 200
            : (attempts[0]?.httpCode || 0),
        bytes: totalBytes,
        elapsedMs: Math.round(commonElapsedMs),
        kbps:
            Math.round(aggregateKbps * 10) / 10,
        server: successful
            .map(item => item.server)
            .join(", "),
        targets: located.targets.map(item => item.url),
        attempts,
        error: ok
            ? ""
            : (
                "Yandex Internetometer speed check failed; " +
                `${successful.length}/${attempts.length} CDN probes ` +
                `passed, aggregate ${Math.round(aggregateKbps * 10) / 10} KB/s`
            ).slice(0, 500),
    };
}

async function runIndependentSpeedCheck(
    socksPort
) {
    // Measure all four providers in one wall-clock window to cut the expensive
    // serial wait roughly in half/quarter while retaining all provider samples.
    const providers = new Array(INDEPENDENT_SPEED_PROVIDERS.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const index = nextIndex++;
            if (index >= INDEPENDENT_SPEED_PROVIDERS.length) return;

            const provider = INDEPENDENT_SPEED_PROVIDERS[index];
            try {
                let result;
                result = await speedProviderLimiter(async () => {
                    if (provider.type === "ndt7") {
                        return runMlabSpeedProvider(socksPort);
                    } else if (provider.type === "yandex") {
                        return runYandexSpeedProvider(socksPort);
                    }
                    return runIndependentCurlSpeedProvider(socksPort, provider);
                });
                providers[index] = result;
            } catch (error) {
                providers[index] = {
                    provider: provider.id,
                    label: provider.label,
                    type: provider.type,
                    ok: false,
                    kbps: 0,
                    bytes: 0,
                    elapsedMs: 0,
                    error: error?.message || "provider error",
                    attempts: [],
                };
            }
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(SPEED_PROVIDER_CONCURRENCY, INDEPENDENT_SPEED_PROVIDERS.length) },
            () => worker()
        )
    );

    const orderedProviders = providers.filter(Boolean);

    const successful = orderedProviders.filter(
        provider => provider?.ok && Number.isFinite(Number(provider.kbps))
    );

    const speeds = successful.map(provider => Number(provider.kbps));
    const medianKbps = speeds.length ? median(speeds) : 0;

    const requiredProviderFailures = [...REQUIRED_SPEED_PROVIDER_IDS].filter(
        providerId => !successful.some(
            provider => String(provider.provider).toLowerCase() === providerId
        )
    );

    const ok =
        successful.length >= INDEPENDENT_SPEED_PROVIDER_MIN_PASSES &&
        requiredProviderFailures.length === 0 &&
        medianKbps >= INDEPENDENT_SPEED_MIN_MEDIAN_KBPS;

    const maxKbps = speeds.length ? Math.max(...speeds) : 0;
    const minKbps = speeds.length ? Math.min(...speeds) : 0;

    return {
        ok,
        providerCount: orderedProviders.length,
        requiredProviders: INDEPENDENT_SPEED_PROVIDER_MIN_PASSES,
        passedCount: successful.length,
        failedCount: orderedProviders.length - successful.length,
        medianKbps: Math.round(medianKbps * 10) / 10,
        minKbps: Math.round(minKbps * 10) / 10,
        maxKbps: Math.round(maxKbps * 10) / 10,
        kbps: Math.round(medianKbps * 10) / 10,
        bytes: successful.length
            ? Math.round(successful.reduce((sum, provider) => sum + (Number(provider.bytes) || 0), 0) / successful.length)
            : 0,
        probes: orderedProviders,
        providers: orderedProviders.map(provider => ({
            provider: provider.provider,
            label: provider.label,
            ok: Boolean(provider.ok),
            kbps: Number(provider.kbps) || 0,
            bytes: Number(provider.bytes) || 0,
            elapsedMs: Number(provider.elapsedMs) || 0,
            httpCode: Number(provider.httpCode) || 0,
            server: provider.server || "",
            error: provider.error || "",
            attempts: Array.isArray(provider.attempts) ? provider.attempts : []
        })),
        error: ok
            ? ""
            : (
                `independent speed check failed: ${successful.length}/${orderedProviders.length} providers passed; ` +
                `median ${Math.round(medianKbps * 10) / 10} KB/s ` +
                `(minimum ${INDEPENDENT_SPEED_MIN_MEDIAN_KBPS} KB/s)` +
                (requiredProviderFailures.length
                    ? `; required providers failed: ${requiredProviderFailures.join(", ")}`
                    : "")
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

function connectionMetrics(remote = [], { whiteList = false } = {}) {
    const successful = (Array.isArray(remote) ? remote : [])
        .filter(item => item?.ok && Number.isFinite(Number(item.latencyMs)))
        .map(item => Number(item.latencyMs));

    if (!successful.length) {
        return {
            medianMs: 0,
            maxMs: Infinity,
            samples: [],
            eligible: false,
        };
    }

    const medianLimit = whiteList
        ? WHITE_LIST_CONNECTION_TIME_MAX_MEDIAN_MS
        : CONNECTION_TIME_MAX_MEDIAN_MS;
    const singleLimit = whiteList
        ? WHITE_LIST_CONNECTION_TIME_MAX_SINGLE_MS
        : CONNECTION_TIME_MAX_SINGLE_MS;

    return {
        medianMs: Math.round(median(successful)),
        maxMs: Math.round(Math.max(...successful)),
        samples: successful.map(value => Math.round(value)),
        eligible: successful.length >= HEALTH_MIN_TARGET_PASSES &&
            median(successful) <= medianLimit &&
            Math.max(...successful) <= singleLimit,
        limits: {
            medianMs: medianLimit,
            singleMs: singleLimit,
        },
    };
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

async function measureGamingLatency(link, connectionFallback = null) {
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

    // Hysteria/Hysteria2 are UDP/QUIC transports, so a direct TCP handshake
    // to the endpoint is not a valid gaming metric. For these protocols use the
    // already measured effective connection latency through the running Xray
    // tunnel instead. This keeps Hysteria eligible without pretending its UDP
    // endpoint speaks TCP.
    if (protocol === "hysteria2" || protocol === "hysteria") {
        const samples = Array.isArray(connectionFallback?.samples)
            ? connectionFallback.samples
                .map(value => Number(value))
                .filter(Number.isFinite)
            : [];

        if (!samples.length) {
            return {
                ok: false,
                samples: [],
                medianLatencyMs: 0,
                maxLatencyMs: Infinity,
                latencySpreadMs: Infinity,
                latencyStdDevMs: Infinity,
                error: "no effective connection latency samples available for Hysteria",
            };
        }

        const medianLatencyMs = median(samples);
        const maxLatencyMs = Math.max(...samples);
        const minLatencyMs = Math.min(...samples);

        return {
            ok: true,
            samples,
            medianLatencyMs: Math.round(medianLatencyMs),
            maxLatencyMs: Math.round(maxLatencyMs),
            latencySpreadMs: Math.round(maxLatencyMs - minLatencyMs),
            latencyStdDevMs: standardDeviation(samples),
            error: "",
            source: "effective-xray-connection",
        };
    }

    // The three samples are independent TCP handshakes. Run them concurrently
    // so gaming eligibility keeps the same three-sample methodology without
    // adding ~2x sequential timeout/handshake wall time per server.
    const probeResults = await Promise.all(
        Array.from({ length: 3 }, () =>
            directTcpLatencyProbe(
                server.address,
                server.port,
                TCP_TIMEOUT_MS
            )
        )
    );

    const samples = probeResults
        .filter(result => result?.ok)
        .map(result => Number(result.latencyMs));

    const errors = probeResults
        .map((result, index) =>
            result?.ok
                ? ""
                : `probe ${index + 1}: ${result?.error || "failed"}`
        )
        .filter(Boolean);

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

    const enoughBackupSpeedProviders =
        qualityPassed >= GAMING_BACKUP_MIN_QUALITY_PASSES &&
        Number(quality?.kbps) >= GAMING_MIN_KBPS;

    const validLatency =
        gamingLatency?.ok === true &&
        latencies.length === 3;

    const eligible =
        enoughIndependentSpeedProviders &&
        validLatency &&
        maxLatencyMs <= GAMING_MAX_LATENCY_MS &&
        latencySpreadMs <= GAMING_MAX_LATENCY_SPREAD_MS;

    const backupEligible =
        enoughBackupSpeedProviders &&
        validLatency &&
        maxLatencyMs <= GAMING_BACKUP_MAX_LATENCY_MS &&
        latencySpreadMs <= GAMING_BACKUP_MAX_LATENCY_SPREAD_MS;

    const tier = eligible
        ? 1
        : backupEligible
            ? 2
            : 0;

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
                        GAMING_BASE_SPEED_PROVIDER_COUNT,
                        1
                    )) * 25
            )
            : 0;

    return {
        eligible,
        backupEligible,
        tier,
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

            // Regular countries publish at most the three best healthy members.
            // White List/LTE is intentionally uncapped for now so every
            // server that passes health-check is published and can be tested
            // directly; a future per-country cap can be introduced later.
            const top = whiteListOnly
                ? sorted
                : sorted.slice(0, COUNTRY_POOL_SIZE);
            const speeds = top
                .map(item => Number(item.quality?.kbps))
                .filter(Number.isFinite);

            const bestSpeed = speeds[0] || 0;
            const secondSpeed = speeds[1] || 0;
            const thirdSpeed = speeds[2] || 0;

            const countryScore =
                bestSpeed * 0.50 +
                secondSpeed * 0.25 +
                thirdSpeed * 0.15 +
                speeds.length * 10;

            return {
                country,
                members: top,
                whiteList: Boolean(whiteListOnly),
                countryScore: Math.round(countryScore * 10) / 10,
                bestSpeed: Math.round(bestSpeed * 10) / 10,
                goodServerCount: speeds.length,
            };
        })
        .sort((a, b) => b.countryScore - a.countryScore);

    return entries.slice(0, MAX_VISIBLE_COUNTRIES);
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


function resultSpeed(result) {
    return Number(result?.quality?.medianKbps ?? result?.quality?.kbps) || 0;
}

function resultConnectionMs(result) {
    return Number(result?.connection?.medianMs) || Infinity;
}

function percentileRank(value, values, { ascending = true } = {}) {
    const finite = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!finite.length || !Number.isFinite(value)) return 0;
    if (finite.length === 1) return 1;
    let below = 0;
    for (const candidate of finite) {
        if (ascending ? candidate <= value : candidate >= value) below += 1;
        else break;
    }
    return below / finite.length;
}

function selectFeaturedFastServers(results, limit = FAST_TOP_N, allowedCountries = FEATURED_COUNTRIES) {
    const candidates = results.filter(result =>
        result.ok &&
        !result.whiteList &&
        result.country &&
        result.connection?.eligible === true &&
        Number.isFinite(resultSpeed(result)) &&
        resultSpeed(result) > 0 &&
        Number.isFinite(Number(result?.connection?.medianMs)) &&
        Number(result.connection.medianMs) > 0
    );

    const speedValues = candidates.map(result => resultSpeed(result));
    const connectionValues = candidates.map(result => resultConnectionMs(result));

    const ranked = candidates
        .map(result => {
            const speedScore = percentileRank(resultSpeed(result), speedValues, { ascending: false });
            const connectionScore = percentileRank(resultConnectionMs(result), connectionValues, { ascending: true });
            // Fast is a balance of throughput and real effective connection time.
            // Gaming latency is deliberately excluded from this score.
            const fastScore = (speedScore * 0.65) + (connectionScore * 0.35);
            return { result, fastScore, speedScore, connectionScore };
        })
        .sort((a, b) => {
            const scoreDiff = b.fastScore - a.fastScore;
            if (scoreDiff !== 0) return scoreDiff;

            const speedDiff = resultSpeed(b.result) - resultSpeed(a.result);
            if (speedDiff !== 0) return speedDiff;

            const connectionDiff = resultConnectionMs(a.result) - resultConnectionMs(b.result);
            if (connectionDiff !== 0) return connectionDiff;

            return String(a.result.linkFingerprint || a.result.link || '')
                .localeCompare(String(b.result.linkFingerprint || b.result.link || ''));
        });

    // At most three distinct countries can participate in the Fast trio.
    // Once a country is admitted, up to FAST_SERVERS_PER_COUNTRY (=3 by default)
    // servers from that country may be selected.
    const selected = [];
    const selectedKeys = new Set();
    const selectedCountries = new Set();
    const countryCounts = new Map();

    for (const row of ranked) {
        const result = row.result;
        const key = String(result.linkFingerprint || result.link || '');
        if (!key || selectedKeys.has(key)) continue;

        const country = String(result.country || '').trim();
        if (!country) continue;
        const countryKey = country.toLowerCase();
        if (!allowedCountries.has(countryKey)) continue;

        // Fast is a location feature: one physical server per selected country.
        if (selectedCountries.has(countryKey)) continue;

        selectedCountries.add(countryKey);
        countryCounts.set(countryKey, 1);
        selectedKeys.add(key);
        selected.push(result);

        if (selected.length >= limit) break;
    }

    return selected;
}

function selectFeaturedGamingServers(
    results,
    excludedCountries = new Set(),
    limit = GAMING_TOP_N,
    allowedCountries = FEATURED_COUNTRIES
) {
    const candidates = results
        .filter(
            result =>
                result.ok &&
                !result.whiteList &&
                result.country &&
                Number(result.gaming?.tier || 0) > 0
        );

    const excluded = new Set(
        [...excludedCountries].map(country =>
            String(country).trim().toLowerCase()
        )
    );

    const groups = new Map();
    for (const result of candidates) {
        const country = String(result.country || "").trim();
        const key = country.toLowerCase();
        if (!country || excluded.has(key) || !allowedCountries.has(key)) continue;

        const bucket = groups.get(key) || { country, members: [] };
        bucket.members.push(result);
        groups.set(key, bucket);
    }

    const rankedCountries = [...groups.values()]
        .map(group => {
            const sorted = group.members.slice().sort((a, b) => {
                const tierDiff = (Number(a.gaming?.tier) || 9) - (Number(b.gaming?.tier) || 9);
                if (tierDiff) return tierDiff;
                const scoreDiff = (Number(b.gaming?.score) || 0) - (Number(a.gaming?.score) || 0);
                if (scoreDiff) return scoreDiff;
                return resultSpeed(b) - resultSpeed(a);
            });

            // A Gaming country may be represented by either a strict Tier-1
            // server or a Tier-2 backup when no Tier-1 candidate exists.
            // This keeps the requested Gaming location count achievable without
            // relaxing the underlying Gaming quality/latency tiers: Tier-2
            // candidates remain explicitly marked as backup-tier Gaming nodes.
            const primary = sorted.find(item =>
                Number(item.gaming?.tier) === 1 ||
                Number(item.gaming?.tier) === 2
            );
            if (!primary) return null;

            const backup = sorted.find(item =>
                item.linkFingerprint !== primary.linkFingerprint &&
                Number(item.gaming?.tier) > 0 &&
                Number(item.gaming?.tier) <= 2
            );

            return {
                country: group.country,
                members: backup ? [primary, backup] : [primary]
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            const scoreDiff = (Number(b.members[0]?.gaming?.score) || 0) - (Number(a.members[0]?.gaming?.score) || 0);
            if (scoreDiff) return scoreDiff;
            return resultSpeed(b.members[0]) - resultSpeed(a.members[0]);
        })
        .slice(0, Math.max(1, limit));

    return rankedCountries.flatMap(country => country.members);
}

function applyFeaturedRegularBadges(indexEntries, healthResults, featuredTargets) {
    const targets = featuredTargets || calculateFeaturedTargetCounts(
        new Set(
            healthResults
                .filter(result => result.ok && !result.whiteList && result.country)
                .map(result => String(result.country).trim().toLowerCase())
        ).size
    );
    const fast = selectFeaturedFastServers(healthResults, targets.fast);
    const fastFingerprints = new Set(fast.map(item => item.linkFingerprint));
    // Fast and Gaming are separate feature locations. A country already
    // represented by Fast may also host a distinct Gaming winner; excluding
    // Fast countries made Gaming impossible whenever only the Fast countries
    // had strict Gaming Tier-1 candidates. The selected servers remain
    // fingerprint-distinct and are published as separate Gaming balancers.
    const gaming = selectFeaturedGamingServers(
        healthResults,
        new Set(),
        targets.gaming
    );
    const gamingFingerprints = new Set(gaming.map(item => item.linkFingerprint));
    const byFingerprint = new Map(healthResults.map(result => [result.linkFingerprint, result]));

    const fastMeta = fast.map((item, index) => ({
        rank: index + 1,
        country: item.country,
        linkFingerprint: item.linkFingerprint,
        medianKbps: resultSpeed(item),
        connectionMedianMs: Number(item.connection?.medianMs) || 0,
    }));
    const gamingMeta = gaming.map((item, index) => ({
        rank: index + 1,
        country: item.country,
        linkFingerprint: item.linkFingerprint,
        score: Number(item.gaming?.score) || 0,
        medianKbps: resultSpeed(item),
        medianLatencyMs: Number(item.gaming?.medianLatencyMs) || 0,
        connectionMedianMs: Number(item.connection?.medianMs) || 0,
    }));

    for (const entry of indexEntries) {
        if (!entry || !entry.link) continue;
        const result = byFingerprint.get(fingerprintLink(entry.link));
        if (!result) continue;

        if (fastFingerprints.has(result.linkFingerprint)) {
            entry.featured = 'fast';
            entry.featuredRank = fast.find(item => item.linkFingerprint === result.linkFingerprint)?.rank || 0;
            const flag = extractFlag(result.remarks) || countryFlag(result.country) || '🌐';
            entry.remarks = `${flag} 🔥 ${result.country}`.trim();
        } else if (gamingFingerprints.has(result.linkFingerprint)) {
            entry.featured = 'gaming';
            entry.featuredRank = gaming.find(item => item.linkFingerprint === result.linkFingerprint)?.rank || 0;
        } else if (entry.featured === 'fast' || entry.featured === 'gaming') {
            delete entry.featured;
            delete entry.featuredRank;
        }
    }

    return { fast, gaming, fastMeta, gamingMeta };
}

async function buildGamingAssignments(
    selectedCountries,
    healthResults,
    candidateItems,
    excludedCountries = new Set(),
    featuredTargets = null
) {
    const candidateByFingerprint = new Map(
        (Array.isArray(candidateItems) ? candidateItems : [])
            .map(item => [fingerprintLink(item?.link || ''), item])
            .filter(([fingerprint, item]) => fingerprint && item)
    );

    const targets = featuredTargets || calculateFeaturedTargetCounts(
        Array.isArray(selectedCountries) ? selectedCountries.length : 0
    );
    const selected = selectFeaturedGamingServers(
        healthResults,
        new Set(excludedCountries),
        targets.gaming
    );

    return selected.map((item, index) => {
        const selectedItem = candidateByFingerprint.get(item.linkFingerprint);
        const selectedLink = String(selectedItem?.link || '').trim();
        if (!selectedLink) return null;

        const flag = extractFlag(item.remarks);
        return {
            id: `gaming-${index + 1}`,
            country: item.country,
            flag,
            featured: "gaming",
            featuredRank: Math.floor(index / GAMING_SERVERS_PER_COUNTRY) + 1,
            gamingMemberRank: (index % GAMING_SERVERS_PER_COUNTRY) + 1,
            remarks: `${flag} 🎮 ${item.country}`.replace(/\s+/g, ' ').trim(),
            linkFingerprint: item.linkFingerprint,
            link: selectedLink,
            quality: item.quality,
            gaming: item.gaming,
            gamingTier: Number(item.gaming?.tier) || 0,
        };
    }).filter(Boolean);
}

async function runGlobalpingDiagnostic() {
    const candidateText = await fs.readFile(HEALTH_CANDIDATES_FILE, "utf8");
    const candidates = JSON.parse(candidateText);
    if (!Array.isArray(candidates) || !candidates.length) {
        throw new Error(`${path.basename(HEALTH_CANDIDATES_FILE)} must contain a non-empty array`);
    }

    // Deterministic but distributed sample: hash the endpoint fingerprint so the
    // first 250 are not always the same source slice after refreshes.
    const sample = candidates
        .filter(item => {
            const fp = fingerprintLink(String(item?.link || ""));
            return isManagedSourceId(item?.id) && !isLteCandidate(item, null) &&
                getTransportType(getProtocol(String(item?.link || ""))) === "tcp";
        })
        .map(item => ({
            item,
            fp: fingerprintLink(String(item?.link || ""))
        }))
        .sort((a, b) => a.fp.localeCompare(b.fp))
        .slice(0, GLOBALPING_MAX_CANDIDATES_PER_CYCLE);

    const diagnosticResults = [];
    let cursor = 0;

    async function worker() {
        while (true) {
            const row = sample[cursor++];
            if (!row) return;

            let url;
            try {
                url = new URL(String(row.item?.link || "").trim());
            } catch {
                diagnosticResults.push({
                    id: row.item?.id || "",
                    fingerprint: row.fp,
                    ok: false,
                    skipped: false,
                    error: "invalid endpoint URL"
                });
                continue;
            }

            const protocol = getProtocol(String(row.item?.link || ""));
            const result = await globalpingRussia(url, protocol);
            diagnosticResults.push({
                id: row.item?.id || "",
                fingerprint: row.fp,
                country: row.item?.country || "",
                source: row.item?.source || "",
                host: url.hostname,
                port: Number(url.port || 443),
                protocol,
                ...result,
                checkedAt: Date.now()
            });
        }
    }

    const workerCount = Math.min(GLOBALPING_CONCURRENCY, sample.length || 1);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const ok = diagnosticResults.filter(item => item.ok).length;
    const fail = diagnosticResults.filter(item => item.ok === false && !item.unavailable && !item.inconclusive).length;
    const unavailable = diagnosticResults.filter(item => item.unavailable).length;

    const report = {
        generatedAt: new Date().toISOString(),
        provider: "globalping",
        purpose: "diagnostic-only",
        affectsRussiaGate: false,
        freeTestBudget: GLOBALPING_MAX_CANDIDATES_PER_CYCLE,
        testsRequested: diagnosticResults.length,
        testsPassed: ok,
        testsFailed: fail,
        testsUnavailable: unavailable,
        results: diagnosticResults
    };

    const output = path.join(ROOT, "russia-globalping-diagnostic.json");
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log(
        `GLOBALPING DIAGNOSTIC COMPLETE: ${diagnosticResults.length} tests; ` +
        `${ok} pass, ${fail} fail, ${unavailable} unavailable; ` +
        `gateImpact=none; results=${path.relative(ROOT, output)}`
    );
}

async function main() {
    if (HEALTHCHECK_MODE === "globalping-diagnostic") {
        await runGlobalpingDiagnostic();
        return;
    }

    if (HEALTHCHECK_MODE !== "russia-gate") {
        await fs.access(
            XRAY_BIN
        );
    }

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
            "Source update status is missing; refusing to health-check a potentially stale candidate manifest."
        );
    }

    if (updateStatus?.refreshed !== true) {
        throw new Error(
            `Source refresh was not performed (${updateStatus?.reason || "unknown reason"}); refusing to reuse the previous candidate manifest.`
        );
    }

    const manifestText = await fs.readFile(HEALTH_CANDIDATES_FILE, "utf8");
    const manifestSha256 = crypto.createHash("sha256").update(manifestText).digest("hex");
    if (updateStatus.manifestSha256 !== manifestSha256) {
        throw new Error(
            `Source manifest generation mismatch: status=${updateStatus.manifestSha256 || "missing"}, manifest=${manifestSha256}`
        );
    }

    const missingManifestLinks = [];
    for (const candidate of candidates.filter(item => isManagedSourceId(item?.id))) {
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
            .filter(item => isManagedSourceId(item?.id))
            .map(item => item.id)
    );

    const nextIndexSeed = committedIndex.filter(
        item => !isManagedSourceId(item?.id)
    );

    let diagnosticReport = {};
    try {
        diagnosticReport = JSON.parse(
            await fs.readFile(path.join(ROOT, "source-report.json"), "utf8")
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
            isManagedSourceId(
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

    let persistentState = {};
    try {
        persistentState = JSON.parse(await fs.readFile(HEALTH_STATE_FILE, "utf8"));
    } catch {}
    let cursor =
        0;

    const healthStartedAt = Date.now();
    const checkedLinkMeta = new Map();

    async function checkItem(
        item,
        russiaProbe = null
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

        const sourceMeta = candidateMap[linkFingerprint] || null;

        // Russia reachability is a pre-gate for regular/non-LTE nodes.
        // Servers definitely unreachable from Russia never consume the expensive
        // Xray + HTTPS + multi-provider speed budget.
        if (!isLteCandidate(item, sourceMeta) && russiaProbe) {
            if (!russiaProbe.gatePassed && !russiaProbe.gatePending) {
                return {
                    item,
                    ok: false,
                    protocol,
                    russiaProbe,
                    reason:
                        `Russia reachability failed: Check-Host ${russiaProbe.checkHost?.nodesReachable || 0}/${russiaProbe.checkHost?.nodesTested || 0}; ` +
                        `Globalping ${russiaProbe.globalping?.probesReachable || 0}/${russiaProbe.globalping?.probesTested || 0}`,
                };
            }
        }

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
                protocol,
                russiaProbe,
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
                    protocol,
                    russiaProbe,
                    reason: `1/3 real stages passed; xray-startup: ${xray.error}`,
                };
            }

            const isWhiteListCandidate =
                Boolean(candidateMap[linkFingerprint]?.whiteList) ||
                MANAGED_WHITE_LIST_RE.test(String(item.id || ""));

            const targetPool = isWhiteListCandidate
                ? WHITE_LIST_HEALTH_TARGET_URLS
                : HEALTH_TARGET_URLS;

            const targets = [...new Set(
                targetPool
                    .map(value => String(value || "").trim())
                    .filter(Boolean)
            )];

            if (targets.length < 1) {
                throw new Error("Need at least one distinct health-check target URL");
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
            const connection = connectionMetrics(remote, { whiteList: isWhiteListCandidate });

            let updateConnectivity = {
                ok: false,
                url: SERVICE_BASE_URL,
                latencyMs: 0,
                error: "not tested",
            };

            if (isWhiteListCandidate) {
                const updateProbe = await probeTargetOnceWithRetries(
                    xray.socksPort,
                    SERVICE_BASE_URL,
                    2
                );

                updateConnectivity = {
                    ok: Boolean(updateProbe?.ok),
                    url: SERVICE_BASE_URL,
                    latencyMs: Number(updateProbe?.latencyMs) || 0,
                    error: updateProbe?.error || "",
                };

                if (!updateConnectivity.ok) {
                    return {
                        item,
                        ok: false,
                        protocol,
                        russiaProbe,
                        reason:
                            `Whitelist health passed, but service connectivity failed: ` +
                            `${updateProbe?.error || "endpoint unreachable"}`,
                        quality: null,
                        connection,
                        remote,
                        updateConnectivity,
                    };
                }
            }
            // Regular nodes use HTTPS reachability as an inexpensive liveness
            // gate before we spend time on the four heavy speed providers.
            // White-list/LTE nodes are intentionally different: their traffic
            // path is special, so a failure of all three ordinary public HTTPS
            // probes must not prevent the actual speed test from determining
            // whether the node can carry real traffic.
            // Regular nodes no longer fail solely because the three synthetic
            // HTTPS probes are unreachable. Those probes are diagnostics; the
            // independent real-download test below is a stronger signal that
            // the Xray route actually carries traffic.
            if (
                !isWhiteListCandidate &&
                passedTargets.length >= HEALTH_MIN_TARGET_PASSES &&
                !connection.eligible
            ) {
                // Do not return yet: an otherwise working route may have slow
                // synthetic endpoints while still passing the real speed test.
            }

            if (
                isWhiteListCandidate &&
                !connection.eligible
            ) {
                return {
                    item,
                    ok: false,
                    protocol,
                    russiaProbe,
                    reason:
                        `TCP + Xray + whitelist HTTPS passed, but effective connection time is too slow ` +
                        `(median ${connection.medianMs} ms, max ${connection.maxMs} ms; ` +
                        `limits ${CONNECTION_TIME_MAX_MEDIAN_MS}/${CONNECTION_TIME_MAX_SINGLE_MS} ms)`,
                    quality: null,
                    connection,
                    remote,
                };
            }

            const quality =
                await runIndependentSpeedCheck(
                    xray.socksPort
                );

            if (!isWhiteListCandidate) {
                const details = failedTargets
                    .map(result =>
                        `${result.targetUrl}: ${result.error || "proxy request failed"}`
                    )
                    .join(" | ");

                if (!quality.ok) {
                    return {
                        item,
                        ok: false,
                        protocol,
                        russiaProbe,
                        reason:
                            `TCP + Xray + real speed check failed ` +
                            `(${quality.passedCount}/${quality.providerCount} providers, ` +
                            `median ${quality.medianKbps} KB/s). ` +
                            `Synthetic HTTPS diagnostics: ${passedTargets.length}/${targets.length} passed` +
                            `${details ? `; ${details}` : ""}`,
                        quality,
                        connection,
                        remote,
                    };
                }

                // A passing real speed test is authoritative even when the
                // synthetic HTTPS endpoints are blocked/reset from the CI
                // runner. Record the diagnostics, but do not reject the node.
            }

            const gamingLatency = await measureGamingLatency(
                item.link,
                connection
            );
            const gaming = getGamingMetrics(remote, quality, gamingLatency);

            return {
                item,
                ok: true,
                protocol,
                russiaProbe,
                stages:
                    `TCP + Xray + ${passedTargets.length}/${targets.length} HTTPS + ` +
                    (isWhiteListCandidate
                        ? `service ${updateConnectivity.ok ? "PASS" : "FAIL"} + `
                        : "") +
                    `quality ${quality.passedCount}/${quality.providerCount} probes passed ` +
                    `(avg passing ${quality.kbps} KB/s)` +
                    (isWhiteListCandidate && !quality.ok ? ` [whitelist: speed probe non-gating]` : ""),
                quality,
                connection,
                gaming: {
                    ...gaming,
                    latencyProbeError: gamingLatency.error || "",
                },
                remote,
                updateConnectivity,
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
                    item,
                    russiaProbeByFingerprint.get(fingerprintLink(item.link || "")) || null
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
                link: String(item.link || "").trim(),
                configFile: item.configFile || null,
                sourceKind: item.sourceKind || null,
                country: resolvedCountry,
                whiteList: isWhiteList,
                source: meta.sourceMeta?.source || item.source || "retained/manual",
                linkFingerprint: meta.linkFingerprint || "",
                ok: result.ok,
                protocol: result.protocol || "",
                stages: result.stages || "",
                reason: result.reason || "",
                quality: result.quality || null,
                connection: result.connection || null,
                gaming: result.gaming || null,
                remote: result.remote || [],
                updateConnectivity: result.updateConnectivity || null,
                russiaProbe: result.russiaProbe || null,
                telegram: result.telegram || null
            });

            const completed = passed + failed;
            if (completed % 50 === 0 || completed === checked) {
                const elapsed = Math.round((Date.now() - healthStartedAt) / 1000);
                console.log(`HEALTH PROGRESS ${completed}/${heavyChecked}: ${passed} passed, ${failed} failed, ${elapsed}s elapsed`);
            }

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

    // Russia reachability is a dedicated pipeline stage. In `russia-gate` mode
    // every non-LTE candidate is checked (or reused from a recent cached result),
    // then the full gate is persisted for the next job. The normal health mode
    // only consumes that immutable gate output and never calls Check-Host again.
    const russiaProbeByFingerprint = new Map();
    // These counters are also consumed by the normal heavy-health mode below.
    // Keep them in the main function scope so an russia-gate run can populate
    // them and a subsequent health run can report/consume the persisted gate.
    let russiaGateChecked = 0;
    let russiaGatePassed = 0;
    let russiaGateFailures = 0;
    let russiaGatePending = 0;

    const cachedRussiaGate =
        persistentState?.russiaGate && typeof persistentState.russiaGate === "object"
            ? persistentState.russiaGate
            : {};

    if (HEALTHCHECK_MODE === "russia-gate") {
        ACTIVE_CHECK_HOST_RUSSIA_NODES = await resolveRussianCheckHostNodes();

        // Verify the checker itself before spending hundreds of checks. This
        // separates "Check-Host is unavailable/throttling" from "this target is
        // unreachable" and selects only Russian nodes that can actually reach
        // the control target.
        const russiaPreflight = await checkHostProviderPreflight();
        const liveRussiaNodes = Array.isArray(russiaPreflight?.selectedLiveNodes)
            ? [...new Set(russiaPreflight.selectedLiveNodes)]
            : [];

        ACTIVE_CHECK_HOST_RUSSIA_NODES = liveRussiaNodes;
        ACTIVE_CHECK_HOST_GATE_QUORUM = Number(russiaPreflight?.quorumRequired) || 0;
        const russiaCheckerMode = russiaPreflight?.checkerMode || (liveRussiaNodes.length >= 2 ? "dual" : liveRussiaNodes.length === 1 ? "single" : "skipped");

        console.log(
            `RUSSIA CHECKER PREFLIGHT: ${russiaPreflight.nodesReachable}/${russiaPreflight.nodesTested} ` +
            `usable Russian node(s); mode=${russiaCheckerMode}; selected=${ACTIVE_CHECK_HOST_RUSSIA_NODES.join(",") || "none"}`
        );

        console.log(
            `RUSSIA GATE START: Check-Host=${ACTIVE_CHECK_HOST_RUSSIA_NODES.length} live Russian nodes for all non-LTE candidates; ` +
            `strategy=${russiaCheckerMode === "dual" ? "strict-positive-reachability-2-of-2" : russiaCheckerMode === "single" ? "single-live-node-warning-mode" : "skipped-all-checkers-unavailable"}; ` +
            `cache=${RUSSIA_GATE_USE_CACHE ? "enabled" : "disabled"}; ` +
            `Globalping=diagnostic-only (never affects gate); ` +
            `adaptive-pacing=global-api>=${CHECK_HOST_TOTAL_MIN_INTERVAL_MS}ms; ` +
            `nodes=${ACTIVE_CHECK_HOST_RUSSIA_NODES.join(",") || "none"}`
        );

        const requiredRussiaItems = managedItems.filter((item) => {
            const fp = fingerprintLink(item.link || "");
            return !isLteCandidate(item, candidateMap[fp] || null);
        });

        if (ACTIVE_CHECK_HOST_GATE_QUORUM === 0) {
            for (const item of requiredRussiaItems) {
                const fp = fingerprintLink(item.link || "");
                russiaProbeByFingerprint.set(fp, {
                    required: false,
                    skipped: true,
                    gatePassed: true,
                    gatePending: false,
                    anyReachable: false,
                    reason: "Russia Gate skipped: no usable Russian Check-Host node was available; passed directly to Heavy",
                    warning: true,
                    checkedAt: Date.now(),
                    checkHost: {
                        provider: "check-host",
                        ok: false,
                        unavailable: true,
                        skipped: true,
                        nodesTested: 0,
                        nodesReachable: 0,
                        nodesInconclusive: 0,
                        quorumRequired: 0,
                        quorumMet: false,
                        results: []
                    }
                });
            }

            const skippedReport = {
                generatedAt: new Date().toISOString(),
                generationId: updateStatus.generationId || null,
                manifestSha256,
                candidates: checked,
                requiredCandidates: 0,
                allowedCandidates: 0,
                failedCandidates: 0,
                skippedCandidates: requiredRussiaItems.length,
                checkerMode: "skipped",
                warning: "No Russian Check-Host nodes were available. Russia Gate was skipped; candidates were passed directly to Heavy.",
                checkHostNodes: [],
                configuredCheckHostNodes: CHECK_HOST_RUSSIA_NODES,
                positiveReachabilityRequired: 0,
                nodeStats: CHECK_HOST_RUSSIA_NODES.map(node => ({
                    node,
                    candidateChecks: 0,
                    reachable: 0,
                    inconclusive: 0,
                    timeouts: 0,
                    rateLimited: 0,
                    otherErrors: 0
                })),
                results: managedItems.map(item => ({
                    id: item.id,
                    link: String(item.link || "").trim(),
                    source: candidateMap[fingerprintLink(item.link || "")]?.source || item.source || "retained/manual",
                    country: candidateMap[fingerprintLink(item.link || "")]?.country || "",
                    required: false,
                    gatePassed: true,
                    gatePending: false,
                    skipped: true,
                    checkedAt: Date.now(),
                    probe: russiaProbeByFingerprint.get(fingerprintLink(item.link || ""))
                }))
            };
            await fs.writeFile(RUSSIA_GATE_FILE, `${JSON.stringify(skippedReport, null, 2)}\n`, "utf8");
            console.warn(`⚠️ RUSSIA GATE SKIPPED: no usable Russian Check-Host nodes; ${requiredRussiaItems.length} non-LTE candidates go directly to Heavy`);
            return;
        }

        const endpointGroups = new Map();
        for (const item of requiredRussiaItems) {
            const fp = fingerprintLink(item.link || "");
            const key = russiaGateEndpointKey(item);
            const group = endpointGroups.get(key) || { key, representative: item, members: [] };
            group.members.push({ item, fp });
            endpointGroups.set(key, group);
        }
        const russiaEndpointGroups = [...endpointGroups.values()];
        const russiaGateStartedAt = Date.now();
        let russiaFreshEndpointChecks = 0;
        let russiaCacheHits = 0;
        let russiaCheckHostUnavailable = 0;
        let russiaCheckHostRateLimited = 0;

        // LTE/whitelist entries never enter the Russia Gate. They retain the
        // existing LTE workflow exactly as before this optimization.
        for (const item of managedItems) {
            const fp = fingerprintLink(item.link || "");
            const sourceMeta = candidateMap[fp] || null;
            if (isLteCandidate(item, sourceMeta)) {
                russiaProbeByFingerprint.set(fp, {
                    required: false,
                    skipped: true,
                    gatePassed: true,
                    gatePending: false,
                    reason: "LTE/white-list diagnostic only",
                    checkedAt: Date.now()
                });
            }
        }

        console.log(
            `RUSSIA GATE WORKSET: candidates=${requiredRussiaItems.length}; ` +
            `uniqueEndpointChecks=${russiaEndpointGroups.length}; ` +
            `dedupeSaved=${Math.max(0, requiredRussiaItems.length - russiaEndpointGroups.length)}; ` +
            `positiveReachability=${ACTIVE_CHECK_HOST_GATE_QUORUM}/${ACTIVE_CHECK_HOST_RUSSIA_NODES.length}`
        );

        const freshEndpointGroups = [];
        for (const group of russiaEndpointGroups) {
            const now = Date.now();
            const cacheCandidates = group.members.map(member => {
                const cached = cachedRussiaGate[member.fp];
                const cachedAt = Number(cached?.checkedAt) || 0;
                return RUSSIA_GATE_USE_CACHE && cached &&
                    Number(cached.gateAlgorithmVersion) === RUSSIA_GATE_ALGORITHM_VERSION &&
                    cachedAt > 0 && cachedAt <= now && now - cachedAt < RUSSIA_GATE_STATE_MAX_AGE_MS
                    ? cached
                    : null;
            });

            if (cacheCandidates.length && cacheCandidates.every(Boolean)) {
                const first = cacheCandidates[0];
                const allSameVerdict = cacheCandidates.every(c =>
                    Boolean(c.gatePassed) === Boolean(first.gatePassed) &&
                    Boolean(c.gatePending) === Boolean(first.gatePending)
                );
                if (allSameVerdict) {
                    for (const member of group.members) {
                        russiaProbeByFingerprint.set(member.fp, {
                            ...first,
                            deduplicatedEndpointKey: group.key,
                            fromCache: true
                        });
                        russiaGateChecked += 1;
                        russiaCacheHits += 1;
                        if (first.gatePassed) russiaGatePassed += 1;
                        else if (first.gatePending) russiaGatePending += 1;
                        else russiaGateFailures += 1;
                    }
                    continue;
                }
            }
            freshEndpointGroups.push(group);
        }

        const coordinator = await runRussiaGateEndpointCoordinator(
            freshEndpointGroups,
            { maxInFlight: CHECK_HOST_MAX_IN_FLIGHT }
        );

        const nodeStats = ACTIVE_CHECK_HOST_RUSSIA_NODES.map(node => {
            const stats = { node, candidateChecks: 0, reachable: 0, inconclusive: 0, timeouts: 0, rateLimited: 0, otherErrors: 0 };
            for (const row of russiaProbeByFingerprint.values()) {
                if (!row?.required || !row?.checkHost) continue;
                const nodeResult = Array.isArray(row.checkHost.results)
                    ? row.checkHost.results.find(result => result?.node === node)
                    : null;
                if (!nodeResult) continue;
                stats.candidateChecks += 1;
                if (nodeResult.reachable) stats.reachable += 1;
                if (nodeResult.inconclusive) stats.inconclusive += 1;
                const errorText = String(nodeResult.error || "");
                if (/timeout|timed out|aborted/i.test(errorText)) stats.timeouts += 1;
                if (row.checkHost.rateLimited) stats.rateLimited += 1;
                if (!nodeResult.reachable && !nodeResult.inconclusive && errorText && !/timeout|timed out|aborted/i.test(errorText)) stats.otherErrors += 1;
            }
            return stats;
        });

        const russiaGateDiagnostics = {
            generatedAt: new Date().toISOString(),
            algorithmVersion: RUSSIA_GATE_ALGORITHM_VERSION,
            checkerMode: russiaCheckerMode,
            warning: russiaCheckerMode !== "dual" ? (russiaCheckerMode === "single" ? "Only one Russian Check-Host node was available." : "No Russian Check-Host nodes were available; gate skipped.") : "",
            configuredNodes: ACTIVE_CHECK_HOST_RUSSIA_NODES,
            candidateCount: requiredRussiaItems.length,
            uniqueEndpointChecks: russiaEndpointGroups.length,
            dedupeSaved: Math.max(0, requiredRussiaItems.length - russiaEndpointGroups.length),
            positiveReachabilityRequired: ACTIVE_CHECK_HOST_GATE_QUORUM,
            selectedNodes: ACTIVE_CHECK_HOST_RUSSIA_NODES,
            nodeStats,
            activeWindow: Number(process.env.HEALTHCHECK_RUSSIA_ACTIVE_WINDOW) || 64,
            maxInFlight: CHECK_HOST_MAX_IN_FLIGHT,
            coordinator: {
                elapsedMs: coordinator.elapsedMs,
                createdRequests: coordinator.createdRequests,
                createFailures: coordinator.createFailures,
                unresolved: coordinator.unresolved,
                pendingRequests: coordinator.pendingRequests,
            },
            rateTelemetry: coordinator.rateTelemetry,
        };
        await fs.writeFile(
            RUSSIA_GATE_DIAGNOSTICS_FILE,
            `${JSON.stringify(russiaGateDiagnostics, null, 2)}\n`,
            "utf8"
        );

        for (const group of freshEndpointGroups) {
            let probe = coordinator.outcomes.get(group.key);
            if (!probe) {
                probe = {
                    required: true,
                    skipped: false,
                    gatePassed: false,
                    gatePending: true,
                    reason: "Russia gate coordinator produced no result",
                    providersUnavailable: true,
                    transport: getTransportType(getProtocol(group.representative.link || "")),
                    checkedAt: Date.now()
                };
            }

            russiaFreshEndpointChecks += 1;
            if (probe?.checkHost?.unavailable) russiaCheckHostUnavailable += 1;
            if (probe?.checkHost?.rateLimited) russiaCheckHostRateLimited += 1;

            for (const member of group.members) {
                const memberProbe = { ...probe, deduplicatedEndpointKey: group.key };
                russiaProbeByFingerprint.set(member.fp, memberProbe);
                russiaGateChecked += 1;
                if (memberProbe.gatePassed) russiaGatePassed += 1;
                else if (memberProbe.gatePending) russiaGatePending += 1;
                else russiaGateFailures += 1;
            }
        }

        const elapsedMs = Math.max(1, Date.now() - russiaGateStartedAt);
        const endpointRate = russiaFreshEndpointChecks / (elapsedMs / 1000);
        console.log(
            `RUSSIA GATE COORDINATOR COMPLETE: endpoints=${russiaFreshEndpointChecks}/${russiaEndpointGroups.length}; ` +
            `inFlightMax=${CHECK_HOST_MAX_IN_FLIGHT}; elapsed=${Math.round(elapsedMs / 1000)}s; ` +
            `rate=${endpointRate.toFixed(2)}/s`
        );

        // Every endpoint uses one Check-Host request containing exactly the two
        // geographically distinct Russian nodes selected by preflight. Both
        // definitive reachable results are required for publication; unresolved
        // or failed results remain non-publishable.
        if (russiaGatePending > 0) {
            console.warn(
                `RUSSIA GATE PENDING: ${russiaGatePending} candidate(s) remain unresolved ` +
                `after all bounded Check-Host polling.`
            );
        }

        if (russiaGatePending > 0) {
            throw new Error(
                `Russia gate produced ${russiaGatePending} unresolved candidate(s) after bounded Check-Host polling; ` +
                `no unresolved candidate may enter publication.`
            );
        }

        if (!RUSSIA_GATE_USE_CACHE && russiaFreshEndpointChecks !== russiaEndpointGroups.length) {
            throw new Error(
                `Russia gate did not freshly check every unique required endpoint: ` +
                `${russiaFreshEndpointChecks}/${russiaEndpointGroups.length}`
            );
        }

        for (const [fp, probe] of russiaProbeByFingerprint) {
            if (probe?.checkedAt && !probe.fromCache) {
                cachedRussiaGate[fp] = {
                    ...probe,
                    gateAlgorithmVersion: RUSSIA_GATE_ALGORITHM_VERSION,
                    checkHost: probe.checkHost
                        ? {
                            provider: probe.checkHost.provider,
                            ok: Boolean(probe.checkHost.ok),
                            unavailable: Boolean(probe.checkHost.unavailable),
                            inconclusive: Boolean(probe.checkHost.inconclusive),
                            nodesTested: Number(probe.checkHost.nodesTested) || 0,
                            nodesReachable: Number(probe.checkHost.nodesReachable) || 0,
                            minLatencyMs: Number(probe.checkHost.minLatencyMs) || 0,
                            rateLimited: Boolean(probe.checkHost.rateLimited),
                            error: probe.checkHost.error || "",
                        }
                        : probe.checkHost,
                    globalping: probe.globalping
                        ? {
                            provider: probe.globalping.provider,
                            ok: Boolean(probe.globalping.ok),
                            unavailable: Boolean(probe.globalping.unavailable),
                            inconclusive: Boolean(probe.globalping.inconclusive),
                            skipped: Boolean(probe.globalping.skipped),
                            probesTested: Number(probe.globalping.probesTested) || 0,
                            probesReachable: Number(probe.globalping.probesReachable) || 0,
                            minLatencyMs: Number(probe.globalping.minLatencyMs) || 0,
                            rateLimited: Boolean(probe.globalping.rateLimited),
                            error: probe.globalping.error || "",
                        }
                        : probe.globalping,
                };
            }
        }

        const nextState = {
            ...persistentState,
            russiaGate: cachedRussiaGate,
        };
        await fs.writeFile(HEALTH_STATE_FILE, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");

        const gateResults = managedItems.map(item => {
            const fp = fingerprintLink(item.link || "");
            const probe = russiaProbeByFingerprint.get(fp) || {
                required: true,
                gatePassed: false,
                gatePending: false,
                checkedAt: Date.now(),
                reason: "Russia gate result missing"
            };
            const sourceMeta = candidateMap[fp] || null;
            return {
                id: item.id,
                link: String(item.link || "").trim(),
                source: sourceMeta?.source || item.source || "retained/manual",
                country: sourceMeta?.country || "",
                required: Boolean(probe.required),
                gatePassed: Boolean(probe.gatePassed),
                gatePending: Boolean(probe.gatePending),
                checkedAt: Number(probe.checkedAt) || Date.now(),
                probe,
            };
        });

        await fs.writeFile(
            RUSSIA_GATE_FILE,
            `${JSON.stringify({
                generatedAt: new Date().toISOString(),
                generationId: updateStatus.generationId || null,
                manifestSha256,
                candidates: checked,
                requiredCandidates: gateResults.filter(item => item.required).length,
                allowedCandidates: gateResults.filter(item => item.required && item.gatePassed).length,
                failedCandidates: gateResults.filter(item => item.required && !item.gatePassed && !item.gatePending).length,
                checkerMode: russiaCheckerMode,
                warning: russiaCheckerMode !== "dual" ? (russiaCheckerMode === "single" ? "⚠️ Only one Russian Check-Host node was available; single-node mode used." : "⚠️ No Russian Check-Host nodes were available; Russia Gate was skipped and candidates were passed directly to Heavy.") : "",
                nodeStats,
                cachedResults: gateResults.filter(item => {
                    const age = Date.now() - (Number(item.checkedAt) || 0);
                    return age >= 0 && age < RUSSIA_GATE_STATE_MAX_AGE_MS;
                }).length,
                checkHostNodes: ACTIVE_CHECK_HOST_RUSSIA_NODES,
                 configuredCheckHostNodes: CHECK_HOST_RUSSIA_NODES,
                 globalpingSelectionCount: 0,
                stateMaxAgeMs: RUSSIA_GATE_STATE_MAX_AGE_MS,
                gateAlgorithmVersion: RUSSIA_GATE_ALGORITHM_VERSION,
                results: gateResults,
            }, null, 2)}\n`, "utf8"
        );

        console.log(
            `RUSSIA GATE COMPLETE: ${russiaGatePassed} pass, ${russiaGatePending} pending, ${russiaGateFailures} fail; ` +
            `results written to ${path.relative(ROOT, RUSSIA_GATE_FILE)}`
        );
        return;
    }

    let gateReport;
    try {
        gateReport = JSON.parse(await fs.readFile(RUSSIA_GATE_FILE, "utf8"));
    } catch (error) {
        throw new Error(`Russia gate report is missing or unreadable: ${error?.message || error}`);
    }

    if (gateReport?.manifestSha256 !== manifestSha256) {
        throw new Error(
            `Russia gate manifest mismatch: gate=${gateReport?.manifestSha256 || "missing"}, manifest=${manifestSha256}`
        );
    }

    if (Number(gateReport?.candidates) !== checked) {
        throw new Error(
            `Russia gate candidate mismatch: gate=${gateReport?.candidates || 0}, candidates=${checked}`
        );
    }

    for (const row of Array.isArray(gateReport.results) ? gateReport.results : []) {
        russiaProbeByFingerprint.set(String(row?.link || "") ? fingerprintLink(row.link) : String(row.id || ""), row.probe || row);
    }

    russiaGateChecked = checked;
    russiaGatePassed = Number(gateReport?.allowedCandidates) || 0;
    russiaGateFailures = Number(gateReport?.failedCandidates) || 0;
    russiaGatePending = Math.max(0, Number(gateReport?.requiredCandidates) - russiaGatePassed - russiaGateFailures);

    // Only Russia-passing regular nodes and all LTE/whitelist nodes
    // proceed to the expensive local/Xray/speed health-check. Pending/unknown
    // reachability is deliberately excluded from publication.
    const healthEligibleItems = [];
    for (const item of managedItems) {
        const fp = fingerprintLink(item.link || "");
        const sourceMeta = candidateMap[fp] || null;

        if (isLteCandidate(item, sourceMeta)) {
            healthEligibleItems.push(item);
            continue;
        }

        const probe = russiaProbeByFingerprint.get(fp);
        if (probe?.gatePassed) {
            healthEligibleItems.push(item);
            continue;
        }

        const resolvedCountry = sourceMeta?.country || String(item.remarks || "").replace(/^\S+\s*/, "").replace(/\s+\d+$/, "");
        healthResults.push({
            id: item.id, remarks: item.remarks || "", link: String(item.link || "").trim(),
            configFile: item.configFile || null, sourceKind: item.sourceKind || null, country: resolvedCountry,
            whiteList: false, source: sourceMeta?.source || item.source || "retained/manual", linkFingerprint: fp,
            ok: false, protocol: getProtocol(item.link || ""), stages: "",
            reason: `Russia reachability failed: Check-Host ${probe.checkHost?.nodesReachable || 0}/${probe.checkHost?.nodesTested || 0}; ` +
                `Globalping ${probe.globalping?.probesReachable || 0}/${probe.globalping?.probesTested || 0}`,
            quality: null, connection: null, gaming: null, remote: [], updateConnectivity: null,
            russiaProbe: probe, telegram: null
        });
    }

    console.log(`HEALTH AFTER RUSSIA GATE: ${healthEligibleItems.length}/${checked} candidates continue to Xray + HTTPS + speed`);

    cursor = 0;
    managedItems.splice(0, managedItems.length, ...healthEligibleItems);
    const heavyChecked = managedItems.length;

    const workerCount = Math.min(HEALTH_CONCURRENCY, managedItems.length || 1);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    passed = healthResults.filter(result => result.ok).length;
    failed = healthResults.filter(result => !result.ok).length;

    if (checked > 0 && managedItems.some(item => !MANAGED_WHITE_LIST_RE.test(String(item.id || ""))) && healthResults.filter(result => result.ok && !result.whiteList).length === 0) {
        throw new Error(
            "All Source servers failed health checks; existing generated pool is preserved."
        );
    }

    const healthHistory = await updateHealthHistory(healthResults);
    const updateVpnPool = selectUpdateVpnPool(healthResults, healthHistory, 10);

    const selectedCountries =
        buildCountryHealthPool(healthResults, false);

    // Europe is a permanent visible location but is not part of
    // selectedCountries. Include it in the featured-location target so the
    // configured 15 visible locations (14 country locations + Europe) produce
    // the intended 3 Fast + 3 Gaming feature slots.
    const featuredTargets = calculateFeaturedTargetCounts(
        selectedCountries.length + 1
    );

    console.log(
        `FEATURED TARGETS: ordinaryLocations=${selectedCountries.length}; ` +
        `total=${featuredTargets.total}; fast=${featuredTargets.fast}; gaming=${featuredTargets.gaming}`
    );

    const featured = applyFeaturedRegularBadges(
        managedItems,
        healthResults,
        featuredTargets
    );
    const featuredById = new Map(
        managedItems
            .filter(item => item && MANAGED_REGULAR_RE.test(String(item.id || "")))
            .map(item => [String(item.id), item])
    );
    const featuredFastCountries = new Set(featured.fast.map(item => item.country));
    const featuredFastIds = new Set(featured.fast.map(item => item.id));

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
        new Set([
            ...featuredFastIds,
            ...healthResults
                .filter(result =>
                    result.ok &&
                    !result.whiteList &&
                    selectedRegularFingerprints.has(result.linkFingerprint)
                )
                .map(result => result.id)
        ]);

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
                    ...(result?.source ? { source: result.source } : {}),
                    ...(result?.retained ? { retained: true } : {}),
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
            const result = healthResults.find(
                candidate => candidate.id === id
            );
            const source = String(result?.source || item?.source || "").trim();
            nextIndex.push(
                source
                    ? { ...item, source, ...(result?.retained ? { retained: true } : {}) }
                    : item
            );
        }
    }

    const gamingAssignments =
        await buildGamingAssignments(
            selectedCountries,
            healthResults,
            candidates,
            featuredFastCountries,
            featuredTargets
        );

    await writeGamingAssignments(
        gamingAssignments
    );

    await fs.writeFile(
        UPDATE_VPN_POOL_FILE,
        `${JSON.stringify({
            generatedAt: new Date().toISOString(),
            maxServers: 10,
            servers: updateVpnPool,
        }, null, 2)}\n`,
        "utf8"
    );

    await fs.writeFile(
        path.join(ROOT, 'config', 'source-recommendations.json'),
        `${JSON.stringify({
            generatedAt: new Date().toISOString(),
            fast: featured.fastMeta,
            gaming: featured.gamingMeta,
        }, null, 2)}\n`,
        'utf8'
    );

    const selectedRegularOrder = [
        ...featured.fast.map(item => item.id),
        ...selectedCountries.flatMap(
            country => country.members
                .filter(member => !featuredFastIds.has(member.id))
                .map(member => member.id)
        )
    ].filter((id, index, list) => list.indexOf(id) === index);

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
                    item => {
                        const featuredItem = featuredById.get(String(item.id));
                        if (!featuredItem) return [item.id, item];

                        return [
                            item.id,
                            {
                                ...item,
                                ...(featuredItem.featured
                                    ? { featured: featuredItem.featured }
                                    : {}),
                                ...(Number.isFinite(Number(featuredItem.featuredRank))
                                    ? { featuredRank: Number(featuredItem.featuredRank) }
                                    : {}),
                                ...(featuredItem.featured === 'fast' && featuredItem.remarks
                                    ? { remarks: featuredItem.remarks }
                                    : {})
                            }
                        ];
                    }
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
                !isManagedSourceId(
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

    // HAPP receives the display label from index.json. Keep generated managed
    // .link URIs purely technical by removing upstream URL fragments;
    // source remarks remain available only as metadata.
    for (const item of normalizedIndex) {
        if (!item || !isManagedSourceId(String(item.id || ""))) continue;

        const technicalLink = stripLinkRemark(item.link);
        if (!technicalLink) continue;

        item.link = technicalLink;

        const linkPath = path.join(stageDir, `${item.id}.link`);
        try {
            await fs.writeFile(
                linkPath,
                `${technicalLink}\n`,
                "utf8"
            );
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }

    const allowedManagedIds = new Set(
        normalizedIndex
            .filter(item => isManagedSourceId(item?.id))
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
            isManagedSourceId(id) &&
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

    const reportFile = path.join(ROOT, "source-report.json");
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
            mlabLocateUrl: MLAB_LOCATE_URL,
        },
        russiaReachability: {
            gatedNonLte: true,
            lteDiagnosticOnly: true,
            checkHostNodes: Array.isArray(gateReport?.checkHostNodes)
                ? gateReport.checkHostNodes
                : CHECK_HOST_RUSSIA_NODES,
            checkHostTimeoutMs: CHECK_HOST_TIMEOUT_MS,
            checkHostPollingMs: CHECK_HOST_POLL_MS,
            checkHostMaxPollingMs: CHECK_HOST_MAX_POLL_MS,
            checkHostCreateMinIntervalMs: CHECK_HOST_CREATE_MIN_INTERVAL_MS,
            checkHostResultMinIntervalMs: CHECK_HOST_RESULT_MIN_INTERVAL_MS,
            checkHostConcurrency: CHECK_HOST_CONCURRENCY,
            globalpingTokenConfigured: Boolean(GLOBALPING_TOKEN),
            globalpingDiagnosticOnly: true,
            globalpingFreeTestBudget: GLOBALPING_MAX_CANDIDATES_PER_CYCLE,
            globalpingMaxCandidatesPerCycle: GLOBALPING_MAX_CANDIDATES_PER_CYCLE,
            globalpingProbeLimit: GLOBALPING_PROBE_LIMIT,
            russiaGatePassed,
            russiaGateFailures,
            russiaGatePending,
            policy: "Russia Gate uses the preferred geographically independent checker pairs ru2+ru3, then ru1+ru3, then ru1+ru2. With two live nodes, both must positively verify the candidate; with one live node, that node is used in warning mode; with zero live nodes, Russia Gate is skipped and candidates proceed directly to Heavy. Check-Host 429/5xx/timeout or unresolved results are UNKNOWN/PENDING and never an automatic PASS while a checker is available. Globalping is diagnostics-only and cannot affect gate decisions. LTE/whitelist candidates are exempt from the Russia gate."
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
            maxServersPerCountry:
                GAMING_SERVERS_PER_COUNTRY,
                FAST_SERVERS_PER_COUNTRY,
            backupMaxLatencyMs:
                GAMING_BACKUP_MAX_LATENCY_MS,
            backupMaxLatencySpreadMs:
                GAMING_BACKUP_MAX_LATENCY_SPREAD_MS,
            backupMinQualityPasses:
                GAMING_BACKUP_MIN_QUALITY_PASSES,
        },
        quarantine: {
            durationMinutes: 90,
            policy: "failed endpoints are hidden from the active subscription immediately, but are not permanently blacklisted and may return after a later successful health check",
        },
        results: healthResults,
    };
    report.finalManagedServers = normalizedIndex.filter(item => isManagedSourceId(item?.id)).length;

    const finalFingerprints = new Set(
        normalizedIndex
            .filter(item => isManagedSourceId(item?.id))
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
        updateVpnPool:
            updateVpnPool.map(item => ({
                id: item.id,
                country: item.country,
                score: item.score,
                stabilityScore: item.stabilityScore,
                consecutiveHealthyCycles: item.consecutiveHealthyCycles,
                successRate: item.successRate,
                recentFailures: item.recentFailures,
                currentHealth: item.currentHealth,
            })),
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

    // Human-facing source stats: exactly three numbers per source.
    // `slot` is the processing slot (the LAST number in SOURCE_URL..._<slot>).
    // The prefix is retained as the operator-facing source identifier.
    const sourceLabels = new Set([
        ...(report.sourceFetches || []).map(row => row.label),
        ...Object.keys(report.healthCheckBySource || {}),
        ...Object.keys(report.sourceCandidateCounts || {}),
    ]);

    const sourceStats = [...sourceLabels]
        .filter(Boolean)
        .filter(label => label !== "retained" && label !== "retained/manual")
        .map(label => {
            const match = /^SOURCE_URL(?:([0-9]+))?_(\d+)$/i.exec(label);
            const slot = match ? Number(match[2]) : null;
            const origin = match?.[1] ? Number(match[1]) : null;
            const fetchRow = (report.sourceFetches || []).find(row => row.label === label);
            const fetched = Number(
                report.sourceCandidateCounts?.[label]?.raw ??
                fetchRow?.rawCount ??
                0
            ) || 0;
            const alive = Number(report.healthCheckBySource?.[label]?.passed || 0);
            const final = normalizedIndex.filter(item =>
                isManagedSourceId(item?.id) &&
                item.source === label
            ).length;

            return {
                label,
                slot,
                origin,
                name: fetchRow?.originName || formatSourceOrigin(fetchRow?.url),
                fetched,
                alive,
                final,
                failedToFetch: fetchRow?.status === "failed",
            };
        })
        .sort((a, b) => {
            const as = Number.isFinite(a.slot) ? a.slot : 999;
            const bs = Number.isFinite(b.slot) ? b.slot : 999;
            if (as !== bs) return as - bs;
            return a.label.localeCompare(b.label);
        });

    report.sourceStats = sourceStats;

    const readmeLines = [
        "# VPN source report",
        "",
        `Последнее обновление: ${new Date().toISOString()}`,
        "",
        "Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.",
        "",
        `🧠 Из памяти предыдущего пула сохранено: **${report.retainedFromPreviousPool ?? 0}** серверов.`,
        "",
        "## Источники",
        "",
        "| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |",
        "|---|---|---:|---:|---:|---:|---|",
    ];

    for (const row of sourceStats) {
        const failed = row.failedToFetch;
        const attention = failed || (row.fetched > 0 && row.alive === 0) ? "⚠️" : "✅";
        const slot = Number.isFinite(row.slot) ? row.slot : "?";
        readmeLines.push(
            `| **${row.label}** | ${row.name || "—"} | ${slot} | ${row.fetched} | ${row.alive} | ${row.final} | ${attention} |`
        );
    }

    if (!sourceStats.length) {
        readmeLines.push("| — | — | 0 | 0 | 0 | ⚠️ нет настроенных источников |");
    }

    try {
        const gateReportForReadme = JSON.parse(await fs.readFile(RUSSIA_GATE_FILE, "utf8"));
        const mode = String(gateReportForReadme?.checkerMode || "").trim();
        const modeLabel = mode === "dual" ? "2 независимые точки" : mode === "single" ? "1 российская точка (⚠️)" : mode === "skipped" ? "ПРОПУЩЕН (⚠️)" : "неизвестно";
        readmeLines.push("", "## 🇷🇺 Russia Gate", "", `**Режим:** ${modeLabel}.`);
        if (gateReportForReadme?.warning) readmeLines.push(`**Предупреждение:** ${gateReportForReadme.warning}`);
        readmeLines.push(
            `Проверено кандидатов: **${Number(gateReportForReadme.requiredCandidates || 0) + Number(gateReportForReadme.skippedCandidates || 0)}**; ` +
            `прошли: **${Number(gateReportForReadme.allowedCandidates || 0)}**; ` +
            `отброшены: **${Number(gateReportForReadme.failedCandidates || 0)}**; ` +
            `pending: **${Math.max(0, Number(gateReportForReadme.requiredCandidates || 0) - Number(gateReportForReadme.allowedCandidates || 0) - Number(gateReportForReadme.failedCandidates || 0))}**.`,
            "",
            "| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |",
            "|---|---:|---:|---:|---:|---:|---:|"
        );
        for (const stat of Array.isArray(gateReportForReadme.nodeStats) ? gateReportForReadme.nodeStats : []) {
            readmeLines.push(`| ${stat.node} | ${stat.candidateChecks || 0} | ${stat.reachable || 0} | ${stat.inconclusive || 0} | ${stat.timeouts || 0} | ${stat.rateLimited || 0} | ${stat.otherErrors || 0} |`);
        }
        if (!Array.isArray(gateReportForReadme.nodeStats) || gateReportForReadme.nodeStats.length === 0) {
            readmeLines.push("| — | 0 | 0 | 0 | 0 | 0 | 0 |");
        }
    } catch {
        // Russia Gate report is optional for older repositories/runs.
    }

    readmeLines.push(
        "",
        "## Правила слотов",
        "",
        "**Слоты 1–8** — обычные источники.",
        "**Слоты 9–15** — whitelist / LTE-источники.",
        "",
        "У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**",
        "",
        "Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.",
    );
    await fs.writeFile(path.join(ROOT, "README.md"), `${readmeLines.join("\n")}\n`, "utf8");

    if (process.env.GITHUB_STEP_SUMMARY) {
        const lines = [
            "## Source refresh report",
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
        `Source health check complete: ${passed} passed, ${failed} removed.`
    );
}

main().catch(
    error => {
        console.error(
            `Source health check failed: ${error.message}`
        );

        process.exitCode =
            1;
    }
);
