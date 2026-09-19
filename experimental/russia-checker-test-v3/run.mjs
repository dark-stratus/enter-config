#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { parseLink, buildOutbound } from "../../scripts/link-runtime.mjs";

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

const GLOBALPING_ENABLED = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_GLOBALPING || "0"));
const GLOBALPING_RECOVERY_ENABLED = !/^(0|false|no)$/i.test(String(process.env.RUSSIA_TEST_GLOBALPING_RECOVERY || "1"));
const GLOBALPING_BASE = String(process.env.RUSSIA_TEST_GLOBALPING_BASE || "https://api.globalping.io/v1").replace(/\/$/, "");
const GLOBALPING_TOKEN = String(process.env.RUSSIA_TEST_GLOBALPING_TOKEN || process.env.GLOBALPING_API_TOKEN || "").trim();
const GLOBALPING_CITY_LIMIT = Math.max(3, Math.min(12, Number(process.env.RUSSIA_TEST_GLOBALPING_CITY_LIMIT) || 9));
const GLOBALPING_RECOVERY_CITY_LIMIT = Math.max(2, Math.min(4, Number(process.env.RUSSIA_TEST_GLOBALPING_RECOVERY_CITY_LIMIT) || 4));
const GLOBALPING_RECOVERY_MAX_ENDPOINTS = Math.max(1, Math.min(50, Number(process.env.RUSSIA_TEST_GLOBALPING_MAX_RECOVERY_ENDPOINTS) || 45));
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
  return [...endpointRows].filter(endpoint => endpoint.transport === "tcp").filter(endpoint => !endpoint.members.some(member => ["PASS-XRAY", "PASS-XRAY-CLOUDFLARE"].includes(xrayById.get(String(member.id))?.verdict))).sort((a,b) => {
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

let globalpingRecoveryQueue = Promise.resolve();

function serializeGlobalpingRecovery(fn) {
  const previous = globalpingRecoveryQueue;
  let release;
  globalpingRecoveryQueue = new Promise(resolve => { release = resolve; });
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
      globalpingRecovery: null,
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
    globalpingRecovery: null,
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
    const verdict = byKey.get(key)?.verdict;
    if (["PASS", "PASS-PARTIAL", "PASS-GLOBALPING", "PASS-HOSTTOOLS", "PASS-HOSTTOOLS-STRONG", "PASS-UDP-STRONG", "PASS-UDP-NOT-REFUSED", "DRY-RUN"].includes(verdict)) links.push(link);
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

function chooseGlobalpingRecoveryCities(cities) {
  const preferred = [
    "Yekaterinburg",
    "Kazan",
    "Novosibirsk",
    "Krasnodar",
    "Samara",
    "Ufa",
    "Rostov-on-Don",
    "Nizhny Novgorod",
    "Perm",
    "Voronezh",
    "Chelyabinsk",
  ];

  const available = new Map(
    (cities || [])
      .filter(row => !/^(moscow|saint petersburg)$/i.test(String(row?.city || "")))
      .map(row => [String(row.city).toLowerCase(), row])
  );
  const selected = [];

  for (const name of preferred) {
    const row = available.get(name.toLowerCase());
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
      if (selected.some(item => item.city.toLowerCase() === row.city.toLowerCase())) continue;
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
  if (!target || !hops.length) return false;

  const finalHop = [...hops].reverse().find(hop => {
    const address = String(hop?.resolvedAddress || "").trim().toLowerCase();
    return address && address === target;
  });
  if (!finalHop) return false;

  const loss = Number(finalHop?.stats?.loss);
  if (Number.isFinite(loss) && loss >= 100) return false;

  const raw = String(probeResult.rawOutput || "");
  if (/destination host unreachable|network unreachable|no route to host/i.test(raw)) return false;

  return true;
}

async function createGlobalpingMtr(endpoint, cities) {
  const { transport, port, host } = parseUrl(endpoint.link);
  if (!host || !cities.length) throw new Error("Globalping recovery has no target or cities");

  const body = {
    type: "mtr",
    target: host,
    timeout: GLOBALPING_MTR_TIMEOUT_SECONDS,
    locations: cities.map(city => ({
      country: "RU",
      city: city.city,
      limit: 1,
    })),
    measurementOptions: {
      protocol: transport === "udp" ? "UDP" : "TCP",
      port,
      packets: 2,
      ipVersion: 4,
    },
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
  if (!id) throw new Error("Globalping recovery response has no measurement id");

  const started = Date.now();
  let data = null;
  while (Date.now() - started <= GLOBALPING_TIMEOUT_MS) {
    await sleep(GLOBALPING_POLL_MS);
    data = await getGlobalpingMeasurement(id);
    const status = String(data?.status || "").toLowerCase();
    if (status && status !== "in-progress") break;
  }

  const resultRows = Array.isArray(data?.results) ? data.results : [];
  const cityRows = resultRows.map(row => ({
    city: row?.probe?.location?.city || "",
    network: row?.probe?.location?.network || "",
    tags: Array.isArray(row?.probe?.tags) ? row.probe.tags : [],
    status: String(row?.result?.status || data?.status || "unknown"),
    reachedTarget: mtrResultReachedTarget(row, host),
    resolvedAddress: row?.result?.resolvedAddress || "",
    finalHopLoss: Number([...((row?.result?.hops) || [])].at(-1)?.stats?.loss),
  }));

  const reachedCities = cityRows.filter(row => row.reachedTarget).length;
  return {
    measurementId: id,
    target: host,
    transport,
    port,
    cities: cityRows,
    reachedCities,
    verdict: reachedCities > 0 ? "PASS-GLOBALPING" : "FAIL-GLOBALPING",
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

async function runGlobalpingRecovery(endpoint, context) {
  if (!GLOBALPING_ENABLED || !GLOBALPING_RECOVERY_ENABLED || DRY_RUN) return null;
  if (!context?.recoveryCities?.length) return null;

  return serializeGlobalpingRecovery(async () => {
    try {
      return await createGlobalpingMtr(endpoint, context.recoveryCities);
    } catch (error) {
      return {
        verdict: "UNKNOWN-GLOBALPING",
        status: Number(error?.status || 0),
        error: error?.message || String(error),
        cities: [],
        reachedCities: 0,
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

function globalpingRecoveryRank(endpoint, xrayById = new Map()) {
  const members = Array.isArray(endpoint.members) ? endpoint.members : [];
  const rows = members.map(member => xrayById.get(String(member.id))).filter(Boolean);
  const hasXrayPass = rows.some(row => ["PASS-XRAY", "PASS-XRAY-CLOUDFLARE"].includes(row?.verdict));
  const transportStrong = ["PASS", "PASS-UDP-STRONG"].includes(endpoint.verdict);
  const transportPartial = endpoint.verdict === "PASS-PARTIAL";
  let score = 0;
  if (!transportStrong) score += 1000;
  if (endpoint.verdict === "FAIL") score += 300;
  if (endpoint.verdict === "UNKNOWN") score += 250;
  if (transportPartial) score += 100;
  if (hasXrayPass) score -= 500;
  if (rows.length && !hasXrayPass) score += 200;
  score += members.length * 10;
  return score;
}

function chooseGlobalpingRecoveryTargets(endpointRows, xrayById) {
  return [...endpointRows]
    .filter(endpoint => {
      const members = Array.isArray(endpoint.members) ? endpoint.members : [];
      const xrayPass = members.some(member => {
        const row = xrayById.get(String(member.id));
        return ["PASS-XRAY", "PASS-XRAY-CLOUDFLARE"].includes(row?.verdict);
      });
      return !xrayPass;
    })
    .sort((a, b) => globalpingRecoveryRank(b, xrayById) - globalpingRecoveryRank(a, xrayById))
    .slice(0, GLOBALPING_RECOVERY_MAX_ENDPOINTS);
}

async function runGlobalpingRecoveryPass(endpointRows, items, xrayById, context) {
  if (!GLOBALPING_ENABLED || !GLOBALPING_RECOVERY_ENABLED || DRY_RUN) {
    return { attempted: 0, recovered: 0, skipped: "disabled", endpoints: [] };
  }
  const cities = Array.isArray(context?.recoveryCities) ? context.recoveryCities : [];
  if (cities.length < 2) return { attempted: 0, recovered: 0, skipped: "not-enough-russian-cities", endpoints: [] };

  const limits = context?.limits || await getGlobalpingLimits();
  const remaining = Number(limits?.remaining);
  const reserve = GLOBALPING_RECOVERY_RESERVE_TESTS;
  const perEndpointTests = cities.length;
  const budgetEndpoints = Number.isFinite(remaining)
    ? Math.max(0, Math.floor(Math.max(0, remaining - reserve) / perEndpointTests))
    : 0;
  const targets = chooseGlobalpingRecoveryTargets(endpointRows, xrayById).slice(0, budgetEndpoints);
  if (!targets.length) {
    return {
      attempted: 0,
      recovered: 0,
      skipped: Number.isFinite(remaining) ? `budget-${remaining}-tests` : "no-targets",
      endpoints: [],
      limits,
    };
  }

  const rows = [];
  let stoppedOnRateLimit = false;
  for (let index = 0; index < targets.length; index += 1) {
    const endpoint = targets[index];
    let result;
    try {
      result = await runGlobalpingRecovery(endpoint, context);
    } catch (error) {
      result = {
        verdict: "UNKNOWN-GLOBALPING",
        error: error?.message || String(error),
        cities: [],
        reachedCities: 0,
      };
    }
    endpoint.globalpingRecovery = result;
    if (result?.verdict === "PASS-GLOBALPING") {
      endpoint.globalpingVerdict = "PASS-GLOBALPING";
    }
    rows.push({ key: endpoint.key, verdict: result?.verdict || "UNKNOWN-GLOBALPING", reachedCities: result?.reachedCities || 0, cities: result?.cities || [], error: result?.error || "" });
    console.log(`RUSSIA TEST V3 GLOBALPING ${index + 1}/${targets.length}: ${endpoint.key} => ${result?.verdict || "UNKNOWN"}`);

    if (result?.status === 429 || /(^|\b)HTTP 429\b|rate.?limit/i.test(String(result?.error || ""))) {
      stoppedOnRateLimit = true;
      break;
    }
  }

  return {
    attempted: rows.length,
    recovered: rows.filter(row => row.verdict === "PASS-GLOBALPING").length,
    skipped: stoppedOnRateLimit ? "stopped-on-rate-limit" : "",
    endpoints: rows,
    limits,
    stoppedOnRateLimit,
  };
}

async function prepareGlobalpingContext() {
  if (!GLOBALPING_ENABLED || DRY_RUN) {
    return {
      enabled: false,
      probesInRussia: 0,
      cities: [],
      recoveryCities: [],
    };
  }

  try {
    const probes = await getGlobalpingProbes();
    const cities = chooseGlobalpingCities(probes);
    const recoveryCities = chooseGlobalpingRecoveryCities(cities);
    const limits = await getGlobalpingLimits();

    return {
      enabled: true,
      probesInRussia: probes.filter(
        probe => String(probe?.location?.country || "").toUpperCase() === "RU"
      ).length,
      cities,
      recoveryCities,
      limits,
    };
  } catch (error) {
    return {
      enabled: true,
      probesInRussia: 0,
      cities: [],
      recoveryCities: [],
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
  const expandedHostTools = expandPassingLinks([{ link: "vless://11111111-1111-1111-1111-111111111111@y:443?security=tls&type=tcp", id: "hosttools-test" }], [{ key: "tcp|y|443", verdict: "PASS-HOSTTOOLS" }]);
  if (expandedHostTools.length !== 1) throw new Error("host.tools verdict expansion self-test failed");
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
  const globalping = await prepareGlobalpingContext();
  const reports = {}, lists = {};

  for (const [label, items] of work) {
    const endpointWorkset = buildEndpointWorkset(items);
    console.log(`${label.toUpperCase()} V3 WORKSET: candidates=${items.length}; uniqueEndpoints=${endpointWorkset.length}; protocols=${JSON.stringify(protocolSummary(items))}`);
    const rawResults = await runPool(endpointWorkset, endpoint => checkEndpoint(endpoint, globalping));
    const endpoints = rawResults.map((result, i) => ({ key: endpointWorkset[i].key, link: endpointWorkset[i].link, protocol: endpointWorkset[i].protocol, transport: endpointWorkset[i].transport, ...result, candidateIds: endpointWorkset[i].members.map(m => m.id), remarks: endpointWorkset[i].members.map(m => m.remarks).filter(Boolean).slice(0,3) }));
    reports[label] = { candidates: items.length, protocols: protocolSummary(items), uniqueEndpoints: endpoints.length, endpointVerdicts: endpoints.reduce((acc,row) => { acc[row.verdict]=(acc[row.verdict]||0)+1; return acc; }, {}), endpoints };
    let xrayById = label === "lte"
      ? await runXrayCandidateChecks(items, endpoints)
      : new Map();

    const hostToolsRecovery = label === "lte"
      ? await runHostToolsRecoveryPass(endpoints, items, xrayById)
      : { attempted: 0, recovered: 0, strongRecovered: 0, skipped: "not-run", endpoints: [] };

    if (hostToolsRecovery.recovered > 0) {
      const recoveredKeys = new Set(
        endpoints
          .filter(endpoint => ["PASS-HOSTTOOLS", "PASS-HOSTTOOLS-STRONG"].includes(endpoint.hostToolsVerdict))
          .map(endpoint => endpoint.key)
      );
      for (const endpoint of endpoints) {
        if (recoveredKeys.has(endpoint.key)) endpoint.verdict = endpoint.hostToolsVerdict;
      }

      const recoveredItems = items.filter(item => {
        try { return recoveredKeys.has(endpointKey(item.link)); }
        catch { return false; }
      });
      const recoveredXrayById = await runXrayCandidateChecks(recoveredItems, endpoints);
      for (const [id, row] of recoveredXrayById.entries()) {
        xrayById.set(id, row);
      }
    }

    lists[label] = expandPassingLinks(items, endpoints);
    await fs.writeFile(path.join(OUT_DIR, `locations-${label}.txt`), lists[label].length ? `${lists[label].join("\n")}\n` : "", "utf8");
    reports[label].xraySummary = [...xrayById.values()].reduce((acc, row) => {
      const key = String(row?.verdict || "UNKNOWN-XRAY");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    reports[label].xrayById = Object.fromEntries(xrayById);
    const xrayVerifiedLinks = [...new Set(items
      .filter(item => ["PASS-XRAY", "PASS-XRAY-CLOUDFLARE"].includes(xrayById.get(String(item.id))?.verdict))
      .map(item => String(item.link || "").trim()).filter(Boolean))];
    const xrayReviewLinks = [...new Set(items
      .filter(item => ["FAIL-XRAY", "UNKNOWN-XRAY"].includes(xrayById.get(String(item.id))?.verdict))
      .map(item => String(item.link || "").trim()).filter(Boolean))];
    if (label === "lte") {
      await fs.writeFile(path.join(OUT_DIR, "locations-lte-xray-verified.txt"), xrayVerifiedLinks.length ? `${xrayVerifiedLinks.join("\n")}\n` : "", "utf8");
      await fs.writeFile(path.join(OUT_DIR, "locations-lte-xray-review.txt"), xrayReviewLinks.length ? `${xrayReviewLinks.join("\n")}\n` : "", "utf8");
      const transportOnlyLinks = [...new Set(lists[label].filter(link => !xrayVerifiedLinks.includes(link)))];
      await fs.writeFile(path.join(OUT_DIR, "locations-lte-transport-only.txt"), transportOnlyLinks.length ? `${transportOnlyLinks.join("\n")}\n` : "", "utf8");
    }
    const strongEndpointKeys = new Set(endpoints.filter(e => ["PASS", "PASS-UDP-STRONG"].includes(e.verdict)).map(e => e.key));
    const partialEndpointKeys = new Set(endpoints.filter(e => e.verdict === "PASS-PARTIAL").map(e => e.key));
    const strongLinks = [...new Set(items.filter(item => { try { return strongEndpointKeys.has(endpointKey(item.link)); } catch { return false; } }).map(item => String(item.link).trim()).filter(Boolean))];
    const partialLinks = [...new Set(items.filter(item => { try { return partialEndpointKeys.has(endpointKey(item.link)); } catch { return false; } }).map(item => String(item.link).trim()).filter(Boolean))];
    await fs.writeFile(path.join(OUT_DIR, `locations-${label}-strong.txt`), strongLinks.length ? `${strongLinks.join("\n")}\n` : "", "utf8");
    await fs.writeFile(path.join(OUT_DIR, `locations-${label}-partial.txt`), partialLinks.length ? `${partialLinks.join("\n")}\n` : "", "utf8");
    if (label === "lte") {
      const cloudflareSpeedLinks = [...new Set(items
        .filter(item => xrayById.get(String(item.id))?.verdict === "PASS-XRAY-CLOUDFLARE")
        .map(item => String(item.link || "").trim())
        .filter(Boolean))];
      await fs.writeFile(
        path.join(OUT_DIR, "locations-lte-xray-cloudflare-speed.txt"),
        cloudflareSpeedLinks.length ? `${cloudflareSpeedLinks.join("\n")}\n` : "",
        "utf8"
      );
      reports[label].hostToolsRecovery = hostToolsRecovery;
      reports[label].globalpingRecovery = { attempted: 0, recovered: 0, skipped: "replaced-by-host-tools" };
    }
    if (label === "lte") {
      const hostToolsRecoveredKeys = new Set(
        endpoints
          .filter(e => ["PASS-HOSTTOOLS", "PASS-HOSTTOOLS-STRONG"].includes(e.verdict))
          .map(e => e.key)
      );
      const hostToolsRecoveredLinks = [
        ...new Set(
          items
            .filter(item => {
              try { return hostToolsRecoveredKeys.has(endpointKey(item.link)); }
              catch { return false; }
            })
            .map(item => String(item.link).trim())
            .filter(Boolean)
        )
      ];
      await fs.writeFile(path.join(OUT_DIR, "locations-lte-hosttools-recovered.txt"), hostToolsRecoveredLinks.length ? `${hostToolsRecoveredLinks.join("\n")}\n` : "", "utf8");
      const hysteria = items.filter(item => ["hysteria","hysteria2","tuic"].includes(protocolOf(item.link)));
      const hysteriaPassing = expandPassingLinks(hysteria, endpoints);
      await fs.writeFile(path.join(OUT_DIR, "lte-hysteria-all.txt"), hysteria.map(x => x.link).join("\n") + (hysteria.length ? "\n" : ""), "utf8");
      await fs.writeFile(path.join(OUT_DIR, "lte-hysteria-passing.txt"), hysteriaPassing.join("\n") + (hysteriaPassing.length ? "\n" : ""), "utf8");
    }
  }

  const hostToolsDiagnostics = { enabled: HOSTTOOLS_ENABLED, maxRequests: HOSTTOOLS_MAX_REQUESTS, reserveRequests: HOSTTOOLS_RESERVE_REQUESTS, strongCities: HOSTTOOLS_RU_STRONG_CITIES, requestsUsed: hostToolsRequestsUsed, results: Object.fromEntries(Object.entries(reports).map(([label, report]) => [label, report.hostToolsRecovery || null])) };
  await fs.writeFile(path.join(OUT_DIR, "hosttools-russia-diagnostic.json"), `${JSON.stringify(hostToolsDiagnostics, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(OUT_DIR, "globalping-city-diagnostic.json"), `${JSON.stringify(globalping, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(OUT_DIR, "check-host-russia-nodes.json"), `${JSON.stringify(checkHostDiscovery, null, 2)}\n`, "utf8");

  const md = [];
  md.push("# Russia checker experiment v3", "", `Generated: ${new Date().toISOString()}`, `Scope: ${SCOPE}`, `Core Check-Host nodes: ${CORE_NODES.join(', ')}`, `TCP strong threshold: ${STRONG_QUORUM}/${CORE_NODES.length}; TCP minimum threshold: ${MIN_PASS_NODES}/${CORE_NODES.length}; non-pass TCP recheck: ${RECHECK_NONPASS ? "enabled" : "disabled"}; exact-link Xray: ${XRAY_ENABLED ? "enabled" : "disabled"}`, "");
  md.push("> Production files are untouched. This experiment uses source-health-candidates.json + Russian transport checks + an exact-link Xray validation stage. No routing, Fast/Gaming logic or production publication is involved.", "");
  for (const [label, report] of Object.entries(reports)) {
    md.push(`## ${label.toUpperCase()}`, "", `Candidates: **${report.candidates}**`, `Protocols: ${Object.entries(report.protocols).map(([k,v]) => `**${k}=${v}**`).join(', ') || 'none'}`, `Unique endpoints: **${report.uniqueEndpoints}**`, `Verdicts: ${Object.entries(report.endpointVerdicts).map(([k,v]) => `**${k}=${v}**`).join(', ') || 'none'}`, `HAPP-ready transport links: **${lists[label].length}**`, `Exact-link Xray: ${Object.entries(report.xraySummary || {}).map(([k,v]) => `**${k}=${v}**`).join(', ') || 'not run'}`, label === "lte" ? `Copy all transport candidates: [locations-${label}.txt](./locations-${label}.txt)\nExact-link Xray verified: [locations-lte-xray-verified.txt](./locations-lte-xray-verified.txt)\nNeeds manual review: [locations-lte-xray-review.txt](./locations-lte-xray-review.txt)\nTransport-only remainder: [locations-lte-transport-only.txt](./locations-lte-transport-only.txt)\nStrong only: [locations-${label}-strong.txt](./locations-${label}-strong.txt)\nPartial only: [locations-${label}-partial.txt](./locations-${label}-partial.txt)` : `Copy all: [locations-${label}.txt](./locations-${label}.txt)`, "");
  }
  md.push("## Why v3 should recover VLESS/Trojan", "", "The previous v2 parser treated Check-Host TCP results of the documented form [{\"time\":0.03,\"address\":\"...\"}] as non-reachable because it expected an object with .time directly. v3 parses the first result object correctly.", "", "The experiment also keeps protocol schemes unchanged: vless:// stays VLESS, trojan:// stays Trojan, hysteria2:// stays Hysteria2, etc.", "");
  md.push("## Recheck strategy", "", "Every non-passing TCP endpoint gets one second Check-Host measurement. A server can therefore recover from a transient timeout or asymmetric first measurement. The report keeps both attempts.", "", "After transport screening, the experiment starts an exact-link Xray test. Links that fail the normal HTTPS targets get the same Cloudflare real-download check used by production health (4 MB, HTTP 2xx/3xx, meaningful download, minimum throughput). This is a fallback verifier, not a replacement for the normal target checks.", "", "For production later, we can choose which verdict tiers to publish after comparing them with your HAPP results.", "");
  md.push("## Hysteria / UDP", "", "Hysteria/Hysteria2/TUIC are detected from the URI scheme and checked with Check-Host UDP, never TCP. The original link is copied to the output unchanged; no Hysteria link is converted to VLESS.", "", "`PASS-UDP-*` means the Russian gate did not receive an explicit UDP refusal. Check-Host itself documents the silent UDP state as `Open or filtered`, so this is a transport screening result, not proof of a successful Hysteria/QUIC handshake.", "", "The exact-link Xray stage uses the real parsed protocol from `scripts/link-runtime.mjs` and therefore keeps Hysteria2 as Hysteria2 instead of coercing it into VLESS.");
  md.push("## Check-Host Russia nodes", "", checkHostDiscovery.nodes?.length ? checkHostDiscovery.nodes.map(n => `- ${n.id}: ${n.city}`).join("\n") : (checkHostDiscovery.error || "No nodes discovered."), "");
  md.push("## Globalping — additional Russian cities",
    "",
    globalping.error ? `Probe discovery/limits error: ${globalping.error}` : `Online Russian probes discovered: **${globalping.probesInRussia ?? 0}**`,
    globalping.cities?.length ? `Inventory cities: ${globalping.cities.map(c => `${c.city} (${c.count}; eyeball=${c.eyeball}; dc=${c.datacenter})`).join(', ')}` : "Inventory cities: none",
    globalping.recoveryCities?.length ? `Recovery cities (excluding Moscow/SPb): **${globalping.recoveryCities.map(c => c.city).join(', ')}**` : "Recovery cities: none",
    globalping.limits?.remaining != null ? `Globalping remaining budget before run: **${globalping.limits.remaining} tests**; reset: ${globalping.limits.resetSeconds ?? "?"} s.` : "Globalping rate-limit status was unavailable, so recovery measurements are not started.",
    "",
    `Recovery is capped at **${GLOBALPING_RECOVERY_MAX_ENDPOINTS} endpoints** and reserves **${GLOBALPING_RECOVERY_RESERVE_TESTS} tests**. With four cities, one endpoint costs four Globalping tests. The run stops immediately on HTTP 429.`,
    "This is the extra Russian checker intended to be reusable later for ordinary locations. It is used as a second geographic transport signal, not as proof of a working proxy protocol.",
    ""
  );
  md.push("## Files for your manual test", "", "- `locations-lte.txt` — broad LTE test list: normal Check-Host passes plus Globalping-recovered endpoints.", "- `locations-lte-strong.txt` — stronger Check-Host subset.", "- `locations-lte-partial.txt` — exactly-1/3 Check-Host TCP subset.", "- `locations-lte-globalping-recovered.txt` — endpoints recovered specifically by the additional Russian-city checker.", "- `locations-lte-xray-verified.txt` — exact-link Xray verified links, including the Cloudflare speed fallback.", "- `locations-lte-xray-cloudflare-speed.txt` — links recovered specifically by the production-style Cloudflare real-download fallback.", "- `locations-lte-xray-review.txt` — links that still failed exact-link Xray.", "- `lte-hysteria-all.txt` — all original Hysteria/Hysteria2/TUIC LTE candidates.", "- `lte-hysteria-passing.txt` — UDP transport-screened Hysteria/Hysteria2/TUIC links.", "- `globalping-city-diagnostic.json` — current Russian probe inventory, rate-limit state and selected recovery cities.", "- `check-host-russia-nodes.json` — current Check-Host Russian nodes.", "");
  await fs.writeFile(path.join(OUT_DIR, "results.md"), `${md.join("\n")}\n`, "utf8");
  await fs.writeFile(path.join(OUT_DIR, "results.json"), `${JSON.stringify({ generatedAt:new Date().toISOString(), scope:SCOPE, coreNodes:CORE_NODES, strongQuorum:STRONG_QUORUM, minPassNodes:MIN_PASS_NODES, recheckNonPass:RECHECK_NONPASS, globalpingRecoveryEnabled:GLOBALPING_RECOVERY_ENABLED,
      globalpingRecoveryMaxEndpoints:GLOBALPING_RECOVERY_MAX_ENDPOINTS,
      globalpingRecoveryCityLimit:GLOBALPING_RECOVERY_CITY_LIMIT,
      hostToolsEnabled: HOSTTOOLS_ENABLED,
      hostToolsMaxRequests: HOSTTOOLS_MAX_REQUESTS,
      hostToolsReserveRequests: HOSTTOOLS_RESERVE_REQUESTS,
      xraySpeedFallbackEnabled:XRAY_SPEED_FALLBACK_ENABLED,
      xraySpeedFallbackUrl:XRAY_SPEED_FALLBACK_URL,
      xraySpeedFallbackMinKbps:XRAY_SPEED_FALLBACK_MIN_KBPS,
      xrayEnabled:XRAY_ENABLED, xrayTargets:XRAY_TARGETS, reports, globalping, checkHostDiscovery, inputSha256:hash(await fs.readFile(INPUT_FILE)) }, null, 2)}\n`, "utf8");
  console.log("RUSSIA CHECKER V3 COMPLETE");
}

main().catch(error => { console.error(`RUSSIA CHECKER V3 FAILED: ${error?.stack || error?.message || String(error)}`); process.exitCode = 1; });
