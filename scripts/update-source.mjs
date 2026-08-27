import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const ROOT = process.env.GITHUB_WORKSPACE
  ? path.resolve(process.env.GITHUB_WORKSPACE)
  : path.resolve(new URL("..", import.meta.url).pathname);
const LINKS_DIR = path.join(ROOT, "config", "links");
const INDEX_FILE = path.join(LINKS_DIR, "index.json");
const STATE_FILE = path.join(ROOT, ".source-state.json");
const UPDATE_STATUS_FILE = path.join(ROOT, "config", "source-update-status.json");

const REGULAR_LIMIT = Number.POSITIVE_INFINITY;
const AUTO_WHITE_LIST_LIMIT = Number.POSITIVE_INFINITY;

// SOURCE_URL_1..20 are regular sources. SOURCE_URL_21..40 are the
// dedicated whitelist sources. All external URLs live in GitHub Secrets;
// no third-party source URL is hardcoded in this repository.
const REGULAR_SECRET_SLOT_START = 1;
const REGULAR_SECRET_SLOT_END = 20;
const WHITE_LIST_SECRET_SLOT_START = 21;
const WHITE_LIST_SECRET_SLOT_END = 40;
const WHITE_LIST_SECRET_SLOTS = Array.from(
  { length: WHITE_LIST_SECRET_SLOT_END - WHITE_LIST_SECRET_SLOT_START + 1 },
  (_, index) => WHITE_LIST_SECRET_SLOT_START + index
);

const FETCH_TIMEOUT_MS = 60_000;
const FETCH_RETRIES = 4;
const FETCH_RETRY_DELAY_MS = 2_000;

const SOURCE_DEVICE_PROFILES = [
  {
    appVersion: "3.3.6",
    buildId: "2607200909000",
    locale: "RU",
    deviceOs: "Windows",
    osVersion: "10_10.0.19045",
    deviceModel: "DESKTOP-A14F8C2D_x86_64",
    hwid: "6e0d7f6a-5d9a-4c4f-a6a3-1b9f4f0d81c2",
  },
  {
    appVersion: "3.1.0",
    buildId: "2606101200000",
    locale: "EN",
    deviceOs: "Windows",
    osVersion: "11_10.0.22631",
    deviceModel: "DESKTOP-C72B91E4_x86_64",
    hwid: "b2f1d8a4-3a97-4f1c-91e2-7c54e9a6d113",
  },
  {
    appVersion: "2.18.3",
    buildId: "2605201200000",
    locale: "RU",
    deviceOs: "Windows",
    osVersion: "11_10.0.26100",
    deviceModel: "DESKTOP-E53A7F19_x86_64",
    hwid: "0c9b3c8d-2b46-46cf-8c93-0a64a76e5f29",
  },
  {
    appVersion: "3.3.6",
    buildId: "2607200909000",
    locale: "EN",
    deviceOs: "Windows",
    osVersion: "11_10.0.26100",
    deviceModel: "DESKTOP-F81D2A63_arm64",
    hwid: "9fd4c0a1-6e73-49d1-a8b2-2e94f7c65138",
  },
  {
    appVersion: "3.3.5",
    buildId: "2607171500000",
    locale: "RU",
    deviceOs: "macOS",
    osVersion: "13_22G74",
    deviceModel: "MacBookPro16,1_x86_64",
    hwid: "3a74c18e-9c55-4d22-b8f1-6e9073a2d451",
  },
  {
    appVersion: "2.18.1",
    buildId: "2605101200000",
    locale: "EN",
    deviceOs: "macOS",
    osVersion: "12_21G93",
    deviceModel: "iMac20,1_x86_64",
    hwid: "51e6b0d4-c2fb-4d77-93ae-8f4c1b207965",
  },
  {
    appVersion: "3.3.6",
    buildId: "2607200909000",
    locale: "EN",
    deviceOs: "macOS",
    osVersion: "14_23F79",
    deviceModel: "MacBookPro18,3_arm64",
    hwid: "c8a5f1b7-47de-49e2-b2d1-5f8c9046a317",
  },
  {
    appVersion: "3.0.2",
    buildId: "2601101000000",
    locale: "RU",
    deviceOs: "macOS",
    osVersion: "15_24A335",
    deviceModel: "Mac14,5_arm64",
    hwid: "7b2e49c1-85a6-46d8-91f3-4c70a2e86519",
  },
  {
    appVersion: "3.26.3",
    buildId: "2607201000000",
    locale: "RU",
    deviceOs: "Android",
    osVersion: "14_API34",
    deviceModel: "Pixel 8 Pro_arm64",
    hwid: "e14a6c92-3f58-4b07-a9d1-82c5e7461b30",
  },
  {
    appVersion: "3.26.3",
    buildId: "2607201000000",
    locale: "EN",
    deviceOs: "Android",
    osVersion: "15_API35",
    deviceModel: "SM-S928B_arm64",
    hwid: "45c8e1a7-72f4-4d93-b6a0-9e31c25784d6",
  },
  {
    appVersion: "3.20.3",
    buildId: "2605071748000",
    locale: "RU",
    deviceOs: "Android",
    osVersion: "13_API33",
    deviceModel: "23127PN0CG_arm64",
    hwid: "a6d2f9c4-18b7-4e53-8c91-57e0b2643a82",
  },
  {
    appVersion: "5.2.0",
    buildId: "2607220012004",
    locale: "RU",
    deviceOs: "iOS",
    osVersion: "18.6",
    deviceModel: "iPhone17,1",
    hwid: "2f7c91e5-4a63-45d8-b0c2-81e6a5739d14",
  },
  {
    appVersion: "5.2.0",
    buildId: "2607220048005",
    locale: "EN",
    deviceOs: "iOS",
    osVersion: "18.5",
    deviceModel: "iPhone16,2",
    hwid: "d9a42e71-6c35-48f0-91b7-53e8c204a6fd",
  },
  {
    appVersion: "5.1.0",
    buildId: "2607000580040",
    locale: "RU",
    deviceOs: "iOS",
    osVersion: "17.7.8",
    deviceModel: "iPhone14,5",
    hwid: "8c1e5a73-29d4-4f06-b8a1-67e3c95240fd",
  },
  {
  "appVersion": "3.3.4",
  "buildId": "2608151105432",
  "locale": "RU",
  "deviceOs": "Android",
  "osVersion": "14.0.0",
  "deviceModel": "SM-S928B",
  "hwid": "3d5f9e11-6a2c-4b88-a7d1-e6301bf5409a"
  },
];

const MAX_SOURCE_DEVICE_PROFILES = SOURCE_DEVICE_PROFILES.length;

const MANAGED_REGULAR_RE = /^source-regular-\d+$/i;
const MANAGED_WHITE_LIST_RE = /^source-whitelist-\d+$/i;

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

  // Source commonly puts the flag immediately before the name:
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

  // Source may put the country only in the profile name/remark, often in Russian.
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

  // Some Source White List profiles intentionally have no country
  // in `remarks` (for example `🌐 Белый интернет`). Keep them instead
  // of silently dropping them. When Source provides structured country
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

function isSourceErrorPayload(parsed) {
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

  return /ошибка добавления подписки|напишите в @sourcevpnsupportbot|subscription (?:error|failed)|failed to add subscription/i.test(
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

    if (isSourceErrorPayload(parsed)) {
      throw new Error(
        `${source}: Source returned an error payload; ` +
        `content-type=${contentType || "unknown"}; ` +
        `preview=${JSON.stringify(responsePreview(raw))}`
      );
    }

    return {
      kind: "json",
      data: parsed,
    };
  } catch (error) {
    // A syntactically valid JSON error response must stay an error.
    // Do not silently reinterpret it as a successful subscription.
    if (
      error instanceof Error &&
      /Source returned an error payload/i.test(error.message)
    ) {
      throw error;
    }
  }

  // Plain-text TXT subscriptions (including the igareck White List files)
  // are already the final transport URI list. Extract directly from the raw
  // response first; do not rewrite or canonicalize the URI.
  const rawLinks = extractProfileLinks(raw);
  if (rawLinks.length > 0) {
    return {
      kind: "links",
      data: rawLinks,
    };
  }

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
        if (isSourceErrorPayload(parsed)) {
          throw new Error(
            `${source}: Source returned an error payload; ` +
            `content-type=${contentType || "unknown"}; ` +
            `preview=${JSON.stringify(responsePreview(candidate))}`
          );
        }

        return {
          kind: "json",
          data: parsed,
        };
      }
    } catch (error) {
      if (
        error instanceof Error &&
        /Source returned an error payload/i.test(error.message)
      ) {
        throw error;
      }
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

function recoverFirstJsonObject(text) {
  const source = normalizeJsonText(text);

  if (!source.startsWith("{")) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        const candidate = source.slice(0, index + 1);

        try {
          const parsed = JSON.parse(candidate);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : null;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

async function readState() {
  try {
    const text = await fs.readFile(STATE_FILE, "utf8");

    try {
      const state = safeJsonParse(text, STATE_FILE);

      let mergedHealthHistory =
        state.healthHistory && typeof state.healthHistory === "object"
          ? state.healthHistory
          : {};

      try {
        const healthStatePath = path.join(
          ROOT,
          "config",
          ".source-state.json"
        );
        const healthText = await fs.readFile(healthStatePath, "utf8");
        const healthState = safeJsonParse(healthText, healthStatePath);
        if (
          healthState?.healthHistory &&
          typeof healthState.healthHistory === "object"
        ) {
          mergedHealthHistory = {
            ...mergedHealthHistory,
            ...healthState.healthHistory,
          };
        }
      } catch {}

      return Number.isFinite(state.lastSuccessfulUpdateAt)
        ? {
            ...state,
            healthHistory: mergedHealthHistory,
          }
        : { ...state, lastSuccessfulUpdateAt: 0, healthHistory: mergedHealthHistory };
    } catch (parseError) {
      const recovered = recoverFirstJsonObject(text);

      if (!recovered) {
        throw parseError;
      }

      console.warn(
        `State file ${STATE_FILE} contained trailing/concatenated data; ` +
        `recovered the first valid JSON object and rewrote the state file.`
      );

      const normalized = {
        ...recovered,
        healthHistory:
          recovered.healthHistory &&
          typeof recovered.healthHistory === "object"
            ? recovered.healthHistory
            : {},
      };

      await writeAtomic(
        STATE_FILE,
        `${JSON.stringify(normalized, null, 2)}\\n`
      );

      return Number.isFinite(normalized.lastSuccessfulUpdateAt)
        ? normalized
        : { lastSuccessfulUpdateAt: 0, healthHistory: {} };
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return { lastSuccessfulUpdateAt: 0, healthHistory: {} };
    }

    throw error;
  }
}



async function getHappClientIdentity(url) {
  const state = await readState();

  if (
    !state.sourceDeviceAssignments ||
    typeof state.sourceDeviceAssignments !== "object"
  ) {
    state.sourceDeviceAssignments = {};
  }

  const fingerprint = fingerprintUrl(url);
  const existingIndex = Number(
    state.sourceDeviceAssignments[fingerprint]
  );

  if (
    Number.isInteger(existingIndex) &&
    existingIndex >= 0 &&
    existingIndex < MAX_SOURCE_DEVICE_PROFILES
  ) {
    return SOURCE_DEVICE_PROFILES[existingIndex];
  }

  const usedIndexes = new Set(
    Object.values(state.sourceDeviceAssignments)
      .map(value => Number(value))
      .filter(
        value =>
          Number.isInteger(value) &&
          value >= 0 &&
          value < MAX_SOURCE_DEVICE_PROFILES
      )
  );

  let profileIndex = -1;

  for (
    let index = 0;
    index < MAX_SOURCE_DEVICE_PROFILES;
    index += 1
  ) {
    if (!usedIndexes.has(index)) {
      profileIndex = index;
      break;
    }
  }

  if (profileIndex === -1) {
    throw new Error(
      `No free dedicated Source device profile remains. ` +
      `Maximum supported unique Source URLs: ${MAX_SOURCE_DEVICE_PROFILES}.`
    );
  }

  state.sourceDeviceAssignments[fingerprint] = profileIndex;

  await writeAtomic(
    STATE_FILE,
    `${JSON.stringify(state, null, 2)}\n`
  );

  console.log(
    `Assigned ${fingerprint} -> device profile #${profileIndex + 1} ` +
    `(${SOURCE_DEVICE_PROFILES[profileIndex].deviceModel})`
  );

  return SOURCE_DEVICE_PROFILES[profileIndex];
}

async function shouldSkip() {
  // GitHub Actions already schedules this workflow every hour.
  // Do not apply a second in-process time gate: every scheduled run
  // must perform a full Source refresh and health-check cycle.
  if (process.env.FORCE_SOURCE_REFRESH === "1") {
    console.log("Forced Source refresh requested; running full refresh.");
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
    const parsed = safeJsonParse(raw, "configured Source URL value");

    if (!Array.isArray(parsed)) {
      throw new Error(
        "Configured Source URL value must be an array."
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
    "user-agent": `Happ/${clientIdentity.appVersion}/${clientIdentity.deviceOs}/${clientIdentity.buildId}`,
    "x-app-version": clientIdentity.appVersion,
    "x-device-locale": clientIdentity.locale,
    "x-device-os": clientIdentity.deviceOs,
    "x-device-model": clientIdentity.deviceModel,
    "x-hwid": clientIdentity.hwid,
    "x-ver-os": clientIdentity.osVersion,
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


async function fetchSourceSources() {
  const clientIdentity = SOURCE_DEVICE_PROFILES[0];
  const fixtureJson = process.env.SOURCE_FIXTURE_JSON;

  if (fixtureJson) {
    return {
      clientIdentity,
      sources: [{
        label: "fixture",
        data: safeJsonParse(fixtureJson, "SOURCE_FIXTURE_JSON"),
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

  const fixturePath = process.env.SOURCE_FIXTURE;

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
  for (let slot = REGULAR_SECRET_SLOT_START; slot <= REGULAR_SECRET_SLOT_END; slot += 1) {
    for (const url of parseConfiguredUrls(process.env[`SOURCE_URL_${slot}`])) {
      configuredRegularUrls.push({ url, slot });
    }
  }

  const seenRegularUrls = new Set();
  const regularRequests = configuredRegularUrls.filter(item => {
    if (seenRegularUrls.has(item.url)) return false;
    seenRegularUrls.add(item.url);
    return true;
  });

  const configuredWhiteListRequests = WHITE_LIST_SECRET_SLOTS.flatMap(slot =>
    parseConfiguredUrls(process.env[`SOURCE_URL_${slot}`]).map(url => ({ url, slot }))
  );

  const sources = [];
  const failures = [];
  const sourceFetches = [];

  const fetchQueue = [
    ...regularRequests.map(({ url, slot }, index) => ({
      url,
      label: `Source URL ${slot}`,
      scope: "regular",
      index,
    })),
    ...configuredWhiteListRequests.map(({ url, slot }, index) => ({
      url,
      label: `Source URL ${slot}`,
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
    const clientIdentity =
      request.scope === "whitelist" &&
      /(?:githubusercontent\.com|github\.com)/i.test(request.url)
        ? SOURCE_DEVICE_PROFILES[0]
        : await getHappClientIdentity(request.url);

    console.log(
      `${request.label}: device=${clientIdentity.deviceModel}, ` +
      `hwid=${clientIdentity.hwid.slice(0, 8)}…`
    );

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
      "All configured Source sources failed. Existing Source pool is preserved."
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

    // Preserve the Source-provided URI byte-for-byte. Do not add missing
    // transport/security parameters or otherwise rewrite the source link.
    // The source configuration is the authority; downstream parsing applies
    // its own protocol defaults only when the source truly omits them.
    canonicalLink = value;
  } catch {}

  if (!remarks) {
    remarks = `${source} ${index + 1}`;
  }

  const normalized =
    normalizeCountryRemark(remarks, {});

  // White List entries must never be discarded merely because the source
  // remark does not contain a recognizable country. HAPP keeps such entries;
  // we publish them later under the neutral Europe bucket.
  const effective =
    normalized ||
    (forceWhiteList
      ? {
          flag: "🇪🇺",
          country: "Europe",
          whiteList: true,
        }
      : null);

  if (!effective) {
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
    sourceKind: "links",
    originalRemarks: remarks,
    flag: effective.flag || "",
    country: effective.country || "",
    whiteList: forceWhiteList || Boolean(effective.whiteList),
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
    throw new Error(`${source.label}: response must be a JSON object or array. Existing Source pool is preserved.`);
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
    result.push({ ...autoEntry, whiteList: true, isAutoWhiteListCandidate: true, originalRemarks: "⚡️ LTE Auto" });
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
    country: "⚡️ LTE Auto",
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
    sourceKind: "json",
    sourceConfig: structuredClone(entry),
    originalRemarks: remarks,
    flag: normalized.flag,
    country: normalized.country,
    whiteList: normalized.whiteList,
    link,
  };
}

function setLinkRemark(link, remark) {
  const value = String(link || "").trim();
  const label = String(remark || "").trim();
  if (!value || !label) return value;

  try {
    const url = new URL(value);
    url.hash = label;
    return url.toString();
  } catch {
    return value;
  }
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
    const link = String(item?.link || "").trim();
    if (!link) continue;

    let key = link;

    try {
      const url = new URL(link);
      const params = [...url.searchParams.entries()]
        .sort(([aKey, aValue], [bKey, bValue]) =>
          aKey.localeCompare(bKey) ||
          aValue.localeCompare(bValue)
        );

      // Deduplicate only the same connection tuple. Fragment/remarks are
      // metadata, while SNI/Host/fingerprint and other transport parameters
      // remain part of the identity. This intentionally does NOT collapse
      // multiple White List routes that share a Max/Yandex/etc. SNI but use
      // different real endpoints or transport settings.
      key = JSON.stringify({
        protocol: url.protocol.toLowerCase(),
        host: url.hostname.toLowerCase(),
        port: Number(url.port || 0),
        username: url.username,
        password: url.password,
        params,
      });
    } catch {}

    if (seen.has(key)) continue;
    seen.add(key);
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
  const retained =
    buildRetainedEntries(currentIndex, healthHistory);
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
    `.source-stage-${process.pid}`
  );

  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.cp(LINKS_DIR, stageDir, { recursive: true });

  const stagedManagedFiles = await fs.readdir(stageDir, {
    withFileTypes: true,
  });

  for (const item of stagedManagedFiles) {
    if (
      !item.isFile() ||
      (!item.name.endsWith(".link") && !item.name.endsWith(".json"))
    ) continue;

    const id = item.name.replace(/\.(?:link|json)$/i, "");

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

  // All Source regular locations go above the permanent White List 1.
  for (let index = 0; index < regular.length; index += 1) {
    const id =
      `source-regular-${String(index + 1).padStart(2, "0")}`;

    const item = regular[index];

    await fs.writeFile(
      path.join(stageDir, `${id}.link`),
      `${item.link}\n`,
      "utf8"
    );

    const entry = {
      id,
      remarks: item.remarks,
      link: item.link,
    };

    if (item.sourceKind === "json" && item.sourceConfig && typeof item.sourceConfig === "object") {
      const configFile = `${id}.json`;
      await fs.writeFile(
        path.join(stageDir, configFile),
        `${JSON.stringify(item.sourceConfig, null, 2)}\n`,
        "utf8"
      );
      entry.configFile = configFile;
      entry.sourceKind = "json";
    }

    nextEntries.push(entry);
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
      `source-whitelist-${String(index + 1).padStart(2, "0")}`;

    const item =
      autoWhiteList[index];
    const displayRemarks =
      String(item.remarks || "").trim();
    const displayLink =
      setLinkRemark(item.link, displayRemarks);

    await fs.writeFile(
      path.join(stageDir, `${id}.link`),
      `${displayLink}\n`,
      "utf8"
    );

    const entry = {
      id,
      remarks: displayRemarks,
      link: displayLink,
      whiteList: true,
      ...(item.country ? { country: item.country } : {}),
      ...(item.flag ? { flag: item.flag } : {}),
    };

    if (item.sourceKind === "json" && item.sourceConfig && typeof item.sourceConfig === "object") {
      const configFile = `${id}.json`;
      await fs.writeFile(
        path.join(stageDir, configFile),
        `${JSON.stringify(item.sourceConfig, null, 2)}\n`,
        "utf8"
      );
      entry.configFile = configFile;
      entry.sourceKind = "json";
    }

    nextEntries.push(entry);
  }

  const uniqueNextEntries = [];
  const seenEntryIds = new Set();

  for (const item of nextEntries) {
    const id = typeof item?.id === "string" ? item.id.toLowerCase() : "";
    if (!id || seenEntryIds.has(id)) continue;
    seenEntryIds.add(id);
    uniqueNextEntries.push(item);
  }

  await fs.writeFile(
    path.join(stageDir, "index.json"),
    `${JSON.stringify(uniqueNextEntries, null, 2)}\n`,
    "utf8"
  );

  return {
    stageDir,
    nextEntries,
  };
}

async function replaceLinksDirectory(stageDir) {
  const backupDir = `${LINKS_DIR}.source-backup-${process.pid}`;

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
  if (await shouldSkip()) {
    await writeAtomic(
      UPDATE_STATUS_FILE,
      `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        refreshed: false,
        reason: "success_interval",
        message: "Source refresh was skipped by the success interval.",
      }, null, 2)}\n`
    );
    console.log("Source update skipped; health stage must not reuse the previous candidate manifest.");
    return;
  }

  const {
    clientIdentity,
    sources,
    failures,
    sourceFetches,
  } = await fetchSourceSources();
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

  // Keep all White List candidates until after health-check. We do not
  // assign countries or rewrite names here: only a passed candidate gets
  // grouped later into a country LTE balancer.
  const automaticWhiteList = merged.whiteList
    .filter(item => item && item.link)
    .map(item => ({
      ...item,
      whiteList: true,
      remarks: String(item.originalRemarks || item.remarks || "").trim(),
    }));

  if (regular.length === 0 && automaticWhiteList.length === 0) {
    throw new Error(
      "Configured Source sources returned zero supported servers. " +
      "Existing Source pool is preserved."
    );
  }

  const manualWhiteList = [];
  const manualWhiteListIds = new Set();

  for (const item of currentIndex) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^whitelist-\d+$/i.test(item.id)
    ) continue;

    const id = item.id.toLowerCase();
    if (manualWhiteListIds.has(id)) continue;

    manualWhiteListIds.add(id);
    manualWhiteList.push(item);
  }

  const { stageDir, nextEntries } = await buildStagedLinks(
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

  // Health-check must always evaluate the complete freshly generated Source
  // candidate pool, not whatever subset happened to be present in the
  // previous committed index. Keep this manifest separate from index.json so
  // the health stage is never coupled to the previous managed pool size.
  const healthCandidates = [
    ...regular.map((item, index) => ({
      id: `source-regular-${String(index + 1).padStart(2, "0")}`,
      remarks: item.remarks || "",
      link: String(item.link || "").trim(),
      ...(item.sourceKind === "json" ? {
        configFile: `source-regular-${String(index + 1).padStart(2, "0")}.json`,
        sourceKind: "json",
      } : {}),
    })),
    ...automaticWhiteList.map((item, index) => ({
      id: `source-whitelist-${String(index + 1).padStart(2, "0")}`,
      remarks: item.remarks || "",
      link: String(item.link || "").trim(),
      ...(item.sourceKind === "json" ? {
        configFile: `source-whitelist-${String(index + 1).padStart(2, "0")}.json`,
        sourceKind: "json",
      } : {}),
    })),
  ].filter(item => item.link);

  const healthCandidatesFile =
    path.join(ROOT, "config", "source-health-candidates.json");

  await fs.mkdir(
    path.dirname(healthCandidatesFile),
    { recursive: true }
  );

  await writeAtomic(
    healthCandidatesFile,
    `${JSON.stringify(healthCandidates, null, 2)}\n`
  );

  if (healthCandidates.length !== regular.length + automaticWhiteList.length) {
    throw new Error(
      `Health candidate manifest mismatch: ` +
      `manifest=${healthCandidates.length}, ` +
      `expected=${regular.length + automaticWhiteList.length}`
    );
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

  // Build candidate metadata using the exact managed IDs that were assigned
  // when the staged config files were written. `regular` / `automaticWhiteList`
  // are source objects and intentionally do not carry the managed ID themselves.
  // Using item.id here therefore produced `undefined.json` in the report.
  const candidateMapEntries = [];

  regular.forEach((item, index) => {
    const id = `source-regular-${String(index + 1).padStart(2, "0")}`;
    candidateMapEntries.push([
      fingerprintUrl(item.link),
      {
        source: item.source || (item.retained ? "retained" : "unknown"),
        country: item.country || "Unknown",
        whiteList: Boolean(item.whiteList),
        retained: Boolean(item.retained),
        sourceKind: item.sourceKind || "links",
        configFile:
          item.sourceKind === "json"
            ? `${id}.json`
            : "",
        managedId: id,
      },
    ]);
  });

  automaticWhiteList.forEach((item, index) => {
    const id = `source-whitelist-${String(index + 1).padStart(2, "0")}`;
    candidateMapEntries.push([
      fingerprintUrl(item.link),
      {
        source: item.source || (item.retained ? "retained" : "unknown"),
        country: item.country || "Unknown",
        whiteList: true,
        retained: Boolean(item.retained),
        sourceKind: item.sourceKind || "links",
        configFile:
          item.sourceKind === "json"
            ? `${id}.json`
            : "",
        managedId: id,
      },
    ]);
  });

  const candidateMap = Object.fromEntries(candidateMapEntries);

  const endpointCloneGroups =
    buildEndpointCloneGroups(deduped);

  const manifestText = await fs.readFile(healthCandidatesFile, "utf8");
  const manifestSha256 = crypto.createHash("sha256").update(manifestText).digest("hex");
  const generationId = manifestSha256.slice(0, 16);

  await writeAtomic(
    UPDATE_STATUS_FILE,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      refreshed: true,
      generationId,
      manifestSha256,
      sourceCount: sources.length,
      configuredSourceCount: sourceFetches.length,
      totalRawEntries,
      freshBeforeDedupe: allEntries.length,
      afterDedupe: deduped.length,
      freshRegular: freshRegularCount,
      freshWhiteList: freshWhiteListCount,
      retainedFromPreviousPool: merged.retainedCount,
      totalBeforeHealthCheck: healthCandidates.length,
      sourceCandidateCounts,
    }, null, 2)}\n`
  );

  const report = {
    generatedAt: new Date().toISOString(),
    generationId,
    manifestSha256,
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
    healthCandidateManifest: {
      path: "source-health-candidates.json",
      count: healthCandidates.length,
    },
    retainedPolicy: "previous managed links are retained unless temporarily quarantined by a failed health check; quarantine is not a permanent blacklist",
  };
  await writeAtomic(
    path.join(ROOT, "source-report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );

  const stateAfterUpdate = await readState();

  await writeAtomic(
    STATE_FILE,
    `${JSON.stringify({
      ...stateAfterUpdate,
      lastSuccessfulUpdateAt: Date.now(),
      sourceCount: sources.length,
      rawEntryCount: totalRawEntries,
      regularCount: regular.length,
      autoWhiteListCount: automaticWhiteList.length,
      happHwid: clientIdentity.hwid,
      happDeviceModel: clientIdentity.deviceModel,
      sourceFingerprints: currentSourceFingerprints,
      sourceDeviceAssignments:
        stateAfterUpdate.sourceDeviceAssignments || {},
    }, null, 2)}\n`
  );

  console.log(
    `Source update complete: ${sources.length} sources, ` +
    `${regular.length} regular, ${automaticWhiteList.length} auto-white-list, ` +
    `${merged.retainedCount} retained from previous pool.`
  );
}

main().catch(error => {
  console.error(`Source update failed: ${error.message}`);
  process.exitCode = 1;
});
