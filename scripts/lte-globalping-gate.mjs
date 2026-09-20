import net from "node:net";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeLocationName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replaceAll("ё", "е")
        .replace(/\s+/g, " ");
}

const CORE_CITIES = new Set([
    "moscow",
    "moscow city",
    "saint petersburg",
    "st petersburg",
    "st. petersburg",
    "санкт-петербург",
]);

const DEFAULT_CITY_PREFERENCE = [
    "Kazan",
    "Novosibirsk",
    "Krasnodar",
    "Ufa",
    "Kursk",
    "Samara",
    "Rostov-on-Don",
    "Nizhny Novgorod",
    "Perm",
    "Voronezh",
    "Chelyabinsk",
    "Yekaterinburg",
];

function endpointKey(link) {
    const url = new URL(String(link || "").trim());
    const host = url.hostname.toLowerCase();
    const port = Number(url.port || 443);
    return `tcp|${host}|${port}`;
}

function isEligibleLteTcp(result) {
    return Boolean(result?.whiteList) && Boolean(result?.ok) &&
        !["hysteria", "hysteria2", "tuic"].includes(String(result?.protocol || "").toLowerCase());
}

async function requestJson(url, options, timeoutMs, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    accept: "application/json",
                    ...(options?.headers || {}),
                },
            });
            const text = await response.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch {
                data = null;
            }
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
                error.status = response.status;
                const retryAfter = Number(response.headers.get("retry-after"));
                if (Number.isFinite(retryAfter)) error.retryAfterMs = retryAfter * 1000;
                throw error;
            }
            return data;
        } catch (error) {
            lastError = error;
            const status = Number(error?.status || 0);
            const transient = status === 429 || status === 408 || status >= 500 ||
                /abort|timeout|timed out|fetch failed|network/i.test(String(error?.message || ""));
            if (!transient || attempt >= attempts) break;
            const retryAfter = Number(error?.retryAfterMs);
            await sleep(Number.isFinite(retryAfter) ? Math.min(15000, Math.max(1000, retryAfter)) : 1000 * attempt);
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError || new Error("Globalping request failed");
}

function chooseCities(probes, cityLimit, requireEyeball) {
    const byCity = new Map();
    for (const probe of Array.isArray(probes) ? probes : []) {
        const location = probe?.location || {};
        if (String(location.country || "").toUpperCase() !== "RU") continue;
        const city = String(location.city || "").trim();
        if (!city) continue;
        const key = normalizeLocationName(city);
        if (CORE_CITIES.has(key)) continue;
        const tags = new Set(Array.isArray(probe?.tags) ? probe.tags.map(tag => String(tag).trim().toLowerCase()) : []);
        const eyeball = tags.has("eyeball-network") && !tags.has("datacenter-network");
        if (requireEyeball && !eyeball) continue;
        const row = byCity.get(key) || { city, count: 0, eyeball: 0 };
        row.count += 1;
        if (eyeball) row.eyeball += 1;
        byCity.set(key, row);
    }

    const selected = [];
    const used = new Set();
    for (const preferred of DEFAULT_CITY_PREFERENCE) {
        const row = byCity.get(normalizeLocationName(preferred));
        if (!row || used.has(normalizeLocationName(row.city))) continue;
        selected.push(row);
        used.add(normalizeLocationName(row.city));
        if (selected.length >= cityLimit) break;
    }

    if (selected.length < cityLimit) {
        for (const row of [...byCity.values()].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))) {
            const key = normalizeLocationName(row.city);
            if (used.has(key)) continue;
            selected.push(row);
            used.add(key);
            if (selected.length >= cityLimit) break;
        }
    }
    return selected;
}

function buildMeasurementOptions(host, port) {
    return {
        protocol: "TCP",
        port,
        packets: 3,
        ...(net.isIP(host) === 0 ? { ipVersion: 4 } : {}),
    };
}

function reachedTarget(row, targetHost) {
    const result = row?.result || {};
    if (String(result.status || "").toLowerCase() !== "finished") return false;
    const target = String(result.resolvedAddress || targetHost || "").trim().toLowerCase();
    if (!target) return false;
    const raw = String(result.rawOutput || "");
    if (/destination host unreachable|network unreachable|no route to host/i.test(raw)) return false;

    const hops = Array.isArray(result.hops) ? result.hops : [];
    const finalHop = [...hops].reverse().find(hop => {
        const address = String(hop?.resolvedAddress || "").trim().toLowerCase();
        return address && (address === target || address === String(targetHost || "").trim().toLowerCase());
    });
    if (finalHop) {
        const loss = Number(finalHop?.stats?.loss);
        return !Number.isFinite(loss) || loss < 100;
    }

    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Boolean(escaped && new RegExp(escaped, "i").test(raw));
}

async function getLimits(apiBase, token, timeoutMs) {
    const data = await requestJson(
        `${apiBase}/limits`,
        token ? { headers: { authorization: `Bearer ${token}` } } : {},
        timeoutMs,
    );
    const create = data?.rateLimit?.measurements?.create || data?.rateLimits?.measurements?.create || {};
    const remaining = Number(create.remaining);
    const limit = Number(create.limit);
    const reset = Number(create.reset);
    return {
        remaining: Number.isFinite(remaining) ? remaining : null,
        limit: Number.isFinite(limit) ? limit : null,
        resetSeconds: Number.isFinite(reset) ? reset : null,
    };
}

async function getProbes(apiBase, token, timeoutMs) {
    const data = await requestJson(
        `${apiBase}/probes`,
        token ? { headers: { authorization: `Bearer ${token}` } } : {},
        timeoutMs,
    );
    return Array.isArray(data) ? data : (Array.isArray(data?.probes) ? data.probes : []);
}

async function runMeasurement(apiBase, token, endpoint, cities, timeoutMs, pollMs, mtrTimeoutSeconds) {
    const url = new URL(String(endpoint.link || "").trim());
    const host = url.hostname;
    const port = Number(url.port || 443);
    const locations = cities.map(city => ({
        country: "RU",
        city: city.city,
        tags: ["eyeball-network"],
        limit: 1,
    }));
    const body = {
        type: "mtr",
        target: host,
        timeout: mtrTimeoutSeconds,
        locations,
        measurementOptions: buildMeasurementOptions(host, port),
    };

    const created = await requestJson(
        `${apiBase}/measurements`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
        },
        timeoutMs,
    );
    const measurementId = String(created?.id || "").trim();
    if (!measurementId) throw new Error("Globalping response has no measurement id");

    const startedAt = Date.now();
    let data = null;
    while (Date.now() - startedAt <= timeoutMs) {
        await sleep(pollMs);
        data = await requestJson(
            `${apiBase}/measurements/${encodeURIComponent(measurementId)}`,
            token ? { headers: { authorization: `Bearer ${token}` } } : {},
            timeoutMs,
        );
        const status = String(data?.status || "").toLowerCase();
        if (status && !["pending", "in-progress", "running"].includes(status)) break;
    }

    const finalStatus = String(data?.status || "").toLowerCase();
    if (["", "pending", "in-progress", "running"].includes(finalStatus)) {
        return {
            verdict: "UNKNOWN-GLOBALPING",
            measurementId,
            error: `measurement ${measurementId} did not finish before timeout`,
            serviceFailure: true,
            cities: [],
            validReachedCities: 0,
        };
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    const cityRows = cities.map((requestedCity, index) => {
        const row = results[index] || {};
        const probe = row?.probe || {};
        const actualCity = String(probe.city || probe.location?.city || "").trim();
        const country = String(probe.country || probe.location?.country || "").toUpperCase();
        const tags = Array.isArray(probe.tags) ? probe.tags.map(String) : [];
        const normalizedTags = new Set(tags.map(tag => tag.trim().toLowerCase()));
        const cityMatches = normalizeLocationName(actualCity) === normalizeLocationName(requestedCity.city);
        const countryMatches = country === "RU";
        const eyeballMatches = normalizedTags.has("eyeball-network") && !normalizedTags.has("datacenter-network");
        const validProbe = cityMatches && countryMatches && eyeballMatches;
        const reached = reachedTarget(row, host);
        return {
            requestedCity: requestedCity.city,
            city: actualCity,
            country,
            network: probe.network || probe.location?.network || "",
            tags,
            status: String(row?.result?.status || data?.status || "unknown"),
            reachedTarget: reached,
            validProbe,
            validReached: validProbe && reached,
            resolvedAddress: row?.result?.resolvedAddress || "",
            finalHopLoss: Number([...((row?.result?.hops) || [])].at(-1)?.stats?.loss),
        };
    });

    const validReachedCities = new Set(
        cityRows.filter(row => row.validReached).map(row => normalizeLocationName(row.city)).filter(Boolean)
    ).size;

    const verdict = validReachedCities >= 2 ? "PASS-GLOBALPING" : "FAIL-GLOBALPING";
    return {
        verdict,
        measurementId,
        cities: cityRows,
        reachedCities: cityRows.filter(row => row.reachedTarget).length,
        validReachedCities,
        requiredDistinctCities: 2,
        serviceFailure: false,
        error: "",
    };
}

export async function runLteGlobalpingGate({
    healthResults = [],
    enabled = true,
    apiBase = "https://api.globalping.io/v1",
    token = "",
    cityLimit = 3,
    minDistinctCities = 2,
    requireEyeball = true,
    maxEndpoints = 164,
    reserveTests = 10,
    timeoutMs = 30000,
    pollMs = 700,
    mtrTimeoutSeconds = 12,
} = {}) {
    const normalizedCityLimit = Math.max(3, Math.min(6, Number(cityLimit) || 3));
    const requiredCities = Math.max(2, Math.min(normalizedCityLimit, Number(minDistinctCities) || 2));
    const beforeGlobalpingLinks = [...new Set(healthResults.filter(r => r?.whiteList && r?.ok).map(r => String(r.link || "").trim()).filter(Boolean))];
    const tcpResults = healthResults.filter(isEligibleLteTcp);
    const endpointGroups = new Map();
    for (const result of tcpResults) {
        try {
            const key = endpointKey(result.link);
            const group = endpointGroups.get(key) || { key, link: result.link, members: [] };
            group.members.push(result);
            endpointGroups.set(key, group);
        } catch {}
    }

    const empty = {
        generatedAt: new Date().toISOString(),
        provider: "globalping",
        purpose: "LTE-only post-Xray Russian transport gate",
        enabled: Boolean(enabled),
        selectedCities: [],
        cityCount: 0,
        requiredDistinctCities: requiredCities,
        beforeGlobalpingLinks,
        attemptedEndpoints: 0,
        passed2of3Endpoints: 0,
        passed3of3Endpoints: 0,
        failedEndpoints: 0,
        failOpen: true,
        serviceAvailable: false,
        skippedReason: "",
        endpoints: [],
    };

    if (!enabled || !tcpResults.length) {
        empty.skippedReason = !enabled ? "disabled" : "no-xray-passing-lte-tcp-links";
        return {
            attemptedEndpoints: 0,
            passed2of3Endpoints: 0,
            passed3of3Endpoints: 0,
            failOpen: true,
            serviceAvailable: false,
            cityCount: 0,
            excludedLinkFingerprints: new Set(),
            endpointByLinkFingerprint: {},
            beforeGlobalpingLinks,
            globalping2of3Links: beforeGlobalpingLinks,
            globalping3of3Links: [],
            finalPublishedLinks: beforeGlobalpingLinks,
            diagnostic: empty,
        };
    }

    let probes;
    let limits;
    try {
        probes = await getProbes(apiBase, token, timeoutMs);
        limits = await getLimits(apiBase, token, timeoutMs);
    } catch (error) {
        return {
            attemptedEndpoints: 0,
            passed2of3Endpoints: 0,
            passed3of3Endpoints: 0,
            failOpen: true,
            serviceAvailable: false,
            cityCount: 0,
            excludedLinkFingerprints: new Set(),
            endpointByLinkFingerprint: {},
            beforeGlobalpingLinks,
            globalping2of3Links: beforeGlobalpingLinks,
            globalping3of3Links: [],
            finalPublishedLinks: beforeGlobalpingLinks,
            diagnostic: { ...empty, skippedReason: `Globalping discovery/limits failed: ${error?.message || String(error)}` },
        };
    }

    const cityRows = chooseCities(probes, normalizedCityLimit, Boolean(requireEyeball));
    if (cityRows.length < normalizedCityLimit) {
        return {
            attemptedEndpoints: 0,
            passed2of3Endpoints: 0,
            passed3of3Endpoints: 0,
            failOpen: true,
            serviceAvailable: false,
            cityCount: cityRows.length,
            excludedLinkFingerprints: new Set(),
            endpointByLinkFingerprint: {},
            beforeGlobalpingLinks,
            globalping2of3Links: beforeGlobalpingLinks,
            globalping3of3Links: [],
            finalPublishedLinks: beforeGlobalpingLinks,
            diagnostic: { ...empty, selectedCities: cityRows, cityCount: cityRows.length, limits, skippedReason: `need-${normalizedCityLimit}-Russian eyeball cities, found-${cityRows.length}` },
        };
    }

    // The gate accepts 2/3, while 3/3 is retained as a stronger diagnostic tier.
    const perEndpointTests = normalizedCityLimit;
    const remaining = Number(limits?.remaining);
    const availableEndpoints = Number.isFinite(remaining)
        ? Math.floor(Math.max(0, remaining - Math.max(0, Number(reserveTests) || 0)) / perEndpointTests)
        : 0;
    if (!Number.isFinite(remaining) || availableEndpoints < 1) {
        return {
            attemptedEndpoints: 0,
            passed2of3Endpoints: 0,
            passed3of3Endpoints: 0,
            failOpen: true,
            serviceAvailable: false,
            cityCount: cityRows.length,
            excludedLinkFingerprints: new Set(),
            endpointByLinkFingerprint: {},
            beforeGlobalpingLinks,
            globalping2of3Links: beforeGlobalpingLinks,
            globalping3of3Links: [],
            finalPublishedLinks: beforeGlobalpingLinks,
            diagnostic: { ...empty, selectedCities: cityRows, cityCount: cityRows.length, limits, skippedReason: "Globalping budget unavailable or exhausted" },
        };
    }

    const targets = [...endpointGroups.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .slice(0, Math.min(maxEndpoints, availableEndpoints));

    const endpoints = [];
    const excludedLinkFingerprints = new Set();
    const endpointByLinkFingerprint = {};
    let serviceFailure = false;

    for (let index = 0; index < targets.length; index += 1) {
        const endpoint = targets[index];
        try {
            const result = await runMeasurement(apiBase, token, endpoint, cityRows, timeoutMs, pollMs, mtrTimeoutSeconds);
            endpoint.globalping = result;
            endpoints.push({ key: endpoint.key, ...result });
            for (const member of endpoint.members) endpointByLinkFingerprint[member.linkFingerprint] = { ...result, endpointKey: endpoint.key };
            if (result.verdict === "FAIL-GLOBALPING") {
                for (const member of endpoint.members) excludedLinkFingerprints.add(String(member.linkFingerprint || ""));
            }
            if (result.serviceFailure || result.verdict === "UNKNOWN-GLOBALPING") serviceFailure = true;
            console.log(`LTE GLOBALPING ${index + 1}/${targets.length}: ${endpoint.key} => ${result.verdict} (${result.validReachedCities || 0}/${normalizedCityLimit})`);
        } catch (error) {
            serviceFailure = true;
            const result = { verdict: "UNKNOWN-GLOBALPING", serviceFailure: true, error: error?.message || String(error), cities: [], validReachedCities: 0 };
            endpoints.push({ key: endpoint.key, ...result });
            for (const member of endpoint.members) endpointByLinkFingerprint[member.linkFingerprint] = { ...result, endpointKey: endpoint.key };
            console.warn(`LTE GLOBALPING ${index + 1}/${targets.length}: ${endpoint.key} => UNKNOWN (${result.error})`);
        }
    }

    // An unavailable service must never create an empty subscription. Real
    // measurement FAILs still filter that endpoint; UNKNOWN remains fail-open.
    const finalPublishedLinks = beforeGlobalpingLinks.filter(link => {
        try {
            const key = endpointKey(link);
            const endpoint = endpointGroups.get(key);
            if (!endpoint) return true;
            const result = endpoint.globalping;
            if (!result || result.verdict === "UNKNOWN-GLOBALPING") return true;
            if (result.verdict === "FAIL-GLOBALPING") return false;
            return result.validReachedCities >= requiredCities;
        } catch {
            return true;
        }
    });

    const globalping2of3Links = beforeGlobalpingLinks.filter(link => {
        try {
            const endpoint = endpointGroups.get(endpointKey(link));
            return Boolean(endpoint?.globalping) && Number(endpoint.globalping.validReachedCities) >= requiredCities;
        } catch {
            return false;
        }
    });

    const globalping3of3Links = beforeGlobalpingLinks.filter(link => {
        try {
            const endpoint = endpointGroups.get(endpointKey(link));
            return Boolean(endpoint?.globalping) && Number(endpoint.globalping.validReachedCities) >= normalizedCityLimit;
        } catch {
            return false;
        }
    });

    const passed2of3Endpoints = endpoints.filter(row => Number(row.validReachedCities) >= requiredCities).length;
    const passed3of3Endpoints = endpoints.filter(row => Number(row.validReachedCities) >= normalizedCityLimit).length;
    const failedEndpoints = endpoints.filter(row => row.verdict === "FAIL-GLOBALPING").length;

    return {
        attemptedEndpoints: endpoints.length,
        passed2of3Endpoints,
        passed3of3Endpoints,
        failOpen: serviceFailure || endpoints.length === 0,
        serviceAvailable: !serviceFailure,
        cityCount: normalizedCityLimit,
        excludedLinkFingerprints,
        endpointByLinkFingerprint,
        beforeGlobalpingLinks,
        globalping2of3Links,
        globalping3of3Links,
        finalPublishedLinks,
        diagnostic: {
            ...empty,
            enabled: true,
            selectedCities: cityRows,
            cityCount: normalizedCityLimit,
            requiredDistinctCities: requiredCities,
            limits,
            attemptedEndpoints: endpoints.length,
            passed2of3Endpoints,
            passed3of3Endpoints,
            failedEndpoints,
            failOpen: serviceFailure || endpoints.length === 0,
            serviceAvailable: !serviceFailure,
            endpoints,
        },
    };
}
