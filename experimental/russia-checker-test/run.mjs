#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

const ROOT = process.cwd();
const INPUT_FILE = path.resolve(
  ROOT,
  process.env.RUSSIA_TEST_INPUT || "config/source-health-candidates.json",
);
const OUT_DIR = path.resolve(
  ROOT,
  process.env.RUSSIA_TEST_OUTPUT_DIR || "experimental/russia-checker-test/results",
);

const CHECK_HOST_BASE = String(
  process.env.RUSSIA_TEST_CHECK_HOST_BASE || "https://check-host.net",
).replace(/\/$/, "");

const CHECK_HOST_NODES = String(
  process.env.RUSSIA_TEST_CHECK_HOST_NODES ||
    "ru2.node.check-host.net,ru3.node.check-host.net",
)
  .split(/[\s,;]+/)
  .map((v) => v.trim())
  .filter(Boolean);

const CHECK_HOST_QUORUM = Math.max(
  1,
  Number(process.env.RUSSIA_TEST_CHECK_HOST_QUORUM) || CHECK_HOST_NODES.length,
);

const CHECK_HOST_CREATE_TIMEOUT_MS = Math.max(
  4000,
  Number(process.env.RUSSIA_TEST_CREATE_TIMEOUT_MS) || 8000,
);
const CHECK_HOST_RESULT_TIMEOUT_MS = Math.max(
  1500,
  Number(process.env.RUSSIA_TEST_RESULT_TIMEOUT_MS) || 3000,
);
const CHECK_HOST_POLL_MS = Math.max(
  500,
  Number(process.env.RUSSIA_TEST_POLL_MS) || 900,
);
const CHECK_HOST_MAX_POLL_MS = Math.max(
  CHECK_HOST_POLL_MS,
  Number(process.env.RUSSIA_TEST_MAX_POLL_MS) || 7000,
);
const CHECK_HOST_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.RUSSIA_TEST_CONCURRENCY) || 4),
);
const CHECK_HOST_CREATE_INTERVAL_MS = Math.max(
  150,
  Number(process.env.RUSSIA_TEST_CREATE_INTERVAL_MS) || 400,
);

const GLOBALPING_ENABLED = /^(1|true|yes)$/i.test(
  String(process.env.RUSSIA_TEST_GLOBALPING || "1"),
);
const GLOBALPING_BASE = String(
  process.env.RUSSIA_TEST_GLOBALPING_BASE || "https://api.globalping.io/v1",
).replace(/\/$/, "");
const GLOBALPING_TOKEN = String(
  process.env.RUSSIA_TEST_GLOBALPING_TOKEN || process.env.GLOBALPING_API_TOKEN || "",
).trim();
const GLOBALPING_SAMPLE = Math.max(
  0,
  Math.min(24, Number(process.env.RUSSIA_TEST_GLOBALPING_SAMPLE) || 12),
);
const GLOBALPING_CITY_LIMIT = Math.max(
  3,
  Math.min(10, Number(process.env.RUSSIA_TEST_GLOBALPING_CITY_LIMIT) || 8),
);
const GLOBALPING_POLL_MS = Math.max(
  500,
  Number(process.env.RUSSIA_TEST_GLOBALPING_POLL_MS) || 900,
);
const GLOBALPING_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.RUSSIA_TEST_GLOBALPING_TIMEOUT_MS) || 12000,
);

const PRIORITY_RUSSIA_CITIES = [
  "Moscow",
  "Saint Petersburg",
  "Yekaterinburg",
  "Kazan",
  "Novosibirsk",
  "Nizhny Novgorod",
  "Samara",
  "Krasnodar",
  "Rostov-on-Don",
];

const SCOPE = String(process.env.RUSSIA_TEST_SCOPE || "all").trim().toLowerCase();
const DRY_RUN = /^(1|true|yes)$/i.test(String(process.env.RUSSIA_TEST_DRY_RUN || "0"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isLte(item) {
  return Boolean(
    item?.whiteList === true ||
      /source-whitelist-\d+/i.test(String(item?.id || "")),
  );
}

function protocolOf(link) {
  return String(link || "").split("://", 1)[0].trim().toLowerCase();
}

function transportOf(protocol) {
  return ["hysteria", "hysteria2", "tuic"].includes(String(protocol).toLowerCase())
    ? "udp"
    : "tcp";
}

function endpointKey(link) {
  const url = new URL(String(link).trim());
  const protocol = protocolOf(link);
  const transport = transportOf(protocol);
  const host = String(url.hostname || "").toLowerCase();
  const port = Number(url.port || 443);
  return `${transport}|${host}|${port}`;
}

function targetForCheckHost(url) {
  const host = String(url.hostname || "");
  const port = Number(url.port || 443);
  const hostPart = host.includes(":") ? `[${host}]` : host;
  return `${hostPart}:${port}`;
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "escapevpn-russia-checker-experiment/1.0",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      const error = new Error(`non-JSON response (${response.status})`);
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(body?.error || body?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfterMs = Number(response.headers.get("retry-after")) * 1000 || 0;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable =
        status === 408 ||
        status === 429 ||
        status >= 500 ||
        /aborted|timeout|timed out|fetch failed/i.test(String(error?.message || ""));
      if (!retryable || attempt + 1 >= attempts) throw error;
      const retryAfter = Number(error?.retryAfterMs);
      const backoff = 1000 * 2 ** attempt;
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.max(backoff, retryAfter) : backoff);
    }
  }
  throw lastError || new Error("retry failed");
}

let lastCheckHostCreateAt = 0;
async function throttleCheckHostCreate() {
  const wait = CHECK_HOST_CREATE_INTERVAL_MS - (Date.now() - lastCheckHostCreateAt);
  if (wait > 0) await sleep(wait);
  lastCheckHostCreateAt = Date.now();
}

function parseCheckHostNode(raw, node, transport) {
  if (raw == null) {
    return { node, state: "pending", latencyMs: 0, raw: null };
  }

  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first && typeof first === "object") {
    if (Number.isFinite(Number(first.time))) {
      return {
        node,
        state: "reachable",
        latencyMs: Number(first.time) * 1000,
        raw: first,
      };
    }

    const error = String(first.error || first.message || "").trim();
    if (transport === "udp") {
      if (/connection refused|port unreachable|unreachable/i.test(error)) {
        return { node, state: "refused", latencyMs: 0, raw: first, error };
      }
      if (/open or filtered|filtered|timeout|timed? out|no response/i.test(error)) {
        return { node, state: "udp-filtered", latencyMs: 0, raw: first, error: error || "open or filtered" };
      }
    }

    return { node, state: "unreachable", latencyMs: 0, raw: first, error: error || "unreachable" };
  }

  const value = String(first || "").trim();
  if (transport === "udp" && !value) {
    return { node, state: "pending", latencyMs: 0, raw: first };
  }
  return { node, state: transport === "udp" ? "udp-filtered" : "unreachable", latencyMs: 0, raw: first, error: value };
}

function decide(results, transport) {
  if (transport === "tcp") {
    const reachable = results.filter((r) => r.state === "reachable").length;
    const pending = results.filter((r) => r.state === "pending").length;
    if (reachable >= CHECK_HOST_QUORUM) return { verdict: "PASS", confidence: "transport-confirmed" };
    if (reachable + pending < CHECK_HOST_QUORUM) return { verdict: "FAIL", confidence: "transport-confirmed" };
    return { verdict: "UNKNOWN", confidence: "unresolved" };
  }

  // UDP is fundamentally different: Check-Host documents a silent UDP port as
  // "open or filtered". That is useful for detecting a hard refusal, but it
  // cannot prove an actual Hysteria/QUIC handshake. We therefore keep a separate
  // verdict instead of pretending that UDP PASS means "Hysteria works".
  const refused = results.some((r) => r.state === "refused");
  const unresolved = results.some((r) => r.state === "pending" || r.state === "unreachable");
  const usableSignals = results.filter((r) => r.state === "reachable" || r.state === "udp-filtered").length;
  if (refused) return { verdict: "FAIL", confidence: "udp-refused" };
  if (usableSignals === results.length && results.length >= CHECK_HOST_QUORUM) {
    return { verdict: "PASS-UDP-FILTERED", confidence: "transport-not-refused" };
  }
  if (!unresolved && usableSignals > 0) return { verdict: "PASS-UDP-FILTERED", confidence: "transport-not-refused" };
  return { verdict: "UNKNOWN", confidence: "udp-inconclusive" };
}

async function createCheckHostMeasurement(url, protocol) {
  const transport = transportOf(protocol);
  const checkType = transport === "udp" ? "udp" : "tcp";
  const params = new URLSearchParams({
    host: targetForCheckHost(url),
    max_nodes: String(CHECK_HOST_NODES.length),
  });
  for (const node of CHECK_HOST_NODES) params.append("node", node);

  await throttleCheckHostCreate();
  const created = await withRetry(() =>
    fetchJson(
      `${CHECK_HOST_BASE}/check-${checkType}?${params.toString()}`,
      {},
      CHECK_HOST_CREATE_TIMEOUT_MS,
    ),
  );

  const requestId = String(created?.request_id || "").trim();
  if (!requestId) throw new Error("Check-Host response has no request_id");
  return { requestId, transport, checkType, nodes: [...CHECK_HOST_NODES] };
}

async function pollCheckHostMeasurement(measurement) {
  const started = Date.now();
  let lastPayload = null;
  while (Date.now() - started <= CHECK_HOST_MAX_POLL_MS) {
    await sleep(CHECK_HOST_POLL_MS);
    lastPayload = await withRetry(() =>
      fetchJson(
        `${CHECK_HOST_BASE}/check-result/${encodeURIComponent(measurement.requestId)}`,
        {},
        CHECK_HOST_RESULT_TIMEOUT_MS,
      ),
    );

    const parsed = measurement.nodes.map((node) =>
      parseCheckHostNode(lastPayload?.[node] ?? null, node, measurement.transport),
    );

    const decision = decide(parsed, measurement.transport);
    const done =
      decision.verdict === "PASS" ||
      decision.verdict === "FAIL" ||
      (measurement.transport === "udp" && decision.verdict === "PASS-UDP-FILTERED");

    if (done) {
      return {
        ...decision,
        nodes: parsed,
        requestId: measurement.requestId,
      };
    }
  }

  return {
    verdict: "UNKNOWN",
    confidence: measurement.transport === "udp" ? "udp-inconclusive" : "timeout",
    nodes: measurement.nodes.map((node) =>
      parseCheckHostNode(lastPayload?.[node] ?? null, node, measurement.transport),
    ),
    requestId: measurement.requestId,
    error: "Check-Host result did not resolve within the bounded polling window",
  };
}

async function checkEndpoint(endpoint) {
  if (DRY_RUN) {
    return {
      verdict: "DRY-RUN",
      confidence: "not-tested",
      requestId: "",
      nodes: CHECK_HOST_NODES.map((node) => ({ node, state: "dry-run", latencyMs: 0 })),
    };
  }

  const url = new URL(endpoint.link);
  const protocol = protocolOf(endpoint.link);
  const measurement = await createCheckHostMeasurement(url, protocol);
  return pollCheckHostMeasurement(measurement);
}

function selectItems(candidates) {
  if (!["all", "lte", "regular"].includes(SCOPE)) {
    throw new Error(`RUSSIA_TEST_SCOPE must be all, lte or regular; got ${SCOPE}`);
  }
  const lte = candidates.filter(isLte);
  const regular = candidates.filter((item) => !isLte(item));
  if (SCOPE === "lte") return { lte, regular: [] };
  if (SCOPE === "regular") return { lte: [], regular };
  return { lte, regular };
}

function buildEndpointWorkset(items) {
  const byKey = new Map();
  for (const item of items) {
    const link = String(item?.link || "").trim();
    if (!link) continue;
    try {
      const key = endpointKey(link);
      const existing = byKey.get(key) || {
        key,
        link,
        protocol: protocolOf(link),
        transport: transportOf(protocolOf(link)),
        members: [],
      };
      existing.members.push({
        id: item.id,
        remarks: item.remarks || "",
        link,
      });
      byKey.set(key, existing);
    } catch {
      // Invalid URLs remain visible in the report, but cannot be sent to Check-Host.
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function runPool(items, fn) {
  const out = [];
  let cursor = 0;
  const workerCount = Math.min(CHECK_HOST_CONCURRENCY, Math.max(1, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      try {
        out[index] = await fn(item);
      } catch (error) {
        out[index] = {
          verdict: "UNKNOWN",
          confidence: "checker-error",
          nodes: [],
          error: error?.message || String(error),
        };
      }
      if ((index + 1) % 20 === 0 || index + 1 === items.length) {
        console.log(`RUSSIA TEST PROGRESS ${index + 1}/${items.length}`);
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function summarize(endpointRows) {
  const counts = {};
  for (const row of endpointRows) counts[row.verdict] = (counts[row.verdict] || 0) + 1;
  return counts;
}

function expandPassingLinks(items, endpointRows) {
  const verdictByKey = new Map(endpointRows.map((row) => [row.key, row]));
  const links = [];
  for (const item of items) {
    const link = String(item?.link || "").trim();
    if (!link) continue;
    let key;
    try {
      key = endpointKey(link);
    } catch {
      continue;
    }
    const verdict = verdictByKey.get(key)?.verdict;
    if (verdict === "PASS" || verdict === "PASS-UDP-FILTERED" || verdict === "DRY-RUN") {
      links.push(link);
    }
  }
  return [...new Set(links)];
}

async function getGlobalpingProbes() {
  if (!GLOBALPING_ENABLED || DRY_RUN) return [];
  const data = await withRetry(() =>
    fetchJson(
      `${GLOBALPING_BASE}/probes`,
      GLOBALPING_TOKEN ? { headers: { authorization: `Bearer ${GLOBALPING_TOKEN}` } } : {},
      GLOBALPING_TIMEOUT_MS,
    ),
  );
  const probes = Array.isArray(data?.probes) ? data.probes : [];
  return probes.filter((probe) => String(probe?.country || "").toUpperCase() === "RU");
}

function chooseGlobalpingCities(probes) {
  const byCity = new Map();
  for (const probe of probes) {
    const city = String(probe?.city || "").trim();
    if (!city) continue;
    const key = city.toLowerCase();
    const current = byCity.get(key) || { city, count: 0 };
    current.count += 1;
    byCity.set(key, current);
  }

  const picked = [];
  const used = new Set();
  for (const city of PRIORITY_RUSSIA_CITIES) {
    const hit = byCity.get(city.toLowerCase());
    if (hit && !used.has(city.toLowerCase())) {
      picked.push(hit);
      used.add(city.toLowerCase());
    }
    if (picked.length >= GLOBALPING_CITY_LIMIT) return picked;
  }

  for (const row of [...byCity.values()].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))) {
    if (used.has(row.city.toLowerCase())) continue;
    picked.push(row);
    used.add(row.city.toLowerCase());
    if (picked.length >= GLOBALPING_CITY_LIMIT) break;
  }
  return picked;
}

async function createGlobalpingPing(target, city) {
  const headers = { "content-type": "application/json" };
  if (GLOBALPING_TOKEN) headers.authorization = `Bearer ${GLOBALPING_TOKEN}`;
  const body = {
    type: "ping",
    target,
    locations: [{ country: "RU", city, limit: 1 }],
    measurementOptions: { packets: 3 },
  };
  return fetchJson(`${GLOBALPING_BASE}/measurements`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, GLOBALPING_TIMEOUT_MS);
}

async function getGlobalpingMeasurement(id) {
  return fetchJson(
    `${GLOBALPING_BASE}/measurements/${encodeURIComponent(id)}`,
    GLOBALPING_TOKEN ? { headers: { authorization: `Bearer ${GLOBALPING_TOKEN}` } } : {},
    GLOBALPING_TIMEOUT_MS,
  );
}

async function runGlobalpingDiagnostics(regularItems) {
  if (!GLOBALPING_ENABLED) return { enabled: false, reason: "disabled" };
  if (DRY_RUN) return { enabled: true, dryRun: true, cities: [], results: [] };
  if (GLOBALPING_SAMPLE <= 0 || !regularItems.length) {
    return { enabled: true, cities: [], results: [], reason: "no diagnostic sample requested" };
  }

  let probes;
  try {
    probes = await getGlobalpingProbes();
  } catch (error) {
    return { enabled: true, error: `probe discovery failed: ${error?.message || String(error)}`, cities: [], results: [] };
  }

  const cities = chooseGlobalpingCities(probes);
  const sample = regularItems
    .filter((item) => {
      try {
        return transportOf(protocolOf(item?.link || "")) === "tcp";
      } catch {
        return false;
      }
    })
    .map((item) => ({ item, fp: hash(item.link || "") }))
    .sort((a, b) => a.fp.localeCompare(b.fp))
    .slice(0, GLOBALPING_SAMPLE);

  const results = [];
  for (const row of sample) {
    let url;
    try {
      url = new URL(String(row.item.link || "").trim());
    } catch {
      continue;
    }
    for (const cityRow of cities) {
      try {
        const created = await withRetry(() => createGlobalpingPing(url.hostname, cityRow.city), 2);
        const id = String(created?.id || "").trim();
        if (!id) throw new Error("Globalping response has no measurement id");
        const started = Date.now();
        let data = null;
        while (Date.now() - started <= GLOBALPING_TIMEOUT_MS) {
          await sleep(GLOBALPING_POLL_MS);
          data = await getGlobalpingMeasurement(id);
          if (String(data?.status || "").toLowerCase() !== "in-progress") break;
        }
        const probeResults = Array.isArray(data?.results) ? data.results : [];
        const finished = probeResults.filter((probe) => String(probe?.result?.status || "").toLowerCase() === "finished");
        const avg = finished
          .map((probe) => Number(probe?.result?.stats?.avg))
          .find((value) => Number.isFinite(value));
        results.push({
          id: row.item.id,
          host: url.hostname,
          city: cityRow.city,
          probeCount: finished.length,
          avgMs: Number.isFinite(avg) ? avg : null,
          status: finished.length ? "reachable" : String(data?.status || "unknown"),
          measurementId: id,
        });
      } catch (error) {
        results.push({
          id: row.item.id,
          host: url.hostname,
          city: cityRow.city,
          status: "error",
          error: error?.message || String(error),
        });
      }
    }
  }

  return {
    enabled: true,
    probesInRussia: probes.length,
    cities,
    sampleSize: sample.length,
    results,
    purpose: "diagnostic-only; never affects the Check-Host verdict or link lists",
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const input = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
  if (!Array.isArray(input) || !input.length) {
    throw new Error(`${INPUT_FILE} must contain a non-empty candidate array`);
  }

  const { lte, regular } = selectItems(input);
  const work = [
    ["regular", regular],
    ["lte", lte],
  ];

  const reports = {};
  const lists = {};

  for (const [label, items] of work) {
    if (!items.length) continue;
    const endpointWorkset = buildEndpointWorkset(items);
    console.log(`${label.toUpperCase()} WORKSET: candidates=${items.length}; uniqueEndpoints=${endpointWorkset.length}`);
    const results = await runPool(endpointWorkset, checkEndpoint);
    const endpointRows = results.map((result, i) => ({
      key: endpointWorkset[i].key,
      link: endpointWorkset[i].link,
      protocol: endpointWorkset[i].protocol,
      transport: endpointWorkset[i].transport,
      ...result,
      candidateIds: endpointWorkset[i].members.map((member) => member.id),
      remarks: endpointWorkset[i].members.map((member) => member.remarks).filter(Boolean).slice(0, 3),
    }));
    const candidateLinks = expandPassingLinks(items, endpointRows);
    reports[label] = {
      candidates: items.length,
      uniqueEndpoints: endpointRows.length,
      endpointVerdicts: summarize(endpointRows),
      endpoints: endpointRows,
    };
    lists[label] = candidateLinks;
    await fs.writeFile(
      path.join(OUT_DIR, `locations-${label}.txt`),
      candidateLinks.length ? `${candidateLinks.join("\n")}\n` : "",
      "utf8",
    );
  }

  const globalping = await runGlobalpingDiagnostics(regular);
  await fs.writeFile(
    path.join(OUT_DIR, "globalping-city-diagnostic.json"),
    `${JSON.stringify(globalping, null, 2)}\n`,
    "utf8",
  );

  const markdown = [];
  markdown.push("# Russia checker experiment");
  markdown.push("");
  markdown.push(`Generated: ${new Date().toISOString()}`);
  markdown.push(`Scope: ${SCOPE}`);
  markdown.push(`Check-Host nodes: ${CHECK_HOST_NODES.join(", ")}`);
  markdown.push(`Check-Host quorum: ${CHECK_HOST_QUORUM}/${CHECK_HOST_NODES.length}`);
  markdown.push("");
  markdown.push("> This is an isolated experiment. It does not use routing, Xray, speed tests, DNS policies, Fast/Gaming selection, or the production publication gate.");
  markdown.push("");

  for (const [label, report] of Object.entries(reports)) {
    markdown.push(`## ${label.toUpperCase()}`);
    markdown.push("");
    markdown.push(`Candidates: **${report.candidates}**`);
    markdown.push(`Unique endpoints checked: **${report.uniqueEndpoints}**`);
    markdown.push(`Endpoint verdicts: ${Object.entries(report.endpointVerdicts).map(([k, v]) => `**${k}=${v}**`).join(", ") || "none"}`);
    markdown.push(`HAPP-ready links: **${lists[label].length}**`);
    markdown.push(`Copy from [locations-${label}.txt](./locations-${label}.txt).`);
    markdown.push("");
  }

  markdown.push("## How to read UDP / Hysteria results");
  markdown.push("");
  markdown.push("`PASS-UDP-FILTERED` means neither Russian Check-Host node returned an explicit UDP refusal. Check-Host documents silent UDP results as `open or filtered`, so this is intentionally **not** treated as proof that a Hysteria/QUIC handshake works.");
  markdown.push("");
  markdown.push("For TCP (VLESS/Trojan/etc.), `PASS` means the endpoint accepted a TCP connection from the required Russian checker quorum.");
  markdown.push("");

  markdown.push("## Globalping city diagnostic");
  markdown.push("");
  if (globalping?.enabled) {
    if (globalping.dryRun) {
      markdown.push("Dry-run: skipped network calls.");
    } else if (globalping.error) {
      markdown.push(`Globalping diagnostic error: ${globalping.error}`);
    } else {
      markdown.push(`Online Russian probes discovered: **${globalping.probesInRussia ?? 0}**.`);
      markdown.push(`Cities selected: ${globalping.cities?.map((row) => `${row.city} (${row.count})`).join(", ") || "none"}.`);
      markdown.push(`Sampled regular endpoints: **${globalping.sampleSize ?? 0}**.`);
      markdown.push("");
      markdown.push("This section is diagnostic-only and does not affect the link lists.");
    }
  } else {
    markdown.push("Globalping diagnostic disabled.");
  }
  markdown.push("");
  markdown.push("## Current baseline from the supplied production snapshot");
  markdown.push("");
  markdown.push("The supplied candidate manifest contains 744 candidates: 580 regular and 164 LTE/white-list. It contains 695 VLESS, 25 Hysteria2, and 24 Trojan candidates. In the current production health report, all 12 LTE Hysteria2 candidates failed at the preliminary TCP step; this experiment removes that protocol-incompatible gate.");
  markdown.push("");
  markdown.push("The supplied production configuration currently exposes only three Russian Check-Host nodes: two in Moscow (`ru1`, `ru2`) and one in Saint Petersburg (`ru3`). The experiment therefore keeps Check-Host as the transport gate and uses Globalping only to add city-level diagnostics.");
  markdown.push("");

  await fs.writeFile(path.join(OUT_DIR, "results.md"), `${markdown.join("\n")}\n`, "utf8");
  await fs.writeFile(
    path.join(OUT_DIR, "results.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      scope: SCOPE,
      dryRun: DRY_RUN,
      checkHost: {
        base: CHECK_HOST_BASE,
        nodes: CHECK_HOST_NODES,
        quorum: CHECK_HOST_QUORUM,
      },
      inputFile: path.relative(ROOT, INPUT_FILE),
      inputSha256: hash(await fs.readFile(INPUT_FILE)),
      reports,
      globalping,
      linkLists: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])),
    }, null, 2)}\n`,
    "utf8",
  );

  console.log("RUSSIA CHECKER EXPERIMENT COMPLETE");
  for (const [label, links] of Object.entries(lists)) {
    console.log(`${label}: ${links.length} HAPP-ready links`);
  }
}

main().catch((error) => {
  console.error(`RUSSIA CHECKER EXPERIMENT FAILED: ${error?.stack || error?.message || String(error)}`);
  process.exitCode = 1;
});
