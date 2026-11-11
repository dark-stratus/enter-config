// Central Russia reachability policy shared by preflight, gate and pool ranking.
export const CHECKER_POLICY = Object.freeze({
    algorithmVersion: 39,
    primaryNode: "ru1.node.check-host.net",
    primaryCheckerWeight: 0.12,
    defaultNodes: Object.freeze([
        "ru1.node.check-host.net",
        "ru2.node.check-host.net",
        "ru3.node.check-host.net",
    ]),
    defaultQuorum: 2,
    maxActiveNodes: 3,
});

export function isCheckHostPositive(result, transport = "tcp") {
    if (!result || typeof result !== "object") return false;
    if (result.reachable === true) return true;
    return transport === "udp" && result.udpUsable === true;
}

export function getPrimaryCheckerEvidence(results, transport = "tcp") {
    const row = Array.isArray(results)
        ? results.find(result => result?.node === CHECKER_POLICY.primaryNode)
        : null;
    const positive = isCheckHostPositive(row, transport);

    return {
        node: CHECKER_POLICY.primaryNode,
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
