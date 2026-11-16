// Central Russia reachability policy shared by preflight, gate and pool ranking.
export const CHECKER_POLICY = Object.freeze({
    algorithmVersion: 42,
    primaryNode: "ru1.node.check-host.net",
    defaultNodes: Object.freeze([
        "ru1.node.check-host.net",
        "ru2.node.check-host.net",
        "ru3.node.check-host.net",
    ]),
    minimumAvailableNodes: 2,
    defaultQuorum: 2,
});

export function isCheckHostPositive(result, transport = "tcp") {
    if (!result || typeof result !== "object") return false;
    if (result.reachable === true) return true;
    return transport === "udp" && result.udpUsable === true;
}

export function getPrimaryCheckerEvidence(results, transport = "tcp") {
    const rows = Array.isArray(results) ? results.filter(row => row && typeof row === "object") : [];
    // Keep the legacy field name for report compatibility, but choose evidence
    // from the currently selected live checker set rather than requiring ru1.
    const row = rows.find(result => isCheckHostPositive(result, transport)) ||
        rows.find(result => !result.inconclusive) || rows[0] || null;
    const positive = isCheckHostPositive(row, transport);

    return {
        node: row?.node || null,
        positive,
        status: positive
            ? "positive"
            : row?.inconclusive
                ? "inconclusive"
                : row
                    ? "negative"
                    : "not-tested",
        reachable: Boolean(row?.reachable),
        udpUsable: Boolean(row?.udpUsable),
        inconclusive: Boolean(row?.inconclusive),
        latencyMs: Number(row?.latencyMs) || 0,
    };
}
