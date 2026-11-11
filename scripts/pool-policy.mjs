/**
 * Shared publication policy for ordinary VPN locations.
 *
 * Keep country allow-list/order and featured target calculation in one place.
 * LTE/whitelist candidates intentionally do not use the ordinary country cap.
 */

export const REGULAR_COUNTRY_ORDER = Object.freeze([
    "Netherlands",
    "United Kingdom",
    "United States",
    "Canada",
    "France",
    "Switzerland",
    "Sweden",
    "Finland",
    "Poland",
    "Russia",
    "Austria",
    "Italy",
    "Hungary",
    "Bulgaria",
    "Georgia",
    // Germany is retained in the generated health catalogue exclusively as a
    // fallback pool for an unavailable Escape-managed Germany ⭐ node.
    "Germany",
]);

export const FALLBACK_ONLY_COUNTRIES = new Set(["germany"]);

export const ALLOWED_REGULAR_COUNTRIES = new Set(
    REGULAR_COUNTRY_ORDER.map(country => country.toLowerCase())
);

export const REGULAR_COUNTRY_RANK = new Map(
    REGULAR_COUNTRY_ORDER.map((country, index) => [
        country.toLowerCase(),
        index,
    ])
);

/**
 * Featured Fast/Gaming candidates use visible ordinary countries except Russia.
 * Russia remains visible but is never Fast/Gaming; fallback-only Germany is
 * retained for recovery and is never featured. Europe is a separate location.
 */
export const FEATURED_COUNTRY_ORDER = Object.freeze(
    REGULAR_COUNTRY_ORDER.filter(country => {
        const key = String(country).trim().toLowerCase();
        return key !== "russia" && !FALLBACK_ONLY_COUNTRIES.has(key);
    })
);
export const FEATURED_COUNTRIES = new Set(
    FEATURED_COUNTRY_ORDER.map(country => country.toLowerCase())
);

export const MAX_SERVERS_PER_REGULAR_COUNTRY = 3;

export function isAllowedRegularCountry(country = "") {
    return ALLOWED_REGULAR_COUNTRIES.has(
        String(country || "").trim().toLowerCase()
    );
}

export function calculateFeaturedTargetCounts(visibleLocationCount) {
    const count = Math.max(
        0,
        Number(visibleLocationCount) || 0
    );

    if (count > 15) {
        return {
            total: 6,
            fast: 3,
            gaming: 3,
        };
    }

    if (count > 10) {
        return {
            total: 4,
            fast: 2,
            gaming: 2,
        };
    }

    if (count > 5) {
        return {
            total: 2,
            fast: 1,
            gaming: 1,
        };
    }

    return {
        total: 0,
        fast: 0,
        gaming: 0,
    };
}
