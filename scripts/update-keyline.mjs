import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const LINKS_DIR = path.join(ROOT, "config", "links");
const INDEX_FILE = path.join(LINKS_DIR, "index.json");
const STATE_FILE = path.join(ROOT, ".keyline-state.json");

const REGULAR_LIMIT = 40;
const WHITE_LIST_LIMIT = 20;
const SUCCESS_INTERVAL_MS = 12 * 60 * 60 * 1000;

const PROTECTED_ID_PATTERNS = [
  /^europe-\d+$/i,
  /^whitelist-\d+$/i,
];

function isProtectedId(id) {
  return PROTECTED_ID_PATTERNS.some(pattern => pattern.test(id));
}

function isWhiteListRemark(remarks = "") {
  const value = String(remarks).toLowerCase();
  return (
    /white[\s_-]*list/.test(value) ||
    /whitelist/.test(value) ||
    /бел(ый|ого)?[\s_-]*(список|лист)/.test(value) ||
    value.includes("🏳️")
  );
}

function extractFlag(remarks = "") {
  const flagMatch = String(remarks).match(/(?:^|\s)([\u{1F1E6}-\u{1F1FF}]{2})(?=\s|$)/u);
  return flagMatch?.[1] || "🏳️";
}

function safeJsonParse(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${source}: invalid JSON (${error.message})`);
  }
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

async function shouldSkip() {
  const state = await readState();
  const elapsed = Date.now() - state.lastSuccessfulUpdateAt;
  if (state.lastSuccessfulUpdateAt > 0 && elapsed < SUCCESS_INTERVAL_MS) {
    const nextAt = new Date(state.lastSuccessfulUpdateAt + SUCCESS_INTERVAL_MS);
    console.log(`Keyline update skipped until ${nextAt.toISOString()}.`);
    return true;
  }
  return false;
}

async function fetchJsonUrl(url, label) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
      "user-agent": "enter-config-keyline-updater/1.0",
    },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  return safeJsonParse(text, url);
}

async function fetchKeylineSources() {
  const fixture = process.env.KEYLINE_FIXTURE;
  if (fixture) {
    const fixturePath = path.resolve(process.cwd(), fixture);
    const text = await fs.readFile(fixturePath, "utf8");
    return {
      primary: safeJsonParse(text, fixturePath),
      whiteList: [],
    };
  }

  const primaryUrl = process.env.KEYLINE_URL?.trim();
  if (!primaryUrl) {
    throw new Error("KEYLINE_URL is not configured.");
  }

  const whiteListUrl = process.env.KEYLINE_WHITE_LIST_URL?.trim();

  const primary = await fetchJsonUrl(primaryUrl, "Keyline regular source");
  const whiteList = whiteListUrl
    ? await fetchJsonUrl(whiteListUrl, "Keyline White List source")
    : [];

  return { primary, whiteList };
}

function encodeQuery(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function buildVlessLink(entry) {
  const outbound = entry?.outbounds?.find(item => item?.tag === "proxy");
  if (!outbound || outbound.protocol !== "vless") {
    return null;
  }

  const server = outbound.settings?.vnext?.[0];
  const user = server?.users?.[0];
  const stream = outbound.streamSettings || {};

  if (!server?.address || !server?.port || !user?.id) return null;
  if (!stream.network || !stream.security) return null;

  // enter-main currently serializes VLESS TCP/GRPC links correctly.
  // XHTTP requires xhttpSettings, which the current parser/builder do not preserve,
  // so those entries are deliberately skipped instead of generating a broken link.
  if (!['tcp', 'grpc'].includes(stream.network)) return null;

  const reality = stream.realitySettings || {};
  const query = encodeQuery({
    encryption: user.encryption || "none",
    flow: user.flow || "",
    type: stream.network,
    security: stream.security,
    sni: reality.serverName || "",
    pbk: reality.publicKey || "",
    sid: reality.shortId || "",
    fp: reality.fingerprint || "",
    serviceName: stream.grpcSettings?.serviceName || "",
    mode: stream.grpcSettings?.multiMode ? "multi" : "",
  });

  return `vless://${encodeURIComponent(user.id)}@${server.address}:${server.port}?${query}`;
}

function buildSupportedLink(entry) {
  const outbound = entry?.outbounds?.find(item => item?.tag === "proxy");
  if (!outbound) return null;

  if (outbound.protocol === "vless") {
    return buildVlessLink(entry);
  }

  // The current Keyline feed is VLESS-only, but keep the adapter honest:
  // unsupported protocols are skipped rather than writing links the app cannot parse.
  return null;
}

function normalizeEntry(entry, index, source) {
  if (!entry || typeof entry !== "object") return null;

  const outbounds = Array.isArray(entry.outbounds) ? entry.outbounds : [];
  const proxy = outbounds.find(item => item?.tag === "proxy");
  const remarks = typeof entry.remarks === "string" ? entry.remarks.trim() : "";
  const link = buildSupportedLink(entry);

  if (!proxy || !remarks || !link) return null;
  if (/^🚀\s*авто\s*выбор/i.test(remarks)) return null;

  return {
    sourceIndex: index,
    source,
    remarks,
    whiteList: isWhiteListRemark(remarks),
    link,
  };
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

function sortKeylineEntries(entries) {
  return [...entries].sort((a, b) => {
    const flagCompare = extractFlag(a.remarks).localeCompare(extractFlag(b.remarks), "ru");
    if (flagCompare !== 0) return flagCompare;
    return a.remarks.localeCompare(b.remarks, "ru");
  });
}

function buildRemarks(entry, number, fallbackPrefix) {
  if (entry.whiteList) {
    return `${extractFlag(entry.remarks)} 🏳️ White List ${number}`;
  }

  const cleaned = entry.remarks.replace(/\s+/g, " ").trim();
  return cleaned || `${fallbackPrefix} ${number}`;
}

async function listLinkFiles() {
  return (await fs.readdir(LINKS_DIR, { withFileTypes: true }))
    .filter(item => item.isFile() && item.name.endsWith(".link"))
    .map(item => item.name);
}

async function loadIndex() {
  const text = await fs.readFile(INDEX_FILE, "utf8");
  const index = safeJsonParse(text, INDEX_FILE);
  if (!Array.isArray(index)) throw new Error("config/links/index.json must contain an array.");
  return index;
}

async function writeAtomic(file, content) {
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, content, "utf8");
  await fs.rename(temp, file);
}

async function removeManagedFiles() {
  const files = await listLinkFiles();
  for (const name of files) {
    const id = name.slice(0, -".link".length);
    if (!isProtectedId(id)) {
      await fs.unlink(path.join(LINKS_DIR, name));
    }
  }
}

async function main() {
  if (await shouldSkip()) return;

  const { primary, whiteList: whiteListSource } = await fetchKeylineSources();

  if (!Array.isArray(primary)) {
    throw new Error("Keyline regular response must be a JSON array.");
  }
  if (!Array.isArray(whiteListSource)) {
    throw new Error("Keyline White List response must be a JSON array.");
  }

  const regularSourceEntries = primary
    .map((entry, index) => normalizeEntry(entry, index, "regular"))
    .filter(Boolean);

  const whiteListSourceEntries = whiteListSource
    .map((entry, index) => normalizeEntry(entry, index, "whitelist"))
    .filter(Boolean)
    .map(entry => ({ ...entry, whiteList: true }));

  const allEntries = dedupe([
    ...regularSourceEntries,
    ...whiteListSourceEntries,
  ]);

  const regular = sortKeylineEntries(
    allEntries.filter(item => !item.whiteList)
  ).slice(0, REGULAR_LIMIT);

  const whiteList = sortKeylineEntries(
    allEntries.filter(item => item.whiteList)
  ).slice(0, WHITE_LIST_LIMIT);

  if (regular.length === 0) {
    throw new Error("Keyline returned zero supported regular servers; keeping the existing pool.");
  }

  const currentIndex = await loadIndex();
  const protectedEntries = currentIndex.filter(
    item => item && typeof item.id === "string" && isProtectedId(item.id)
  );

  await removeManagedFiles();

  const manualWhiteLists = protectedEntries.filter(item => /^whitelist-\d+$/i.test(item.id));
  const europeEntries = protectedEntries.filter(item => /^europe-\d+$/i.test(item.id));
  const nextEntries = [...europeEntries, ...protectedEntries.filter(item => !/^europe-\d+$/i.test(item.id) && !/^whitelist-\d+$/i.test(item.id))];

  for (let i = 0; i < regular.length; i += 1) {
    const id = `keyline-regular-${String(i + 1).padStart(2, "0")}`;
    const item = regular[i];
    await writeAtomic(path.join(LINKS_DIR, `${id}.link`), `${item.link}\n`);
    nextEntries.push({
      id,
      remarks: buildRemarks(item, i + 1, "Keyline"),
    });
  }

  nextEntries.push(...manualWhiteLists);

  for (let i = 0; i < whiteList.length; i += 1) {
    const id = `keyline-whitelist-${String(i + 1).padStart(2, "0")}`;
    const item = whiteList[i];
    await writeAtomic(path.join(LINKS_DIR, `${id}.link`), `${item.link}\n`);
    nextEntries.push({
      id,
      remarks: buildRemarks(item, i + 1, "White List"),
    });
  }

  await writeAtomic(
    INDEX_FILE,
    `${JSON.stringify(nextEntries, null, 2)}\n`
  );

  await writeAtomic(
    STATE_FILE,
    `${JSON.stringify({ lastSuccessfulUpdateAt: Date.now() }, null, 2)}\n`
  );

  console.log(`Keyline update complete: ${regular.length} regular, ${whiteList.length} white-list servers.`);
}

main().catch(error => {
  console.error(`Keyline update failed: ${error.message}`);
  process.exitCode = 1;
});
