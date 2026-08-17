#!/usr/bin/env node

import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

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

function parseQuery(
    url
) {
    return url.searchParams;
}

function buildVlessOutbound(
    url
) {
    const params =
        parseQuery(url);

    const network =
        params.get("type") ||
        params.get("network") ||
        "tcp";

    const security =
        params.get("security") ||
        "none";

    const vnext = {
        address:
            url.hostname,

        port:
            Number(url.port),

        users: [
            {
                id:
                    safeDecode(
                        url.username
                    ),

                encryption:
                    params.get(
                        "encryption"
                    ) ||
                    "none",

                flow:
                    params.get(
                        "flow"
                    ) ||
                    ""
            }
        ]
    };

    const stream = {
        network,
        security
    };

    if (network === "ws") {
        stream.wsSettings = {
            path:
                params.get("path") ||
                "",

            headers:
                params.get("host")
                    ? {
                        Host:
                            params.get(
                                "host"
                            )
                    }
                    : {}
        };
    }

    if (network === "grpc") {
        stream.grpcSettings = {
            serviceName:
                params.get(
                    "serviceName"
                ) ||
                "",

            multiMode:
                params.get(
                    "mode"
                ) ===
                "multi"
        };
    }

    if (
        network ===
            "httpupgrade"
    ) {
        stream.httpupgradeSettings = {
            path:
                params.get("path") ||
                "",

            host:
                params.get("host") ||
                ""
        };
    }

    if (
        network === "xhttp" ||
        network === "splithttp"
    ) {
        stream.network =
            "xhttp";

        stream.xhttpSettings = {
            path:
                params.get("path") ||
                "",

            host:
                params.get("host") ||
                "",

            mode:
                params.get("mode") ||
                "packet-up"
        };
    }

    if (security === "tls") {
        stream.tlsSettings = {
            serverName:
                params.get(
                    "sni"
                ) ||
                "",

            fingerprint:
                params.get(
                    "fp"
                ) ||
                "",

            alpn:
                (
                    params.get(
                        "alpn"
                    ) ||
                    ""
                )
                .split(",")
                .filter(Boolean)
        };
    }

    if (security === "reality") {
        stream.realitySettings = {
            fingerprint:
                params.get(
                    "fp"
                ) ||
                "chrome",

            publicKey:
                params.get(
                    "pbk"
                ) ||
                "",

            serverName:
                params.get(
                    "sni"
                ) ||
                "",

            shortId:
                params.get(
                    "sid"
                ) ||
                ""
        };
    }

    return {
        protocol:
            "vless",

        settings: {
            vnext: [
                vnext
            ]
        },

        streamSettings:
            stream,

        tag:
            "proxy"
    };
}

function buildTrojanOutbound(
    url
) {
    const params =
        parseQuery(url);

    const stream = {
        network:
            params.get(
                "type"
            ) ||
            "tcp",

        security:
            "tls",

        tlsSettings: {
            serverName:
                params.get(
                    "sni"
                ) ||
                "",

            fingerprint:
                params.get(
                    "fp"
                ) ||
                "",

            alpn:
                (
                    params.get(
                        "alpn"
                    ) ||
                    ""
                )
                .split(",")
                .filter(Boolean)
        }
    };

    if (
        stream.network ===
        "ws"
    ) {
        stream.wsSettings = {
            path:
                params.get("path") ||
                "",

            headers:
                params.get("host")
                    ? {
                        Host:
                            params.get(
                                "host"
                            )
                    }
                    : {}
        };
    }

    if (
        stream.network ===
        "grpc"
    ) {
        stream.grpcSettings = {
            serviceName:
                params.get(
                    "serviceName"
                ) ||
                "",

            multiMode:
                params.get(
                    "mode"
                ) ===
                "multi"
        };
    }

    if (
        stream.network ===
        "httpupgrade"
    ) {
        stream.httpupgradeSettings = {
            path:
                params.get("path") ||
                "",

            host:
                params.get("host") ||
                ""
        };
    }

    return {
        protocol:
            "trojan",

        settings: {
            servers: [
                {
                    address:
                        url.hostname,

                    port:
                        Number(url.port),

                    password:
                        safeDecode(
                            url.username
                        )
                }
            ]
        },

        streamSettings:
            stream,

        tag:
            "proxy"
    };
}

function buildHysteriaOutbound(
    url
) {
    const params =
        parseQuery(url);

    const finalmaskText =
        params.get("fm");

    let finalmask = {};

    if (finalmaskText) {
        try {
            finalmask =
                JSON.parse(
                    safeDecode(
                        safeDecode(
                            finalmaskText
                        )
                    )
                );
        } catch {}
    }

    return {
        protocol:
            "hysteria",

        settings: {
            address:
                url.hostname,

            port:
                Number(url.port),

            version:
                2,

            auth:
                safeDecode(
                    url.username
                )
        },

        streamSettings: {
            network:
                "hysteria",

            security:
                "tls",

            isCustomFinalmask:
                Object.keys(
                    finalmask
                ).length > 0,

            finalmask,

            hysteriaSettings: {
                version:
                    2,

                auth:
                    safeDecode(
                        url.username
                    )
            },

            tlsSettings: {
                serverName:
                    params.get(
                        "sni"
                    ) ||
                    "",

                alpn:
                    (
                        params.get(
                            "alpn"
                        ) ||
                        "h3"
                    )
                    .split(",")
                    .filter(Boolean),

                ...(params.get(
                    "insecure"
                ) === "1" ||
                params.get(
                    "allowInsecure"
                ) === "1"
                    ? {
                        allowInsecure:
                            true
                    }
                    : {}),

                ...(params.get(
                    "pinSHA256"
                )
                    ? {
                        pinnedPeerCertSha256:
                            params.get(
                                "pinSHA256"
                            )
                    }
                    : {})
            }
        },

        tag:
            "proxy"
    };
}

function buildXrayConfig(
    link,
    socksPort
) {
    const url =
        new URL(
            link
        );

    const protocol =
        getProtocol(link);

    let outbound;

    if (
        protocol ===
        "vless"
    ) {
        outbound =
            buildVlessOutbound(
                url
            );
    } else if (
        protocol ===
        "trojan"
    ) {
        outbound =
            buildTrojanOutbound(
                url
            );
    } else if (
        protocol ===
            "hysteria2" ||
        protocol ===
            "hysteria"
    ) {
        outbound =
            buildHysteriaOutbound(
                url
            );
    } else {
        throw new Error(
            `Unsupported protocol: ${protocol}`
        );
    }

    return {
        log: {
            loglevel:
                "none"
        },

        inbounds: [
            {
                listen:
                    "127.0.0.1",

                port:
                    socksPort,

                protocol:
                    "socks",

                settings: {
                    udp:
                        false
                },

                sniffing: {
                    enabled:
                        false
                },

                tag:
                    "socks"
            }
        ],

        outbounds: [
            outbound,

            {
                protocol:
                    "freedom",

                tag:
                    "direct"
            },

            {
                protocol:
                    "blackhole",

                tag:
                    "block"
            }
        ]
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

async function runCurl(
    socksPort
) {
    const errors = [];

    const probeTarget =
        async targetUrl => {
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
                        ok:
                            true,

                        targetUrl,

                        error:
                            ""
                    };
                }

                errors.push(
                    `${targetUrl} attempt ${attempt}: ${result.error || "curl failed"}`
                );

                if (
                    attempt <
                    REQUEST_RETRIES
                ) {
                    await sleep(
                        150
                    );
                }
            }

            return {
                ok:
                    false,

                targetUrl,

                error:
                    ""
            };
        };

    const probes =
        HEALTH_TARGET_URLS.map(
            targetUrl =>
                probeTarget(
                    targetUrl
                )
        );

    const results =
        await Promise.all(
            probes
        );

    const success =
        results.find(
            result =>
                result.ok
        );

    if (success) {
        return success;
    }

    return {
        ok:
            false,

        error:
            errors
                .slice(-6)
                .join("; ")
                .slice(
                    0,
                    1000
                )
    };
}

async function xrayProbe(
    link
) {
    const socksPort =
        await getFreePort();

    const tempDir =
        await fs.mkdtemp(
            path.join(
                os.tmpdir(),
                "keyline-health-"
            )
        );

    const configFile =
        path.join(
            tempDir,
            "config.json"
        );

    const config =
        buildXrayConfig(
            link,
            socksPort
        );

    await fs.writeFile(
        configFile,
        JSON.stringify(
            config
        ),
        "utf8"
    );

    const child =
        spawn(
            XRAY_BIN,
            [
                "run",
                "-c",
                configFile
            ],
            {
                stdio: [
                    "ignore",
                    "ignore",
                    "ignore"
                ]
            }
        );

    try {
        const ready =
            await waitForPort(
                socksPort
            );

        if (!ready) {
            return {
                ok:
                    false,

                error:
                    "xray socks inbound did not start"
            };
        }

        return await runCurl(
            socksPort
        );
    } finally {
        child.kill(
            "SIGTERM"
        );

        await sleep(100);

        if (!child.killed) {
            child.kill(
                "SIGKILL"
            );
        }

        await fs.rm(
            tempDir,
            {
                recursive:
                    true,

                force:
                    true
            }
        );
    }
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

    return index.map(
        item => {
            if (
                !isManagedKeylineId(
                    item.id
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
                    );

                const next = {
                    ...item,
                    remarks:
                        `${flag ? `${flag} ` : ""}🏳️ White List ${whiteListNumber}`.trim()
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

    const nextIndex =
        [];

    let passed =
        0;

    let failed =
        0;

    const managedItems =
        [];

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

        try {
            const stage2 =
                await xrayProbe(
                    link
                );

            if (!stage2.ok) {
                return {
                    item,
                    ok:
                        false,

                    reason:
                        `protocol probe failed (${stage2.error || "unknown"})`
                };
            }

            return {
                item,
                ok:
                    true,

                protocol
            };
        } catch (
            error
        ) {
            return {
                item,
                ok:
                    false,

                reason:
                    error?.message ||
                    "xray health probe error"
            };
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

            await fs.rm(
                path.join(
                    LINKS_DIR,
                    `${item.id}.link`
                ),
                {
                    force:
                        true
                }
            );
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

    await fs.writeFile(
        INDEX_FILE,
        `${JSON.stringify(
            normalizedIndex,
            null,
            2
        )}\n`,
        "utf8"
    );

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
