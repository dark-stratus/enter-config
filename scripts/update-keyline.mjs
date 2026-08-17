import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const LINKS_DIR = path.join(ROOT, "config", "links");
const INDEX_FILE = path.join(LINKS_DIR, "index.json");
const STATE_FILE = path.join(ROOT, ".keyline-state.json");

const REGULAR_LIMIT = 40;
const AUTO_WHITE_LIST_LIMIT = 20;
const SUCCESS_INTERVAL_MS = 12 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 2_000;

const HAPP_APP_VERSION = "2.16.2";
const HAPP_BUILD_ID = "2605221224503";
const HAPP_DEVICE_LOCALE = "RU";
const HAPP_DEVICE_OS = "Windows";
const HAPP_OS_VERSION = "10_10.0.19045";

const MANAGED_REGULAR_RE = /^keyline-regular-\d+$/i;
const MANAGED_WHITE_LIST_RE = /^keyline-whitelist-\d+$/i;

function isManagedId(id) {
  return MANAGED_REGULAR_RE.test(id) || MANAGED_WHITE_LIST_RE.test(id);
}

const FLAG_TO_COUNTRY = {
  "🇦🇱": "Albania",
  "🇦🇹": "Austria",
  "🇧🇪": "Belgium",
  "🇧🇷": "Brazil",
  "🇨🇭": "Switzerland",
  "🇨🇳": "China",
  "🇨🇿": "Czech Republic",
  "🇩🇪": "Germany",
  "🇩🇰": "Denmark",
  "🇪🇪": "Estonia",
  "🇪🇸": "Spain",
  "🇫🇮": "Finland",
  "🇫🇷": "France",
  "🇬🇧": "United Kingdom",
  "🇬🇷": "Greece",
  "🇭🇰": "Hong Kong",
  "🇮🇩": "Indonesia",
  "🇮🇪": "Ireland",
  "🇮🇳": "India",
  "🇮🇱": "Israel",
  "🇮🇹": "Italy",
  "🇯🇵": "Japan",
  "🇰🇿": "Kazakhstan",
  "🇱🇹": "Lithuania",
  "🇱🇻": "Latvia",
  "🇲🇽": "Mexico",
  "🇳🇱": "Netherlands",
  "🇳🇴": "Norway",
  "🇳🇿": "New Zealand",
  "🇵🇱": "Poland",
  "🇵🇹": "Portugal",
  "🇷🇴": "Romania",
  "🇷🇺": "Russia",
  "🇸🇪": "Sweden",
  "🇸🇬": "Singapore",
  "🇸🇮": "Slovenia",
  "🇸🇰": "Slovakia",
  "🇹🇭": "Thailand",
  "🇹🇷": "Turkey",
  "🇺🇦": "Ukraine",
  "🇺🇸": "United States",
  "🇻🇳": "Vietnam",
};

const WHITE_LIST_PATTERNS = [
  /\bwhite\s*list\b/i,
  /\bwhitelist\b/i,
  /бел\w*/i,
  /обход\w*/i,
  /глушил\w*/i,
  /\blte\b/i,
  /\bblock\s*list\b/i,
  /\bblocklist\b/i,
  /🏳️?/u,
];

function isWhiteListRemark(remarks = "") {
  const value = String(remarks);

  return WHITE_LIST_PATTERNS.some(pattern => pattern.test(value));
}

function extractFlag(remarks = "") {
  const match = String(remarks).match(
    /(?:^|\s)([\u{1F1E6}-\u{1F1FF}]{2})(?=\s|$)/u
  );

  return match?.[1] || "🏳️";
}

function countryFromRemark(remarks = "") {
  const flag = extractFlag(remarks);
  return {
    flag,
    country: FLAG_TO_COUNTRY[flag] || "Unknown",
  };
}

function isAutoSelectionRemark(remarks = "") {
  return /^🚀\s*авто\s*выбор/i.test(String(remarks).trim());
}

function normalizeAutoRemark(remarks = "") {
  return isAutoSelectionRemark(remarks);
}

function normalizeCountryRemark(remarks = "") {
  const original = String(remarks).replace(/\s+/g, " ").trim();
  const { flag, country } = countryFromRemark(original);

  if (country === "Unknown") return null;
  if (isAutoSelectionRemark(original)) return null;

  return {
    flag,
    country,
    whiteList: isWhiteListRemark(original),
  };
}

function normalizeJsonText(text) {
  return String(text).replace(/^\uFEFF/, "").trim();
}

function safeJsonParse(text, source) {
  try {
    return JSON.parse(normalizeJsonText(text));
  } catch (error) {
    const normalized = normalizeJsonText(text);
    const preview = normalized
      .slice(0, 240)
      .replace(/\s+/g, " ");

    throw new Error(
      `${source}: invalid JSON (${error.message}); ` +
      `response length=${normalized.length}; ` +
      `preview=${JSON.stringify(preview)}`
    );
  }
}

function looksLikeBase64(text) {
  const normalized = String(text).replace(/\s+/g, "");

  if (!normalized || normalized.length < 16) return false;
  if (!/^[A-Za-z0-9+/_=-]+$/.test(normalized)) return false;

  return normalized.length % 4 === 0 || normalized.endsWith("=");
}

function decodeBase64Text(text) {
  const normalized = String(text)
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const buffer = Buffer.from(normalized, "base64");

  if (!buffer.length) {
    throw new Error("base64 payload decoded to an empty response");
  }

  const decoded = buffer.toString("utf8");
  const printable = [...decoded].filter(char => (
    char === "\n" ||
    char === "\r" ||
    char === "\t" ||
    char >= " "
  )).length;

  if (decoded.length === 0 || printable / decoded.length < 0.85) {
    throw new Error("base64 payload is not valid UTF-8 text");
  }

  return decoded;
}

function stripProfileMetadata(text) {
  return String(text)
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith("#"))
    .join("\n")
    .trim();
}

function extractProfileLinks(text) {
  const links = [];
  const lines = String(text).split(/\r?\n/);

  for (const line of lines) {
    const value = line.trim();

    if (!value || value.startsWith("#")) continue;

    const matches = value.match(
      /(?:vless|trojan|hysteria2):\/\/[^\s]+/gi
    );

    if (!matches) continue;

    for (const link of matches) {
      links.push(link.replace(/[\]}>\],;]+$/, ""));
    }
  }

  return [...new Set(links)];
}

function extractJsonAfterMetadata(text, source) {
  const payload = stripProfileMetadata(text);

  if (!payload.startsWith("[") && !payload.startsWith("{")) {
    return null;
  }

  return safeJsonParse(payload, source);
}

function parseSubscriptionPayload(text, contentType, source) {
  const raw = normalizeJsonText(text);

  if (!raw) {
    throw new Error(
      `${source}: empty response; content-type=${contentType || "unknown"}`
    );
  }

  try {
    const parsed = safeJsonParse(raw, source);

    return {
      kind: "json",
      data: parsed,
    };
  } catch {}

  const candidates = [raw];

  if (looksLikeBase64(raw)) {
    try {
      candidates.push(decodeBase64Text(raw));
    } catch {}
  }

  let lastError = null;

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    try {
      const parsed = extractJsonAfterMetadata(candidate, source);

      if (parsed !== null) {
        return {
          kind: "json",
          data: parsed,
        };
      }
    } catch (error) {
      lastError = error;
    }

    const links = extractProfileLinks(candidate);

    if (links.length > 0) {
      return {
        kind: "links",
        data: links,
      };
    }
  }

  const preview = raw
    .slice(0, 240)
    .replace(/\s+/g, " ");

  throw new Error(
    `${source}: unsupported subscription response; ` +
    `content-type=${contentType || "unknown"}; ` +
    `response length=${raw.length}; ` +
    `preview=${JSON.stringify(preview)}` +
    (lastError ? `; ${lastError.message}` : "")
  );
}

async function readState() {
  try {
    const text = await fs.readFile(STATE_FILE, "utf8");
    const state = safeJsonParse(text, STATE_FILE);

    return Number.isFinite(state.lastSuccessfulUpdateAt)
      ? state
      : { lastSuccessfulUpdateAt: 0 };
  } catch (error) {
    if (error.code === "ENOENT") return { lastSuccessfulUpdateAt: 0 };
    throw error;
  }
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function createHappDeviceModel() {
  const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `LAPTOP-${suffix}_x86_64`;
}

async function getHappClientIdentity() {
  const state = await readState();

  const hwid = isUuid(state.happHwid)
    ? state.happHwid
    : crypto.randomUUID();

  const deviceModel = (
    typeof state.happDeviceModel === "string" &&
    /^LAPTOP-[A-Z0-9]+_x86_64$/.test(state.happDeviceModel)
  )
    ? state.happDeviceModel
    : createHappDeviceModel();

  return {
    hwid,
    deviceModel,
  };
}

async function shouldSkip() {
  if (process.env.FORCE_KEYLINE_REFRESH === "1") {
    console.log("Forced Keyline refresh requested; ignoring update interval.");
    return false;
  }

  const state = await readState();
  const elapsed = Date.now() - state.lastSuccessfulUpdateAt;

  if (
    state.lastSuccessfulUpdateAt > 0 &&
    elapsed < SUCCESS_INTERVAL_MS
  ) {
    const nextAt = new Date(
      state.lastSuccessfulUpdateAt + SUCCESS_INTERVAL_MS
    );

    console.log(
      `Keyline update skipped until ${nextAt.toISOString()}.`
    );

    return true;
  }

  return false;
}

function parseUrlList(value) {
  if (!value) return [];

  return String(value)
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parseConfiguredUrls(value) {
  if (!value) return [];

  const raw = String(value).trim();

  if (raw.startsWith("[")) {
    const parsed = safeJsonParse(raw, "KEYLINE_URLS");

    if (!Array.isArray(parsed)) {
      throw new Error("KEYLINE_URLS JSON value must be an array.");
    }

    return parsed
      .map(item => String(item).trim())
      .filter(Boolean);
  }

  return parseUrlList(raw);
}

function uniqueUrls(urls) {
  return [...new Set(urls)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function responsePreview(text) {
  return normalizeJsonText(text)
    .slice(0, 240)
    .replace(/\s+/g, " ");
}

async function fetchJsonUrl(url, label, clientIdentity) {
  let lastError = null;

  const headers = {
    "user-agent": `Happ/${HAPP_APP_VERSION}/${HAPP_DEVICE_OS}/${HAPP_BUILD_ID}`,
    "x-app-version": HAPP_APP_VERSION,
    "x-device-locale": HAPP_DEVICE_LOCALE,
    "x-device-os": HAPP_DEVICE_OS,
    "x-device-model": clientIdentity.deviceModel,
    "x-hwid": clientIdentity.hwid,
    "x-ver-os": HAPP_OS_VERSION,
    accept: "*/*",
    "accept-language": "ru-RU,en,*",
    "accept-encoding": "gzip, deflate",
  };

  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers,
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          `${label}: HTTP ${response.status}; ` +
          `response length=${text.length}; ` +
          `preview=${JSON.stringify(responsePreview(text))}`
        );
      }

      const contentType = response.headers.get("content-type") || "unknown";
      const payload = parseSubscriptionPayload(text, contentType, label);

      if (payload.kind === "json") {
        return payload;
      }

      return payload;
    } catch (error) {
      lastError = error;

      if (attempt < FETCH_RETRIES) {
        console.warn(
          `${label}: attempt ${attempt}/${FETCH_RETRIES} failed: ` +
          `${error.message}. Retrying in ${FETCH_RETRY_DELAY_MS} ms...`
        );

        await sleep(FETCH_RETRY_DELAY_MS);
      }
    }
  }

  throw lastError || new Error(`${label}: unknown fetch error`);
}

async function fetchKeylineSources() {
  const clientIdentity = await getHappClientIdentity();

  console.log(
    `Using Happ client identity: device=${clientIdentity.deviceModel}, ` +
    `hwid=${clientIdentity.hwid.slice(0, 8)}…`
  );

  const fixtureJson = process.env.KEYLINE_FIXTURE_JSON;

  if (fixtureJson) {
    return {
      clientIdentity,
      sources: [{
        label: "fixture",
        data: safeJsonParse(fixtureJson, "KEYLINE_FIXTURE_JSON"),
        payloadKind: "json",
        forceWhiteList: false,
      }],
    };
  }

  const fixturePath = process.env.KEYLINE_FIXTURE;

  if (fixturePath) {
    const resolved = path.resolve(process.cwd(), fixturePath);
    const text = await fs.readFile(resolved, "utf8");

    return {
      clientIdentity,
      sources: [{
        label: resolved,
        data: safeJsonParse(text, resolved),
        payloadKind: "json",
        forceWhiteList: false,
      }],
    };
  }

  const configuredRegularUrls = parseConfiguredUrls(
    process.env.KEYLINE_URLS
  );

  const regularUrls = uniqueUrls(
    configuredRegularUrls.length > 0
      ? configuredRegularUrls
      : parseUrlList(process.env.KEYLINE_URL)
  );

  const dedicatedWhiteListUrls = uniqueUrls(
    parseUrlList(process.env.KEYLINE_WHITE_LIST_URLS)
  );

  const sources = [];
  const failures = [];

  // Every configured subscription is read once per attempt, using the
  // same client identity and headers as a normal Windows Happ client.
  for (let index = 0; index < regularUrls.length; index += 1) {
    const url = regularUrls[index];
    const label = `Keyline source ${index + 1}`;

    try {
      const data = await fetchJsonUrl(url, label, clientIdentity);

      sources.push({
        label,
        data: data.data,
        payloadKind: data.kind,
        forceWhiteList: false,
      });

      console.log(`${label}: OK`);
    } catch (error) {
      failures.push({
        label,
        message: error.message,
      });

      console.error(`${label}: FAILED — ${error.message}`);
    }
  }

  for (let index = 0; index < dedicatedWhiteListUrls.length; index += 1) {
    const url = dedicatedWhiteListUrls[index];
    const label = `Keyline White List source ${index + 1}`;

    try {
      const data = await fetchJsonUrl(
        url,
        label,
        clientIdentity
      );

      sources.push({
        label,
        data: data.data,
        payloadKind: data.kind,
        forceWhiteList: true,
      });

      console.log(`${label}: OK`);
    } catch (error) {
      failures.push({
        label,
        message: error.message,
      });

      console.error(`${label}: FAILED — ${error.message}`);
    }
  }

  if (sources.length === 0 && failures.length === 0) {
    throw new Error(
      "No Keyline URLs configured. Set KEYLINE_URLS with one /sub/... URL per line."
    );
  }

  if (failures.length > 0) {
    const details = failures
      .map(item => `- ${item.label}: ${item.message}`)
      .join("\n");

    throw new Error(
      `Keyline refresh aborted: ${failures.length} source(s) failed.\n${details}\n` +
      "Existing Keyline pool is preserved."
    );
  }

  return {
    clientIdentity,
    sources,
  };
}

function encodeQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => (
      value !== undefined &&
      value !== null &&
      value !== ""
    ))
    .map(([key, value]) => (
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    ))
    .join("&");
}

function encodeLinkUsername(value) {
  return encodeURIComponent(String(value ?? ""));
}

function buildRealityQuery(reality, extra = {}) {
  return encodeQuery({
    security: extra.security || "reality",
    sni: reality?.serverName || "",
    pbk: reality?.publicKey || "",
    sid: reality?.shortId || "",
    fp: reality?.fingerprint || "",
    alpn: Array.isArray(extra.alpn) ? extra.alpn.join(",") : (extra.alpn || ""),
  });
}

function buildTransportQuery(stream) {
  const network = stream?.network || "tcp";

  const base = {
    type: network,
  };

  if (network === "grpc") {
    base.serviceName = stream.grpcSettings?.serviceName || "";
    base.mode = stream.grpcSettings?.multiMode ? "multi" : "";
  }

  if (network === "ws") {
    base.host =
      stream.wsSettings?.headers?.Host ||
      stream.wsSettings?.host ||
      "";

    base.path = stream.wsSettings?.path || "";
  }

  if (network === "httpupgrade") {
    base.host =
      stream.httpupgradeSettings?.host ||
      stream.httpUpgradeSettings?.host ||
      "";

    base.path =
      stream.httpupgradeSettings?.path ||
      stream.httpUpgradeSettings?.path ||
      "";
  }

  if (network === "xhttp") {
    base.host = stream.xhttpSettings?.host || "";
    base.path = stream.xhttpSettings?.path || "";
    base.mode = stream.xhttpSettings?.mode || "";
  }

  return base;
}

function buildVlessLink(entry) {
  const outbound = entry?.outbounds?.find(
    item => item?.tag === "proxy"
  );

  if (!outbound || outbound.protocol !== "vless") return null;

  const server = outbound.settings?.vnext?.[0];
  const user = server?.users?.[0];
  const stream = outbound.streamSettings || {};

  if (!server?.address || !server?.port || !user?.id) return null;
  if (!stream.network || !stream.security) return null;

  const supportedNetworks = [
    "tcp",
    "grpc",
    "ws",
    "httpupgrade",
    "xhttp",
  ];

  if (!supportedNetworks.includes(stream.network)) return null;

  const reality = stream.realitySettings || {};
  const query = encodeQuery({
    encryption: user.encryption || "none",
    flow: user.flow || "",
    ...buildTransportQuery(stream),
    ...buildRealityQuery(reality, {
      security: stream.security,
    }),
  });

  return (
    `vless://${encodeLinkUsername(user.id)}@${server.address}:${server.port}?${query}`
  );
}

function buildTrojanLink(entry) {
  const outbound = entry?.outbounds?.find(
    item => item?.tag === "proxy"
  );

  if (!outbound || outbound.protocol !== "trojan") return null;

  const server =
    outbound.settings?.servers?.[0] ||
    outbound.settings?.vnext?.[0];

  const stream = outbound.streamSettings || {};

  if (!server?.address || !server?.port || !server?.password) {
    return null;
  }

  const supportedNetworks = [
    "tcp",
    "grpc",
    "ws",
    "httpupgrade",
  ];

  if (!supportedNetworks.includes(stream.network)) return null;

  const tls = stream.tlsSettings || {};
  const query = encodeQuery({
    ...buildTransportQuery({
      ...stream,
      wsSettings: stream.wsSettings,
      grpcSettings: stream.grpcSettings,
      httpupgradeSettings: stream.httpupgradeSettings,
      httpUpgradeSettings: stream.httpUpgradeSettings,
    }),
    security: "tls",
    sni: tls.serverName || "",
    fp: tls.fingerprint || "",
    alpn: Array.isArray(tls.alpn) ? tls.alpn.join(",") : "",
  });

  return (
    `trojan://${encodeLinkUsername(server.password)}@${server.address}:${server.port}?${query}`
  );
}

function buildHysteria2Link(entry) {
  const outbound = entry?.outbounds?.find(
    item => item?.tag === "proxy"
  );

  if (!outbound) return null;

  const protocol = String(outbound.protocol || "").toLowerCase();

  if (protocol !== "hysteria" && protocol !== "hysteria2") {
    return null;
  }

  const settings = outbound.settings || {};
  const stream = outbound.streamSettings || {};
  const tls = stream.tlsSettings || {};
  const hysteria = stream.hysteriaSettings || {};

  const server =
    settings.address
      ? {
          address: settings.address,
          port: settings.port,
        }
      : settings.servers?.[0];

  if (!server?.address || !server?.port) return null;

  const auth =
    hysteria.auth ||
    settings.auth ||
    server.password ||
    "";

  const query = encodeQuery({
    sni: tls.serverName || "",
    alpn: Array.isArray(tls.alpn) ? tls.alpn.join(",") : "",
  });

  return (
    `hysteria2://${encodeLinkUsername(auth)}@${server.address}:${server.port}?${query}`
  );
}

function buildSupportedLink(entry) {
  const outbound = entry?.outbounds?.find(
    item => item?.tag === "proxy"
  );

  if (!outbound) return null;

  if (outbound.protocol === "vless") {
    return buildVlessLink(entry);
  }

  if (outbound.protocol === "trojan") {
    return buildTrojanLink(entry);
  }

  if (
    outbound.protocol === "hysteria" ||
    outbound.protocol === "hysteria2"
  ) {
    return buildHysteria2Link(entry);
  }

  return null;
}

function normalizeProfileLink(link, index, source, forceWhiteList = false) {
  if (typeof link !== "string" || !link.trim()) return null;

  const value = link.trim();
  const protocol = value.split("://")[0]?.toLowerCase();

  if (!["vless", "trojan", "hysteria2"].includes(protocol)) {
    return null;
  }

  let remarks = "";

  try {
    const url = new URL(value);
    remarks = decodeURIComponent(url.hash.replace(/^#/, "")).trim();
  } catch {}

  if (!remarks) {
    remarks = `${source} ${index + 1}`;
  }

  const normalized = normalizeCountryRemark(remarks);
  if (!normalized) return null;

  return {
    sourceIndex: index,
    source,
    originalRemarks: remarks,
    flag: normalized.flag,
    country: normalized.country,
    whiteList: forceWhiteList || normalized.whiteList,
    link: value,
  };
}

function normalizeSourceData(source) {
  if (source.payloadKind === "links") {
    return source.data
      .map((link, index) => normalizeProfileLink(
        link,
        index,
        source.label,
        source.forceWhiteList
      ))
      .filter(Boolean);
  }

  if (!Array.isArray(source.data)) {
    throw new Error(
      `${source.label}: response must be a JSON array. ` +
      "Existing Keyline pool is preserved."
    );
  }

  const result = [];
  let autoEntry = null;

  for (let index = 0; index < source.data.length; index += 1) {
    const normalized = normalizeEntry(
      source.data[index],
      index,
      source.label
    );

    if (normalized === "AUTO_SELECTION") {
      if (!autoEntry) {
        autoEntry = extractAutoLink(source.data[index]);
      }
      continue;
    }

    if (!normalized) continue;
    if (source.forceWhiteList) normalized.whiteList = true;

    result.push(normalized);
  }

  if (autoEntry && result.some(item => item.whiteList)) {
    result.push({
      ...autoEntry,
      whiteList: true,
      isAutoWhiteListCandidate: true,
      originalRemarks: "⚡ Auto White List",
    });
  }

  return result;
}

function extractAutoLink(entry) {
  const outbound = entry?.outbounds?.find(
    item => item?.tag === "proxy"
  );

  if (!outbound) return null;

  const link = buildSupportedLink(entry);
  if (!link) return null;

  return {
    sourceIndex: -1,
    source: "auto",
    flag: "⚡",
    country: "Auto White List",
    link,
  };
}

function normalizeEntry(entry, index, source) {
  if (!entry || typeof entry !== "object") return null;

  const outbounds = Array.isArray(entry.outbounds)
    ? entry.outbounds
    : [];

  const proxy = outbounds.find(item => item?.tag === "proxy");
  const remarks = typeof entry.remarks === "string"
    ? entry.remarks.trim()
    : "";
  const link = buildSupportedLink(entry);

  if (!proxy || !remarks || !link) return null;
  if (isAutoSelectionRemark(remarks)) return "AUTO_SELECTION";

  const normalized = normalizeCountryRemark(remarks);
  if (!normalized) return null;

  return {
    sourceIndex: index,
    source,
    originalRemarks: remarks,
    flag: normalized.flag,
    country: normalized.country,
    whiteList: normalized.whiteList,
    link,
  };
}

function canonicalCountryEntries(entries) {
  const counters = new Map();

  return entries.map(item => {
    if (item.isAutoWhiteListCandidate) return item;

    const key = item.country;
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);

    return {
      ...item,
      remarks: `${item.flag} ${item.country} ${next}`.trim(),
      countryIndex: next,
    };
  });
}

function canonicalAutoWhiteList(entries) {
  if (!entries.length) return [];

  return [{
    ...entries[0],
    remarks: "⚡ Auto White List",
  }];
}

function dedupe(entries) {
  const seen = new Set();
  const result = [];

  for (const item of entries) {
    if (seen.has(item.link)) continue;

    seen.add(item.link);
    result.push(item);
  }

  return result;
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const countryCompare = a.country.localeCompare(b.country, "en");
    if (countryCompare !== 0) return countryCompare;

    return (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0);
  });
}

function normalizeAndNumber(entries) {
  const sorted = sortEntries(entries);
  const counters = new Map();

  return sorted.map(item => {
    if (item.isAutoWhiteListCandidate) return item;

    const key = item.country;
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);

    return {
      ...item,
      remarks: `${item.flag} ${item.country} ${next}`,
      countryIndex: next,
    };
  });
}

async function loadIndex() {
  const text = await fs.readFile(INDEX_FILE, "utf8");
  const index = safeJsonParse(text, INDEX_FILE);

  if (!Array.isArray(index)) {
    throw new Error(
      "config/links/index.json must contain an array."
    );
  }

  return index;
}

async function writeAtomic(file, content) {
  const temp = `${file}.tmp-${process.pid}`;

  await fs.writeFile(temp, content, "utf8");
  await fs.rename(temp, file);
}

async function buildStagedLinks(
  currentIndex,
  regular,
  autoWhiteList,
  manualWhiteList
) {
  const stageDir = path.join(
    ROOT,
    `.keyline-stage-${process.pid}`
  );

  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.cp(LINKS_DIR, stageDir, { recursive: true });

  const stagedManagedFiles = await fs.readdir(stageDir, {
    withFileTypes: true,
  });

  for (const item of stagedManagedFiles) {
    if (!item.isFile() || !item.name.endsWith(".link")) continue;

    const id = item.name.slice(0, -".link".length);

    if (!isManagedId(id)) continue;

    await fs.unlink(path.join(stageDir, item.name));
  }

  const manualEntries = currentIndex.filter(item => (
    item &&
    typeof item.id === "string" &&
    !isManagedId(item.id) &&
    !/^whitelist-\d+$/i.test(item.id)
  ));

  const currentManualWhiteLists = currentIndex.filter(item => (
    item &&
    typeof item.id === "string" &&
    !isManagedId(item.id) &&
    /^whitelist-\d+$/i.test(item.id)
  ));

  const nextEntries = [];
  const manualNonWhite = manualEntries.filter(item => item.id !== "whitelist-1");
  const manualEuropeFirst = manualNonWhite.filter(item => /^europe-\d+$/i.test(item.id));
  const manualOther = manualNonWhite.filter(item => !/^europe-\d+$/i.test(item.id));

  nextEntries.push(...manualEuropeFirst);

  nextEntries.push(...manualOther);

  for (let index = 0; index < regular.length; index += 1) {
    const id = `keyline-regular-${String(index + 1).padStart(2, "0")}`;
    const item = regular[index];

    await fs.writeFile(
      path.join(stageDir, `${id}.link`),
      `${item.link}\n`,
      "utf8"
    );

    nextEntries.push({
      id,
      remarks: item.remarks,
    });
  }

  for (const item of manualWhiteList) {
    const id = item.id;
    const sourceFile = path.join(LINKS_DIR, `${id}.link`);
    const stagedFile = path.join(stageDir, `${id}.link`);

    try {
      await fs.copyFile(sourceFile, stagedFile);
      nextEntries.push(item);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  for (let index = 0; index < autoWhiteList.length; index += 1) {
    const id = `keyline-whitelist-${String(index + 1).padStart(2, "0")}`;
    const item = autoWhiteList[index];

    await fs.writeFile(
      path.join(stageDir, `${id}.link`),
      `${item.link}\n`,
      "utf8"
    );

    nextEntries.push({
      id,
      remarks: item.remarks,
    });
  }

  await fs.writeFile(
    path.join(stageDir, "index.json"),
    `${JSON.stringify(nextEntries, null, 2)}\n`,
    "utf8"
  );

  return {
    stageDir,
    nextEntries,
  };
}

async function replaceLinksDirectory(stageDir) {
  const backupDir = `${LINKS_DIR}.keyline-backup-${process.pid}`;

  await fs.rm(backupDir, { recursive: true, force: true });
  await fs.rename(LINKS_DIR, backupDir);

  try {
    await fs.rename(stageDir, LINKS_DIR);
  } catch (error) {
    await fs.rename(backupDir, LINKS_DIR);
    throw error;
  }

  await fs.rm(backupDir, { recursive: true, force: true });
}

async function main() {
  if (await shouldSkip()) return;

  const {
    clientIdentity,
    sources,
  } = await fetchKeylineSources();
  const allEntries = [];
  let totalRawEntries = 0;

  for (const source of sources) {
    const normalized = normalizeSourceData(source);

    totalRawEntries += source.data.length;
    allEntries.push(...normalized);

    console.log(
      `${source.label}: parsed ${normalized.length} supported entries` +
      ` (${source.payloadKind})`
    );
  }

  const deduped = dedupe(allEntries);

  const regular = normalizeAndNumber(
    deduped.filter(item => (
      !item.whiteList &&
      !item.isAutoWhiteListCandidate
    ))
  ).slice(0, REGULAR_LIMIT);

  const autoCandidates = deduped.filter(
    item => item.isAutoWhiteListCandidate
  );

  const whiteListLocations = normalizeAndNumber(
    deduped.filter(item => (
      item.whiteList &&
      !item.isAutoWhiteListCandidate
    ))
  );

  const autoWhiteList = canonicalAutoWhiteList(autoCandidates);
  const remainingWhiteListSlots = Math.max(
    AUTO_WHITE_LIST_LIMIT - autoWhiteList.length,
    0
  );

  const automaticWhiteList = [
    ...autoWhiteList,
    ...whiteListLocations.slice(0, remainingWhiteListSlots),
  ];

  if (regular.length === 0 && automaticWhiteList.length === 0) {
    throw new Error(
      "Configured Keyline sources returned zero supported servers. " +
      "Existing Keyline pool is preserved."
    );
  }

  const currentIndex = await loadIndex();
  const manualWhiteList = currentIndex.filter(item => (
    item &&
    typeof item.id === "string" &&
    /^whitelist-\d+$/i.test(item.id)
  ));

  const { stageDir } = await buildStagedLinks(
    currentIndex,
    regular,
    automaticWhiteList,
    manualWhiteList
  );

  try {
    await replaceLinksDirectory(stageDir);
  } catch (error) {
    await fs.rm(stageDir, { recursive: true, force: true });
    throw error;
  }

  await writeAtomic(
    STATE_FILE,
    `${JSON.stringify({
      lastSuccessfulUpdateAt: Date.now(),
      sourceCount: sources.length,
      rawEntryCount: totalRawEntries,
      regularCount: regular.length,
      autoWhiteListCount: automaticWhiteList.length,
      happHwid: clientIdentity.hwid,
      happDeviceModel: clientIdentity.deviceModel,
    }, null, 2)}\n`
  );

  console.log(
    `Keyline update complete: ${sources.length} sources, ` +
    `${regular.length} regular, ${automaticWhiteList.length} auto-white-list.`
  );
}

main().catch(error => {
  console.error(`Keyline update failed: ${error.message}`);
  process.exitCode = 1;
});
