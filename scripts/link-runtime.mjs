/**
 * Canonical link -> Xray outbound conversion used by the health-check.
 * Keep this behavior aligned with enter-main/src/vpn/parsers.js + builders.js.
 */

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(String(value ?? ""));
    } catch {
        return String(value ?? "");
    }
}

export function parseLink(link) {
    const value = String(link ?? "").trim();
    const protocol = value.split("://")[0].toLowerCase();

    if (protocol === "vless") return buildVlessFromLink(value);
    if (protocol === "trojan") return buildTrojanFromLink(value);
    if (protocol === "hysteria2" || protocol === "hysteria") return buildHysteriaFromLink(value);

    throw new Error(`Unsupported protocol: ${protocol}`);
}

export function buildOutbound(server, tag = "proxy") {
    if (server.protocol === "vless") return buildVless(server, tag);
    if (server.protocol === "trojan") return buildTrojan(server, tag);
    if (server.protocol === "hysteria2") return buildHysteria2(server, tag);
    throw new Error(`Unsupported protocol: ${server.protocol}`);
}

function buildVlessFromLink(link) {
    const url = new URL(link);
    const network = url.searchParams.get("type") || url.searchParams.get("network") || "tcp";

    return {
        protocol: "vless",
        address: url.hostname,
        port: Number(url.port),
        uuid: safeDecodeURIComponent(url.username),
        publicKey: url.searchParams.get("pbk") || url.searchParams.get("publicKey") || "",
        shortId: url.searchParams.get("sid") || url.searchParams.get("shortId") || "",
        serverName: url.searchParams.get("sni") || url.searchParams.get("serverName") || "",
        serviceName: url.searchParams.get("serviceName") || "",
        mode: url.searchParams.get("mode") || "",
        alpn: url.searchParams.get("alpn") || "",
        security: url.searchParams.get("security") || "none",
        fingerprint: url.searchParams.get("fp") || url.searchParams.get("fingerprint") || "chrome",
        flow: url.searchParams.get("flow") || "",
        network,
        host: url.searchParams.get("host") || "",
        path: url.searchParams.get("path") || "",
        headerType: url.searchParams.get("headerType") || "",
        packetEncoding: url.searchParams.get("packetEncoding") || "",
        extra: url.searchParams.get("extra") || "",
    };
}

function buildTrojanFromLink(link) {
    const url = new URL(link);
    return {
        protocol: "trojan",
        address: url.hostname,
        port: Number(url.port),
        password: safeDecodeURIComponent(url.username),
        serverName: url.searchParams.get("sni") || url.searchParams.get("serverName") || "",
        serviceName: url.searchParams.get("serviceName") || "",
        mode: url.searchParams.get("mode") || "",
        alpn: url.searchParams.get("alpn") || "",
        security: url.searchParams.get("security") || "tls",
        fingerprint: url.searchParams.get("fp") || url.searchParams.get("fingerprint") || "chrome",
        network: url.searchParams.get("type") || url.searchParams.get("network") || "tcp",
        host: url.searchParams.get("host") || "",
        path: url.searchParams.get("path") || "",
    };
}

function buildHysteriaFromLink(link) {
    const url = new URL(link);
    let finalmask = {};
    const fm = url.searchParams.get("fm");

    if (fm) {
        try {
            finalmask = JSON.parse(
                safeDecodeURIComponent(
                    safeDecodeURIComponent(fm)
                )
            );
        } catch {}
    }

    return {
        protocol: "hysteria2",
        address: url.hostname,
        port: Number(url.port),
        auth: safeDecodeURIComponent(url.username),
        serverName: url.searchParams.get("sni") || url.searchParams.get("serverName") || "",
        alpn: url.searchParams.get("alpn") || "h3",
        obfs: url.searchParams.get("obfs") || "",
        obfsPassword: url.searchParams.get("obfs-password") || "",
        insecure:
            url.searchParams.get("insecure") === "1" ||
            url.searchParams.get("allowInsecure") === "1",
        pinSHA256: url.searchParams.get("pinSHA256") || "",
        upMbps: url.searchParams.get("upmbps") || "",
        downMbps: url.searchParams.get("downmbps") || "",
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

    if (server.network === "raw") {
        stream.network = "tcp";
        stream.tcpSettings = {
            header: {
                type: server.headerType || "none",
            },
            ...(server.packetEncoding ? { packetEncoding: server.packetEncoding } : {}),
        };
    }

    if (server.network === "tcp") {
        stream.tcpSettings = {
            header: {
                type: server.headerType || "none",
            },
            ...(server.packetEncoding ? { packetEncoding: server.packetEncoding } : {}),
        };
    }

    if (server.network === "grpc") {
        stream.grpcSettings = {
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
        let extra = {};
        if (server.extra) {
            try {
                extra = JSON.parse(safeDecodeURIComponent(server.extra));
            } catch {}
        }

        stream.network = "xhttp";
        stream.xhttpSettings = {
            mode: extra.mode || server.mode || "packet-up",
            host: extra.host || server.host || "",
            path: extra.path || server.path || "",
            ...(extra.headers ? { headers: extra.headers } : {}),
        };
    }

    if (server.security === "reality") {
        stream.realitySettings = {
            fingerprint: server.fingerprint,
            publicKey: server.publicKey,
            serverName: server.serverName,
            shortId: server.shortId,
        };
    }

    if (server.security === "tls") {
        stream.tlsSettings = {
            serverName: server.serverName,
            fingerprint: server.fingerprint,
            alpn: server.alpn
                ? server.alpn.split(",").map(item => item.trim()).filter(Boolean)
                : [],
        };
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
        },
    };

    if (server.alpn) {
        stream.tlsSettings.alpn = server.alpn
            .split(",")
            .map(item => item.trim())
            .filter(Boolean);
    }

    if (server.network === "grpc") {
        stream.grpcSettings = {
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

    return stream;
}

function buildHysteriaStream(server) {
    return {
        network: "hysteria",
        security: "tls",
        isCustomFinalmask: Object.keys(server.finalmask || {}).length > 0,
        finalmask: server.finalmask || {},
        hysteriaSettings: {
            version: 2,
            auth: server.auth,
        },
        tlsSettings: {
            serverName: server.serverName,
            alpn: String(server.alpn || "h3")
                .split(",")
                .map(item => item.trim())
                .filter(Boolean),
            disableSystemRoot: false,
            enableSessionResumption: false,
            ...(server.insecure ? { allowInsecure: true } : {}),
            ...(server.pinSHA256 ? { pinnedPeerCertSha256: server.pinSHA256 } : {}),
        },
    };
}
