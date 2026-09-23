/**
 * Shared publication policy for ordinary VPN locations.
 *
 * Keep country allow-list/order and featured target calculation in one place.
 * LTE/whitelist candidates intentionally do not use the ordinary country cap.
 */

export const REGULAR_COUNTRY_ORDER = Object.freeze([
    "Germany",
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
]);

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
 * Featured Fast/Gaming candidates are selected from the same ordinary-country
 * pool. Europe is a separate permanent/manual location.
 */
export const FEATURED_COUNTRY_ORDER = REGULAR_COUNTRY_ORDER;
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
