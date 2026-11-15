/**
 * Canonical URI <-> Xray outbound codec used by source normalization and health checks.
 * Keep this as the only place where transport/security URI fields are mapped.
 */

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(String(value ?? ""));
    } catch {
        return String(value ?? "");
    }
}

function normalizeHostname(hostname) {
    const value = String(hostname ?? "");
    return value.startsWith("[") && value.endsWith("]")
        ? value.slice(1, -1)
        : value;
}

function formatUriHostname(hostname) {
    const value = String(hostname ?? "").trim();
    if (value.includes(":") && !(value.startsWith("[") && value.endsWith("]"))) {
        return `[${value}]`;
    }
    return value;
}

function queryParam(url, ...names) {
    const values = new Map();
    for (const [key, value] of url.searchParams.entries()) {
        const normalizedKey = key.toLowerCase();
        if (!values.has(normalizedKey)) values.set(normalizedKey, value);
    }

    for (const name of names) {
        const key = String(name).toLowerCase();
        if (values.has(key)) return { found: true, value: values.get(key) };
    }
    return { found: false, value: "" };
}

function queryValue(url, names, fallback = "") {
    const result = queryParam(url, ...(Array.isArray(names) ? names : [names]));
    return result.found ? result.value : fallback;
}

function parseJsonQueryValue(value, fallback = {}) {
    if (value && typeof value === "object") return value;
    let candidate = String(value ?? "");
    if (!candidate) return fallback;

    // URLSearchParams already performs one decode. Parse that representation
    // first; decode further only for feeds that deliberately double-encode JSON.
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const parsed = JSON.parse(candidate);
            return parsed && typeof parsed === "object" ? parsed : fallback;
        } catch {
            const decoded = safeDecodeURIComponent(candidate);
            if (decoded === candidate) break;
            candidate = decoded;
        }
    }
    return fallback;
}

function parseGrpcAuthority(url) {
    const authority = String(queryValue(url, "authority") || "").trim();
    // A malformed, unescaped URI query such as authority=/?TELEGRAM... must
    // not become an invalid HTTP/2 :authority value in the Xray config.
    if (!authority || /[\s/?#]/u.test(authority)) return "";
    return authority;
}

function parseLegacyFragment(value) {
    const parts = String(value ?? "").split(",").map(part => part.trim());
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;

    const [length, delay, packets, maxSplit] = parts;
    // Current Xray FinalMask schema uses lengths/delays arrays. A single
    // Happ value maps to a one-element array without changing its range text.
    const settings = { packets, lengths: [length], delays: [delay] };
    if (maxSplit && maxSplit.toLowerCase() !== "null") settings.maxSplit = maxSplit;
    return {
        tcp: [{ type: "fragment", settings }],
    };
}

function readFinalmask(url) {
    const raw = queryParam(url, "fm");
    const finalmask = raw.found ? parseJsonQueryValue(raw.value, {}) : {};
    if (finalmask && typeof finalmask === "object" && Object.keys(finalmask).length) {
        return finalmask;
    }
    return parseLegacyFragment(queryValue(url, "fragment")) || {};
}

function cloneFinalmask(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? structuredClone(value)
        : {};
}

function appendFinalmask(params, finalmask) {
    if (finalmask && typeof finalmask === "object" && Object.keys(finalmask).length) {
        appendParam(params, "fm", JSON.stringify(finalmask));
    }
}

function appendParam(params, key, value) {
    if (value === undefined || value === null || value === "") return;
    params.append(key, String(value));
}

function buildUri(protocol, username, address, port, params) {
    const host = formatUriHostname(address);
    const query = params.toString();
    return `${protocol}://${encodeURIComponent(String(username ?? ""))}@${host}:${Number(port)}${query ? `?${query}` : ""}`;
}

export function parseLink(link) {
    const value = String(link ?? "").trim();
    if (!value) throw new Error("Empty proxy link");

    let url;
    try {
        url = new URL(value);
    } catch (error) {
        throw new Error(`Invalid proxy link: ${error?.message || error}`);
    }

    const protocol = url.protocol.replace(/:$/, "").toLowerCase();
    let server;
    if (protocol === "vless") server = buildVlessFromLink(url);
    else if (protocol === "trojan") server = buildTrojanFromLink(url);
    else if (protocol === "hysteria2" || protocol === "hysteria") server = buildHysteriaFromLink(url);
    else throw new Error(`Unsupported protocol: ${protocol}`);

    return validateParsedServer(server);
}

export function buildOutbound(server, tag = "proxy") {
    if (server.protocol === "vless") return buildVless(server, tag);
    if (server.protocol === "trojan") return buildTrojan(server, tag);
    if (server.protocol === "hysteria2") return buildHysteria2(server, tag);
    throw new Error(`Unsupported protocol: ${server.protocol}`);
}

/** Convert a selected Xray outbound into a share URI without dropping fields. */
export function buildLinkFromOutbound(outbound) {
    if (!outbound || typeof outbound !== "object") return null;
    const protocol = String(outbound.protocol || "").toLowerCase();

    if (protocol === "vless") return buildVlessLinkFromOutbound(outbound);
    if (protocol === "trojan") return buildTrojanLinkFromOutbound(outbound);
    if (protocol === "hysteria" || protocol === "hysteria2") {
        return buildHysteriaLinkFromOutbound(outbound);
    }
    return null;
}

const VLESS_NETWORKS = new Set([
    "tcp", "raw", "grpc", "ws", "httpupgrade", "xhttp", "splithttp"
]);
const TROJAN_NETWORKS = new Set([
    "tcp", "raw", "grpc", "ws", "httpupgrade"
]);

export function validateParsedServer(server) {
    const missing = [];
    if (!String(server?.address || "").trim()) missing.push("server address");
    if (!Number.isInteger(server?.port) || server.port < 1 || server.port > 65535) {
        missing.push("valid server port");
    }

    if (server?.protocol === "vless") {
        const userId = String(server.uuid || "").trim();
        const isUuid = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu.test(userId);
        // Xray VLESS accepts either a UUID or a custom UTF-8 ID shorter than
        // 30 bytes. Rejecting non-UUID IDs silently discarded valid public
        // source nodes during normalization (for example, XpnTeam-15).
        const isShortCustomId = Boolean(userId) && new TextEncoder().encode(userId).byteLength < 30;
        if (!isUuid && !isShortCustomId) {
            missing.push("valid VLESS ID (UUID or custom ID under 30 UTF-8 bytes)");
        }
        if (!VLESS_NETWORKS.has(String(server.network || "tcp").toLowerCase())) {
            missing.push(`supported VLESS transport (got ${server.network || "empty"})`);
        }
        const security = String(server.security || "none").toLowerCase();
        if (!["none", "tls", "reality"].includes(security)) {
            missing.push(`supported VLESS security (got ${security})`);
        }
        if (security === "reality") {
            if (!String(server.publicKey || "").trim()) missing.push("Reality public key (pbk)");
            const shortId = String(server.shortId ?? "").trim();
            // Empty short IDs are valid only when the remote inbound allows one.
            if (!/^(?:[0-9a-f]{2}){0,8}$/iu.test(shortId)) {
                missing.push("valid Reality short ID (sid: 0-16 even-length hex characters)");
            }
            if (!String(server.serverName || "").trim()) missing.push("Reality server name (sni)");
            if (!["tcp", "raw", "grpc", "xhttp", "splithttp"].includes(String(server.network || "tcp").toLowerCase())) {
                missing.push("Reality-compatible transport (RAW, XHTTP or gRPC)");
            }
        }
    } else if (server?.protocol === "trojan") {
        if (!String(server.password || "").trim()) missing.push("Trojan password");
        if (String(server.security || "tls").toLowerCase() !== "tls") {
            missing.push("TLS security for Trojan (this builder does not support non-TLS Trojan links)");
        }
        if (!TROJAN_NETWORKS.has(String(server.network || "tcp").toLowerCase())) {
            missing.push(`supported Trojan transport (got ${server.network || "empty"})`);
        }
    } else if (server?.protocol !== "hysteria2") {
        missing.push(`supported protocol (got ${server?.protocol || "empty"})`);
    }

    if (missing.length) {
        throw new Error(`Invalid ${server?.protocol || "unknown"} server configuration: missing/invalid ${missing.join(", ")}`);
    }
    return server;
}

function buildVlessFromLink(url) {
    const security = String(queryValue(url, "security", "none") || "none").trim().toLowerCase();
    const network = String(queryValue(url, ["type", "network"], "tcp") || "tcp").trim().toLowerCase();
    const spiderX = queryParam(url, "spx", "spiderx", "spider_x");
    const host = queryValue(url, "host");
    const path = queryValue(url, "path");
    const explicitHeaderType = queryParam(url, "headertype");
    const headerType = explicitHeaderType.found
        ? explicitHeaderType.value
        : (network === "tcp" && (host || path) ? "http" : "");

    return {
        protocol: "vless",
        address: normalizeHostname(url.hostname),
        port: Number(url.port),
        uuid: safeDecodeURIComponent(url.username),
        publicKey: queryValue(url, ["pbk", "publickey", "password"]),
        mldsa65Verify: queryValue(url, "pqv"),
        shortId: queryValue(url, ["sid", "shortid"]),
        serverName: queryValue(url, ["sni", "servername"]),
        // An omitted spiderX is the same empty value shown in Xray's client
        // schema. Preserve any supplied path exactly; do not synthesize '/'.
        spiderX: spiderX.found ? spiderX.value : "",
        serviceName: queryValue(url, "servicename"),
        mode: queryValue(url, "mode"),
        alpn: queryValue(url, "alpn"),
        security,
        fingerprint: queryValue(url, ["fp", "fingerprint"], "chrome"),
        flow: queryValue(url, "flow"),
        network,
        host,
        path,
        headerType,
        packetEncoding: queryValue(url, "packetencoding"),
        authority: parseGrpcAuthority(url),
        verifyPeerCertByName: queryValue(url, "vcn"),
        pinnedPeerCertSha256: queryValue(url, "pcs"),
        echConfigList: queryValue(url, "ech"),
        cipherSuites: queryValue(url, "cs"),
        finalmask: readFinalmask(url),
        extra: queryValue(url, "extra"),
        allowInsecure: ["1", "true", "yes"].includes(queryValue(url, ["allowinsecure", "insecure"]).toLowerCase()),
    };
}

function buildTrojanFromLink(url) {
    return {
        protocol: "trojan",
        address: normalizeHostname(url.hostname),
        port: Number(url.port),
        password: safeDecodeURIComponent(url.username),
        serverName: queryValue(url, ["sni", "servername"]),
        serviceName: queryValue(url, "servicename"),
        mode: queryValue(url, "mode"),
        alpn: queryValue(url, "alpn"),
        security: String(queryValue(url, "security", "tls") || "tls").toLowerCase(),
        fingerprint: queryValue(url, ["fp", "fingerprint"], "chrome"),
        network: String(queryValue(url, ["type", "network"], "tcp") || "tcp").toLowerCase(),
        host: queryValue(url, "host"),
        path: queryValue(url, "path"),
        headerType: queryValue(url, "headertype"),
        packetEncoding: queryValue(url, "packetencoding"),
        allowInsecure: ["1", "true", "yes"].includes(queryValue(url, ["allowinsecure", "insecure"]).toLowerCase()),
        authority: parseGrpcAuthority(url),
        verifyPeerCertByName: queryValue(url, "vcn"),
        pinnedPeerCertSha256: queryValue(url, "pcs"),
        echConfigList: queryValue(url, "ech"),
        cipherSuites: queryValue(url, "cs"),
        finalmask: readFinalmask(url),
    };
}

function buildHysteriaFromLink(url) {
    const finalmask = readFinalmask(url);
    const insecure = ["1", "true", "yes"].includes(
        queryValue(url, ["insecure", "allowinsecure"]).toLowerCase()
    );

    return {
        protocol: "hysteria2",
        address: normalizeHostname(url.hostname),
        port: Number(url.port),
        auth: safeDecodeURIComponent(url.username),
        serverName: queryValue(url, ["sni", "servername"]),
        alpn: queryValue(url, "alpn", "h3"),
        fingerprint: queryValue(url, ["fp", "fingerprint"], "chrome"),
        obfs: queryValue(url, "obfs"),
        obfsPassword: queryValue(url, "obfs-password"),
        insecure,
        pinSHA256: queryValue(url, ["pcs", "pinsha256"]),
        verifyPeerCertByName: queryValue(url, "vcn"),
        echConfigList: queryValue(url, "ech"),
        cipherSuites: queryValue(url, "cs"),
        upMbps: queryValue(url, "upmbps"),
        downMbps: queryValue(url, "downmbps"),
        finalmask,
    };
}

function buildVless(server, tag) {
    return {
        protocol: "vless",
        tag,
        settings: {
            vnext: [
                {
                    address: server.address,
                    port: server.port,
                    users: [
                        {
                            id: server.uuid,
                            encryption: "none",
                            flow: server.flow || "",
                            level: 8,
                            security: "auto",
                        },
                    ],
                },
            ],
        },
        streamSettings: buildVlessStream(server),
    };
}

function buildTrojan(server, tag) {
    return {
        protocol: "trojan",
        tag,
        settings: {
            servers: [
                {
                    address: server.address,
                    port: server.port,
                    password: server.password,
                },
            ],
        },
        streamSettings: buildTrojanStream(server),
    };
}

function buildHysteria2(server, tag) {
    return {
        protocol: "hysteria",
        tag,
        settings: {
            address: server.address,
            port: server.port,
            version: 2,
            ...(server.auth ? { auth: server.auth } : {}),
        },
        streamSettings: buildHysteriaStream(server),
    };
}

function buildVlessStream(server) {
    const stream = {
        network: server.network || "tcp",
        security: server.security || "none",
    };

    if (server.network === "raw" || server.network === "tcp") {
        if (server.network === "raw") stream.network = "tcp";
        const headerType = server.headerType || ((server.host || server.path) ? "http" : "none");
        const header = { type: headerType };
        if (headerType === "http") {
            header.request = {
                version: "1.1",
                method: "GET",
                path: [server.path || "/"],
                headers: server.host ? { Host: [server.host] } : {},
            };
        }
        stream.tcpSettings = {
            header,
            ...(server.packetEncoding ? { packetEncoding: server.packetEncoding } : {}),
        };
    }

    if (server.network === "grpc") {
        stream.grpcSettings = {
            ...(server.authority ? { authority: server.authority } : {}),
            serviceName: server.serviceName || "",
            multiMode: server.mode === "multi",
        };
    }

    if (server.network === "ws") {
        stream.wsSettings = {
            path: server.path || "",
            headers: server.host ? { Host: server.host } : {},
        };
    }

    if (server.network === "httpupgrade") {
        stream.httpupgradeSettings = {
            path: server.path || "",
            host: server.host || "",
        };
    }

    if (server.network === "xhttp" || server.network === "splithttp") {
        const extra = parseJsonQueryValue(server.extra, {});
        const xhttpExtra = extra && typeof extra === "object" && !Array.isArray(extra)
            ? { ...extra }
            : {};
        const mode = xhttpExtra.mode || server.mode || "packet-up";
        const host = xhttpExtra.host || server.host || "";
        const path = xhttpExtra.path || server.path || "";
        delete xhttpExtra.mode;
        delete xhttpExtra.host;
        delete xhttpExtra.path;

        stream.network = "xhttp";
        stream.xhttpSettings = {
            mode,
            host,
            path,
            ...(Object.keys(xhttpExtra).length ? { extra: xhttpExtra } : {}),
        };
    }

    if (server.security === "reality") {
        stream.realitySettings = {
            allowInsecure: false,
            fingerprint: server.fingerprint,
            password: server.publicKey,
            serverName: server.serverName,
            shortId: server.shortId,
            ...(server.mldsa65Verify ? { mldsa65Verify: server.mldsa65Verify } : {}),
            show: false,
            spiderX: server.spiderX ?? "",
        };
    }

    if (server.security === "tls") {
        stream.tlsSettings = {
            serverName: server.serverName,
            fingerprint: server.fingerprint,
            alpn: server.alpn
                ? server.alpn.split(",").map(item => item.trim()).filter(Boolean)
                : [],
            ...(server.allowInsecure ? { allowInsecure: true } : {}),
            ...(server.verifyPeerCertByName ? { verifyPeerCertByName: server.verifyPeerCertByName } : {}),
            ...(server.pinnedPeerCertSha256 ? { pinnedPeerCertSha256: server.pinnedPeerCertSha256 } : {}),
            ...(server.echConfigList ? { echConfigList: server.echConfigList } : {}),
            ...(server.cipherSuites ? { cipherSuites: server.cipherSuites } : {}),
        };
    }

    const finalmask = cloneFinalmask(server.finalmask);
    if (Object.keys(finalmask).length) {
        stream.finalmask = finalmask;
        stream.isCustomFinalmask = true;
    }

    return stream;
}

function buildTrojanStream(server) {
    const stream = {
        network: server.network || "tcp",
        security: "tls",
        isCustomFinalmask: false,
        tlsSettings: {
            serverName: server.serverName,
            fingerprint: server.fingerprint,
            disableSystemRoot: false,
            enableSessionResumption: false,
            ...(server.alpn
                ? { alpn: server.alpn.split(",").map(item => item.trim()).filter(Boolean) }
                : {}),
            ...(server.allowInsecure ? { allowInsecure: true } : {}),
            ...(server.verifyPeerCertByName ? { verifyPeerCertByName: server.verifyPeerCertByName } : {}),
            ...(server.pinnedPeerCertSha256 ? { pinnedPeerCertSha256: server.pinnedPeerCertSha256 } : {}),
            ...(server.echConfigList ? { echConfigList: server.echConfigList } : {}),
            ...(server.cipherSuites ? { cipherSuites: server.cipherSuites } : {}),
        },
    };

    if (server.network === "raw" || server.network === "tcp") {
        if (server.network === "raw") stream.network = "tcp";
        const headerType = server.headerType || ((server.host || server.path) ? "http" : "none");
        const header = { type: headerType };
        if (headerType === "http") {
            header.request = {
                version: "1.1",
                method: "GET",
                path: [server.path || "/"],
                headers: server.host ? { Host: [server.host] } : {},
            };
        }
        stream.tcpSettings = {
            header,
            ...(server.packetEncoding ? { packetEncoding: server.packetEncoding } : {}),
        };
    }

    if (server.network === "grpc") {
        stream.grpcSettings = {
            ...(server.authority ? { authority: server.authority } : {}),
            serviceName: server.serviceName || "",
            multiMode: server.mode === "multi",
        };
    }
    if (server.network === "ws") {
        stream.wsSettings = {
            path: server.path || "",
            headers: server.host ? { Host: server.host } : {},
        };
    }
    if (server.network === "httpupgrade") {
        stream.httpupgradeSettings = {
            path: server.path || "",
            host: server.host || "",
        };
    }

    const finalmask = cloneFinalmask(server.finalmask);
    if (Object.keys(finalmask).length) {
        stream.finalmask = finalmask;
        stream.isCustomFinalmask = true;
    }
    return stream;
}

function buildHysteriaStream(server) {
    const finalmask = server.finalmask && typeof server.finalmask === "object"
        ? structuredClone(server.finalmask)
        : {};

    if (server.obfs && !finalmask.obfs) {
        finalmask.obfs = {
            type: server.obfs,
            ...(server.obfsPassword ? { password: server.obfsPassword } : {}),
        };
    }

    const hysteriaSettings = {
        version: 2,
        auth: server.auth,
    };
    if (server.upMbps) hysteriaSettings.up = String(server.upMbps).match(/(?:mbps|gbps)/i)
        ? String(server.upMbps)
        : `${server.upMbps} mbps`;
    if (server.downMbps) hysteriaSettings.down = String(server.downMbps).match(/(?:mbps|gbps)/i)
        ? String(server.downMbps)
        : `${server.downMbps} mbps`;

    return {
        network: "hysteria",
        security: "tls",
        isCustomFinalmask: Object.keys(finalmask).length > 0,
        finalmask,
        hysteriaSettings,
        tlsSettings: {
            serverName: server.serverName,
            fingerprint: server.fingerprint,
            alpn: String(server.alpn || "h3")
                .split(",")
                .map(item => item.trim())
                .filter(Boolean),
            disableSystemRoot: false,
            enableSessionResumption: false,
            ...(server.insecure ? { allowInsecure: true } : {}),
            ...(server.pinSHA256 ? { pinnedPeerCertSha256: server.pinSHA256 } : {}),
            ...(server.verifyPeerCertByName ? { verifyPeerCertByName: server.verifyPeerCertByName } : {}),
            ...(server.echConfigList ? { echConfigList: server.echConfigList } : {}),
            ...(server.cipherSuites ? { cipherSuites: server.cipherSuites } : {}),
        },
    };
}

function tlsField(tlsSettings, name) {
    return tlsSettings?.[name] ?? tlsSettings?.settings?.[name];
}

function normalizeCsv(value) {
    if (Array.isArray(value)) return value.join(",");
    return String(value ?? "");
}

function buildVlessLinkFromOutbound(outbound) {
    const server = outbound.settings?.vnext?.[0];
    const user = server?.users?.[0];
    const stream = outbound.streamSettings || {};
    if (!server?.address || !server?.port || !user?.id || !stream.network || !stream.security) return null;

    const network = String(stream.network).toLowerCase();
    if (!VLESS_NETWORKS.has(network)) return null;

    const params = new URLSearchParams();
    appendParam(params, "encryption", user.encryption || "none");
    appendParam(params, "flow", user.flow);
    appendParam(params, "type", network);

    if (network === "tcp" || network === "raw") {
        const tcp = stream.tcpSettings || {};
        const header = tcp.header || {};
        appendParam(params, "headerType", header.type);
        appendParam(params, "packetEncoding", tcp.packetEncoding);
        if (String(header.type || "").toLowerCase() === "http") {
            const request = header.request || {};
            const host = request.headers?.Host || request.headers?.host || "";
            const path = Array.isArray(request.path) ? request.path[0] : request.path;
            appendParam(params, "host", Array.isArray(host) ? host[0] : host);
            appendParam(params, "path", path);
        }
    }
    if (network === "grpc") {
        appendParam(params, "authority", stream.grpcSettings?.authority);
        appendParam(params, "serviceName", stream.grpcSettings?.serviceName);
        appendParam(params, "mode", stream.grpcSettings?.multiMode ? "multi" : "gun");
    }
    if (network === "ws") {
        appendParam(params, "host", stream.wsSettings?.headers?.Host || stream.wsSettings?.host);
        appendParam(params, "path", stream.wsSettings?.path);
    }
    if (network === "httpupgrade") {
        const settings = stream.httpupgradeSettings || stream.httpUpgradeSettings || {};
        appendParam(params, "host", settings.host);
        appendParam(params, "path", settings.path);
    }
    if (network === "xhttp" || network === "splithttp") {
        const settings = stream.xhttpSettings || stream.splitHttpSettings || stream.splithttpSettings || {};
        appendParam(params, "host", settings.host);
        appendParam(params, "path", settings.path);
        appendParam(params, "mode", settings.mode);
        if (settings.extra && Object.keys(settings.extra).length) {
            appendParam(params, "extra", JSON.stringify(settings.extra));
        }
    }

    const security = String(stream.security).toLowerCase();
    appendParam(params, "security", security);
    if (security === "reality") {
        const reality = stream.realitySettings || {};
        appendParam(params, "sni", reality.serverName);
        appendParam(params, "pbk", reality.password || reality.publicKey);
        appendParam(params, "sid", reality.shortId);
        appendParam(params, "pqv", reality.mldsa65Verify);
        // Xray's client schema represents an omitted spiderX as an empty
        // string. Preserve configured values; never invent a crawler path.
        appendParam(params, "spx", reality.spiderX);
        appendParam(params, "fp", reality.fingerprint || stream.tlsSettings?.fingerprint);
        const alpn = Array.isArray(stream.tlsSettings?.alpn)
            ? stream.tlsSettings.alpn.join(",")
            : stream.tlsSettings?.alpn;
        appendParam(params, "alpn", alpn);
    } else if (security === "tls") {
        const tls = stream.tlsSettings || {};
        appendParam(params, "sni", tls.serverName);
        appendParam(params, "fp", tls.fingerprint);
        appendParam(params, "alpn", normalizeCsv(tls.alpn));
        appendParam(params, "allowInsecure", tls.allowInsecure || tlsField(tls, "allowInsecure") ? "1" : "");
        appendParam(params, "vcn", tlsField(tls, "verifyPeerCertByName"));
        appendParam(params, "pcs", normalizeCsv(tlsField(tls, "pinnedPeerCertSha256")));
        appendParam(params, "ech", tlsField(tls, "echConfigList"));
        appendParam(params, "cs", tls.cipherSuites || tlsField(tls, "cipherSuites"));
    }

    appendFinalmask(params, stream.finalmask || outbound.finalmask);
    return buildUri("vless", user.id, server.address, server.port, params);
}

function buildTrojanLinkFromOutbound(outbound) {
    const server = outbound.settings?.servers?.[0] || outbound.settings?.vnext?.[0];
    const stream = outbound.streamSettings || {};
    if (!server?.address || !server?.port || !server?.password) return null;

    const network = String(stream.network || "tcp").toLowerCase();
    if (!TROJAN_NETWORKS.has(network)) return null;

    const params = new URLSearchParams();
    appendParam(params, "type", network);
    appendParam(params, "security", "tls");
    if (network === "tcp" || network === "raw") {
        const tcp = stream.tcpSettings || {};
        const header = tcp.header || {};
        appendParam(params, "headerType", header.type);
        appendParam(params, "packetEncoding", tcp.packetEncoding);
        if (String(header.type || "").toLowerCase() === "http") {
            const request = header.request || {};
            const host = request.headers?.Host || request.headers?.host || "";
            const requestPath = Array.isArray(request.path) ? request.path[0] : request.path;
            appendParam(params, "host", Array.isArray(host) ? host[0] : host);
            appendParam(params, "path", requestPath);
        }
    }
    if (network === "grpc") {
        appendParam(params, "authority", stream.grpcSettings?.authority);
        appendParam(params, "serviceName", stream.grpcSettings?.serviceName);
        appendParam(params, "mode", stream.grpcSettings?.multiMode ? "multi" : "gun");
    }
    if (network === "ws") {
        appendParam(params, "host", stream.wsSettings?.headers?.Host || stream.wsSettings?.host);
        appendParam(params, "path", stream.wsSettings?.path);
    }
    if (network === "httpupgrade") {
        const settings = stream.httpupgradeSettings || stream.httpUpgradeSettings || {};
        appendParam(params, "host", settings.host);
        appendParam(params, "path", settings.path);
    }

    const tls = stream.tlsSettings || {};
    appendParam(params, "sni", tls.serverName);
    appendParam(params, "fp", tls.fingerprint);
    appendParam(params, "alpn", normalizeCsv(tls.alpn));
    appendParam(params, "allowInsecure", tls.allowInsecure || tlsField(tls, "allowInsecure") ? "1" : "");
    appendParam(params, "vcn", tlsField(tls, "verifyPeerCertByName"));
    appendParam(params, "pcs", normalizeCsv(tlsField(tls, "pinnedPeerCertSha256")));
    appendParam(params, "ech", tlsField(tls, "echConfigList"));
    appendParam(params, "cs", tls.cipherSuites || tlsField(tls, "cipherSuites"));
    appendFinalmask(params, stream.finalmask || outbound.finalmask);
    return buildUri("trojan", server.password, server.address, server.port, params);
}

function buildHysteriaLinkFromOutbound(outbound) {
    const settings = outbound.settings || {};
    const stream = outbound.streamSettings || {};
    const tls = stream.tlsSettings || {};
    const hysteria = stream.hysteriaSettings || {};
    const server = settings.address
        ? { address: settings.address, port: settings.port }
        : settings.servers?.[0];
    if (!server?.address || !server?.port) return null;

    const auth = hysteria.auth || settings.auth || server.password || "";
    const finalmask = stream.finalmask || outbound.finalmask || null;
    const params = new URLSearchParams();
    appendParam(params, "sni", tls.serverName);
    appendParam(params, "alpn", normalizeCsv(tls.alpn));
    appendParam(params, "fp", tls.fingerprint);
    appendParam(params, "insecure", tls.allowInsecure || tlsField(tls, "allowInsecure") ? "1" : "");
    appendParam(params, "pcs", normalizeCsv(tlsField(tls, "pinnedPeerCertSha256") || tls.pinSHA256));
    appendParam(params, "vcn", tlsField(tls, "verifyPeerCertByName"));
    appendParam(params, "ech", tlsField(tls, "echConfigList"));
    appendParam(params, "cs", tls.cipherSuites || tlsField(tls, "cipherSuites"));
    appendParam(params, "upmbps", hysteria.up);
    appendParam(params, "downmbps", hysteria.down);
    appendFinalmask(params, finalmask);
    return buildUri("hysteria2", auth, server.address, server.port, params);
}
