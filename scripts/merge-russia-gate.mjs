#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const candidatesFile = process.env.HEALTH_CANDIDATES_FILE || path.join(ROOT, "config", "source-health-candidates.json");
const updateStatusFile = path.join(ROOT, "config", "source-update-status.json");
const stateFile = path.join(ROOT, "config", ".source-state.json");
const outputFile = process.env.RUSSIA_GATE_FILE || path.join(ROOT, "config", "source-russia-gate.json");
const shardDir = process.env.RUSSIA_GATE_SHARD_DIR || path.join(ROOT, ".russia-gate-shards");
const shardCount = Math.max(1, Number(process.env.HEALTHCHECK_RUSSIA_GATE_SHARD_COUNT) || 1);
const algorithmVersion = Math.max(1, Number(process.env.HEALTHCHECK_RUSSIA_GATE_ALGORITHM_VERSION) || 14);

const [candidateText, candidates, updateStatus] = await Promise.all([
  fs.readFile(candidatesFile, "utf8"),
  fs.readFile(candidatesFile, "utf8").then(JSON.parse),
  fs.readFile(updateStatusFile, "utf8").then(JSON.parse),
]);

if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("Candidate manifest is empty or invalid");
if (updateStatus?.refreshed !== true) throw new Error("Source refresh was not performed; refusing to merge a stale Russia gate");
const manifestSha256 = crypto.createHash("sha256").update(candidateText).digest("hex");
if (updateStatus.manifestSha256 !== manifestSha256) {
  throw new Error(`Source manifest mismatch: status=${updateStatus.manifestSha256 || "missing"}, actual=${manifestSha256}`);
}
const fp = link => crypto.createHash("sha256").update(String(link || "")).digest("hex").slice(0, 12);
const managed = candidates.filter(item => /^source-(regular|whitelist)-\d+$/i.test(String(item?.id || "")));
const required = managed.filter(item => /^source-regular-\d+$/i.test(String(item?.id || "")));

const merged = new Map();
for (let i = 0; i < shardCount; i += 1) {
  const file = path.join(shardDir, `shard-${i}.json`);
  let shard;
  try { shard = JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { throw new Error(`Missing/invalid Russia gate shard ${i + 1}/${shardCount}: ${error.message}`); }
  if (Number(shard.shardIndex) !== i || Number(shard.shardCount) !== shardCount) throw new Error(`Shard metadata mismatch in ${file}`);
  if (String(shard.manifestSha256) !== manifestSha256) throw new Error(`Manifest mismatch in ${file}`);
  if (Number(shard.gateAlgorithmVersion) !== algorithmVersion) throw new Error(`Gate algorithm mismatch in ${file}`);
  if (!Array.isArray(shard.results)) throw new Error(`Shard ${i + 1} has no results`);
  for (const row of shard.results) {
    const key = fp(row?.link);
    if (merged.has(key)) throw new Error(`Duplicate Russia gate result for ${row?.id || row?.link}`);
    merged.set(key, row);
  }
}

if (merged.size !== managed.length) {
  throw new Error(`Russia gate coverage mismatch: ${merged.size}/${managed.length} managed candidates were merged`);
}
for (const item of managed) {
  const row = merged.get(fp(item.link));
  if (!row || String(row.id) !== String(item.id)) throw new Error(`Russia gate result missing/mismatched for ${item.id}`);
}

const results = managed.map(item => {
  const row = merged.get(fp(item.link));
  return {
    id: item.id,
    link: String(item.link || "").trim(),
    source: item.source || "",
    country: item.country || "",
    required: Boolean(row.probe?.required),
    gatePassed: Boolean(row.probe?.gatePassed),
    gatePending: Boolean(row.probe?.gatePending),
    checkedAt: Number(row.probe?.checkedAt) || Date.now(),
    probe: row.probe,
  };
});
const allowed = results.filter(r => r.required && r.gatePassed);
const pending = results.filter(r => r.required && r.gatePending);
const failed = results.filter(r => r.required && !r.gatePassed && !r.gatePending);

let state = {};
try { state = JSON.parse(await fs.readFile(stateFile, "utf8")); } catch {}
const russiaGateState = (state.russiaGate && typeof state.russiaGate === "object") ? state.russiaGate : {};
for (const row of results) {
  if (row.probe?.checkedAt) {
    russiaGateState[fp(row.link)] = { ...row.probe, gateAlgorithmVersion: algorithmVersion };
  }
}
await fs.writeFile(stateFile, `${JSON.stringify({ ...state, russiaGate: russiaGateState }, null, 2)}\n`, "utf8");

const nodes = [...new Set(results.flatMap(r => Array.isArray(r.probe?.checkHost?.results) ? r.probe.checkHost.results.map(x => x.node) : []).filter(Boolean))];
const report = {
  generatedAt: new Date().toISOString(),
  generationId: updateStatus.generationId || null,
  manifestSha256,
  candidates: managed.length,
  requiredCandidates: required.length,
  allowedCandidates: allowed.length,
  failedCandidates: failed.length,
  pendingCandidates: pending.length,
  cachedResults: 0,
  checkHostNodes: nodes,
  configuredCheckHostNodes: String(process.env.HEALTHCHECK_RUSSIA_CHECK_HOST_NODES || "").split(/[,:;]+/).filter(Boolean),
  globalpingSelectionCount: 0,
  gateAlgorithmVersion: algorithmVersion,
  sharded: true,
  shardCount,
  results,
};
await fs.writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`RUSSIA GATE MERGED: ${allowed.length} pass, ${pending.length} pending, ${failed.length} fail; ${managed.length}/${managed.length} managed candidates covered`);
if (pending.length > 0) throw new Error(`Russia gate has ${pending.length} unresolved candidate(s)`);
