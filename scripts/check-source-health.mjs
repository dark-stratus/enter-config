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


const GLOBALPING_TOKEN = String(
    process.env.RUSSIA_TEST_GLOBALPING_TOKEN ||
    process.env.HEALTHCHECK_GLOBALPING_API_TOKEN ||
    process.env.GLOBALPING_API_TOKEN ||
    ""
).trim();
const RUSSIA_GATE_STATE_MAX_AGE_MS = Math.max(5 * 60 * 1000, Number(process.env.HEALTHCHECK_RUSSIA_GATE_STATE_MAX_AGE_MS) || 6 * 60 * 60 * 1000);
const RUSSIA_GATE_USE_CACHE =
    /^(1|true|yes)$/i.test(
        String(process.env.HEALTHCHECK_RUSSIA_GATE_USE_CACHE || "0").trim()
    );
// Bump whenever the gate semantics change so old cached verdicts cannot be
// reused after changing providers or reachability rules.
const RUSSIA_GATE_ALGORITHM_VERSION = Math.max(1, Number(process.env.HEALTHCHECK_RUSSIA_GATE_ALGORITHM_VERSION) || 34);
// Russia Gate is deliberately single-process. A per-shard limiter would create
// multiple independent API streams and can trigger Check-Host 429 responses.
const RUSSIA_GATE_SHARD_INDEX = 0;
const RUSSIA_GATE_SHARD_COUNT = 1;
const RUSSIA_GATE_SHARD_OUTPUT = "";
const RUSSIA_GATE_SHARD_MODE = false;
const CHECK_HOST_CONCURRENCY = Math.max(2, Math.min(12, Number(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_CONCURRENCY) || 6));
const CHECK_HOST_MAX_IN_FLIGHT = Math.max(2, Math.min(12, Number(process.env.HEALTHCHECK_RUSSIA_MAX_IN_FLIGHT) || CHECK_HOST_CONCURRENCY));

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
const FEATURED_EXCLUDED_COUNTRIES = new Set(["russia"]);

// Europe is a permanent visible location and therefore counts toward the
// Fast/Gaming thresholds used for the final subscription layout.
function calculateFeaturedTargetCounts(visibleLocationCount) {
    const count = Math.max(0, Number(visibleLocationCount) || 0);

    if (count > 15) {
        return { total: 6, fast: 3, gaming: 3 };
    }

    if (count > 10) {
        return { total: 4, fast: 2, gaming: 2 };
    }

    if (count > 5) {
        return { total: 2, fast: 1, gaming: 1 };
    }

    return { total: 0, fast: 0, gaming: 0 };
}
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

const HEALTH_MIN_TARGET_PASSES = Math.max(
    1,
    Math.min(
        HEALTH_TARGET_URLS.length,
        Number(process.env.HEALTHCHECK_MIN_TARGET_PASSES) || 2
    )
);


// LTE Russia checker v3 — production-integrated implementation.
// This is intentionally kept inside the existing source health checker so the
// experimental repository can be deleted without affecting production.
let runLteRussiaCheckerV3;

{
const CHECK_HOST_BASE = String(process.env.RUSSIA_TEST_CHECK_HOST_BASE || "https://check-host.net").replace(/\/$/, "");
const CORE_NODES = String(process.env.RUSSIA_TEST_CORE_NODES || "ru1.node.check-host.net,ru2.node.check-host.net,ru3.node.check-host.net")
  .split(/[\s,;]+/).map(v => v.trim()).filter(Boolean);
const STRONG_QUORUM = Math.max(1, Math.min(CORE_NODES.length, Number(process.env.RUSSIA_TEST_STRONG_QUORUM) || 2));
const MIN_PASS_NODES = Math.max(1, Math.min(CORE_NODES.length, Number(process.env.RUSSIA_TEST_MIN_PASS_NODES) || 1));
const RECHECK_NONPASS = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_RECHECK_NONPASS || "1"));
const DISCOVER_CHECK_HOST_RU = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_DISCOVER_CHECK_HOST_RU || "1"));

const CREATE_TIMEOUT_MS = Math.max(5000, Number(process.env.RUSSIA_TEST_CREATE_TIMEOUT_MS) || 12000);
const RESULT_TIMEOUT_MS = Math.max(3000, Number(process.env.RUSSIA_TEST_RESULT_TIMEOUT_MS) || 6000);
const POLL_MS = Math.max(700, Number(process.env.RUSSIA_TEST_POLL_MS) || 1200);
const MAX_POLL_MS = Math.max(POLL_MS, Number(process.env.RUSSIA_TEST_MAX_POLL_MS) || 16000);
const CREATE_INTERVAL_MS = Math.max(800, Number(process.env.RUSSIA_TEST_CREATE_INTERVAL_MS) || 1400);
const CONCURRENCY = Math.max(1, Math.min(3, Number(process.env.RUSSIA_TEST_CONCURRENCY) || 2));
const RETRIES = Math.max(3, Math.min(8, Number(process.env.RUSSIA_TEST_RETRIES) || 6));

const GLOBALPING_ENABLED = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_GLOBALPING || "1"));
const GLOBALPING_RECOVERY_ENABLED = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_GLOBALPING_RECOVERY || "1"));
const GLOBALPING_BASE = String(process.env.RUSSIA_TEST_GLOBALPING_BASE || "https://api.globalping.io/v1").replace(/\/$/, "");
const GLOBALPING_TOKEN = String(process.env.RUSSIA_TEST_GLOBALPING_TOKEN || process.env.GLOBALPING_API_TOKEN || "").trim();
const GLOBALPING_CITY_LIMIT = Math.max(3, Math.min(12, Number(process.env.RUSSIA_TEST_GLOBALPING_CITY_LIMIT) || 9));
const GLOBALPING_RECOVERY_CITY_LIMIT = Math.max(2, Math.min(6, Number(process.env.RUSSIA_TEST_GLOBALPING_RECOVERY_CITY_LIMIT) || 3));
const GLOBALPING_RECOVERY_MIN_DISTINCT_CITIES = Math.max(2, Math.min(GLOBALPING_RECOVERY_CITY_LIMIT, Number(process.env.RUSSIA_TEST_GLOBALPING_MIN_DISTINCT_CITIES) || 2));
const GLOBALPING_RECOVERY_REQUIRE_EYEBALL = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_GLOBALPING_REQUIRE_EYEBALL || "1"));
const GLOBALPING_RECOVERY_TCP_ONLY = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_GLOBALPING_TCP_ONLY || "1"));
const GLOBALPING_RECOVERY_MAX_ENDPOINTS = Math.max(1, Math.min(164, Number(process.env.RUSSIA_TEST_GLOBALPING_MAX_RECOVERY_ENDPOINTS) || 164));
const GLOBALPING_RECOVERY_RESERVE_TESTS = Math.max(0, Number(process.env.RUSSIA_TEST_GLOBALPING_RESERVE_TESTS) || 10);
const GLOBALPING_RECOVERY_CONCURRENCY = 1;
const GLOBALPING_POLL_MS = Math.max(500, Number(process.env.RUSSIA_TEST_GLOBALPING_POLL_MS) || 700);
const GLOBALPING_TIMEOUT_MS = Math.max(10000, Number(process.env.RUSSIA_TEST_GLOBALPING_TIMEOUT_MS) || 30000);
const GLOBALPING_MTR_TIMEOUT_SECONDS = Math.max(5, Math.min(20, Number(process.env.RUSSIA_TEST_GLOBALPING_MTR_TIMEOUT_SECONDS) || 12));
const HOSTTOOLS_ENABLED = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_HOSTTOOLS || "1"));
const HOSTTOOLS_BASE = String(process.env.RUSSIA_TEST_HOSTTOOLS_BASE || "https://host.tools").replace(/\/$/, "");
const HOSTTOOLS_MAX_REQUESTS = Math.max(1, Math.min(90, Number(process.env.RUSSIA_TEST_HOSTTOOLS_MAX_REQUESTS) || 80));
const HOSTTOOLS_RESERVE_REQUESTS = Math.max(0, Math.min(20, Number(process.env.RUSSIA_TEST_HOSTTOOLS_RESERVE_REQUESTS) || 15));
const HOSTTOOLS_REQUEST_INTERVAL_MS = Math.max(350, Number(process.env.RUSSIA_TEST_HOSTTOOLS_REQUEST_INTERVAL_MS) || 650);
const HOSTTOOLS_TIMEOUT_MS = Math.max(7000, Number(process.env.RUSSIA_TEST_HOSTTOOLS_TIMEOUT_MS) || 15000);
const HOSTTOOLS_RU_STRONG_CITIES = Math.max(2, Number(process.env.RUSSIA_TEST_HOSTTOOLS_RU_STRONG_CITIES) || 2);
const HOSTTOOLS_EXCLUDE_CITIES = new Set(["moscow", "saint petersburg", "st petersburg", "st. petersburg", "санкт-петербург"]);
const XRAY_ENABLED = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_XRAY || "1"));
const XRAY_BIN = path.resolve(ROOT, process.env.RUSSIA_TEST_XRAY_BIN || ".xray/xray");
const XRAY_START_TIMEOUT_MS = Math.max(5000, Number(process.env.RUSSIA_TEST_XRAY_START_TIMEOUT_MS) || 12000);
const XRAY_REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.RUSSIA_TEST_XRAY_REQUEST_TIMEOUT_MS) || 9000);
const XRAY_LINK_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.RUSSIA_TEST_XRAY_LINK_CONCURRENCY) || 3));
const XRAY_LINK_ATTEMPTS = Math.max(1, Math.min(2, Number(process.env.RUSSIA_TEST_XRAY_LINK_ATTEMPTS) || 2));
const XRAY_RETRY_DELAY_MS = Math.max(300, Number(process.env.RUSSIA_TEST_XRAY_RETRY_DELAY_MS) || 1200);
const XRAY_TARGETS = String(
  process.env.RUSSIA_TEST_XRAY_TARGETS ||
  "https://www.gstatic.com/generate_204,https://www.cloudflare.com/cdn-cgi/trace"
).split(/\s*,\s*/).map(v => v.trim()).filter(Boolean);
const XRAY_ONLY_ON_TRANSPORT_PASS = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_XRAY_ONLY_ON_TRANSPORT_PASS || "1"));
const XRAY_SPEED_FALLBACK_ENABLED = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_XRAY_SPEED_FALLBACK || "1"));
const XRAY_SPEED_FALLBACK_URL =
  process.env.RUSSIA_TEST_XRAY_SPEED_URL ||
  "https://speed.cloudflare.com/__down?bytes=4194304";
const XRAY_SPEED_FALLBACK_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.RUSSIA_TEST_XRAY_SPEED_TIMEOUT_MS) || 9000
);
const XRAY_SPEED_FALLBACK_MIN_BYTES = Math.max(
  64 * 1024,
  Number(process.env.RUSSIA_TEST_XRAY_SPEED_MIN_BYTES) || 256 * 1024
);
const XRAY_SPEED_FALLBACK_MIN_KBPS = Math.max(
  64,
  Number(process.env.RUSSIA_TEST_XRAY_SPEED_MIN_KBPS) || 1024
);

const PRIORITY_RUSSIA_CITIES = [
  "Moscow", "Saint Petersburg", "Yekaterinburg", "Kazan", "Novosibirsk",
  "Nizhny Novgorod", "Samara", "Krasnodar", "Rostov-on-Don", "Ufa", "Perm", "Voronezh",
];

const SCOPE = "lte";
const DRY_RUN = false;
const SELF_TEST = /^(1|true|yes)$/i.test(String(process.env.RUSSIA_TEST_SELF_TEST || "0"));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }

function protocolOf(link) {
  return String(link || "").split("://", 1)[0].trim().toLowerCase();
}

function transportOf(protocol) {
  return ["hysteria", "hysteria2", "tuic"].includes(String(protocol).toLowerCase()) ? "udp" : "tcp";
}

function isLte(item) {
  return Boolean(item?.whiteList === true || /^source-whitelist-\d+$/i.test(String(item?.id || "")));
}

function parseUrl(link) {
  const url = new URL(String(link).trim());
  const protocol = protocolOf(link);
  const port = Number(url.port || 443);
  return { url, protocol, transport: transportOf(protocol), host: url.hostname, port };
}

function endpointKey(link) {
  const { host, port, transport } = parseUrl(link);
  return `${transport}|${String(host).toLowerCase()}|${port}`;
}

function targetForCheckHost(url, port) {
  const host = String(url.hostname || "");
  const hostPart = host.includes(":") ? `[${host}]` : host;
  return `${hostPart}:${port || Number(url.port || 443)}`;
}

function authHeaders(extra = {}) {
  return {
    accept: "application/json",
    "user-agent": "escapevpn-russia-checker-experiment-v3/1.0",
    "accept-encoding": "gzip",
    ...extra,
  };
}

async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: authHeaders(options.headers || {}) });
    const retryAfterMs = Number(response.headers.get("retry-after")) * 1000 || 0;
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      const msg = body?.error?.message || body?.error || body?.message || `HTTP ${response.status}`;
      const error = new Error(String(msg));
      error.status = response.status;
      error.retryAfterMs = retryAfterMs;
      throw error;
    }
    if (body === null && text) {
      const error = new Error(`non-JSON response (${response.status})`);
      error.status = response.status;
      error.retryAfterMs = retryAfterMs;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, attempts = RETRIES) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await fn(attempt); }
    catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 408 || status === 429 || status >= 500 || /aborted|timeout|timed out|fetch failed/i.test(String(error?.message || ""));
      if (!retryable || attempt + 1 >= attempts) throw error;
      const retryAfter = Number(error?.retryAfterMs || 0);
      const backoff = Math.max(1200, 1500 * 2 ** attempt);
      await sleep(retryAfter > 0 ? Math.max(backoff, retryAfter) : backoff);
    }
  }
  throw lastError || new Error("retry failed");
}

let lastHostToolsRequestAt = 0;
let hostToolsRequestsUsed = 0;
async function throttleHostToolsRequest() {
  const wait = HOSTTOOLS_REQUEST_INTERVAL_MS - (Date.now() - lastHostToolsRequestAt);
  if (wait > 0) await sleep(wait);
  lastHostToolsRequestAt = Date.now();
}

async function fetchHostToolsStream(url, timeoutMs = HOSTTOOLS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: authHeaders({ accept: "text/event-stream, application/json" }),
    });
    const text = await response.text();
    const retryAfterMs = Number(response.headers.get("retry-after")) * 1000 || 0;
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfterMs = retryAfterMs;
      throw error;
    }
    try {
      const body = JSON.parse(text);
      return { envelope: body, events: [body] };
    } catch {}
    const events = [];
    let current = [];
    const flush = () => {
      if (!current.length) return;
      const dataText = current.filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
      if (dataText) {
        try { events.push(JSON.parse(dataText)); } catch {}
      }
      current = [];
    };
    for (const line of text.split(/\r?\n/)) {
      if (line === "") flush();
      else if (!line.startsWith(":")) current.push(line);
    }
    flush();
    if (!events.length) throw new Error("host.tools returned no JSON/SSE events");
    return { envelope: events[0], events };
  } finally {
    clearTimeout(timer);
  }
}

const HOSTTOOLS_KNOWN_RU_CITIES = [
  "Yekaterinburg", "Ekaterinburg", "Екатеринбург", "Kazan", "Казань", "Novosibirsk", "Новосибирск",
  "Krasnodar", "Краснодар", "Rostov-on-Don", "Ростов-на-Дону", "Ufa", "Уфа", "Perm", "Пермь",
  "Nizhny Novgorod", "Нizhny Novgorod", "Нижний Новгород", "Samara", "Самара", "Voronezh", "Воронеж",
  "Chelyabinsk", "Челябинск", "Omsk", "Омск", "Vladivostok", "Владивосток", "Irkutsk", "Иркутск",
  "Krasnoyarsk", "Красноярск", "Tyumen", "Тюмень", "Saratov", "Саратов", "Volgograd", "Волгоград",
  "Tomsk", "Томск", "Barnaul", "Барнаул", "Naberezhnye Chelny", "Набережные Челны",
];
function hostToolsLocationText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return [value.name, value.city, value.region, value.country, value.location, value.probe, value.provider]
    .filter(v => typeof v === "string").join(" ");
}
function hostToolsCountry(value, locationText = "") {
  const text = `${String(value || "")} ${locationText}`.trim().toLowerCase();
  if (/\b(?:ru|rus|russia|russian federation)\b|росси|рф/.test(text)) return true;
  return HOSTTOOLS_KNOWN_RU_CITIES.some(city => text.includes(city.toLowerCase()));
}
function hostToolsCity(value, locationText = "") {
  const explicit = String(value || "").trim().replace(/\s+/g, " ");
  if (explicit) return explicit;
  const text = String(locationText || "").replace(/\s+/g, " ");
  for (const city of HOSTTOOLS_KNOWN_RU_CITIES) if (text.toLowerCase().includes(city.toLowerCase())) return city;
  return text.split(",")[0]?.trim() || text.trim();
}
function hostToolsObservationRows(value, rows = [], seen = new Set(), depth = 0) {
  if (depth > 6 || value == null || typeof value !== "object" || seen.has(value)) return rows;
  seen.add(value);
  if (Array.isArray(value)) { for (const item of value) hostToolsObservationRows(item, rows, seen, depth + 1); return rows; }
  const location = value.location && typeof value.location === "object" ? value.location : null;
  const locationText = hostToolsLocationText(value.location) || hostToolsLocationText(value);
  const city = hostToolsCity(value.city ?? location?.city ?? value.region?.city ?? value.place?.city, locationText);
  const country = String(value.country ?? location?.country ?? value.region?.country ?? value.place?.country ?? "");
  const combined = `${locationText} ${hostToolsLocationText(value)}`.trim();
  const status = String(value.status ?? value.state ?? value.verdict ?? value.result ?? value.outcome ?? value.portStatus ?? "").trim().toLowerCase();
  const ok = value.ok === true || value.success === true || value.reachable === true || value.open === true || value.connected === true;
  if (city && hostToolsCountry(country, combined)) rows.push({ city, country: country || "RU", ok, status, latencyMs: Number(value.latencyMs ?? value.latency ?? value.rtt ?? value.connectMs ?? 0) || 0, raw: value });
  for (const nested of Object.values(value)) if (nested && typeof nested === "object") hostToolsObservationRows(nested, rows, seen, depth + 1);
  return rows;
}
function hostToolsRowPassed(row) {
  const status = String(row?.status || "").toLowerCase();
  if (row?.ok === true) return true;
  return /\b(open|opened|reachable|success|successful|up|connected|ok)\b/.test(status);
}
function summarizeHostToolsEvents(events) {
  const byCity = new Map();
  for (const row of hostToolsObservationRows(events)) {
    const key = row.city.toLowerCase();
    const current = byCity.get(key) || { city: row.city, attempts: 0, passed: 0, bestLatencyMs: 0, statuses: [] };
    current.attempts += 1;
    if (hostToolsRowPassed(row)) { current.passed += 1; if (!current.bestLatencyMs || (row.latencyMs > 0 && row.latencyMs < current.bestLatencyMs)) current.bestLatencyMs = row.latencyMs; }
    if (row.status) current.statuses.push(row.status);
    byCity.set(key, current);
  }
  const cities = [...byCity.values()].map(row => ({ ...row, passed: row.passed > 0, nonCore: !HOSTTOOLS_EXCLUDE_CITIES.has(row.city.toLowerCase()) }));
  const russianPassedCities = cities.filter(row => row.nonCore && row.passed);
  return { cities: cities.sort((a,b) => Number(b.passed)-Number(a.passed) || a.city.localeCompare(b.city)), russianPassedCities, passedOtherCities: russianPassedCities.length };
}
async function runHostToolsTcp(endpoint) {
  if (!HOSTTOOLS_ENABLED || DRY_RUN) return { verdict: "SKIPPED-HOSTTOOLS", endpoint: endpoint.key };
  if (endpoint.transport !== "tcp") return { verdict: "SKIPPED-HOSTTOOLS-UDP", endpoint: endpoint.key, cities: [] };
  const { host, port } = parseUrl(endpoint.link);
  const target = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
  const url = `${HOSTTOOLS_BASE}/api/v1/network/tcp?q=${encodeURIComponent(target)}`;
  if (hostToolsRequestsUsed >= Math.max(0, HOSTTOOLS_MAX_REQUESTS - HOSTTOOLS_RESERVE_REQUESTS)) return { verdict: "SKIPPED-HOSTTOOLS-BUDGET", endpoint: endpoint.key, url, cities: [], passedOtherCities: 0 };
  await throttleHostToolsRequest();
  hostToolsRequestsUsed += 1;
  try {
    const payload = await fetchHostToolsStream(url, HOSTTOOLS_TIMEOUT_MS);
    const summary = summarizeHostToolsEvents(payload.events || [payload.envelope]);
    const verdict = summary.passedOtherCities >= HOSTTOOLS_RU_STRONG_CITIES ? "PASS-HOSTTOOLS-STRONG" : summary.passedOtherCities >= 1 ? "PASS-HOSTTOOLS" : "FAIL-HOSTTOOLS";
    return { verdict, endpoint: endpoint.key, url, cities: summary.cities, russianPassedCities: summary.russianPassedCities, passedOtherCities: summary.passedOtherCities, source: "host.tools" };
  } catch (error) {
    return { verdict: Number(error?.status || 0) === 429 ? "RATE-LIMIT-HOSTTOOLS" : "UNKNOWN-HOSTTOOLS", endpoint: endpoint.key, url, status: Number(error?.status || 0), error: error?.message || String(error), cities: [], russianPassedCities: [], passedOtherCities: 0 };
  }
}
function chooseHostToolsRecoveryTargets(endpointRows, xrayById) {
  return [...endpointRows]
    .filter(endpoint => endpoint.transport === "tcp")
    .filter(endpoint => {
      const members = Array.isArray(endpoint?.members) ? endpoint.members : [];
      return !members.some(member =>
        ["PASS-XRAY", "PASS-XRAY-CLOUDFLARE"].includes(
          xrayById.get(String(member?.id))?.verdict
        )
      );
    })
    .sort((a,b) => {
    const rank = endpoint => ({ FAIL:4, UNKNOWN:3, "PASS-PARTIAL":2 }[String(endpoint.verdict)] || 1);
    return rank(b)-rank(a) || a.key.localeCompare(b.key);
  });
}
async function runHostToolsRecoveryPass(endpointRows, items, xrayById) {
  if (!HOSTTOOLS_ENABLED || DRY_RUN) return { attempted: 0, recovered: 0, strongRecovered: 0, skipped: "disabled", endpoints: [] };
  const budget = Math.max(0, Math.min(endpointRows.filter(e => e.transport === "tcp").length, HOSTTOOLS_MAX_REQUESTS - HOSTTOOLS_RESERVE_REQUESTS));
  const targets = chooseHostToolsRecoveryTargets(endpointRows, xrayById).slice(0, budget);
  const rows = []; let rateLimited = false;
  for (let index=0; index<targets.length; index++) {
    const result = await runHostToolsTcp(targets[index]);
    targets[index].hostToolsRecovery = result;
    if (["PASS-HOSTTOOLS","PASS-HOSTTOOLS-STRONG"].includes(result.verdict)) targets[index].hostToolsVerdict = result.verdict;
    rows.push({ key: targets[index].key, verdict: result.verdict, passedOtherCities: result.passedOtherCities || 0, cities: result.cities || [], error: result.error || "" });
    console.log(`RUSSIA TEST V3 HOSTTOOLS ${index+1}/${targets.length}: ${targets[index].key} => ${result.verdict} (${result.passedOtherCities||0} other-RU cities)`);
    if (result.verdict === "RATE-LIMIT-HOSTTOOLS") { rateLimited=true; break; }
  }
  return { attempted: rows.length, recovered: rows.filter(r => ["PASS-HOSTTOOLS","PASS-HOSTTOOLS-STRONG"].includes(r.verdict)).length, strongRecovered: rows.filter(r=>r.verdict==="PASS-HOSTTOOLS-STRONG").length, skipped: rateLimited ? "stopped-on-rate-limit" : "", endpoints: rows, maxRequests: HOSTTOOLS_MAX_REQUESTS, reserveRequests: HOSTTOOLS_RESERVE_REQUESTS, requestsUsed: hostToolsRequestsUsed, rateLimited };
}

let lastCreateAt = 0;
async function throttleCreate() {
  const wait = CREATE_INTERVAL_MS - (Date.now() - lastCreateAt);
  if (wait > 0) await sleep(wait);
  lastCreateAt = Date.now();
}

function extractErrorText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractErrorText).filter(Boolean).join(" | ");
  if (typeof value === "object") return [value.error, value.message, value.status].map(extractErrorText).filter(Boolean).join(" | ");
  return String(value);
}

function parseNodeResult(raw, node, transport) {
  if (raw == null) return { node, state: "pending", raw: null, latencyMs: 0 };
  const text = extractErrorText(raw);
  const jsonText = JSON.stringify(raw);

  if (transport === "udp") {
    if (/connection refused|port unreachable|udp.*unreachable|network is unreachable/i.test(`${text} ${jsonText}`)) {
      return { node, state: "refused", raw, error: text || "connection refused", latencyMs: 0 };
    }
    if (/open or filtered|filtered/i.test(`${text} ${jsonText}`)) {
      return { node, state: "udp-filtered", raw, error: text || "open or filtered", latencyMs: 0 };
    }
    if (Array.isArray(raw)) {
      const flat = raw.flat(Infinity);
      const flatText = extractErrorText(flat);
      if (/connection refused|port unreachable|unreachable/i.test(flatText)) return { node, state: "refused", raw, error: flatText, latencyMs: 0 };
      if (/open or filtered|filtered/i.test(flatText)) return { node, state: "udp-filtered", raw, error: flatText, latencyMs: 0 };
      if (flat.length === 0 || flat.every(v => v == null)) return { node, state: "pending", raw, latencyMs: 0 };
    }
    // Check-Host's UDP semantics intentionally cannot prove an application handshake.
    // Any final result that is not an explicit UDP refusal is kept for manual HAPP validation.
    if (/timeout|timed out|no response|no answer/i.test(`${text} ${jsonText}`)) {
      return { node, state: "udp-filtered", raw, error: text || "open or filtered", latencyMs: 0 };
    }
    return { node, state: "udp-filtered", raw, error: text || "open or filtered", latencyMs: 0 };
  }

  // Check-Host TCP returns an array like [{"time":0.03,"address":"..."}] per its API.
  // v2 incorrectly treated that array as an opaque value and marked every successful
  // TCP endpoint as unreachable. Always inspect the first concrete result object.
  const first = Array.isArray(raw) ? raw.find(value => value && typeof value === "object") : raw;
  if (first && typeof first === "object" && Number.isFinite(Number(first.time))) {
    return { node, state: "reachable", raw, latencyMs: Number(first.time) * 1000 };
  }
  const firstError = first && typeof first === "object" ? String(first.error || first.message || "") : "";
  if (/connection refused|unreachable|timed out|timeout|no route/i.test(`${firstError} ${text} ${jsonText}`)) {
    return { node, state: "unreachable", raw, error: text || "unreachable", latencyMs: 0 };
  }
  return { node, state: "unreachable", raw, error: text || "unreachable", latencyMs: 0 };
}

function decide(nodes, transport) {
  if (!Array.isArray(nodes) || !nodes.length) return { verdict: "UNKNOWN", confidence: "no-node-results" };
  if (transport === "tcp") {
    const reachable = nodes.filter(n => n.state === "reachable").length;
    const pending = nodes.filter(n => n.state === "pending").length;
    if (reachable >= STRONG_QUORUM) return { verdict: "PASS", confidence: `tcp-${reachable}/${nodes.length}` };
    if (pending === 0 && reachable >= MIN_PASS_NODES) return { verdict: "PASS-PARTIAL", confidence: `tcp-${reachable}/${nodes.length}` };
    if (pending === 0) return { verdict: "FAIL", confidence: `tcp-${reachable}/${nodes.length}` };
    return { verdict: "UNKNOWN", confidence: `tcp-pending-${pending}` };
  }
  const refused = nodes.filter(n => n.state === "refused").length;
  const pending = nodes.filter(n => n.state === "pending").length;
  const usable = nodes.filter(n => n.state === "udp-filtered" || n.state === "reachable").length;
  if (usable >= STRONG_QUORUM) return { verdict: "PASS-UDP-STRONG", confidence: `udp-${usable}/${nodes.length}` };
  if (pending === 0 && usable >= MIN_PASS_NODES) return { verdict: "PASS-UDP-NOT-REFUSED", confidence: `udp-${usable}/${nodes.length}` };
  if (pending === 0 && refused === nodes.length) return { verdict: "FAIL", confidence: "udp-explicitly-refused-all" };
  return { verdict: "UNKNOWN", confidence: `udp-pending-${pending}` };
}

async function createCheckHostMeasurement(url, protocol) {
  const transport = transportOf(protocol);
  const type = transport === "udp" ? "udp" : "tcp";
  const params = new URLSearchParams({ host: targetForCheckHost(url), max_nodes: String(CORE_NODES.length) });
  for (const node of CORE_NODES) params.append("node", node);
  await throttleCreate();
  const created = await withRetry(() => fetchJson(`${CHECK_HOST_BASE}/check-${type}?${params.toString()}`, {}, CREATE_TIMEOUT_MS));
  const requestId = String(created?.request_id || "").trim();
  if (!requestId) throw new Error("Check-Host response has no request_id");
  return { requestId, transport, type, nodes: [...CORE_NODES] };
}

async function pollCheckHostMeasurement(measurement) {
  const started = Date.now();
  let lastPayload = null;
  while (Date.now() - started <= MAX_POLL_MS) {
    await sleep(POLL_MS);
    lastPayload = await withRetry(() => fetchJson(`${CHECK_HOST_BASE}/check-result/${encodeURIComponent(measurement.requestId)}`, {}, RESULT_TIMEOUT_MS));
    const parsed = measurement.nodes.map(node => parseNodeResult(lastPayload?.[node] ?? null, node, measurement.transport));
    const decision = decide(parsed, measurement.transport);
    const allFinal = parsed.every(row => !["pending"].includes(row.state));
    if (["PASS", "FAIL", "PASS-PARTIAL", "PASS-UDP-STRONG", "PASS-UDP-NOT-REFUSED"].includes(decision.verdict) || allFinal) {
      return { ...decision, nodes: parsed, requestId: measurement.requestId };
    }
  }
  const parsed = measurement.nodes.map(node => parseNodeResult(lastPayload?.[node] ?? null, node, measurement.transport));
  return { verdict: "UNKNOWN", confidence: "timeout", nodes: parsed, requestId: measurement.requestId, error: "Check-Host result did not resolve within the bounded polling window" };
}

async function checkEndpointOnce(endpoint) {
  const { url, protocol } = parseUrl(endpoint.link);
  const measurement = await createCheckHostMeasurement(url, protocol);
  return pollCheckHostMeasurement(measurement);
}

function reachableCount(result) {
  return Array.isArray(result?.nodes) ? result.nodes.filter(n => n.state === "reachable").length : 0;
}

function isTcpNonPass(result, endpoint) {
  return endpoint.transport === "tcp" && !["PASS", "PASS-PARTIAL", "DRY-RUN"].includes(result?.verdict);
}

let globalpingGateQueue = Promise.resolve();

function serializeGlobalpingRecovery(fn) {
  const previous = globalpingGateQueue;
  let release;
  globalpingGateQueue = new Promise(resolve => { release = resolve; });
  return previous
    .catch(() => {})
    .then(fn)
    .finally(() => release());
}

async function checkEndpoint(endpoint, globalpingContext = null) {
  if (DRY_RUN) {
    return {
      verdict: "DRY-RUN",
      confidence: "not-tested",
      requestId: "",
      attempts: [],
      nodes: CORE_NODES.map(node => ({ node, state: "dry-run", latencyMs: 0 })),
      globalpingGate: null,
    };
  }

  const first = await checkEndpointOnce(endpoint);
  const shouldRecheck = RECHECK_NONPASS && isTcpNonPass(first, endpoint);

  let bestResult = first;
  let attempts = [first];

  if (shouldRecheck) {
    const second = await checkEndpointOnce(endpoint);
    attempts = [first, second];

    const firstReachable = reachableCount(first);
    const secondReachable = reachableCount(second);
    const best = Math.max(firstReachable, secondReachable);

    if (best >= STRONG_QUORUM) {
      bestResult = {
        ...second,
        verdict: "PASS",
        confidence: `tcp-recheck-strong-best-${best}/${CORE_NODES.length}`,
        rechecked: true,
        bestReachable: best,
      };
    } else if (best >= MIN_PASS_NODES) {
      bestResult = {
        ...second,
        verdict: "PASS-PARTIAL",
        confidence: `tcp-recheck-partial-best-${best}/${CORE_NODES.length}`,
        rechecked: true,
        bestReachable: best,
      };
    } else {
      bestResult = {
        ...second,
        verdict: "FAIL",
        confidence: `tcp-recheck-${firstReachable}/${secondReachable}`,
        rechecked: true,
        bestReachable: best,
      };
    }
  }

  return {
    ...bestResult,
    attempts,
    globalpingGate: null,
  };
}


function xrayPassCandidateVerdict(verdict) {
  return ["PASS", "PASS-PARTIAL", "PASS-GLOBALPING", "PASS-HOSTTOOLS", "PASS-HOSTTOOLS-STRONG", "PASS-UDP-STRONG", "PASS-UDP-NOT-REFUSED", "DRY-RUN"].includes(String(verdict));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForLocalPort(port) {
  return new Promise(resolve => {
    const started = Date.now();
    const probe = () => {
      if (Date.now() - started >= XRAY_START_TIMEOUT_MS) return resolve(false);
      const socket = net.createConnection({ host: "127.0.0.1", port, timeout: 700 });
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        socket.destroy();
        if (ok) return resolve(true);
        setTimeout(probe, 100);
      };
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    };
    probe();
  });
}

function normalizeLinkForXrayProbe(link) {
  const raw = String(link || "").trim();
  try {
    const url = new URL(raw);
    const extra = url.searchParams.get("extra");
    // Some VLESS xhttp feeds contain literal extra=null. The shared runtime
    // expects an object and otherwise may throw while reading extra.mode.
    if (String(extra || "").trim().toLowerCase() === "null") {
      url.searchParams.delete("extra");
      return url.toString();
    }
  } catch {}
  return raw;
}

function buildXrayConfigForLink(link, socksPort) {
  const server = parseLink(link);
  const outbound = buildOutbound(server, "proxy");
  return {
    log: { loglevel: "none" },
    inbounds: [{
      listen: "127.0.0.1",
      port: socksPort,
      protocol: "socks",
      settings: { udp: true },
      sniffing: { enabled: false },
      tag: "socks",
    }],
    outbounds: [
      outbound,
      { protocol: "freedom", tag: "direct" },
      { protocol: "blackhole", tag: "block" },
    ],
  };
}

async function startXrayForLink(link) {
  const socksPort = await getFreePort();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "russia-v3-xray-"));
  const configPath = path.join(tempDir, "config.json");
  let child = null;
  let stderr = "";

  const cleanup = async () => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise(resolve => {
        const force = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch {}
          resolve();
        }, 1000);
        child.once("exit", () => {
          clearTimeout(force);
          resolve();
        });
      });
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  };

  try {
    const probeLink = normalizeLinkForXrayProbe(link);
    const config = buildXrayConfigForLink(probeLink, socksPort);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

    child = spawn(XRAY_BIN, ["run", "-c", configPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.on("data", chunk => {
      stderr += String(chunk);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    const opened = await Promise.race([
      waitForLocalPort(socksPort),
      new Promise(resolve => child.once("error", error => resolve({ error }))),
      new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal }))),
    ]);

    if (opened !== true) {
      const detail = opened?.error?.message ||
        (opened && typeof opened === "object" ? `xray exited (${opened.code ?? "?"}${opened.signal ? `/${opened.signal}` : ""})` : "") ||
        "xray SOCKS port did not open";
      await cleanup();
      return { ok: false, error: `${detail}${stderr ? `; ${stderr.trim().slice(-700)}` : ""}`.slice(0, 1400) };
    }

    return { ok: true, socksPort, cleanup };
  } catch (error) {
    await cleanup();
    return { ok: false, error: error?.message || String(error) };
  }
}

function curlViaXrayOnce(socksPort, targetUrl) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const args = [
      "--silent", "--show-error", "--fail",
      "--connect-timeout", "4",
      "--max-time", String(Math.ceil(XRAY_REQUEST_TIMEOUT_MS / 1000)),
      "--proxy", `socks5h://127.0.0.1:${socksPort}`,
      targetUrl,
      "--output", "/dev/null",
      "--write-out", "\\n%{http_code}\\n%{time_total}\\n",
    ];
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish({ ok: false, latencyMs: 0, httpCode: 0, error: "curl timeout" });
    }, XRAY_REQUEST_TIMEOUT_MS + 500);
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", error => {
      clearTimeout(timeout);
      finish({ ok: false, latencyMs: 0, httpCode: 0, error: error?.message || "curl spawn failed" });
    });
    child.once("exit", code => {
      clearTimeout(timeout);
      const values = stdout.trim().split(/\r?\n/).map(v => v.trim()).filter(Boolean);
      const latencyMs = Number(values.at(-1)) > 0
        ? Math.round(Number(values.at(-1)) * 1000)
        : Math.max(Date.now() - startedAt, 0);
      const httpCode = Number(values.at(-2)) || 0;
      finish({
        ok: code === 0,
        latencyMs,
        httpCode,
        error: code === 0 ? "" : (stderr.trim().slice(0, 500) || `curl exit ${code}`),
      });
    });
  });
}

function curlViaXraySpeedOnce(socksPort, targetUrl) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const args = [
      "--silent", "--show-error",
      "--connect-timeout", "5",
      "--max-time", String(Math.ceil(XRAY_SPEED_FALLBACK_TIMEOUT_MS / 1000)),
      "--proxy", `socks5h://127.0.0.1:${socksPort}`,
      "--http1.1",
      "--location",
      "--output", "/dev/null",
      "--write-out", "%{http_code}\\n%{size_download}\\n%{time_total}\\n",
      targetUrl,
    ];
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish({ ok: false, httpCode: 0, bytes: 0, kbps: 0, elapsedMs: Math.max(Date.now() - startedAt, 0), curlCode: 28, error: "curl timeout" });
    }, XRAY_SPEED_FALLBACK_TIMEOUT_MS + 800);
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", error => {
      clearTimeout(timeout);
      finish({ ok: false, httpCode: 0, bytes: 0, kbps: 0, elapsedMs: Math.max(Date.now() - startedAt, 0), curlCode: -1, error: error?.message || "curl spawn failed" });
    });
    child.once("exit", code => {
      clearTimeout(timeout);
      const lines = stdout.trim().split(/\\r?\\n/).map(v => v.trim());
      const httpCode = Number(lines[0] || 0) || 0;
      const bytes = Number(lines[1] || 0) || 0;
      const curlSeconds = Number(lines[2] || 0);
      const elapsedSeconds = Number.isFinite(curlSeconds) && curlSeconds > 0
        ? curlSeconds
        : Math.max((Date.now() - startedAt) / 1000, 0.001);
      const kbps = bytes > 0 ? (bytes / 1024) / elapsedSeconds : 0;
      const isHttpSuccess = httpCode >= 200 && httpCode < 400;
      const completedOrTimedOut = code === 0 || code === 28;
      const ok =
        completedOrTimedOut &&
        isHttpSuccess &&
        bytes >= XRAY_SPEED_FALLBACK_MIN_BYTES &&
        kbps >= XRAY_SPEED_FALLBACK_MIN_KBPS;
      finish({
        ok,
        httpCode,
        bytes,
        kbps: Math.round(kbps * 10) / 10,
        elapsedMs: Math.round(elapsedSeconds * 1000),
        curlCode: Number(code),
        error: ok ? "" : (stderr.trim().slice(0, 500) || `curl=${code}, HTTP=${httpCode || "?"}, ${bytes} bytes, ${Math.round(kbps * 10) / 10} KB/s`),
      });
    });
  });
}

async function testExactLinkWithXray(link) {
  if (!XRAY_ENABLED) return { verdict: "SKIPPED-XRAY", attempts: [], target: "", latencyMs: 0 };
  const attempts = [];
  for (let attempt = 1; attempt <= XRAY_LINK_ATTEMPTS; attempt += 1) {
    const started = Date.now();
    const xray = await startXrayForLink(link);
    if (!xray.ok) {
      const failed = { attempt, ok: false, error: xray.error, targetResults: [] };
      attempts.push(failed);
      if (attempt < XRAY_LINK_ATTEMPTS) await sleep(XRAY_RETRY_DELAY_MS);
      continue;
    }

    const targetResults = [];
    let speedFallback = null;
    try {
      for (const target of XRAY_TARGETS) {
        const result = await curlViaXrayOnce(xray.socksPort, target);
        targetResults.push({ target, ...result });
        if (result.ok) break;
      }

      if (!targetResults.some(result => result.ok) && XRAY_SPEED_FALLBACK_ENABLED) {
        speedFallback = await curlViaXraySpeedOnce(xray.socksPort, XRAY_SPEED_FALLBACK_URL);
      }
    } finally {
      await xray.cleanup();
    }

    const success = targetResults.find(result => result.ok);
    const row = {
      attempt,
      ok: Boolean(success || speedFallback?.ok),
      latencyMs: success?.latencyMs || speedFallback?.elapsedMs || 0,
      target: success?.target || (speedFallback?.ok ? XRAY_SPEED_FALLBACK_URL : ""),
      targetResults,
      speedFallback,
      durationMs: Math.max(Date.now() - started, 0),
    };
    attempts.push(row);
    if (success) {
      return {
        verdict: "PASS-XRAY",
        confidence: `xray-${targetResults.length}/${XRAY_TARGETS.length}`,
        attempts,
        target: success.target,
        latencyMs: success.latencyMs,
      };
    }
    if (speedFallback?.ok) {
      return {
        verdict: "PASS-XRAY-CLOUDFLARE",
        confidence: `cloudflare-speed-${Math.round(speedFallback.kbps)}KBps`,
        attempts,
        target: XRAY_SPEED_FALLBACK_URL,
        latencyMs: speedFallback.elapsedMs,
        speedFallback,
      };
    }
    if (attempt < XRAY_LINK_ATTEMPTS) await sleep(XRAY_RETRY_DELAY_MS);
  }

  return {
    verdict: "FAIL-XRAY",
    confidence: `xray-${attempts.length}/${XRAY_TARGETS.length || 1}`,
    attempts,
    target: "",
    latencyMs: 0,
  };
}

async function runXrayCandidateChecks(items, endpointRows) {
  if (DRY_RUN || !XRAY_ENABLED) return new Map(items.map(item => [String(item.id), { verdict: "SKIPPED-XRAY" }]));
  const endpointByKey = new Map(endpointRows.map(row => [row.key, row]));
  const candidates = [];
  for (const item of items) {
    const link = String(item?.link || "").trim();
    if (!link) continue;
    let key;
    try { key = endpointKey(link); } catch { continue; }
    const endpoint = endpointByKey.get(key);
    if (!endpoint) continue;
    if (XRAY_ONLY_ON_TRANSPORT_PASS && !xrayPassCandidateVerdict(endpoint.verdict)) continue;
    candidates.push({ id: String(item.id), link });
  }

  const results = new Map();
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= candidates.length) return;
      const candidate = candidates[index];
      try {
        results.set(candidate.id, await testExactLinkWithXray(candidate.link));
      } catch (error) {
        results.set(candidate.id, { verdict: "UNKNOWN-XRAY", attempts: [], error: error?.message || String(error) });
      }
      console.log(`RUSSIA TEST V3 XRAY ${index + 1}/${candidates.length}: ${candidate.link.slice(0, 90)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(XRAY_LINK_CONCURRENCY, Math.max(1, candidates.length)) }, worker));
  return results;
}

function buildEndpointWorkset(items) {
  const byKey = new Map();
  for (const item of items) {
    const link = String(item?.link || "").trim();
    if (!link) continue;
    try {
      const { protocol, transport } = parseUrl(link);
      const key = endpointKey(link);
      const existing = byKey.get(key) || { key, link, protocol, transport, members: [] };
      existing.members.push({ id: item.id, remarks: item.remarks || "", link });
      byKey.set(key, existing);
    } catch {}
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function runPool(items, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { out[index] = await fn(items[index]); }
      catch (error) { out[index] = { verdict: "UNKNOWN", confidence: "checker-error", nodes: [], error: error?.message || String(error) }; }
      if ((index + 1) % 10 === 0 || index + 1 === items.length) console.log(`RUSSIA TEST V3 PROGRESS ${index + 1}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, items.length)) }, worker));
  return out;
}

function expandPassingLinks(items, endpointRows) {
  const byKey = new Map(endpointRows.map(row => [row.key, row]));
  const links = [];
  for (const item of items) {
    const link = String(item?.link || "").trim();
    if (!link) continue;
    let key;
    try { key = endpointKey(link); } catch { continue; }
    const endpoint = byKey.get(key);
    const verdict = endpoint?.verdict;
    // Only the Russian Check-Host baseline may populate the broad transport list.
    // Globalping/host.tools are additional transport diagnostics, not HAPP proof.
    // UDP non-refusal is also not enough to prove a Hysteria/QUIC handshake.
    if (["PASS", "PASS-PARTIAL", "DRY-RUN"].includes(verdict)) links.push(link);
  }
  return [...new Set(links)];
}

function exactXrayPassing(item, xrayById) {
  return ["PASS-XRAY", "PASS-XRAY-CLOUDFLARE"].includes(
    xrayById.get(String(item?.id))?.verdict
  );
}

async function discoverCheckHostRussiaNodes() {
  if (!DISCOVER_CHECK_HOST_RU || DRY_RUN) return { discovered: false, nodes: [] };
  try {
    const data = await fetchJson(`${CHECK_HOST_BASE}/nodes/hosts`, {}, 12000);
    const rows = Object.entries(data?.nodes || {})
      .map(([id, value]) => ({ id, country: value?.location?.[0], city: value?.location?.[2], ip: value?.ip, asn: value?.asn }))
      .filter(row => String(row.country).toLowerCase() === "ru")
      .sort((a, b) => String(a.city).localeCompare(String(b.city)) || a.id.localeCompare(b.id));
    return { discovered: true, nodes: rows };
  } catch (error) {
    return { discovered: false, nodes: [], error: error?.message || String(error) };
  }
}

async function getGlobalpingProbes() {
  if (!GLOBALPING_ENABLED || DRY_RUN) return [];
  const data = await withRetry(() => fetchJson(
    `${GLOBALPING_BASE}/probes`,
    GLOBALPING_TOKEN
      ? { headers: { authorization: `Bearer ${GLOBALPING_TOKEN}` } }
      : {},
    GLOBALPING_TIMEOUT_MS
  ));
  return Array.isArray(data) ? data : (Array.isArray(data?.probes) ? data.probes : []);
}

function chooseGlobalpingCities(probes) {
  const byCity = new Map();
  for (const probe of probes) {
    const location = probe?.location || {};
    if (String(location.country || "").toUpperCase() !== "RU") continue;
    const city = String(location.city || "").trim();
    if (!city) continue;
    const key = city.toLowerCase();
    const row = byCity.get(key) || {
      city,
      count: 0,
      eyeball: 0,
      datacenter: 0,
    };
    row.count += 1;
    const tags = new Set(Array.isArray(probe?.tags) ? probe.tags.map(String) : []);
    if (tags.has("eyeball-network")) row.eyeball += 1;
    if (tags.has("datacenter-network")) row.datacenter += 1;
    byCity.set(key, row);
  }

  const picked = [];
  const used = new Set();
  for (const city of PRIORITY_RUSSIA_CITIES) {
    const row = byCity.get(city.toLowerCase());
    if (!row) continue;
    picked.push(row);
    used.add(city.toLowerCase());
    if (picked.length >= GLOBALPING_CITY_LIMIT) break;
  }

  if (picked.length < GLOBALPING_CITY_LIMIT) {
    for (const row of [...byCity.values()].sort(
      (a, b) =>
        b.eyeball - a.eyeball ||
        b.count - a.count ||
        a.city.localeCompare(b.city)
    )) {
      if (used.has(row.city.toLowerCase())) continue;
      picked.push(row);
      used.add(row.city.toLowerCase());
      if (picked.length >= GLOBALPING_CITY_LIMIT) break;
    }
  }

  return picked;
}

function normalizeLocationName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ");
}

function isGlobalpingCoreCity(value) {
  return new Set([
    "moscow",
    "moscow city",
    "saint petersburg",
    "st petersburg",
    "st. petersburg",
    "санкт-петербург",
  ]).has(normalizeLocationName(value));
}

function chooseGlobalpingRecoveryCities(cities) {
  const preferred = [
    "Kazan",
    "Novosibirsk",
    "Krasnodar",
    "Ufa",
    "Kursk",
    "Samara",
    "Rostov-on-Don",
    "Nizhny Novgorod",
    "Perm",
    "Voronezh",
    "Chelyabinsk",
    "Yekaterinburg",
  ];

  const available = new Map(
    (cities || [])
      .filter(row => !isGlobalpingCoreCity(row?.city))
      .filter(row => Number(row?.count) > 0)
      .filter(row => !GLOBALPING_RECOVERY_REQUIRE_EYEBALL || Number(row?.eyeball) > 0)
      .map(row => [normalizeLocationName(row.city), row])
  );
  const selected = [];

  for (const name of preferred) {
    const row = available.get(normalizeLocationName(name));
    if (!row) continue;
    selected.push(row);
    if (selected.length >= GLOBALPING_RECOVERY_CITY_LIMIT) break;
  }

  if (selected.length < GLOBALPING_RECOVERY_CITY_LIMIT) {
    for (const row of [...available.values()].sort(
      (a, b) =>
        b.eyeball - a.eyeball ||
        b.count - a.count ||
        a.city.localeCompare(b.city)
    )) {
      if (selected.some(item => normalizeLocationName(item.city) === normalizeLocationName(row.city))) continue;
      selected.push(row);
      if (selected.length >= GLOBALPING_RECOVERY_CITY_LIMIT) break;
    }
  }

  return selected;
}

function mtrResultReachedTarget(result, targetHost) {
  const probeResult = result?.result || {};
  if (String(probeResult.status || "").toLowerCase() !== "finished") return false;

  const target = String(probeResult.resolvedAddress || targetHost || "").trim().toLowerCase();
  const hops = Array.isArray(probeResult.hops) ? probeResult.hops : [];
  const raw = String(probeResult.rawOutput || "");
  if (!target) return false;

  if (/destination host unreachable|network unreachable|no route to host/i.test(raw)) return false;

  const finalHop = [...hops].reverse().find(hop => {
    const address = String(hop?.resolvedAddress || "").trim().toLowerCase();
    return address && (address === target || address === String(targetHost || "").trim().toLowerCase());
  });

  if (finalHop) {
    const loss = Number(finalHop?.stats?.loss);
    return !Number.isFinite(loss) || loss < 100;
  }

  // If Globalping does not expose the destination hop, only accept an explicit
  // occurrence of the resolved destination in raw output. An intermediate hop
  // replying is not enough to call the endpoint reachable.
  const resolved = String(probeResult.resolvedAddress || "").trim().toLowerCase();
  if (resolved) {
    const escaped = resolved.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(escaped, "i").test(raw)) return true;
  }

  return false;
}

function buildGlobalpingMeasurementOptions(host, port) {
  return {
    protocol: "TCP",
    port,
    packets: 3,
    // Globalping accepts ipVersion for hostname targets. Literal IP targets
    // must omit it; otherwise the API rejects the measurement.
    ...(net.isIP(host) === 0 ? { ipVersion: 4 } : {}),
  };
}

async function createGlobalpingMtr(endpoint, cities) {
  const { transport, port, host } = parseUrl(endpoint.link);
  if (!host || !cities.length) throw new Error("Globalping gate has no target or cities");
  if (GLOBALPING_RECOVERY_TCP_ONLY && transport !== "tcp") {
    return {
      measurementId: "",
      target: host,
      transport,
      port,
      cities: [],
      reachedCities: 0,
      validReachedCities: 0,
      verdict: "SKIPPED-GLOBALPING-NON-TCP",
      note: "Globalping transport checks are not sufficient to prove a Hysteria/QUIC handshake.",
    };
  }

  const measurementOptions = buildGlobalpingMeasurementOptions(host, port);

  const body = {
    type: "mtr",
    target: host,
    timeout: GLOBALPING_MTR_TIMEOUT_SECONDS,
    locations: cities.map(city => ({
      country: "RU",
      city: city.city,
      ...(GLOBALPING_RECOVERY_REQUIRE_EYEBALL ? { tags: ["eyeball-network"] } : {}),
      limit: 1,
    })),
    measurementOptions,
  };

  const created = await fetchJson(
    `${GLOBALPING_BASE}/measurements`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(GLOBALPING_TOKEN ? { authorization: `Bearer ${GLOBALPING_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
    },
    GLOBALPING_TIMEOUT_MS
  );

  const id = String(created?.id || "").trim();
  if (!id) throw new Error("Globalping gate response has no measurement id");

  const started = Date.now();
  let data = null;
  while (Date.now() - started <= GLOBALPING_TIMEOUT_MS) {
    await sleep(GLOBALPING_POLL_MS);
    data = await getGlobalpingMeasurement(id);
    const status = String(data?.status || "").toLowerCase();
    if (status && status !== "in-progress") break;
  }

  const finalStatus = String(data?.status || "").toLowerCase();
  if (finalStatus === "in-progress" || finalStatus === "pending") {
    return {
      measurementId: id,
      target: host,
      transport,
      port,
      cities: [],
      reachedCities: 0,
      validReachedCities: 0,
      requiredDistinctCities: GLOBALPING_RECOVERY_MIN_DISTINCT_CITIES,
      verdict: "UNKNOWN-GLOBALPING",
      error: `Globalping measurement ${id} did not finish before timeout`,
      measurementFailure: true,
    };
  }

  const resultRows = Array.isArray(data?.results) ? data.results : [];
  const cityRows = resultRows.map((row, index) => {
    const probe = row?.probe || {};
    const requestedCity = cities[index]?.city || "";
    const actualCity = probe?.city || probe?.location?.city || "";
    const country = String(probe?.country || probe?.location?.country || "").toUpperCase();
    const tags = Array.isArray(probe?.tags) ? probe.tags.map(String) : [];
    const normalizedTags = new Set(tags.map(tag => tag.trim().toLowerCase()));
    const cityMatches = Boolean(actualCity) && normalizeLocationName(actualCity) === normalizeLocationName(requestedCity);
    const countryMatches = country === "RU";
    const hasEyeballTag = normalizedTags.has("eyeball-network");
    const hasDatacenterTag = normalizedTags.has("datacenter-network");
    const eyeballMatches = !GLOBALPING_RECOVERY_REQUIRE_EYEBALL || (hasEyeballTag && !hasDatacenterTag);
    const validProbe = cityMatches && countryMatches && eyeballMatches;
    return {
      requestedCity,
      city: actualCity,
      country,
      network: probe?.network || probe?.location?.network || "",
      tags,
      latitude: Number(probe?.latitude ?? probe?.location?.latitude) || null,
      longitude: Number(probe?.longitude ?? probe?.location?.longitude) || null,
      status: String(row?.result?.status || data?.status || "unknown"),
      validProbe,
      validation: { cityMatches, countryMatches, eyeballMatches, hasEyeballTag, hasDatacenterTag },
      reachedTarget: mtrResultReachedTarget(row, host),
      resolvedAddress: row?.result?.resolvedAddress || "",
      finalHopLoss: Number([...((row?.result?.hops) || [])].at(-1)?.stats?.loss),
    };
  });

  const reachedCities = cityRows.filter(row => row.reachedTarget).length;
  const validReachedCities = new Set(
    cityRows
      .filter(row => row.validProbe && row.reachedTarget)
      .map(row => normalizeLocationName(row.city))
      .filter(Boolean)
  ).size;
  const verdict = validReachedCities >= GLOBALPING_RECOVERY_MIN_DISTINCT_CITIES
    ? "PASS-GLOBALPING"
    : validReachedCities > 0
      ? "PARTIAL-GLOBALPING"
      : "FAIL-GLOBALPING";

  return {
    measurementId: id,
    target: host,
    transport,
    port,
    cities: cityRows,
    reachedCities,
    validReachedCities,
    requiredDistinctCities: GLOBALPING_RECOVERY_MIN_DISTINCT_CITIES,
    verdict,
  };
}

async function getGlobalpingMeasurement(id) {
  return fetchJson(
    `${GLOBALPING_BASE}/measurements/${encodeURIComponent(id)}`,
    GLOBALPING_TOKEN
      ? { headers: { authorization: `Bearer ${GLOBALPING_TOKEN}` } }
      : {},
    GLOBALPING_TIMEOUT_MS
  );
}

async function runGlobalpingGate(endpoint, context) {
  if (!GLOBALPING_ENABLED || !GLOBALPING_RECOVERY_ENABLED || DRY_RUN) return null;
  if (!context?.gateCities?.length) {
    return {
      verdict: "UNKNOWN-GLOBALPING",
      error: context?.error || "Globalping has no selected Russian gate cities",
      cities: [],
      reachedCities: 0,
      validReachedCities: 0,
      serviceFailure: true,
    };
  }

  return serializeGlobalpingRecovery(async () => {
    try {
      return await createGlobalpingMtr(endpoint, context.gateCities);
    } catch (error) {
      return {
        verdict: "UNKNOWN-GLOBALPING",
        status: Number(error?.status || 0),
        error: error?.message || String(error),
        cities: [],
        reachedCities: 0,
        validReachedCities: 0,
        serviceFailure: true,
      };
    }
  });
}

async function getGlobalpingLimits() {
  if (!GLOBALPING_ENABLED || DRY_RUN) return null;
  try {
    const data = await fetchJson(
      `${GLOBALPING_BASE}/limits`,
      GLOBALPING_TOKEN
        ? { headers: { authorization: `Bearer ${GLOBALPING_TOKEN}` } }
        : {},
      GLOBALPING_TIMEOUT_MS
    );
    const create = data?.rateLimit?.measurements?.create || data?.rateLimits?.measurements?.create || {};
    const remaining = Number(create?.remaining);
    const limit = Number(create?.limit);
    const reset = Number(create?.reset);
    return {
      remaining: Number.isFinite(remaining) ? remaining : null,
      limit: Number.isFinite(limit) ? limit : null,
      resetSeconds: Number.isFinite(reset) ? reset : null,
    };
  } catch (error) {
    return {
      remaining: null,
      limit: null,
      resetSeconds: null,
      error: error?.message || String(error),
    };
  }
}

function globalpingGateRank(endpoint, xrayById = new Map()) {
  const members = Array.isArray(endpoint.members) ? endpoint.members : [];
  const xrayRows = members.map(member => xrayById.get(String(member.id))).filter(Boolean);
  const hasXrayPass = xrayRows.some(row => ["PASS-XRAY", "PASS-XRAY-CLOUDFLARE"].includes(row?.verdict));
  if (!hasXrayPass) return Number.POSITIVE_INFINITY;

  // Among Xray-passing endpoints, prefer Check-Host-strong endpoints first.
  // This does not change the gate; it only determines which endpoints are tested first if a hard budget is hit.
  if (endpoint.verdict === "PASS") return 0;
  if (endpoint.verdict === "PASS-PARTIAL") return 1;
  return 2;
}

function chooseGlobalpingGateTargets(endpointRows, xrayById) {
  return [...endpointRows]
    .filter(endpoint => {
      const members = Array.isArray(endpoint.members) ? endpoint.members : [];
      return members.some(member => {
        const row = xrayById.get(String(member.id));
        return ["PASS-XRAY", "PASS-XRAY-CLOUDFLARE"].includes(row?.verdict);
      });
    })
    .sort((a, b) => globalpingGateRank(a, xrayById) - globalpingGateRank(b, xrayById))
    .slice(0, GLOBALPING_RECOVERY_MAX_ENDPOINTS);
}

async function runGlobalpingGatePass(endpointRows, items, xrayById, context) {
  if (!GLOBALPING_ENABLED || !GLOBALPING_RECOVERY_ENABLED || DRY_RUN) {
    return { attempted: 0, passed: 0, skipped: "disabled", serviceAvailable: false, failOpen: true, endpoints: [] };
  }
  const cities = Array.isArray(context?.gateCities) ? context.gateCities : [];
  if (cities.length !== 3) {
    return {
      attempted: 0,
      passed: 0,
      skipped: cities.length ? `need-3-russian-cities-got-${cities.length}` : "not-enough-russian-cities",
      serviceAvailable: false,
      failOpen: true,
      endpoints: [],
      limits: context?.limits || null,
    };
  }

  const limits = context?.limits || await getGlobalpingLimits();
  const remaining = Number(limits?.remaining);
  const reserve = GLOBALPING_RECOVERY_RESERVE_TESTS;
  const perEndpointTests = cities.length; // one probe/test per requested city
  const budgetEndpoints = Number.isFinite(remaining)
    ? Math.max(0, Math.floor(Math.max(0, remaining - reserve) / perEndpointTests))
    : 0;
  if (!Number.isFinite(remaining)) {
    return {
      attempted: 0,
      passed: 0,
      skipped: "globalping-limit-unavailable",
      serviceAvailable: false,
      failOpen: true,
      endpoints: [],
      limits,
    };
  }

  const targets = chooseGlobalpingGateTargets(endpointRows, xrayById)
    .filter(endpoint => !GLOBALPING_RECOVERY_TCP_ONLY || endpoint.transport === "tcp")
    .slice(0, budgetEndpoints);
  if (!targets.length) {
    return {
      attempted: 0,
      passed: 0,
      skipped: Number.isFinite(remaining) ? `budget-${remaining}-tests-or-no-targets` : "no-targets",
      serviceAvailable: budgetEndpoints > 0 || remaining > reserve,
      failOpen: true,
      endpoints: [],
      limits,
    };
  }

  const rows = [];
  let stoppedOnRateLimit = false;
  let serviceFailure = false;
  for (let index = 0; index < targets.length; index += 1) {
    const endpoint = targets[index];
    let result;
    try {
      result = await runGlobalpingGate(endpoint, context);
    } catch (error) {
      result = {
        verdict: "UNKNOWN-GLOBALPING",
        error: error?.message || String(error),
        cities: [],
        reachedCities: 0,
        validReachedCities: 0,
        serviceFailure: true,
      };
    }
    endpoint.globalpingGate = result;
    if (result?.verdict === "PASS-GLOBALPING") {
      endpoint.globalpingVerdict = "PASS-GLOBALPING";
    } else if (result?.verdict === "PARTIAL-GLOBALPING") {
      endpoint.globalpingVerdict = "PARTIAL-GLOBALPING";
    }
    rows.push({
      key: endpoint.key,
      verdict: result?.verdict || "UNKNOWN-GLOBALPING",
      reachedCities: result?.reachedCities || 0,
      validReachedCities: result?.validReachedCities || 0,
      requiredDistinctCities: result?.requiredDistinctCities || 2,
      cities: result?.cities || [],
      error: result?.error || "",
      serviceFailure: Boolean(result?.serviceFailure),
    });
    console.log(`RUSSIA TEST V3 GLOBALPING ${index + 1}/${targets.length}: ${endpoint.key} => ${result?.verdict || "UNKNOWN"} (${result?.validReachedCities || 0}/3)`);

    if (result?.serviceFailure) serviceFailure = true;
    if (result?.status === 429 || /(^|\b)HTTP 429\b|rate.?limit/i.test(String(result?.error || ""))) {
      stoppedOnRateLimit = true;
      serviceFailure = true;
      break;
    }
  }

  return {
    attempted: rows.length,
    passed: rows.filter(row => row.verdict === "PASS-GLOBALPING").length,
    passed2of3: rows.filter(row => Number(row.validReachedCities) >= 2).length,
    passed3of3: rows.filter(row => Number(row.validReachedCities) >= 3).length,
    skipped: stoppedOnRateLimit ? "stopped-on-rate-limit" : "",
    endpoints: rows,
    limits,
    stoppedOnRateLimit,
    serviceAvailable: !serviceFailure,
    failOpen: serviceFailure || stoppedOnRateLimit || rows.length === 0,
  };
}

async function prepareGlobalpingContext() {
  if (!GLOBALPING_ENABLED || DRY_RUN) {
    return {
      enabled: false,
      probesInRussia: 0,
      cities: [],
      gateCities: [],
    };
  }

  try {
    const probes = await getGlobalpingProbes();
    const cities = chooseGlobalpingCities(probes);
    const gateCities = chooseGlobalpingRecoveryCities(cities);
    const limits = await getGlobalpingLimits();

    return {
      enabled: true,
      probesInRussia: probes.filter(
        probe => String(probe?.location?.country || "").toUpperCase() === "RU"
      ).length,
      cities,
      gateCities,
      limits,
      readyForThreeCityGate: gateCities.length === 3 && Number.isFinite(Number(limits?.remaining)),
    };
  } catch (error) {
    return {
      enabled: true,
      probesInRussia: 0,
      cities: [],
      gateCities: [],
      limits: null,
      readyForThreeCityGate: false,
      error: `probe discovery failed: ${error?.message || String(error)}`,
    };
  }
}

function protocolSummary(items) {
  const counts = {};
  for (const item of items) {
    const protocol = protocolOf(item?.link || "");
    counts[protocol] = (counts[protocol] || 0) + 1;
  }
  return counts;
}

function runSelfTest() {
  const samples = [
    ["vless://11111111-1111-1111-1111-111111111111@example.com:443?security=tls&type=tcp&sni=example.com", "vless", "tcp"],
    ["trojan://password@example.com:443?sni=example.com", "trojan", "tcp"],
    ["hysteria2://password@example.com:443?sni=example.com&alpn=h3", "hysteria2", "udp"],
    ["hysteria://password@example.com:443?sni=example.com&alpn=h3", "hysteria", "udp"],
    ["tuic://password@example.com:443?sni=example.com", "tuic", "udp"],
  ];
  for (const [link, expectedProtocol, expectedTransport] of samples) {
    const actual = parseUrl(link);
    if (actual.protocol !== expectedProtocol || actual.transport !== expectedTransport) throw new Error(`protocol self-test failed for ${link}`);
  }
  const outboundVless = buildOutbound(parseLink(samples[0][0]), "probe-vless");
  const outboundTrojan = buildOutbound(parseLink(samples[1][0]), "probe-trojan");
  const outboundHysteria = buildOutbound(parseLink(samples[2][0]), "probe-hysteria");
  if (outboundVless?.protocol !== "vless" || outboundTrojan?.protocol !== "trojan" || outboundHysteria?.protocol !== "hysteria") {
    throw new Error("exact-link outbound protocol self-test failed");
  }
  const normalizedExtraNull = normalizeLinkForXrayProbe("vless://11111111-1111-1111-1111-111111111111@example.com:443?type=xhttp&mode=packet-up&extra=null&sni=example.com");
  if (/extra=null/i.test(normalizedExtraNull)) throw new Error("xhttp extra=null normalization self-test failed");
  const tcpOk = parseNodeResult([{ time: 0.041, address: "203.0.113.10" }], "ru2", "tcp");
  if (tcpOk.state !== "reachable" || tcpOk.latencyMs <= 0) throw new Error("TCP array parser self-test failed");
  const filtered = parseNodeResult([{ error: "Open or filtered" }], "ru2", "udp");
  const refused = parseNodeResult([{ error: "Connection refused" }], "ru2", "udp");
  if (filtered.state !== "udp-filtered" || refused.state !== "refused") throw new Error("UDP parser self-test failed");
  if (decide([{state:"udp-filtered"},{state:"udp-filtered"}], "udp").verdict !== "PASS-UDP-STRONG") throw new Error("UDP decision self-test failed");
  const selectedCities = chooseGlobalpingRecoveryCities([
    { city: "Moscow", count: 20, eyeball: 20, datacenter: 0 },
    { city: "Saint Petersburg", count: 20, eyeball: 20, datacenter: 0 },
    { city: "Yekaterinburg", count: 8, eyeball: 0, datacenter: 8 },
    { city: "Kazan", count: 7, eyeball: 1, datacenter: 6 },
    { city: "Novosibirsk", count: 6, eyeball: 2, datacenter: 4 },
    { city: "Krasnodar", count: 2, eyeball: 1, datacenter: 1 },
  ]);
  if (selectedCities.length !== 3 || selectedCities.some(city => isGlobalpingCoreCity(city.city)) || selectedCities.some(city => !city.eyeball)) {
    throw new Error("Globalping gate city selector self-test failed");
  }
  const ipOptions = buildGlobalpingMeasurementOptions("203.0.113.10", 443);
  if (Object.prototype.hasOwnProperty.call(ipOptions, "ipVersion")) {
    throw new Error("Globalping IP-target options must omit ipVersion");
  }
  const hostOptions = buildGlobalpingMeasurementOptions("example.com", 443);
  if (hostOptions.ipVersion !== 4) throw new Error("Globalping hostname-target options must prefer IPv4");
  const gateTargetInput = [
    { key: "tcp|203.0.113.10|443", verdict: "PASS", members: [{ id: "good" }] },
    { key: "tcp|203.0.113.11|443", verdict: "PASS", members: [{ id: "bad" }] },
  ];
  const gateTargets = chooseGlobalpingGateTargets(gateTargetInput, new Map([
    ["good", { verdict: "PASS-XRAY" }],
    ["bad", { verdict: "FAIL-XRAY" }],
  ]));
  if (gateTargets.length !== 1 || gateTargets[0].key !== "tcp|203.0.113.10|443") {
    throw new Error("Globalping gate Xray-order self-test failed");
  }

  const flattenedProbe = { probe: { city: "Kazan", country: "RU", tags: ["eyeball-network"] }, result: { status: "finished", resolvedAddress: "203.0.113.10", hops: [{ resolvedAddress: "203.0.113.10", stats: { loss: 0 } }] } };
  const probeMeta = flattenedProbe.probe;
  if (probeMeta.city !== "Kazan" || !probeMeta.tags.includes("eyeball-network")) {
    throw new Error("Globalping flattened probe self-test failed");
  }
  const mtrOk = mtrResultReachedTarget({
    result: {
      status: "finished",
      resolvedAddress: "203.0.113.10",
      hops: [{ resolvedAddress: "203.0.113.10", stats: { loss: 0 } }]
    }
  }, "203.0.113.10");
  if (!mtrOk) throw new Error("Globalping MTR parser self-test failed");
  const hostToolsSummary = summarizeHostToolsEvents([{ location: { city: "Yekaterinburg", country: "RU" }, ok: true, status: "open", latencyMs: 41 }]);
  if (hostToolsSummary.passedOtherCities !== 1) throw new Error("host.tools city parser self-test failed");
  const sampleLink = "vless://11111111-1111-1111-1111-111111111111@y:443?security=tls&type=tcp";
  const nonAuthoritativeVerdicts = [
    "PASS-GLOBALPING",
    "PASS-HOSTTOOLS",
    "PASS-HOSTTOOLS-STRONG",
    "PASS-UDP-STRONG",
    "PASS-UDP-NOT-REFUSED",
  ];
  for (const verdict of nonAuthoritativeVerdicts) {
    const expanded = expandPassingLinks([{ link: sampleLink, id: `non-authoritative-${verdict}` }], [{ key: "tcp|y|443", verdict }]);
    if (expanded.length !== 0) throw new Error(`non-authoritative verdict expansion self-test failed: ${verdict}`);
  }
  const expandedCheckHost = expandPassingLinks([{ link: sampleLink, id: "check-host-test" }], [{ key: "tcp|y|443", verdict: "PASS" }]);
  if (expandedCheckHost.length !== 1) throw new Error("Check-Host verdict expansion self-test failed");

  const gpItems = [
    { id: "gp-a", link: sampleLink },
    { id: "gp-b", link: "vless://22222222-2222-2222-2222-222222222222@z:443?security=tls&type=tcp" },
  ];
  const gpXray = new Map([
    ["gp-a", { verdict: "PASS-XRAY" }],
    ["gp-b", { verdict: "PASS-XRAY" }],
  ]);
  const gpEndpoints = new Map([
    ["tcp|y|443", { key: "tcp|y|443", transport: "tcp", globalpingGate: { verdict: "PASS-GLOBALPING", validReachedCities: 2 } }],
    ["tcp|z|443", { key: "tcp|z|443", transport: "tcp", globalpingGate: { verdict: "PASS-GLOBALPING", validReachedCities: 3 } }],
  ]);
  if (globalpingStrictLinks(gpItems, gpXray, gpEndpoints, 2).length !== 2) throw new Error("Globalping 2/3 self-test failed");
  if (globalpingStrictLinks(gpItems, gpXray, gpEndpoints, 3).length !== 1) throw new Error("Globalping 3/3 self-test failed");
  const safeWhenDown = buildGlobalpingSafeLinks(gpItems, gpXray, gpEndpoints, { attempted: 0, serviceAvailable: false, failOpen: true });
  if (safeWhenDown.length !== 2) throw new Error("Globalping fail-open self-test failed");
  gpEndpoints.get("tcp|y|443").globalpingGate = { verdict: "FAIL-GLOBALPING", validReachedCities: 0 };
  const safeAfterRealFail = buildGlobalpingSafeLinks(gpItems, gpXray, gpEndpoints, { attempted: 2, serviceAvailable: true, failOpen: false });
  if (safeAfterRealFail.length !== 1 || !safeAfterRealFail.includes(gpItems[1].link)) throw new Error("Globalping real-fail filtering self-test failed");
  console.log("RUSSIA TEST V3 SELF-TEST: PASS");
}

function getXrayVerifiedLinks(items, xrayById) {
  return [...new Set(items
    .filter(item => exactXrayPassing(item, xrayById))
    .map(item => String(item.link || "").trim())
    .filter(Boolean))];
}

function linkEndpointRow(link, endpointByKey) {
  try { return endpointByKey.get(endpointKey(link)) || null; }
  catch { return null; }
}

function globalpingStrictLinks(items, xrayById, endpointByKey, minimumCities) {
  return [...new Set(items
    .filter(item => exactXrayPassing(item, xrayById))
    .filter(item => {
      const endpoint = linkEndpointRow(String(item.link || "").trim(), endpointByKey);
      if (!endpoint || endpoint.transport !== "tcp") return false;
      const reached = Number(endpoint?.globalpingGate?.validReachedCities);
      return Number.isFinite(reached) && reached >= minimumCities && reached <= 3;
    })
    .map(item => String(item.link || "").trim())
    .filter(Boolean))];
}

function buildGlobalpingSafeLinks(items, xrayById, endpointByKey, globalpingGate) {
  const baseline = getXrayVerifiedLinks(items, xrayById);
  if (!baseline.length) return [];

  const serviceUnavailable = !globalpingGate?.attempted || globalpingGate?.serviceAvailable === false || globalpingGate?.failOpen === true;
  if (serviceUnavailable) return baseline;

  return baseline.filter(link => {
    const endpoint = linkEndpointRow(link, endpointByKey);
    if (!endpoint) return true;
    if (endpoint.transport !== "tcp") return true; // Globalping TCP gate does not certify UDP/Hysteria.
    const result = endpoint.globalpingGate;
    if (!result) return true; // Not tested because of budget/rate-limit: fail-open for this endpoint.
    if (result.verdict === "UNKNOWN-GLOBALPING") return true; // Service/measurement failure: fail-open.
    return Number(result.validReachedCities) >= 2;
  });
}

function globalpingFilesSummary(beforeLinks, twoOfThreeLinks, threeOfThreeLinks, safeLinks, gate) {
  return {
    beforeGlobalping: beforeLinks.length,
    strict2of3: twoOfThreeLinks.length,
    strict3of3: threeOfThreeLinks.length,
    safeAfterGlobalping: safeLinks.length,
    removedByStrict2of3: Math.max(0, beforeLinks.filter(Boolean).length - twoOfThreeLinks.length),
    attemptedEndpoints: gate?.attempted || 0,
    tested2of3: gate?.passed2of3 || 0,
    tested3of3: gate?.passed3of3 || 0,
    failOpen: Boolean(gate?.failOpen),
    serviceAvailable: gate?.serviceAvailable !== false,
  };
}

  runLteRussiaCheckerV3 = async function runLteRussiaCheckerV3(items) {
    if (SELF_TEST) runSelfTest();

    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!safeItems.length) {
      return {
        byId: new Map(),
        diagnostics: {
          generatedAt: new Date().toISOString(),
          scope: "lte",
          candidates: 0,
          endpoints: 0,
          xray: {},
          globalping: { attempted: 0, passed2of3: 0, passed3of3: 0, failOpen: true, skipped: "no-candidates" },
          hostToolsRecovery: { attempted: 0, recovered: 0, strongRecovered: 0, skipped: "no-candidates" },
        },
      };
    }

    const checkHostDiscovery = await discoverCheckHostRussiaNodes();
    const globalping = await prepareGlobalpingContext();

    const endpointWorkset = buildEndpointWorkset(safeItems);
    console.log(
      `LTE V3 WORKSET: candidates=${safeItems.length}; ` +
      `uniqueEndpoints=${endpointWorkset.length}; protocols=${JSON.stringify(protocolSummary(safeItems))}`
    );

    const rawResults = await runPool(
      endpointWorkset,
      endpoint => checkEndpoint(endpoint, globalping)
    );

    const endpoints = rawResults.map((result, i) => ({
      key: endpointWorkset[i].key,
      link: endpointWorkset[i].link,
      protocol: endpointWorkset[i].protocol,
      transport: endpointWorkset[i].transport,
      ...result,
      members: endpointWorkset[i].members,
      candidateIds: endpointWorkset[i].members.map(member => member.id),
      remarks: endpointWorkset[i].members.map(member => member.remarks).filter(Boolean).slice(0, 3),
    }));

    const xrayById = await runXrayCandidateChecks(safeItems, endpoints);
    const globalpingGate = await runGlobalpingGatePass(
      endpoints,
      safeItems,
      xrayById,
      globalping
    );
    const hostToolsRecovery = await runHostToolsRecoveryPass(
      endpoints,
      safeItems,
      xrayById
    );

    const endpointByKey = new Map(endpoints.map(endpoint => [endpoint.key, endpoint]));
    const safeLinks = buildGlobalpingSafeLinks(
      safeItems,
      xrayById,
      endpointByKey,
      globalpingGate
    );
    const safeLinkSet = new Set(safeLinks);

    const byId = new Map();
    for (const item of safeItems) {
      const id = String(item?.id || "");
      const link = String(item?.link || "").trim();
      let endpoint = null;
      try {
        endpoint = endpointByKey.get(endpointKey(link)) || null;
      } catch {}

      const xray = xrayById.get(id) || null;
      const gp = endpoint?.globalpingGate || null;
      const transport = endpoint?.transport || transportOf(protocolOf(link));
      const ok = safeLinkSet.has(link);

      let reason = "";
      if (!ok) {
        if (!endpoint) {
          reason = "LTE v3: endpoint was not checked";
        } else if (!xray || !["PASS-XRAY", "PASS-XRAY-CLOUDFLARE"].includes(xray.verdict)) {
          reason = `LTE v3 Xray failed: ${xray?.verdict || "UNKNOWN-XRAY"}`;
        } else if (transport === "tcp" && gp?.verdict === "FAIL-GLOBALPING") {
          reason =
            `LTE v3 Globalping failed: ${Number(gp?.validReachedCities || 0)}/` +
            `${globalpingGate?.endpoints?.find(row => row.key === endpoint.key)?.requiredDistinctCities || 2} valid Russian cities`;
        } else {
          reason = `LTE v3 rejected: ${gp?.verdict || "no-final-verdict"}`;
        }
      }

      const xrayStages = xray
        ? `${xray.verdict}${xray.confidence ? ` (${xray.confidence})` : ""}`
        : "not-run";
      const gpStages = transport === "tcp"
        ? (
            gp?.verdict
              ? ` + Globalping ${gp.verdict} ${Number(gp.validReachedCities || 0)}/3`
              : " + Globalping not-tested/fail-open"
          )
        : " + Globalping skipped for UDP";
      const stages =
        `Check-Host ${endpoint?.verdict || "UNKNOWN"}` +
        ` + Xray ${xrayStages}` +
        gpStages;

      byId.set(id, {
        ok,
        protocol: protocolOf(link),
        transport,
        stages,
        reason,
        endpoint,
        xray,
        globalping: gp,
        hostToolsRecovery,
        quality: xray?.speedFallback || null,
      });
    }

    return {
      byId,
      diagnostics: {
        generatedAt: new Date().toISOString(),
        scope: "lte",
        candidates: safeItems.length,
        uniqueEndpoints: endpoints.length,
        checkHostDiscovery,
        globalping,
        globalpingGate,
        hostToolsRecovery,
        xrayById: Object.fromEntries(xrayById),
        endpointVerdicts: endpoints.reduce((acc, row) => {
          const key = String(row.verdict || "UNKNOWN");
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        safeLinks,
        beforeGlobalpingLinks: getXrayVerifiedLinks(safeItems, xrayById),
        globalping2of3Links: globalpingStrictLinks(safeItems, xrayById, endpointByKey, 2),
        globalping3of3Links: globalpingStrictLinks(safeItems, xrayById, endpointByKey, 3),
      },
    };
  };
}

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
        const hasUdpTimeout =
            transport === "udp" &&
            (first.timeout === true || Number(first.timeout) > 0);

        // Check-Host's UDP result may encode a non-refused probe as a raw
        // object like { address: "…", timeout: 1 } without an `error` field.
        // The experimental LTE checker intentionally treated that state as
        // "open or filtered"/UDP-usable and left the real protocol proof to
        // Xray. Preserve the same semantics in the production gate so
        // Hysteria2/TUIC candidates are not discarded before Xray.
        if (transport === "udp" && (hasUdpTimeout || /open or filtered|filtered|timeout|timed? out/i.test(error))) {
            return {
                node,
                reachable: false,
                inconclusive: true,
                udpUsable: true,
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
        udpUsable: transport === "udp",
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
    // UDP Check-Host cannot prove a Hysteria/QUIC handshake. For the first
    // Russian transport gate, however, the experimental LTE checker treated
    // "open or filtered"/timeout as a non-refused UDP result. Preserve that
    // conservative prefilter semantics here; exact Xray health remains the
    // authoritative application-level check.
    const positive = transport === "udp"
        ? parsed.filter(x => x.reachable || x.udpUsable)
        : reachable;

    if (positive.length >= requiredReachable) {
        return {
            done: true,
            result: {
                provider: "check-host",
                ok: true,
                unavailable: false,
                inconclusive: false,
                transport,
                nodesTested: parsed.length,
                nodesReachable: positive.length,
                nodesInconclusive: unresolved.length,
                quorumRequired: requiredReachable,
                quorumMet: true,
                minLatencyMs: reachable.length ? Math.min(...reachable.map(x => x.latencyMs)) : 0,
                results: parsed
            }
        };
    }

    if (positive.length + unresolved.length < requiredReachable) {
        return {
            done: true,
            result: {
                provider: "check-host",
                ok: false,
                unavailable: false,
                inconclusive: false,
                transport,
                nodesTested: parsed.length,
                nodesReachable: positive.length,
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
        minLatencyMs: Number(checkHost.minLatencyMs) > 0 ? Number(checkHost.minLatencyMs) : 0,
        checkedAt: Date.now()
    };
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
    // Fast is a location feature: one physical server per selected country.
    const selected = [];
    const selectedKeys = new Set();
    const selectedCountries = new Set();

    for (const row of ranked) {
        const result = row.result;
        const key = String(result.linkFingerprint || result.link || '');
        if (!key || selectedKeys.has(key)) continue;

        const country = String(result.country || '').trim();
        if (!country) continue;
        const countryKey = country.toLowerCase();
        if (!allowedCountries.has(countryKey) || FEATURED_EXCLUDED_COUNTRIES.has(countryKey)) continue;

        // Fast is a location feature: one physical server per selected country.
        if (selectedCountries.has(countryKey)) continue;

        selectedCountries.add(countryKey);
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
        if (
            !country ||
            excluded.has(key) ||
            !allowedCountries.has(key) ||
            FEATURED_EXCLUDED_COUNTRIES.has(key)
        ) continue;

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
            const rank = fast.find(item => item.linkFingerprint === result.linkFingerprint)?.rank || 0;
            const flag = extractFlag(result.remarks) || countryFlag(result.country) || '🌐';
            const country = String(result.country || '').trim();

            entry.featured = 'fast';
            entry.featuredRank = rank;
            entry.flag = flag;
            entry.country = country;
            entry.remarks = `${flag} 🔥 ${country}`.trim();
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
        new Set(),
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

async function main() {
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

        // Russia reachability is a pre-gate for every managed candidate.
        // Servers definitely unreachable from Russia never consume the expensive
        // Xray + HTTPS + multi-provider speed budget.
        if (russiaProbe) {
            if (!russiaProbe.gatePassed && !russiaProbe.gatePending) {
                return {
                    item,
                    ok: false,
                    protocol,
                    russiaProbe,
                    reason:
                        `Russia reachability failed: Check-Host ${russiaProbe.checkHost?.nodesReachable || 0}/${russiaProbe.checkHost?.nodesTested || 0}`,
                };
            }
        }

        const transport = getTransportType(protocol);
        const stage1 = transport === "tcp"
            ? await tcpProbe(url.hostname, url.port)
            : true;

        if (!stage1) {
            return {
                item,
                ok: false,
                protocol,
                russiaProbe,
                reason: "TCP unreachable"
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

            const targets = [...new Set(
                HEALTH_TARGET_URLS
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
            const connection = connectionMetrics(remote);

            // Synthetic HTTPS targets are diagnostic-only for regular servers.
            // Real download quality remains the authoritative heavy health signal.
            const quality = await runIndependentSpeedCheck(xray.socksPort);

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
                        `${transport.toUpperCase()} + Xray + real speed check failed ` +
                        `(${quality.passedCount}/${quality.providerCount} providers, ` +
                        `median ${quality.medianKbps} KB/s). ` +
                        `Synthetic HTTPS diagnostics: ${passedTargets.length}/${targets.length} passed` +
                        `${details ? `; ${details}` : ""}`,
                    quality,
                    connection,
                    remote,
                };
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
                    `${transport.toUpperCase()} + Xray + ${passedTargets.length}/${targets.length} HTTPS + ` +
                    `quality ${quality.passedCount}/${quality.providerCount} probes passed ` +
                    `(avg passing ${quality.kbps} KB/s)`,
                quality,
                connection,
                gaming: {
                    ...gaming,
                    latencyProbeError: gamingLatency.error || "",
                },
                remote,
                updateConnectivity: null,
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
    // every regular candidate is checked (or reused from a recent cached result),
    // then the full gate is persisted for the next job. The normal health mode
    // only consumes that immutable gate output for regular servers; LTE uses v3 Check-Host independently.
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
            `RUSSIA GATE START: Check-Host=${ACTIVE_CHECK_HOST_RUSSIA_NODES.length} live Russian nodes for regular candidates; ` +
            `strategy=${russiaCheckerMode === "dual" ? "strict-positive-reachability-2-of-2" : russiaCheckerMode === "single" ? "single-live-node-warning-mode" : "skipped-all-checkers-unavailable"}; ` +
            `cache=${RUSSIA_GATE_USE_CACHE ? "enabled" : "disabled"}; ` +
            `LTE checker v3 is integrated into Heavy; ` +
            `adaptive-pacing=global-api>=${CHECK_HOST_TOTAL_MIN_INTERVAL_MS}ms; ` +
            `nodes=${ACTIVE_CHECK_HOST_RUSSIA_NODES.join(",") || "none"}`
        );

        const requiredRussiaItems = managedItems.filter(item => !isLteCandidate(item, candidateMap[fingerprintLink(item?.link || "")] || null));

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
            console.warn(`⚠️ RUSSIA GATE SKIPPED: no usable Russian Check-Host nodes; ${requiredRussiaItems.length} candidates go directly to Heavy`);
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
            const sourceMeta = candidateMap[fp] || null;
            const lte = isLteCandidate(item, sourceMeta);

            if (lte) {
                return {
                    id: item.id,
                    link: String(item.link || "").trim(),
                    source: sourceMeta?.source || item.source || "retained/manual",
                    country: sourceMeta?.country || "",
                    required: false,
                    gatePassed: true,
                    gatePending: false,
                    skipped: true,
                    checkedAt: Date.now(),
                    reason: "LTE is checked by the integrated Russia checker v3 during Heavy health stage",
                    probe: {
                        provider: "integrated-russia-checker-v3",
                        required: false,
                        skipped: true,
                        gatePassed: true,
                        gatePending: false,
                        checkedAt: Date.now(),
                        reason: "LTE is intentionally excluded from the legacy Russia Gate",
                    },
                };
            }

            const probe = russiaProbeByFingerprint.get(fp) || {
                required: true,
                gatePassed: false,
                gatePending: false,
                checkedAt: Date.now(),
                reason: "Russia gate result missing"
            };

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

    russiaGateChecked = Number(gateReport?.requiredCandidates) || 0;
    russiaGatePassed = Number(gateReport?.allowedCandidates) || 0;
    russiaGateFailures = Number(gateReport?.failedCandidates) || 0;
    russiaGatePending = Math.max(0, Number(gateReport?.requiredCandidates) - russiaGatePassed - russiaGateFailures);

    // Regular candidates must first pass the legacy Russia Gate.
    // LTE/whitelist candidates intentionally bypass that legacy gate and are
    // checked exclusively by the integrated Russia checker v3 below.
    const healthEligibleItems = [];
    const lteItems = [];
    for (const item of managedItems) {
        const fp = fingerprintLink(item.link || "");
        const sourceMeta = candidateMap[fp] || null;
        const lte = isLteCandidate(item, sourceMeta);

        if (lte) {
            lteItems.push(item);
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
            reason: `Russia reachability failed: Check-Host ${probe?.checkHost?.nodesReachable || 0}/${probe?.checkHost?.nodesTested || 0}`,
            quality: null, connection: null, gaming: null, remote: [], updateConnectivity: null,
            russiaProbe: probe || null, telegram: null
        });
    }

    const regularHealthItems = healthEligibleItems.filter(
        item => !isLteCandidate(item, candidateMap[fingerprintLink(item?.link || "")] || null)
    );

    console.log(
        `HEALTH AFTER RUSSIA GATE: regular=${regularHealthItems.length}/${checked}; ` +
        `LTE delegated exclusively to integrated Russia checker v3=${lteItems.length}`
    );

    cursor = 0;
    managedItems.splice(0, managedItems.length, ...regularHealthItems);
    const heavyChecked = managedItems.length;

    const workerCount = Math.min(HEALTH_CONCURRENCY, managedItems.length || 1);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    let lteV3Diagnostics = null;
    if (lteItems.length) {
        const lteV3 = await runLteRussiaCheckerV3(lteItems);
        lteV3Diagnostics = lteV3.diagnostics;

        for (const item of lteItems) {
            const fp = fingerprintLink(item.link || "");
            const sourceMeta = candidateMap[fp] || null;
            const row = lteV3.byId.get(String(item.id)) || {};
            const resolvedCountry =
                normalizeCountryName(sourceMeta?.country || "") ||
                normalizeCountryName(extractWhiteListCountryFromRemarks(item.remarks || "")) ||
                "Europe";

            healthResults.push({
                id: item.id,
                remarks: item.remarks || "",
                link: String(item.link || "").trim(),
                configFile: item.configFile || null,
                sourceKind: item.sourceKind || null,
                country: resolvedCountry,
                whiteList: true,
                source: sourceMeta?.source || item.source || "retained/manual",
                linkFingerprint: fp,
                ok: Boolean(row.ok),
                protocol: row.protocol || getProtocol(item.link || ""),
                stages: row.stages || "LTE Russia checker v3",
                reason: row.reason || "",
                quality: row.quality || null,
                connection: null,
                gaming: null,
                remote: row.endpoint?.nodes || [],
                updateConnectivity: null,
                russiaProbe: null,
                globalping: row.globalping || null,
                lteV3: {
                    endpointVerdict: row.endpoint?.verdict || "UNKNOWN",
                    xrayVerdict: row.xray?.verdict || "UNKNOWN-XRAY",
                    globalpingVerdict: row.globalping?.verdict || null,
                },
                telegram: null,
            });

            if (row.ok) {
                passed += 1;
            } else {
                failed += 1;
            }
        }
    }

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

    // Europe is a permanent visible location and therefore counts toward the
    // Fast/Gaming thresholds.
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
            gatedAllManagedCandidates: false,
            lteDiagnosticOnly: false,
            lteCheckerV3: true,
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
            globalpingDiagnosticOnly: false,
            lteCheckerV3: lteV3Diagnostics
                ? {
                    candidates: lteV3Diagnostics.candidates,
                    uniqueEndpoints: lteV3Diagnostics.uniqueEndpoints,
                    globalping: lteV3Diagnostics.globalpingGate || null,
                    xray: lteV3Diagnostics.xrayById || {},
                    safeLinks: lteV3Diagnostics.safeLinks || [],
                }
                : null,
            russiaGatePassed,
            russiaGateFailures,
            russiaGatePending,
            policy: "Russia Gate uses the preferred geographically independent checker pairs ru2+ru3, then ru1+ru3, then ru1+ru2. With two live nodes, both must positively verify the candidate; with one live node, that node is used in warning mode; with zero live nodes, Russia Gate is skipped and candidates proceed directly to Heavy. Check-Host 429/5xx/timeout or unresolved results are UNKNOWN/PENDING and never an automatic PASS while a checker is available. The Russia transport gate applies to LTE/whitelist candidates too. Globalping is LTE-only, runs after Xray, accepts 2/3 selected Russian eyeball cities, keeps 3/3 as a stronger diagnostic tier, and is fail-open on Globalping service failure. Regular servers never use Globalping."
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
            `- Regular-server synthetic HTTPS targets are diagnostics only; they no longer decide server eligibility`,
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
