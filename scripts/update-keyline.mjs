import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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

const MANAGED_REGULAR_RE = /^keyline-regular-\d+$/i;
const MANAGED_WHITE_LIST_RE = /^keyline-whitelist-\d+$/i;

function isManagedId(id) {
  return MANAGED_REGULAR_RE.test(id) || MANAGED_WHITE_LIST_RE.test(id);
}

function isWhiteListRemark(remarks = "") {
  const value = String(remarks).toLowerCase();

  return (
    /white[\s_-]*list/.test(value) ||
    /whitelist/.test(value) ||
    /бел(ый|ого|ому|ым|ом)?[\s_-]*(список|лист)/.test(value) ||
    value.includes("🏳️") ||
    value.includes("🏳")
  );
}

function extractFlag(remarks = "") {
  const match = String(remarks).match(
    /(?:^|\s)([\u{1F1E6}-\u{1F1FF}]{2})(?=\s|$)/u
  );

  return match?.[1] || "🏳️";
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

async function fetchJsonUrl(url, label) {
  let lastError = null;

  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
          "user-agent": "enter-config-keyline-updater/2.1",
        },
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

      try {
        return safeJsonParse(text, label);
      } catch (error) {
        const contentType = response.headers.get("content-type") || "unknown";

        throw new Error(
          `${error.message}; content-type=${contentType}`
        );
      }
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
  const fixtureJson = process.env.KEYLINE_FIXTURE_JSON;

  if (fixtureJson) {
    return [{
      label: "fixture",
      data: safeJsonParse(fixtureJson, "KEYLINE_FIXTURE_JSON"),
      forceWhiteList: false,
    }];
  }

  const fixturePath = process.env.KEYLINE_FIXTURE;

  if (fixturePath) {
    const resolved = path.resolve(process.cwd(), fixturePath);
    const text = await fs.readFile(resolved, "utf8");

    return [{
      label: resolved,
      data: safeJsonParse(text, resolved),
      forceWhiteList: false,
    }];
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

  // Every configured subscription is read exactly once per attempt,
  // with bounded retries for transient/partial HTTP responses.
  for (let index = 0; index < regularUrls.length; index += 1) {
    const url = regularUrls[index];
    const label = `Keyline source ${index + 1}`;

    try {
      const data = await fetchJsonUrl(url, label);

      sources.push({
        label,
        data,
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
      const data = await fetchJsonUrl(url, label);

      sources.push({
        label,
        data,
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

  return sources;
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

  // enter-main currently preserves TCP/GRPC VLESS fields correctly.
  // Other transports are skipped rather than emitted as broken links.
  if (!["tcp", "grpc"].includes(stream.network)) return null;

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

  return (
    `vless://${encodeURIComponent(user.id)}@${server.address}:${server.port}?${query}`
  );
}

function buildSupportedLink(entry) {
  const outbound = entry?.outbounds?.find(
    item => item?.tag === "proxy"
  );

  if (!outbound) return null;
  if (outbound.protocol === "vless") return buildVlessLink(entry);

  return null;
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

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const flagCompare = extractFlag(a.remarks).localeCompare(
      extractFlag(b.remarks),
      "ru"
    );

    if (flagCompare !== 0) return flagCompare;

    const sourceCompare = a.source.localeCompare(b.source, "ru");

    if (sourceCompare !== 0) return sourceCompare;

    return a.remarks.localeCompare(b.remarks, "ru");
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

async function buildStagedLinks(currentIndex, regular, autoWhiteList) {
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
    !isManagedId(item.id)
  ));

  const nextEntries = [...manualEntries];

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
      remarks: item.remarks.replace(/\s+/g, " ").trim(),
    });
  }

  for (let index = 0; index < autoWhiteList.length; index += 1) {
    const id = `keyline-whitelist-${String(index + 1).padStart(2, "0")}`;
    const item = autoWhiteList[index];
    const flag = extractFlag(item.remarks);

    await fs.writeFile(
      path.join(stageDir, `${id}.link`),
      `${item.link}\n`,
      "utf8"
    );

    nextEntries.push({
      id,
      remarks: `${flag} 🤖 🏳️ Auto White List ${index + 1}`,
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

  const sources = await fetchKeylineSources();
  const allEntries = [];
  let totalRawEntries = 0;

  for (const source of sources) {
    if (!Array.isArray(source.data)) {
      throw new Error(
        `${source.label}: response must be a JSON array. ` +
        "Existing Keyline pool is preserved."
      );
    }

    totalRawEntries += source.data.length;

    for (let index = 0; index < source.data.length; index += 1) {
      const normalized = normalizeEntry(
        source.data[index],
        index,
        source.label
      );

      if (!normalized) continue;
      if (source.forceWhiteList) normalized.whiteList = true;

      allEntries.push(normalized);
    }
  }

  const deduped = dedupe(allEntries);

  const regular = sortEntries(
    deduped.filter(item => !item.whiteList)
  ).slice(0, REGULAR_LIMIT);

  const autoWhiteList = sortEntries(
    deduped.filter(item => item.whiteList)
  ).slice(0, AUTO_WHITE_LIST_LIMIT);

  if (regular.length === 0 && autoWhiteList.length === 0) {
    throw new Error(
      "Configured Keyline sources returned zero supported servers. " +
      "Existing Keyline pool is preserved."
    );
  }

  const currentIndex = await loadIndex();
  const { stageDir } = await buildStagedLinks(
    currentIndex,
    regular,
    autoWhiteList
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
      autoWhiteListCount: autoWhiteList.length,
    }, null, 2)}\n`
  );

  console.log(
    `Keyline update complete: ${sources.length} sources, ` +
    `${regular.length} regular, ${autoWhiteList.length} auto-white-list.`
  );
}

main().catch(error => {
  console.error(`Keyline update failed: ${error.message}`);
  process.exitCode = 1;
});
