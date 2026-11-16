import test from "node:test";
import assert from "node:assert/strict";
import { chooseLteGateCities, chooseRussiaGateCities, classifyRussiaGlobalpingVotes } from "./lte-globalping-gate.mjs";

test("Russia Globalping chooses live eyeball cities by available probe count, not fixed names", () => {
    const probes = [
        ...Array.from({ length: 3 }, () => ({ status: "online", location: { country: "RU", city: "Ufa" }, tags: ["eyeball-network"] })),
        ...Array.from({ length: 2 }, () => ({ status: "online", location: { country: "RU", city: "Perm" }, tags: ["eyeball-network"] })),
        { status: "online", location: { country: "RU", city: "Tyumen" }, tags: ["eyeball-network"] },
        ...Array.from({ length: 8 }, () => ({ status: "offline", location: { country: "RU", city: "Kazan" }, tags: ["eyeball-network"] })),
    ];
    const cities = chooseRussiaGateCities(probes);
    assert.deepEqual(cities.map(row => row.city), ["Ufa", "Perm", "Tyumen"]);
    assert.ok(cities.every(row => row.requireEyeball));
});

test("Russia Globalping fills missing eyeball slots from any live Russian city", () => {
    const probes = [
        { status: "online", location: { country: "RU", city: "Kazan" }, tags: ["eyeball-network"] },
        { status: "online", location: { country: "RU", city: "Ufa" }, tags: ["eyeball-network"] },
        { status: "online", location: { country: "RU", city: "Voronezh" }, tags: ["datacenter-network"] },
        { status: "offline", location: { country: "RU", city: "Perm" }, tags: ["eyeball-network"] },
    ];
    const cities = chooseRussiaGateCities(probes);
    assert.equal(cities.length, 3);
    assert.deepEqual(cities.map(row => row.requireEyeball), [true, true, false]);
    assert.equal(cities[2].city, "Voronezh");
});

test("Globalping passes with two positive votes even when the third location is missing", () => {
    const result = classifyRussiaGlobalpingVotes([
        { requestedCity: "Ufa", validCompleted: true, validReached: true },
        { requestedCity: "Perm", validCompleted: true, validReached: true },
        { requestedCity: "Tyumen", validCompleted: false, validReached: false },
    ]);
    assert.equal(result.verdict, "PASS-GLOBALPING");
    assert.equal(result.validReachedCities, 2);
    assert.equal(result.serviceFailure, false);
});

test("Globalping is unknown when fewer than two locations returned definitive results", () => {
    const result = classifyRussiaGlobalpingVotes([
        { requestedCity: "Ufa", validCompleted: true, validReached: true },
        { requestedCity: "Perm", validCompleted: false, validReached: false },
        { requestedCity: "Tyumen", validCompleted: false, validReached: false },
    ]);
    assert.equal(result.verdict, "UNKNOWN-GLOBALPING");
    assert.equal(result.validCompletedCities, 1);
});


test("Russia Globalping uses three fallback candidates when live inventory is unavailable", () => {
    const cities = chooseRussiaGateCities([]);
    assert.equal(cities.length, 3);
    assert.ok(cities.every(row => row.requireEyeball === false));
    assert.ok(cities.every(row => row.selectionSource === "fallback-candidate"));
});

test("Globalping fallback publishes a successful endpoint on a 2-of-3 live vote", async t => {
    const originalFetch = globalThis.fetch;
    const requestedLocations = [];
    const jsonResponse = value => new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
    });

    globalThis.fetch = async (input, options = {}) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/limits")) {
            return jsonResponse({ rateLimit: { measurements: { create: { remaining: 3, limit: 100, reset: 60 } } } });
        }
        if (url.pathname.endsWith("/probes")) return jsonResponse([]);
        if (url.pathname.endsWith("/measurements") && options.method === "POST") {
            const body = JSON.parse(options.body);
            requestedLocations.push(...body.locations);
            return jsonResponse({ id: "russia-gate-test-measurement" });
        }
        if (url.pathname.endsWith("/measurements/russia-gate-test-measurement")) {
            const positive = city => ({
                probe: { country: "RU", city },
                result: {
                    status: "finished",
                    resolvedAddress: "198.51.100.10",
                    hops: [{ resolvedAddress: "198.51.100.10", stats: { loss: 0 } }],
                },
            });
            return jsonResponse({
                status: "finished",
                results: [positive("Ufa"), positive("Samara")],
            });
        }
        throw new Error(`Unexpected Globalping test request: ${options.method || "GET"} ${url}`);
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const { endpointResults, diagnostic } = await (await import("./lte-globalping-gate.mjs")).runGlobalpingStrictFallback({
        endpoints: [{ key: "tcp|vpn.example.net|443", link: "tcp://vpn.example.net:443", transport: "tcp" }],
        token: "test-token",
        apiBase: "https://globalping.test/v1",
        reserveTests: 0,
        timeoutMs: 1000,
        pollMs: 0,
        mtrTimeoutSeconds: 1,
    });

    assert.equal(requestedLocations.length, 3);
    assert.equal(endpointResults["tcp|vpn.example.net|443"].verdict, "PASS-GLOBALPING");
    assert.equal(endpointResults["tcp|vpn.example.net|443"].validReachedCities, 2);
    assert.equal(endpointResults["tcp|vpn.example.net|443"].validCompletedCities, 2);
    assert.equal(diagnostic.passedEndpoints, 1);
    assert.equal(diagnostic.unknownEndpoints, 0);
});


test("LTE Globalping also ranks currently online Russian cities dynamically", () => {
    const probes = [
        ...Array.from({ length: 3 }, () => ({ status: "online", location: { country: "RU", city: "Ufa" }, tags: ["eyeball-network"] })),
        ...Array.from({ length: 2 }, () => ({ status: "online", location: { country: "RU", city: "Perm" }, tags: ["eyeball-network"] })),
        { status: "online", location: { country: "RU", city: "Tyumen" }, tags: ["eyeball-network"] },
        ...Array.from({ length: 9 }, () => ({ status: "offline", location: { country: "RU", city: "Kazan" }, tags: ["eyeball-network"] })),
    ];
    const cities = chooseLteGateCities(probes, 3, true);
    assert.deepEqual(cities.map(row => row.city), ["Ufa", "Perm", "Tyumen"]);
    assert.ok(cities.every(row => row.requireEyeball));
});

test("LTE Globalping fills from online non-eyeball cities and ignores offline probes", () => {
    const probes = [
        { status: "online", location: { country: "RU", city: "Ufa" }, tags: ["eyeball-network"] },
        { status: "online", location: { country: "RU", city: "Perm" }, tags: ["eyeball-network"] },
        { status: "online", location: { country: "RU", city: "Voronezh" }, tags: ["datacenter-network"] },
        { status: "offline", location: { country: "RU", city: "Tyumen" }, tags: ["eyeball-network"] },
    ];
    const cities = chooseLteGateCities(probes, 3, true);
    assert.equal(cities.length, 3);
    assert.deepEqual(cities.map(row => row.requireEyeball), [true, true, false]);
    assert.equal(cities[2].city, "Voronezh");
});

test("LTE Globalping uses fallback Russian locations when probe inventory is missing", () => {
    const cities = chooseLteGateCities([], 3, true);
    assert.equal(cities.length, 3);
    assert.ok(cities.every(row => row.requireEyeball === false));
    assert.ok(cities.every(row => row.selectionSource === "fallback-candidate"));
});

test("LTE Globalping falls back to three candidate locations when /probes is unavailable", async t => {
    const originalFetch = globalThis.fetch;
    const requestedLocations = [];
    const jsonResponse = (value, status = 200) => new Response(
        typeof value === "string" ? value : JSON.stringify(value),
        { status, headers: { "content-type": "application/json" } },
    );
    globalThis.fetch = async (input, options = {}) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/limits")) {
            return jsonResponse({ rateLimit: { measurements: { create: { remaining: 20, limit: 100, reset: 60 } } } });
        }
        if (url.pathname.endsWith("/probes")) return jsonResponse({ error: "probe inventory unavailable" }, 503);
        if (url.pathname.endsWith("/measurements") && options.method === "POST") {
            const body = JSON.parse(options.body);
            requestedLocations.push(...body.locations);
            return jsonResponse({ id: "lte-fallback-test-measurement" });
        }
        if (url.pathname.endsWith("/measurements/lte-fallback-test-measurement")) {
            const positive = city => ({
                probe: { country: "RU", city },
                result: {
                    status: "finished",
                    resolvedAddress: "198.51.100.10",
                    hops: [{ resolvedAddress: "198.51.100.10", stats: { loss: 0 } }],
                },
            });
            return jsonResponse({
                status: "finished",
                results: [positive("Ufa"), positive("Samara")],
            });
        }
        throw new Error(`Unexpected LTE Globalping test request: ${options.method || "GET"} ${url}`);
    };
    t.after(() => { globalThis.fetch = originalFetch; });

    const { finalPublishedLinks, diagnostic } = await (await import("./lte-globalping-gate.mjs")).runLteGlobalpingGate({
        healthResults: [{
            id: "lte-candidate",
            link: "tcp://vpn.example.net:443",
            protocol: "vless",
            whiteList: true,
            ok: true,
        }],
        token: "test-token",
        apiBase: "https://globalping.test/v1",
        reserveTests: 0,
        timeoutMs: 1000,
        pollMs: 0,
        mtrTimeoutSeconds: 1,
    });

    assert.deepEqual(requestedLocations.map(row => row.city), ["Ufa", "Samara", "Perm"]);
    assert.deepEqual(finalPublishedLinks, ["tcp://vpn.example.net:443"]);
    assert.equal(diagnostic.selectionMode, "fallback-candidate-locations-no-complete-live-inventory");
    assert.match(diagnostic.probeDiscoveryError, /HTTP 503/);
    assert.equal(diagnostic.passed2of3Endpoints, 1);
});
