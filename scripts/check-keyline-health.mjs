#!/usr/bin/env node

import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { parseLink, buildOutbound } from "./link-runtime.mjs";

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

const HEALTH_CONCURRENCY =
    Math.max(
        1,
        Math.min(
            12,
            Number(process.env.HEALTHCHECK_CONCURRENCY) || 8
        )
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

function sleep(ms) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}

function safeDecode(value) {
    try {
        return decodeURIComponent(
            String(value ?? "")
        );
    } catch {
        return String(value ?? "");
    }
}

function fingerprintLink(link) {
    return crypto.createHash("sha256").update(String(link)).digest("hex").slice(0, 12);
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
            "keyline-xray-"
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
        const args = [
            "--silent",
            "--show-error",
            "--fail",
            "--connect-timeout",
            "4",
            "--max-time",
            String(
                Math.ceil(
                    REQUEST_TIMEOUT_MS /
                    1000
                )
            ),
            "--proxy",
            `socks5h://127.0.0.1:${socksPort}`,
            targetUrl,
            "--output",
            "/dev/null",
        ];

        const child =
            spawn(
                "curl",
                args,
                {
                    stdio:
                        [
                            "ignore",
                            "ignore",
                            "pipe"
                        ]
                }
            );

        let stderr = "";

        child.stderr.on(
            "data",
            chunk => {
                stderr +=
                    String(chunk);
            }
        );

        const timeout =
            setTimeout(
                () => {
                    child.kill(
                        "SIGKILL"
                    );
                },
                REQUEST_TIMEOUT_MS
            );

        child.once(
            "exit",
            code => {
                clearTimeout(
                    timeout
                );

                resolve({
                    ok:
                        code === 0,

                    error:
                        stderr
                            .trim()
                            .slice(
                                0,
                                240
                            )
                });
            }
        );
    });
}

async function probeTargetOnceWithRetries(
    socksPort,
    targetUrl
) {
    const errors = [];

    for (
        let attempt = 1;
        attempt <= REQUEST_RETRIES;
        attempt += 1
    ) {
        const result =
            await runCurlOnce(
                socksPort,
                targetUrl
            );

        if (result.ok) {
            return {
                ok: true,
                targetUrl,
                error: ""
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
        ok: false,
        targetUrl,
        error: errors.join("; ").slice(0, 1000)
    };
}

async function runCurl(
    socksPort
) {
    const probes =
        HEALTH_TARGET_URLS.map(
            targetUrl =>
                probeTargetOnceWithRetries(
                    socksPort,
                    targetUrl
                )
        );

    return await Promise.all(
        probes
    );
}

function isManagedKeylineId(
    id
) {
    return (
        /^keyline-regular-\d+$/i.test(id) ||
        /^keyline-whitelist-\d+$/i.test(id)
    );
}

function isAutomaticWhiteListId(
    id
) {
    return /^keyline-whitelist-\d+$/i.test(id);
}

function extractFlag(
    remarks = ""
) {
    const match =
        String(remarks).match(
            /[\u{1F1E6}-\u{1F1FF}]{2}/u
        );

    return match?.[0] || "";
}

function stripFlag(
    remarks = ""
) {
    return String(remarks)
        .replace(
            /[\u{1F1E6}-\u{1F1FF}]{2}/gu,
            ""
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim();
}

function renumberIndex(
    index
) {
    const countryCounters =
        new Map();

    const whiteListItems =
        index.filter(
            item =>
                isAutomaticWhiteListId(
                    item.id
                )
        );

    let whiteListNumber = 2;

    const normalized =
        index.map(
            item => {
                if (
                    !isManagedKeylineId(
                        item?.id
                    )
                ) {
                    return item;
                }

                if (
                    isAutomaticWhiteListId(
                        item.id
                    )
                ) {
                    const flag =
                        extractFlag(
                            item.remarks
                        ) ||
                        "🇷🇺";

                    const next = {
                        ...item,
                        remarks:
                            `${flag} 🏳️ White List ${whiteListNumber}`
                                .trim()
                    };

                    whiteListNumber +=
                        1;

                    return next;
                }

                const flag =
                    extractFlag(
                        item.remarks
                    );

                const raw =
                    stripFlag(
                        item.remarks
                    )
                    .replace(
                        /\b(?:White List|Whitelist|Balance)\b.*$/i,
                        ""
                    )
                    .replace(
                        /\s+\d+\s*$/u,
                        ""
                    )
                    .trim();

                if (!raw) {
                    return item;
                }

                const count =
                    (
                        countryCounters.get(
                            raw
                        ) ||
                        0
                    ) + 1;

                countryCounters.set(
                    raw,
                    count
                );

                return {
                    ...item,

                    remarks:
                        `${flag} ${raw} ${count}`.trim()
                };
            }
        );

    // Canonical ordering is important for Happ:
    // Europe/manual locations first, then all Keyline regulars,
    // then permanent White List 1, then automatically discovered White Lists.
    const europe =
        normalized.filter(
            item =>
                /^europe-\d+$/i.test(
                    item?.id
                )
        );

    const manual =
        normalized.filter(
            item =>
                item &&
                !isManagedKeylineId(
                    item.id
                ) &&
                !/^europe-\d+$/i.test(
                    item?.id
                ) &&
                !/^whitelist-\d+$/i.test(
                    item?.id
                )
        );

    const permanentWhite =
        normalized.filter(
            item =>
                /^whitelist-\d+$/i.test(
                    item?.id
                )
        );

    const managedRegular =
        normalized.filter(
            item =>
                /^keyline-regular-\d+$/i.test(
                    item?.id
                )
        );

    const managedWhite =
        normalized.filter(
            item =>
                /^keyline-whitelist-\d+$/i.test(
                    item?.id
                )
        );

    return [
        ...europe,
        ...manual,
        ...managedRegular,
        ...permanentWhite,
        ...managedWhite,
    ];
}

async function main() {
    await fs.access(
        XRAY_BIN
    );

    const indexText =
        await fs.readFile(
            INDEX_FILE,
            "utf8"
        );

    const index =
        JSON.parse(
            indexText
        );

    if (
        !Array.isArray(index)
    ) {
        throw new Error(
            "index.json must be an array"
        );
    }

    let diagnosticReport = {};
    try {
        diagnosticReport = JSON.parse(
            await fs.readFile(path.join(ROOT, "keyline-report.json"), "utf8")
        );
    } catch {}

    const candidateMap = diagnosticReport.candidateMap || {};

    const nextIndex =
        [];

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
            isManagedKeylineId(
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

    let cursor =
        0;

    const checkedLinkMeta = new Map();

    async function checkItem(
        item
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

        const stage1 =
            await tcpProbe(
                url.hostname,
                url.port
            );

        if (!stage1) {
            return {
                item,
                ok:
                    false,

                reason:
                    "TCP unreachable"
            };
        }

        let xray = null;

        try {
            xray = await startXray(link);

            if (!xray.ok) {
                return {
                    item,
                    ok: false,
                    reason: `1/3 real stages passed; xray-startup: ${xray.error}`,
                };
            }

            const targets = [...new Set(
                HEALTH_TARGET_URLS
                    .map(value => String(value || "").trim())
                    .filter(Boolean)
            )];

            if (targets.length < 2) {
                throw new Error("Need at least two distinct health-check target URLs");
            }

            const remote = await Promise.all(
                targets.map(target =>
                    probeTargetOnceWithRetries(
                        xray.socksPort,
                        target
                    )
                )
            );

            const failedTargets = remote.filter(
                result => !result?.ok
            );

            if (failedTargets.length > 0) {
                const details = failedTargets
                    .map(result =>
                        `${result.targetUrl}: ${result.error || "proxy request failed"}`
                    )
                    .join(" | ");

                return {
                    item,
                    ok: false,
                    reason:
                        `TCP reachable, Xray SOCKS started, ` +
                        `${targets.length - failedTargets.length}/${targets.length} ` +
                        `HTTPS proxy probes passed; ${details}`,
                };
            }

            return {
                item,
                ok: true,
                protocol,
                stages: `TCP + Xray + ${targets.length}/${targets.length} HTTPS`,
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
                    item
                );

            const meta = checkedLinkMeta.get(item.id) || {};
            healthResults.push({
                id: item.id,
                remarks: item.remarks || "",
                country: meta.sourceMeta?.country || String(item.remarks || "").replace(/^\S+\s*/, "").replace(/\s+\d+$/, ""),
                source: meta.sourceMeta?.source || "retained/manual",
                linkFingerprint: meta.linkFingerprint || "",
                ok: result.ok,
                protocol: result.protocol || "",
                stages: result.stages || "",
                reason: result.reason || ""
            });

            if (result.ok) {
                console.log(
                    `HEALTH PASS ${item.id}: ${result.protocol}`
                );

                passed +=
                    1;

                nextIndex.push(
                    item
                );

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

    const workerCount =
        Math.min(
            HEALTH_CONCURRENCY,
            managedItems.length ||
            1
        );

    await Promise.all(
        Array.from(
            {
                length:
                    workerCount
            },
            () =>
                worker()
        )
    );

    if (
        checked > 0 &&
        passed === 0
    ) {
        throw new Error(
            "All Keyline servers failed health checks; " +
            "existing generated pool is preserved."
        );
    }

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

    const allowedManagedIds = new Set(
        normalizedIndex
            .filter(item => isManagedKeylineId(item?.id))
            .map(item => item.id)
    );

    const stagedFiles = await fs.readdir(
        stageDir,
        { withFileTypes: true }
    );

    for (const entry of stagedFiles) {
        if (!entry.isFile() || !entry.name.endsWith(".link")) continue;

        const id = entry.name.slice(0, -5);

        if (
            isManagedKeylineId(id) &&
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

    const reportFile = path.join(ROOT, "keyline-report.json");
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
        results: healthResults,
    };
    report.finalManagedServers = normalizedIndex.filter(item => isManagedKeylineId(item?.id)).length;

    if (process.env.GITHUB_STEP_SUMMARY) {
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
        const lines = [
            "## Keyline refresh report",
            `- Sources: ${report.sourceCount ?? "?"} / configured ${report.configuredSourceCount ?? "?"}`,
            `- Raw entries: ${report.totalRawEntries ?? "?"}`,
            `- Parsed before dedupe: ${report.freshBeforeDedupe ?? "?"}`,
            `- After dedupe: ${report.afterDedupe ?? "?"}`,
            `- Fresh regular / whitelist: ${report.freshRegular ?? "?"} / ${report.freshWhiteList ?? "?"}`,
            `- Retained from previous pool: ${report.retainedFromPreviousPool ?? "?"}`,
            `- Before health-check: ${report.totalBeforeHealthCheck ?? "?"}`,
            `- Health-check: **${passed} passed / ${failed} failed**`,
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

    console.log(
        `Keyline health check complete: ${passed} passed, ${failed} removed.`
    );
}

main().catch(
    error => {
        console.error(
            `Keyline health check failed: ${error.message}`
        );

        process.exitCode =
            1;
    }
);
