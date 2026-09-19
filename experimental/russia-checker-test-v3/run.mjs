#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const INPUT_FILE = path.resolve(ROOT, process.env.RUSSIA_TEST_INPUT || "config/source-health-candidates.json");
const OUT_DIR = path.resolve(ROOT, process.env.RUSSIA_TEST_OUTPUT_DIR || "experimental/russia-checker-test-v3/results");

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
const GLOBALPING_BASE = String(process.env.RUSSIA_TEST_GLOBALPING_BASE || "https://api.globalping.io/v1").replace(/\/$/, "");
const GLOBALPING_TOKEN = String(process.env.RUSSIA_TEST_GLOBALPING_TOKEN || process.env.GLOBALPING_API_TOKEN || "").trim();
const GLOBALPING_CITY_LIMIT = Math.max(3, Math.min(12, Number(process.env.RUSSIA_TEST_GLOBALPING_CITY_LIMIT) || 9));
const GLOBALPING_POLL_MS = Math.max(500, Number(process.env.RUSSIA_TEST_GLOBALPING_POLL_MS) || 700);
const GLOBALPING_TIMEOUT_MS = Math.max(10000, Number(process.env.RUSSIA_TEST_GLOBALPING_TIMEOUT_MS) || 30000);

const PRIORITY_RUSSIA_CITIES = [
  "Moscow", "Saint Petersburg", "Yekaterinburg", "Kazan", "Novosibirsk",
  "Nizhny Novgorod", "Samara", "Krasnodar", "Rostov-on-Don", "Ufa", "Perm", "Voronezh",
];

const SCOPE = String(process.env.RUSSIA_TEST_SCOPE || "all").trim().toLowerCase();
const DRY_RUN = /^(1|true|yes)$/i.test(String(process.env.RUSSIA_TEST_DRY_RUN || "0"));
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

async function checkEndpoint(endpoint) {
  if (DRY_RUN) return { verdict: "DRY-RUN", confidence: "not-tested", requestId: "", attempts: [], nodes: CORE_NODES.map(node => ({ node, state: "dry-run", latencyMs: 0 })) };
  const first = await checkEndpointOnce(endpoint);
  const shouldRecheck = RECHECK_NONPASS && isTcpNonPass(first, endpoint);
  if (!shouldRecheck) return { ...first, attempts: [first] };
  const second = await checkEndpointOnce(endpoint);
  const firstReachable = reachableCount(first);
  const secondReachable = reachableCount(second);
  const best = Math.max(firstReachable, secondReachable);
  let verdict = "FAIL";
  let confidence = `tcp-recheck-${firstReachable}/${secondReachable}`;
  if (best >= STRONG_QUORUM) { verdict = "PASS"; confidence = `tcp-recheck-strong-best-${best}/${CORE_NODES.length}`; }
  else if (best >= MIN_PASS_NODES) { verdict = "PASS-PARTIAL"; confidence = `tcp-recheck-partial-best-${best}/${CORE_NODES.length}`; }
  return { ...second, verdict, confidence, attempts: [first, second], rechecked: true, bestReachable: best };
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
      if ((index + 1) % 10 === 0 || index + 1 === items.length) console.log(`RUSSIA TEST V2 PROGRESS ${index + 1}/${items.length}`);
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
    const verdict = byKey.get(key)?.verdict;
    if (["PASS", "PASS-PARTIAL", "PASS-UDP-STRONG", "PASS-UDP-NOT-REFUSED", "DRY-RUN"].includes(verdict)) links.push(link);
  }
  return [...new Set(links)];
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
  const data = await withRetry(() => fetchJson(`${GLOBALPING_BASE}/probes`, GLOBALPING_TOKEN ? { headers: { authorization: `Bearer ${GLOBALPING_TOKEN}` } } : {}, GLOBALPING_TIMEOUT_MS));
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
    const row = byCity.get(key) || { city, count: 0, eyeball: 0, datacenter: 0 };
    row.count += 1;
    const tags = new Set(Array.isArray(probe?.tags) ? probe.tags.map(String) : []);
    if (tags.has("eyeball-network")) row.eyeball += 1;
    if (tags.has("datacenter-network")) row.datacenter += 1;
    byCity.set(key, row);
  }
  const picked = [], used = new Set();
  for (const city of PRIORITY_RUSSIA_CITIES) {
    const row = byCity.get(city.toLowerCase());
    if (row) { picked.push(row); used.add(city.toLowerCase()); }
    if (picked.length >= GLOBALPING_CITY_LIMIT) return picked;
  }
  for (const row of [...byCity.values()].sort((a, b) => b.eyeball - a.eyeball || b.count - a.count || a.city.localeCompare(b.city))) {
    if (used.has(row.city.toLowerCase())) continue;
    picked.push(row); used.add(row.city.toLowerCase());
    if (picked.length >= GLOBALPING_CITY_LIMIT) break;
  }
  return picked;
}

async function runGlobalpingCityDiagnostics() {
  if (!GLOBALPING_ENABLED) return { enabled: false, reason: "disabled" };
  if (DRY_RUN) return { enabled: true, dryRun: true, cities: [], results: [] };
  let probes;
  try { probes = await getGlobalpingProbes(); }
  catch (error) { return { enabled: true, error: `probe discovery failed: ${error?.message || String(error)}`, cities: [], results: [] }; }

  const cities = chooseGlobalpingCities(probes);
  const results = [];
  for (const city of cities) {
    try {
      const body = {
        type: "ping",
        target: "check-host.net",
        locations: [{ country: "RU", city: city.city, limit: 1 }],
        timeout: 10,
        measurementOptions: { packets: 2, protocol: "TCP", port: 443 },
      };
      const created = await withRetry(() => fetchJson(`${GLOBALPING_BASE}/measurements`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(GLOBALPING_TOKEN ? { authorization: `Bearer ${GLOBALPING_TOKEN}` } : {}) },
        body: JSON.stringify(body),
      }, GLOBALPING_TIMEOUT_MS), 4);
      const id = String(created?.id || "").trim();
      if (!id) throw new Error("Globalping response has no measurement id");
      const started = Date.now();
      let data = null;
      while (Date.now() - started <= GLOBALPING_TIMEOUT_MS) {
        await sleep(GLOBALPING_POLL_MS);
        data = await getGlobalpingMeasurement(id);
        if (String(data?.status || "").toLowerCase() !== "in-progress") break;
      }
      const rows = Array.isArray(data?.results) ? data.results : [];
      const finished = rows.filter(row => String(row?.result?.status || "").toLowerCase() === "finished");
      results.push({ city: city.city, probeCount: rows.length, status: finished.length ? "reachable" : String(data?.status || "unknown"), probes: finished.map(row => ({ city: row?.probe?.location?.city || city.city, network: row?.probe?.location?.network || row?.probe?.network || "", avgMs: Number(row?.result?.stats?.avg), loss: Number(row?.result?.stats?.loss), tags: row?.probe?.tags || [] })), measurementId: id });
    } catch (error) {
      results.push({ city: city.city, status: "error", error: error?.message || String(error) });
    }
  }
  return { enabled: true, probesInRussia: probes.filter(p => String(p?.location?.country || "").toUpperCase() === "RU").length, cities, results, purpose: "diagnostic-only; never affects candidate verdicts or output link lists" };
}

async function getGlobalpingMeasurement(id) {
  return fetchJson(`${GLOBALPING_BASE}/measurements/${encodeURIComponent(id)}`, GLOBALPING_TOKEN ? { headers: { authorization: `Bearer ${GLOBALPING_TOKEN}` } } : {}, GLOBALPING_TIMEOUT_MS);
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
    ["vless://u@example.com:443", "vless", "tcp"],
    ["trojan://p@example.com:443", "trojan", "tcp"],
    ["hysteria2://p@example.com:443", "hysteria2", "udp"],
    ["hysteria://p@example.com:443", "hysteria", "udp"],
    ["tuic://p@example.com:443", "tuic", "udp"],
  ];
  for (const [link, expectedProtocol, expectedTransport] of samples) {
    const actual = parseUrl(link);
    if (actual.protocol !== expectedProtocol || actual.transport !== expectedTransport) throw new Error(`protocol self-test failed for ${link}`);
  }
  const tcpOk = parseNodeResult([{ time: 0.041, address: "203.0.113.10" }], "ru2", "tcp");
  if (tcpOk.state !== "reachable" || tcpOk.latencyMs <= 0) throw new Error("TCP array parser self-test failed");
  const filtered = parseNodeResult([{ error: "Open or filtered" }], "ru2", "udp");
  const refused = parseNodeResult([{ error: "Connection refused" }], "ru2", "udp");
  if (filtered.state !== "udp-filtered" || refused.state !== "refused") throw new Error("UDP parser self-test failed");
  if (decide([{state:"udp-filtered"},{state:"udp-filtered"}], "udp").verdict !== "PASS-UDP-STRONG") throw new Error("UDP decision self-test failed");
  console.log("RUSSIA TEST V3 SELF-TEST: PASS");
}

async function main() {
  if (SELF_TEST) { runSelfTest(); return; }
  await fs.mkdir(OUT_DIR, { recursive: true });
  const input = JSON.parse(await fs.readFile(INPUT_FILE, "utf8"));
  if (!Array.isArray(input) || !input.length) throw new Error(`${INPUT_FILE} must contain a non-empty candidate array`);
  if (!['all','lte','regular'].includes(SCOPE)) throw new Error(`RUSSIA_TEST_SCOPE must be all, lte or regular`);

  const lte = input.filter(isLte);
  const regular = input.filter(item => !isLte(item));
  const work = [['lte', lte]];
  if (SCOPE !== 'lte') console.warn(`RUSSIA TEST V3: regular candidates are intentionally skipped; requested scope=${SCOPE} ignored in favor of LTE-only experiment`);

  const checkHostDiscovery = await discoverCheckHostRussiaNodes();
  const reports = {}, lists = {};

  for (const [label, items] of work) {
    const endpointWorkset = buildEndpointWorkset(items);
    console.log(`${label.toUpperCase()} V2 WORKSET: candidates=${items.length}; uniqueEndpoints=${endpointWorkset.length}; protocols=${JSON.stringify(protocolSummary(items))}`);
    const rawResults = await runPool(endpointWorkset, checkEndpoint);
    const endpoints = rawResults.map((result, i) => ({ key: endpointWorkset[i].key, link: endpointWorkset[i].link, protocol: endpointWorkset[i].protocol, transport: endpointWorkset[i].transport, ...result, candidateIds: endpointWorkset[i].members.map(m => m.id), remarks: endpointWorkset[i].members.map(m => m.remarks).filter(Boolean).slice(0,3) }));
    reports[label] = { candidates: items.length, protocols: protocolSummary(items), uniqueEndpoints: endpoints.length, endpointVerdicts: endpoints.reduce((acc,row) => { acc[row.verdict]=(acc[row.verdict]||0)+1; return acc; }, {}), endpoints };
    lists[label] = expandPassingLinks(items, endpoints);
    await fs.writeFile(path.join(OUT_DIR, `locations-${label}.txt`), lists[label].length ? `${lists[label].join("\n")}\n` : "", "utf8");
    const strongEndpointKeys = new Set(endpoints.filter(e => ["PASS", "PASS-UDP-STRONG"].includes(e.verdict)).map(e => e.key));
    const partialEndpointKeys = new Set(endpoints.filter(e => e.verdict === "PASS-PARTIAL").map(e => e.key));
    const strongLinks = [...new Set(items.filter(item => { try { return strongEndpointKeys.has(endpointKey(item.link)); } catch { return false; } }).map(item => String(item.link).trim()).filter(Boolean))];
    const partialLinks = [...new Set(items.filter(item => { try { return partialEndpointKeys.has(endpointKey(item.link)); } catch { return false; } }).map(item => String(item.link).trim()).filter(Boolean))];
    await fs.writeFile(path.join(OUT_DIR, `locations-${label}-strong.txt`), strongLinks.length ? `${strongLinks.join("\n")}\n` : "", "utf8");
    await fs.writeFile(path.join(OUT_DIR, `locations-${label}-partial.txt`), partialLinks.length ? `${partialLinks.join("\n")}\n` : "", "utf8");
    if (label === "lte") {
      const hysteria = items.filter(item => ["hysteria","hysteria2","tuic"].includes(protocolOf(item.link)));
      const hysteriaPassing = expandPassingLinks(hysteria, endpoints);
      await fs.writeFile(path.join(OUT_DIR, "lte-hysteria-all.txt"), hysteria.map(x => x.link).join("\n") + (hysteria.length ? "\n" : ""), "utf8");
      await fs.writeFile(path.join(OUT_DIR, "lte-hysteria-passing.txt"), hysteriaPassing.join("\n") + (hysteriaPassing.length ? "\n" : ""), "utf8");
    }
  }

  const globalping = await runGlobalpingCityDiagnostics();
  await fs.writeFile(path.join(OUT_DIR, "globalping-city-diagnostic.json"), `${JSON.stringify(globalping, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(OUT_DIR, "check-host-russia-nodes.json"), `${JSON.stringify(checkHostDiscovery, null, 2)}\n`, "utf8");

  const md = [];
  md.push("# Russia checker experiment v3", "", `Generated: ${new Date().toISOString()}`, `Scope: ${SCOPE}`, `Core Check-Host nodes: ${CORE_NODES.join(', ')}`, `TCP strong threshold: ${STRONG_QUORUM}/${CORE_NODES.length}; TCP minimum threshold: ${MIN_PASS_NODES}/${CORE_NODES.length}; non-pass TCP recheck: ${RECHECK_NONPASS ? "enabled" : "disabled"}`, "");
  md.push("> Production files are untouched. This experiment uses only source-health-candidates.json + transport checks. No routing, Xray, speed tests, Fast/Gaming logic or production publication are involved.", "");
  for (const [label, report] of Object.entries(reports)) {
    md.push(`## ${label.toUpperCase()}`, "", `Candidates: **${report.candidates}**`, `Protocols: ${Object.entries(report.protocols).map(([k,v]) => `**${k}=${v}**`).join(', ') || 'none'}`, `Unique endpoints: **${report.uniqueEndpoints}**`, `Verdicts: ${Object.entries(report.endpointVerdicts).map(([k,v]) => `**${k}=${v}**`).join(', ') || 'none'}`, `HAPP-ready links: **${lists[label].length}**`, `Copy all: [locations-${label}.txt](./locations-${label}.txt)\nStrong only: [locations-${label}-strong.txt](./locations-${label}-strong.txt)\nPartial only: [locations-${label}-partial.txt](./locations-${label}-partial.txt)`, "");
  }
  md.push("## Why v3 should recover VLESS/Trojan", "", "The previous v2 parser treated Check-Host TCP results of the documented form [{\"time\":0.03,\"address\":\"...\"}] as non-reachable because it expected an object with .time directly. v3 parses the first result object correctly.", "", "The experiment also keeps protocol schemes unchanged: vless:// stays VLESS, trojan:// stays Trojan, hysteria2:// stays Hysteria2, etc.", "");
  md.push("## Recheck strategy", "", "Every non-passing TCP endpoint gets one second Check-Host measurement. A server can therefore recover from a transient timeout or asymmetric first measurement. The report keeps both attempts.", "", "For production later, we can choose whether to publish all TCP 1/3+ results or only the stronger subset after your HAPP test.", "");
  md.push("## Hysteria / UDP", "", "Hysteria/Hysteria2/TUIC are detected from the URI scheme and checked with Check-Host UDP, never TCP. The original link is copied to the output unchanged; no Hysteria link is converted to VLESS.", "", "`PASS-UDP-*` means the Russian gate did not receive an explicit UDP refusal. Check-Host itself documents the silent UDP state as `Open or filtered`, so this is a transport screening result, not proof of a successful Hysteria/QUIC handshake. Those links are deliberately left in the HAPP test list for manual verification.", "");
  md.push("## Check-Host Russia nodes", "", checkHostDiscovery.nodes?.length ? checkHostDiscovery.nodes.map(n => `- ${n.id}: ${n.city}`).join("\n") : (checkHostDiscovery.error || "No nodes discovered."), "");
  md.push("## Globalping city diagnostic", "", globalping.error ? `Error: ${globalping.error}` : `Online Russian probes discovered: **${globalping.probesInRussia ?? 0}**`, globalping.cities?.length ? `Selected cities: ${globalping.cities.map(c => `${c.city} (${c.count} probes)`).join(', ')}` : "Selected cities: none", "", "This diagnostic is independent of the candidate verdicts. It exists to answer which Russian cities Globalping can currently source probes from; the city checks use TCP/443 to check-host.net only to verify that the selected probe can execute a measurement.", "");
  md.push("## Files for your manual test", "", "- `locations-lte.txt` — broad LTE test list: TCP endpoints with at least 1/3 Russian TCP confirmations, plus UDP endpoints that are not explicitly refused.", "- `locations-lte-strong.txt` — stronger subset: TCP 2/3+; UDP 2/3+ non-refused.", "- `locations-lte-partial.txt` — TCP endpoints confirmed by exactly 1/3 nodes (useful for testing asymmetric routes).", "- `lte-hysteria-all.txt` — every Hysteria/Hysteria2/TUIC LTE candidate before filtering.", "- `lte-hysteria-passing.txt` — Hysteria/Hysteria2/TUIC links that passed the UDP transport screen.", "- `globalping-city-diagnostic.json` — live Globalping Russian-city inventory + city probes.", "- `check-host-russia-nodes.json` — live Check-Host Russian node inventory.", "");
  await fs.writeFile(path.join(OUT_DIR, "results.md"), `${md.join("\n")}\n`, "utf8");
  await fs.writeFile(path.join(OUT_DIR, "results.json"), `${JSON.stringify({ generatedAt:new Date().toISOString(), scope:SCOPE, coreNodes:CORE_NODES, strongQuorum:STRONG_QUORUM, minPassNodes:MIN_PASS_NODES, recheckNonPass:RECHECK_NONPASS, reports, globalping, checkHostDiscovery, inputSha256:hash(await fs.readFile(INPUT_FILE)) }, null, 2)}\n`, "utf8");
  console.log("RUSSIA CHECKER V3 COMPLETE");
}

main().catch(error => { console.error(`RUSSIA CHECKER V3 FAILED: ${error?.stack || error?.message || String(error)}`); process.exitCode = 1; });
