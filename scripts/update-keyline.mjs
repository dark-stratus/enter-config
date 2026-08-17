import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const LINKS_DIR = path.join(ROOT, "config", "links");
const INDEX_FILE = path.join(LINKS_DIR, "index.json");
const STATE_FILE = path.join(ROOT, ".keyline-state.json");

const REGULAR_LIMIT = Number.POSITIVE_INFINITY;
const AUTO_WHITE_LIST_LIMIT = 20;
const SUCCESS_INTERVAL_MS = 1 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 60_000;
const FETCH_RETRIES = 4;
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
  "🇧🇾": "Belarus",
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
  /\bwhite[-_ ]?listed?\b/i,

  // Russian white-list phrases. Do NOT match any arbitrary word
  // beginning with "бел" (for example "Беларусь"/"Белоруссия").
  /(?<!\p{L})бел(?:ый|ая|ое|ые|ом|ой|ых|ым|ыми)\s+спис(?:ок|ка|ке|ком|ки|ков|ках|ками)(?!\p{L})/iu,
  /(?<!\p{L})бел(?:ый|ая|ое|ые|ом|ой|ых|ым|ыми)\s+интернет(?!\p{L})/iu,

  /обход\w*/iu,
  /глушил\w*/iu,
  /мобил\w*/iu,
  /\blte\b/iu,
  /\bmobile\b/i,
  /\bblock\s*list\b/i,
  /\bblocklist\b/i,
  /🏳️/u,
];

const COUNTRY_NAME_PATTERNS = Object.entries(FLAG_TO_COUNTRY).map(
  ([flag, country]) => ({
    flag,
    country,
    pattern: new RegExp(
      `(^|[\\s\\[\\]().,:;_-])${country.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?=$|[\\s\\[\\]().,:;_-])`,
      "i"
    ),
  })
);

function flagToIso(flag) {
  const cps = [...String(flag || "")];
  if (cps.length !== 2) return "";
  return cps.map(ch => String.fromCharCode(ch.codePointAt(0) - 0x1f1e6 + 65)).join("");
}

const COUNTRY_ALIAS_PATTERNS = [
  ["Albania", ["албания"]], ["Austria", ["австрия"]],
  ["Belarus", ["беларусь", "белоруссия"]], ["Belgium", ["бельгия"]], ["Brazil", ["бразилия"]],
  ["Switzerland", ["швейцария"]], ["China", ["китай"]],
  ["Czech Republic", ["чехия", "чешская республика"]],
  ["Germany", ["германия", "немец"]], ["Denmark", ["дания"]],
  ["Estonia", ["эстония"]], ["Spain", ["испания"]],
  ["Finland", ["финляндия"]], ["France", ["франция"]],
  ["United Kingdom", ["великобритания", "англия", "ук"]],
  ["Greece", ["греция"]], ["Hong Kong", ["гонконг"]],
  ["Indonesia", ["индонезия"]], ["Ireland", ["ирландия"]],
  ["India", ["индия"]], ["Israel", ["израиль"]],
  ["Italy", ["италия"]], ["Japan", ["япония"]],
  ["Kazakhstan", ["казахстан"]], ["Lithuania", ["литва", "литва"]],
  ["Latvia", ["латвия"]], ["Mexico", ["мексика"]],
  ["Netherlands", ["нидерланды", "нидерланд", "голландия", "голланд"]],
  ["Norway", ["норвегия"]], ["New Zealand", ["новая зеландия"]],
  ["Poland", ["польша"]], ["Portugal", ["португалия"]],
  ["Romania", ["румыния"]], ["Russia", ["россия", "рф"]],
  ["Sweden", ["швеция"]], ["Singapore", ["сингапур"]],
  ["Slovenia", ["словения"]], ["Slovakia", ["словакия"]],
  ["Thailand", ["таиланд", "тайланд"]], ["Turkey", ["турция"]],
  ["Ukraine", ["украина"]], ["United States", ["сша", "соединенные штаты"]],
  ["Vietnam", ["вьетнам"]],
].flatMap(([country, aliases]) => {
  const flag = Object.entries(FLAG_TO_COUNTRY).find(([, value]) => value === country)?.[0] || "";
  return aliases.map(alias => ({
    country,
    flag,
    pattern: new RegExp(`(^|[\\s\\[\\]().,:;_\\-/])${alias.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?=$|[\\s\\[\\]().,:;_\\-/0-9])`, "i"),
  }));
});

const COUNTRY_CODE_PATTERNS = Object.entries(FLAG_TO_COUNTRY).map(([flag, country]) => ({
  flag,
  country,
  pattern: new RegExp(`(^|[\\s\\[\\]().,:;_\\-/])${flagToIso(flag)}(?=$|[\\s\\[\\]().,:;_\\-/0-9])`, "i"),
}));

const COUNTRY_DISPLAY_NAMES =
  new Intl.DisplayNames(
    ["en"],
    {
      type:
        "region"
    }
  );

function countryFromFlagValue(
  flag
) {
  const value =
    String(
      flag ||
      ""
    );

  const codePoints =
    [...value];

  if (
    codePoints.length !== 2 ||
    !codePoints.every(
      character =>
        character.codePointAt(0) >=
          0x1f1e6 &&
        character.codePointAt(0) <=
          0x1f1ff
    )
  ) {
    return "";
  }

  const isoCode =
    codePoints
      .map(
        character =>
          String.fromCharCode(
            character.codePointAt(0) -
              0x1f1e6 +
              65
          )
      )
      .join("");

  try {
    return (
      COUNTRY_DISPLAY_NAMES.of(
        isoCode
      ) ||
      ""
    );
  } catch {
    return "";
  }
}


function isWhiteListRemark(remarks = "") {
  const value = String(remarks);

  return WHITE_LIST_PATTERNS.some(pattern => pattern.test(value));
}

function extractFlag(remarks = "", metadata = {}) {
  const value = String(remarks);

  // Keyline commonly puts the flag immediately before the name:
  // `🇫🇷Новый образец`, so the flag must not require surrounding spaces.
  const match = value.match(
    /[\u{1F1E6}-\u{1F1FF}]{2}/u
  );

  if (match?.[0]) {
    return match[0];
  }

  const metadataFlag =
    metadata?.flag ||
    metadata?.countryFlag ||
    metadata?.icon;

  if (
    typeof metadataFlag === "string" &&
    /[\u{1F1E6}-\u{1F1FF}]{2}/u.test(
      metadataFlag
    )
  ) {
    return metadataFlag.match(
      /[\u{1F1E6}-\u{1F1FF}]{2}/u
    )?.[0] || "";
  }

  return "";
}

function countryFromRemark(
  remarks = "",
  metadata = {}
) {
  const flag = extractFlag(
    remarks,
    metadata
  );

  if (flag) {
    const country =
      FLAG_TO_COUNTRY[flag] ||
      countryFromFlagValue(
        flag
      );

    if (country) {
      return {
        flag,
        country,
      };
    }
  }

  const metadataCountry =
    metadata?.country ||
    metadata?.countryName ||
    metadata?.location;

  if (
    typeof metadataCountry === "string" &&
    metadataCountry.trim()
  ) {
    const normalizedCountry =
      String(metadataCountry).trim();

    for (const entry of COUNTRY_NAME_PATTERNS) {
      if (
        entry.country.toLowerCase() ===
        normalizedCountry.toLowerCase()
      ) {
        return {
          flag: entry.flag,
          country: entry.country,
        };
      }
    }
  }

  // Fallback for sources that spell the country name but omit the flag.
  for (const entry of COUNTRY_NAME_PATTERNS) {
    if (entry.pattern.test(String(remarks))) {
      return { flag: entry.flag, country: entry.country };
    }
  }

  // Keyline may put the country only in the profile name/remark, often in Russian.
  for (const entry of COUNTRY_ALIAS_PATTERNS) {
    if (entry.pattern.test(String(remarks))) {
      return { flag: entry.flag, country: entry.country };
    }
  }

  // Also accept a standalone ISO country code in a server name, e.g. "FR-01" / "NL Amsterdam".
  for (const entry of COUNTRY_CODE_PATTERNS) {
    if (entry.pattern.test(String(remarks))) {
      return { flag: entry.flag, country: entry.country };
    }
  }

  return {
    flag: "",
    country: "Unknown",
  };
}

function isAutoSelectionRemark(remarks = "") {
  return /^🚀\s*авто\s*выбор/i.test(String(remarks).trim());
}

function normalizeAutoRemark(remarks = "") {
  return isAutoSelectionRemark(remarks);
}

function normalizeCountryRemark(
  remarks = "",
  metadata = {}
) {
  const original =
    String(remarks)
      .replace(/\s+/g, " ")
      .trim();

  const {
    flag,
    country
  } =
    countryFromRemark(
      original,
      metadata
    );

  if (isAutoSelectionRemark(original)) {
    return null;
  }

  if (country !== "Unknown") {
    return {
      flag,
      country,
      whiteList:
        isWhiteListRemark(original),
    };
  }

  // Some Keyline White List profiles intentionally have no country
  // in `remarks` (for example `🌐 Белый интернет`). Keep them instead
  // of silently dropping them. When Keyline provides structured country
  // metadata it is preferred above; otherwise use the requested Russia
  // fallback for unflagged White List profiles.
  if (isWhiteListRemark(original)) {
    return {
      flag:
        flag ||
        "🇷🇺",

      country:
        flag ? country : "Russia",

      whiteList:
        true,
    };
  }

  return null;
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

function isKeylineErrorPayload(parsed) {
  if (!parsed || typeof parsed !== "object") return false;

  const title = String(parsed.title || parsed.message || "").toLowerCase();
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  if (!entries.length) {
    return /ошибка добавления подписки|subscription (?:error|failed)|failed to add subscription/i.test(title);
  }

  const texts = entries.map(entry =>
    typeof entry === "string"
      ? entry
      : `${entry?.remarks || ""} ${entry?.message || ""}`
  ).join(" ").toLowerCase();

  return /ошибка добавления подписки|напишите в @keylinevpnsupportbot|subscription (?:error|failed)|failed to add subscription/i.test(
    `${title} ${texts}`
  ) && !entries.some(entry => entry && typeof entry === "object" && (entry.outbounds || entry.link));
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

    if (isKeylineErrorPayload(parsed)) {
      throw new Error(
        `${source}: Keyline returned an error payload; ` +
        `content-type=${contentType || "unknown"}; ` +
        `preview=${JSON.stringify(responsePreview(raw))}`
      );
    }

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
      : { lastSuccessfulUpdateAt: 0, healthHistory: {} };
  } catch (error) {
    if (error.code === "ENOENT") return { lastSuccessfulUpdateAt: 0, healthHistory: {} };
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
    const parsed = safeJsonParse(raw, "configured Keyline URL value");

    if (!Array.isArray(parsed)) {
      throw new Error(
        "Configured Keyline URL value must be an array."
      );
    }

    return parsed
      .map(item => String(item).trim())
      .filter(Boolean);
  }

  return raw
    .split(/[\r\n,;]+/)
    .map(item => item.trim())
    .filter(Boolean);
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


async function fetchOneConfiguredSource(url, label, clientIdentity) {
  const payload = await fetchJsonUrl(url, label, clientIdentity);
  return {
    label,
    data: payload.data,
    payloadKind: payload.kind,
    url,
  };
}

function fingerprintUrl(url) {
  return crypto.createHash("sha256").update(String(url)).digest("hex").slice(0, 12);
}

function sourceSlotLabel(scope, index) {
  return scope === "whitelist"
    ? `Keyline White List source ${index + 1}`
    : `Keyline source ${index + 1}`;
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
        url: "fixture",
      }],
      failures: [],
      sourceFetches: [{
        label: "fixture",
        status: "fixture",
        urlFingerprint: "fixture",
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
        url: resolved,
      }],
      failures: [],
      sourceFetches: [{
        label: resolved,
        status: "fixture",
        urlFingerprint: fingerprintUrl(resolved),
      }],
    };
  }

  const configuredRegularUrls = [];
  for (let slot = 1; slot <= 15; slot += 1) {
    for (const url of parseConfiguredUrls(process.env[`KEYLINE_URL_${slot}`])) {
      configuredRegularUrls.push({ url, slot });
    }
  }

  const seenRegularUrls = new Set();
  const regularRequests = configuredRegularUrls.filter(item => {
    if (seenRegularUrls.has(item.url)) return false;
    seenRegularUrls.add(item.url);
    return true;
  });

  const dedicatedWhiteListUrls = parseUrlList(
    process.env.KEYLINE_WHITE_LIST_URLS
  ).filter((url, index, list) => list.indexOf(url) === index);

  const sources = [];
  const failures = [];
  const sourceFetches = [];

  const fetchQueue = [
    ...regularRequests.map(({ url, slot }, index) => ({
      url,
      label: `Keyline URL ${slot}`,
      scope: "regular",
      index,
    })),
    ...dedicatedWhiteListUrls.map((url, index) => ({
      url,
      label: `Keyline White List source ${index + 1}`,
      scope: "whitelist",
      index,
    })),
  ];

  // Fetch sequentially. Parallel subscription requests from one client/IP
  // can look like automated scraping and provoke source-level errors.
  for (let index = 0; index < fetchQueue.length; index += 1) {
    const request = fetchQueue[index];
    const urlFingerprint = fingerprintUrl(request.url);
    const startedAt = Date.now();

    try {
      const source = await fetchOneConfiguredSource(
        request.url,
        request.label,
        clientIdentity
      );

      source.forceWhiteList = request.scope === "whitelist";
      sources.push(source);
      sourceFetches.push({
        label: request.label,
        scope: request.scope,
        status: "ok",
        urlFingerprint,
        durationMs: Date.now() - startedAt,
        payloadKind: source.payloadKind,
        rawCount: Array.isArray(source.data)
          ? source.data.length
          : (source.data && typeof source.data === "object" ? 1 : 0),
      });

      console.log(`${request.label}: OK`);
    } catch (error) {
      failures.push({
        label: request.label,
        scope: request.scope,
        urlFingerprint,
        message: error.message,
      });

      sourceFetches.push({
        label: request.label,
        scope: request.scope,
        status: "failed",
        urlFingerprint,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });

      console.error(
        `${request.label}: FAILED — ${error.message}`
      );
    }

    if (index < fetchQueue.length - 1) {
      await sleep(750);
    }
  }

  if (sources.length === 0) {
    throw new Error(
      "All configured Keyline sources failed. Existing Keyline pool is preserved."
    );
  }

  return {
    clientIdentity,
    sources,
    failures,
    sourceFetches,
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

  if (
    network === "xhttp" ||
    network === "splithttp"
  ) {
    const settings =
      stream.xhttpSettings ||
      stream.splitHttpSettings ||
      stream.splithttpSettings ||
      {};

    base.host =
      settings.host || "";

    base.path =
      settings.path || "";

    base.mode =
      settings.mode || "";

    base.type =
      network;
  }

  return base;
}

function findProxyOutbound(entry) {
  const outbounds = Array.isArray(
    entry?.outbounds
  )
    ? entry.outbounds
    : [];

  return (
    outbounds.find(
      item => item?.tag === "proxy"
    ) ||
    outbounds.find(
      item => [
        "vless",
        "trojan",
        "hysteria",
        "hysteria2",
      ].includes(
        String(
          item?.protocol || ""
        ).toLowerCase()
      )
    ) ||
    null
  );
}

function buildVlessLink(entry) {
  const outbound =
    findProxyOutbound(entry);

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
    "splithttp",
  ];

  if (!supportedNetworks.includes(stream.network)) return null;

  const transportQuery = encodeQuery({
    encryption: user.encryption || "none",
    flow: user.flow || "",
    ...buildTransportQuery(stream),
  });

  const security =
    String(stream.security || "none").toLowerCase();

  let securityQuery = "";

  if (security === "reality") {
    securityQuery =
      buildRealityQuery(
        stream.realitySettings || {},
        {
          security,
          alpn:
            Array.isArray(
              stream.tlsSettings?.alpn
            )
              ? stream.tlsSettings.alpn
              : "",
        }
      );
  } else if (security === "tls") {
    const tls =
      stream.tlsSettings || {};

    securityQuery =
      encodeQuery({
        security: "tls",
        sni:
          tls.serverName || "",
        fp:
          tls.fingerprint || "",
        alpn:
          Array.isArray(tls.alpn)
            ? tls.alpn.join(",")
            : "",
      });
  } else {
    securityQuery =
      encodeQuery({
        security,
      });
  }

  const query = [
    transportQuery,
    securityQuery,
  ]
    .filter(Boolean)
    .join("&");

  return (
    `vless://${encodeLinkUsername(user.id)}@${server.address}:${server.port}?${query}`
  );
}

function buildTrojanLink(entry) {
  const outbound =
    findProxyOutbound(entry);

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
  const outbound =
    findProxyOutbound(entry);

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

  const finalmask =
    stream.finalmask ||
    outbound.finalmask ||
    null;

  const query = encodeQuery({
    sni: tls.serverName || "",
    alpn: Array.isArray(tls.alpn)
      ? tls.alpn.join(",")
      : "",
    insecure:
      tls.allowInsecure
        ? "1"
        : "",
    pinSHA256:
      tls.pinnedPeerCertSha256 ||
      tls.pinSHA256 ||
      "",
    fm:
      finalmask &&
      typeof finalmask === "object" &&
      Object.keys(finalmask).length > 0
        ? JSON.stringify(finalmask)
        : "",
  });

  return (
    `hysteria2://${encodeLinkUsername(auth)}@${server.address}:${server.port}?${query}`
  );
}


function buildSupportedLink(entry) {
  const outbound =
    findProxyOutbound(entry);

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

function recordDropSample(stats, sample) {
  if (!stats || !Array.isArray(stats.droppedSamples)) return;
  if (stats.droppedSamples.length >= 10) return;
  stats.droppedSamples.push(sample);
}

function normalizeProfileLink(link, index, source, forceWhiteList = false, stats = null) {
  if (typeof link !== "string" || !link.trim()) {
    if (stats) {
      stats.droppedInvalid += 1;
      recordDropSample(stats, { index, reason: "invalid-link" });
    }
    return null;
  }

  const value = link.trim();
  const protocol = value.split("://")[0]?.toLowerCase();

  if (!["vless", "trojan", "hysteria2"].includes(protocol)) {
    if (stats) {
      stats.droppedUnsupported += 1;
      recordDropSample(stats, { index, reason: "unsupported-protocol" });
    }
    return null;
  }

  let canonicalLink = value;
  let remarks = "";

  try {
    const url = new URL(value);
    remarks = decodeURIComponent(url.hash.replace(/^#/, "")).trim();

    // Normalize URI inputs to the same minimum contract used by enter-main:
    // transport is explicit, and protocol security has a deterministic default.
    if (protocol === "vless") {
      if (!url.searchParams.get("type") && !url.searchParams.get("network")) {
        url.searchParams.set("type", "tcp");
      }
      if (!url.searchParams.get("security")) {
        url.searchParams.set("security", "none");
      }
    } else if (protocol === "trojan") {
      if (!url.searchParams.get("type") && !url.searchParams.get("network")) {
        url.searchParams.set("type", "tcp");
      }
      if (!url.searchParams.get("security")) {
        url.searchParams.set("security", "tls");
      }
    }

    const hash = url.hash;
    url.hash = "";
    canonicalLink = url.toString();
    url.hash = hash;
    if (hash) canonicalLink += hash;
  } catch {}

  if (!remarks) {
    remarks = `${source} ${index + 1}`;
  }

  const normalized =
    normalizeCountryRemark(remarks, {});
  if (!normalized) {
    if (stats) {
      stats.droppedUnknownCountry += 1;
      recordDropSample(stats, { index, reason: "unknown-country", remarks });
    }
    return null;
  }
  if (stats) stats.parsed += 1;

  return {
    sourceIndex: index,
    source,
    originalRemarks: remarks,
    flag: normalized.flag,
    country: normalized.country,
    whiteList: forceWhiteList || normalized.whiteList,
    link: canonicalLink,
  };
}

function normalizeSourceData(source) {
  const stats = {
    raw: Array.isArray(source.data) ? source.data.length : 1,
    parsed: 0,
    droppedInvalid: 0,
    droppedUnsupported: 0,
    droppedUnknownCountry: 0,
    droppedAutoSelection: 0,
    autoSelection: 0,
    droppedSamples: [],
  };

  if (source.payloadKind === "links") {
    const result = source.data
      .map((link, index) => normalizeProfileLink(
        link, index, source.label, source.forceWhiteList, stats
      ))
      .filter(Boolean);
    return { entries: result, stats };
  }

  const sourceEntries = Array.isArray(source.data)
    ? source.data
    : (source.data && typeof source.data === "object" ? [source.data] : null);

  if (!sourceEntries) {
    throw new Error(`${source.label}: response must be a JSON object or array. Existing Keyline pool is preserved.`);
  }

  const result = [];
  let autoEntry = null;
  stats.raw = sourceEntries.length;

  for (let index = 0; index < sourceEntries.length; index += 1) {
    const normalized = normalizeEntry(sourceEntries[index], index, source.label, stats);
    if (normalized === "AUTO_SELECTION") {
      stats.autoSelection += 1;
      if (!autoEntry) autoEntry = extractAutoLink(sourceEntries[index]);
      continue;
    }
    if (!normalized) continue;
    if (source.forceWhiteList) normalized.whiteList = true;
    result.push(normalized);
  }

  if (autoEntry && result.some(item => item.whiteList)) {
    result.push({ ...autoEntry, whiteList: true, isAutoWhiteListCandidate: true, originalRemarks: "⚡ Auto White List" });
  }

  return { entries: result, stats };
}

function extractAutoLink(entry) {
  const outbound =
    findProxyOutbound(entry);

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

function normalizeEntry(entry, index, source, stats = null) {
  if (!entry || typeof entry !== "object") {
    if (stats) stats.droppedInvalid += 1;
    return null;
  }

  const outbounds = Array.isArray(entry.outbounds)
    ? entry.outbounds
    : [];

  const proxy =
    findProxyOutbound(entry);
  const remarks = typeof entry.remarks === "string"
    ? entry.remarks.trim()
    : "";
  const link = buildSupportedLink(entry);

  if (!proxy || !remarks || !link) {
    if (stats) {
      if (!proxy || !link) {
        stats.droppedInvalid += 1;
        recordDropSample(stats, { index, reason: "invalid-entry", remarks });
      } else {
        stats.droppedUnknownCountry += 1;
        recordDropSample(stats, { index, reason: "unknown-country", remarks });
      }
    }
    return null;
  }
  if (isAutoSelectionRemark(remarks)) return "AUTO_SELECTION";

  const normalized =
    normalizeCountryRemark(
      remarks,
      {}
    );

  if (!normalized) {
    if (stats) {
      stats.droppedUnknownCountry += 1;
      recordDropSample(stats, { index, reason: "unknown-country", remarks });
    }
    return null;
  }
  if (stats) stats.parsed += 1;

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

  const flag =
    typeof entries[0].flag === "string" &&
    /[\u{1F1E6}-\u{1F1FF}]{2}/u.test(
      entries[0].flag
    )
      ? entries[0].flag
      : "";

  return [{
    ...entries[0],
    remarks:
      `${flag} 🏳️ White List 2`.trim(),
    whiteListIndex: 2,
  }];
}

function endpointFingerprint(link) {
  try {
    const url = new URL(String(link));

    const normalizedParams = [...url.searchParams.entries()]
      .filter(([key]) => !["fragment", "remarks"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b));

    return crypto
      .createHash("sha256")
      .update(JSON.stringify({
        protocol: url.protocol.toLowerCase(),
        host: url.hostname.toLowerCase(),
        port: Number(url.port || 0),
        username: url.username,
        password: url.password,
        params: normalizedParams,
      }))
      .digest("hex")
      .slice(0, 12);
  } catch {
    return fingerprintUrl(link);
  }
}

function buildEndpointCloneGroups(entries) {
  const groups = new Map();

  for (const item of entries) {
    const key = endpointFingerprint(item.link);
    const group = groups.get(key) || {
      fingerprint: key,
      count: 0,
      countries: new Set(),
      remarks: [],
      links: [],
    };

    group.count += 1;
    if (item.country) group.countries.add(item.country);
    if (item.remarks || item.originalRemarks) {
      group.remarks.push(item.remarks || item.originalRemarks);
    }
    group.links.push(fingerprintUrl(item.link));
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter(group => group.count > 1)
    .map(group => ({
      fingerprint: group.fingerprint,
      count: group.count,
      countries: [...group.countries],
      remarks: group.remarks.slice(0, 10),
      linkFingerprints: group.links.slice(0, 10),
    }));
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

function buildRetainedEntries(currentIndex, healthHistory = {}) {
  const retained = [];

  for (const item of currentIndex) {
    if (!isManagedId(item?.id)) continue;

    const link = String(item?.link || "").trim();
    if (!link) continue;

    const health = healthHistory[endpointFingerprint(link)] || null;
    const quarantineUntil = Number(health?.quarantineUntil) || 0;
    if (health?.lastStatus === "fail" && quarantineUntil > Date.now()) {
      continue;
    }

    const remarks = String(item?.remarks || "").trim();
    const flag = extractFlag(remarks);
    const isWhiteList = MANAGED_WHITE_LIST_RE.test(item.id);

    let country = "Unknown";
    if (flag) {
      country =
        FLAG_TO_COUNTRY[flag] ||
        countryFromFlagValue(flag) ||
        "Unknown";
    }

    if (country === "Unknown") {
      const match = remarks.match(
        /(?:^|\s)(Albania|Austria|Belgium|Brazil|Switzerland|China|Czech Republic|Germany|Denmark|Estonia|Spain|Finland|France|United Kingdom|Greece|Hong Kong|Indonesia|Ireland|India|Israel|Italy|Japan|Kazakhstan|Lithuania|Latvia|Mexico|Netherlands|Norway|New Zealand|Poland|Portugal|Romania|Russia|Sweden|Singapore|Slovenia|Slovakia|Thailand|Turkey|Ukraine|United States|Vietnam)(?:\s+\d+)?(?:\s|$)/i
      );

      if (match?.[1]) {
        country = match[1];
      }
    }

    retained.push({
      link,
      remarks,
      flag: flag || "🇷🇺",
      country,
      whiteList: isWhiteList,
      retained: true,
    });
  }

  return retained;
}

function mergeWithRetainedEntries(
  freshRegular,
  freshWhiteList,
  currentIndex,
  healthHistory = {}
) {
  const retained = buildRetainedEntries(currentIndex, healthHistory);
  const seen = new Set(
    [...freshRegular, ...freshWhiteList]
      .map(item => String(item?.link || "").trim())
      .filter(Boolean)
  );

  for (const item of retained) {
    if (seen.has(item.link)) continue;

    seen.add(item.link);

    if (item.whiteList) {
      freshWhiteList.push(item);
    } else {
      freshRegular.push(item);
    }
  }

  return {
    regular: freshRegular,
    whiteList: freshWhiteList,
    retainedCount: retained.length,
  };
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
      remarks: `${item.flag} ${item.country} ${next}`.trim(),
      countryIndex: next,
    };
  });
}

function normalizeWhiteListEntries(entries, startNumber = 2) {
  const sorted = sortEntries(entries);

  return sorted.map((item, index) => ({
    ...item,
    remarks:
      `${item.flag || "🇷🇺"} 🏳️ White List ${startNumber + index}`.trim(),
    whiteListIndex: startNumber + index,
  }));
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


async function readManagedLinkFromDisk(id, fallbackIndexItem = null) {
  if (
    fallbackIndexItem &&
    typeof fallbackIndexItem.link === "string" &&
    fallbackIndexItem.link.trim()
  ) {
    return fallbackIndexItem.link.trim();
  }

  const file =
    path.join(
      LINKS_DIR,
      `${id}.link`
    );

  try {
    return (
      await fs.readFile(
        file,
        "utf8"
      )
    ).trim();
  } catch {
    return "";
  }
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

  const nextEntries = [];
  const manualEuropeFirst = manualEntries.filter(
    item => /^europe-\d+$/i.test(item.id)
  );
  const manualOther = manualEntries.filter(
    item => !/^europe-\d+$/i.test(item.id)
  );

  // Permanent/manual non-White-List locations remain first.
  const manualOrdered = [
    ...manualEuropeFirst,
    ...manualOther,
  ];

  for (const item of manualOrdered) {
    const link = await readManagedLinkFromDisk(item.id, item);

    nextEntries.push(
      link
        ? { ...item, link }
        : { ...item }
    );
  }

  // All Keyline regular locations go above the permanent White List 1.
  for (let index = 0; index < regular.length; index += 1) {
    const id =
      `keyline-regular-${String(index + 1).padStart(2, "0")}`;

    const item = regular[index];

    await fs.writeFile(
      path.join(stageDir, `${id}.link`),
      `${item.link}\n`,
      "utf8"
    );

    nextEntries.push({
      id,
      remarks: item.remarks,
      link: item.link,
    });
  }

  // Permanent White List entries are kept after the regular pool.
  for (const item of manualWhiteList) {
    const id = item.id;
    const sourceFile =
      path.join(LINKS_DIR, `${id}.link`);

    const stagedFile =
      path.join(stageDir, `${id}.link`);

    try {
      await fs.copyFile(
        sourceFile,
        stagedFile
      );

      const link = await readManagedLinkFromDisk(id, item);

      nextEntries.push({
        ...item,
        ...(link ? { link } : {}),
        ...(id.toLowerCase() === "whitelist-1"
          ? {
              remarks:
                `${extractFlag(item.remarks) || "🇷🇺"} 🏳️ White List 1`,
            }
          : {}),
      });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  // Automatically discovered White List entries come immediately
  // after the permanent White List 1.
  for (
    let index = 0;
    index < autoWhiteList.length;
    index += 1
  ) {
    const id =
      `keyline-whitelist-${String(index + 1).padStart(2, "0")}`;

    const item =
      autoWhiteList[index];

    await fs.writeFile(
      path.join(stageDir, `${id}.link`),
      `${item.link}\n`,
      "utf8"
    );

    nextEntries.push({
      id,
      remarks: item.remarks,
      link: item.link,
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
    failures,
    sourceFetches,
  } = await fetchKeylineSources();
  const allEntries = [];
  let totalRawEntries = 0;
  const sourceReports = [];

  for (const source of sources) {
    const result = normalizeSourceData(source);
    const { entries, stats } = result;
    totalRawEntries += stats.raw;
    allEntries.push(...entries);

    sourceReports.push({
      source: source.label,
      payloadKind: source.payloadKind,
      ...stats,
    });

    console.log(
      `${source.label}: raw=${stats.raw}, parsed=${stats.parsed}, ` +
      `no-country=${stats.droppedUnknownCountry}, invalid=${stats.droppedInvalid}, ` +
      `unsupported=${stats.droppedUnsupported}`
    );
  }

  const deduped = dedupe(allEntries);
  const currentIndex = await loadIndex();

  const freshRegularEntries = deduped.filter(item => (
    !item.whiteList &&
    !item.isAutoWhiteListCandidate
  ));

  const freshWhiteListEntries = deduped.filter(item => (
    item.whiteList &&
    !item.isAutoWhiteListCandidate
  ));

  const freshRegularCount = freshRegularEntries.length;
  const freshWhiteListCount = freshWhiteListEntries.length;

  const previousState = await readState();
  const healthHistory = previousState.healthHistory || {};

  const merged = mergeWithRetainedEntries(
    freshRegularEntries,
    freshWhiteListEntries,
    currentIndex,
    healthHistory
  );

  const regular = normalizeAndNumber(
    merged.regular
  );

  const autoCandidates = deduped.filter(
    item => item.isAutoWhiteListCandidate
  );

  const autoWhiteList = canonicalAutoWhiteList(autoCandidates);
  const remainingWhiteListSlots = Math.max(
    AUTO_WHITE_LIST_LIMIT - autoWhiteList.length,
    0
  );

  const whiteListLocations = normalizeWhiteListEntries(
    merged.whiteList,
    autoWhiteList.length > 0 ? 3 : 2
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

  const previousSourceFingerprints = previousState.sourceFingerprints || {};
  const currentSourceFingerprints = Object.fromEntries(
    sourceFetches.map(item => [item.label, item.urlFingerprint])
  );

  const sourceChanges = sourceFetches
    .filter(item => previousSourceFingerprints[item.label] && previousSourceFingerprints[item.label] !== item.urlFingerprint)
    .map(item => ({
      label: item.label,
      previous: previousSourceFingerprints[item.label],
      current: item.urlFingerprint,
    }));

  const sourceCandidateCounts = Object.fromEntries(
    sources.map(source => [source.label, { raw: 0, parsed: 0, unique: 0 }])
  );

  for (const sourceReport of sourceReports) {
    if (!sourceCandidateCounts[sourceReport.source]) {
      sourceCandidateCounts[sourceReport.source] = { raw: 0, parsed: 0, unique: 0 };
    }
    sourceCandidateCounts[sourceReport.source].raw += Number(sourceReport.raw) || 0;
    sourceCandidateCounts[sourceReport.source].parsed += Number(sourceReport.parsed) || 0;
  }

  for (const item of deduped) {
    if (!sourceCandidateCounts[item.source]) {
      sourceCandidateCounts[item.source] = { raw: 0, parsed: 0, unique: 0 };
    }
    sourceCandidateCounts[item.source].unique += 1;
  }

  const candidateMap = Object.fromEntries(
    [...regular, ...automaticWhiteList].map(item => [
      fingerprintUrl(item.link),
      {
        source: item.source || (item.retained ? "retained" : "unknown"),
        country: item.country || "Unknown",
        whiteList: Boolean(item.whiteList),
        retained: Boolean(item.retained),
      }
    ])
  );

  const endpointCloneGroups =
    buildEndpointCloneGroups(deduped);

  const report = {
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    configuredSourceCount: sourceFetches.length,
    sourceFetches,
    sourceFailures: failures,
    sourceChanges,
    sourceCandidateCounts,
    candidateMap,
    totalRawEntries,
    sourceReports,
    freshBeforeDedupe: allEntries.length,
    afterDedupe: deduped.length,
    endpointCloneGroups,
    endpointCloneGroupCount: endpointCloneGroups.length,
    freshRegular: freshRegularCount,
    freshWhiteList: freshWhiteListCount,
    retainedFromPreviousPool: merged.retainedCount,
    regularBeforeHealthCheck: regular.length,
    autoWhiteListBeforeHealthCheck: automaticWhiteList.length,
    totalBeforeHealthCheck: regular.length + automaticWhiteList.length,
    retainedPolicy: "previous managed links are retained unless temporarily quarantined by a failed health check; quarantine is not a permanent blacklist",
  };
  await writeAtomic(
    path.join(ROOT, "keyline-report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );

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
      sourceFingerprints: currentSourceFingerprints,
    }, null, 2)}\n`
  );

  console.log(
    `Keyline update complete: ${sources.length} sources, ` +
    `${regular.length} regular, ${automaticWhiteList.length} auto-white-list, ` +
    `${merged.retainedCount} retained from previous pool.`
  );
}

main().catch(error => {
  console.error(`Keyline update failed: ${error.message}`);
  process.exitCode = 1;
});
