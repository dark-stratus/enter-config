/**
 * Canonical country metadata shared by source parsing and health/output stages.
 *
 * `country` is the normalized identity used internally. The flag is derived
 * from that identity, never carried independently through the pipeline.
 */

export const COUNTRY_BY_FLAG = Object.freeze({
    "🇦🇱": "Albania",
    "🇦🇹": "Austria",
    "🇦🇪": "United Arab Emirates",
    "🇧🇾": "Belarus",
    "🇧🇪": "Belgium",
    "🇧🇷": "Brazil",
    "🇧🇬": "Bulgaria",
    "🇨🇦": "Canada",
    "🇨🇭": "Switzerland",
    "🇨🇳": "China",
    "🇭🇷": "Croatia",
    "🇨🇾": "Cyprus",
    "🇨🇿": "Czech Republic",
    "🇩🇪": "Germany",
    "🇩🇰": "Denmark",
    "🇪🇪": "Estonia",
    "🇪🇸": "Spain",
    "🇫🇮": "Finland",
    "🇫🇷": "France",
    "🇬🇧": "United Kingdom",
    "🇬🇷": "Greece",
    "🇬🇪": "Georgia",
    "🇭🇺": "Hungary",
    "🇭🇰": "Hong Kong",
    "🇮🇩": "Indonesia",
    "🇮🇪": "Ireland",
    "🇮🇳": "India",
    "🇮🇱": "Israel",
    "🇮🇹": "Italy",
    "🇯🇵": "Japan",
    "🇰🇿": "Kazakhstan",
    "🇱🇹": "Lithuania",
    "🇱🇻": "Latvia",
    "🇲🇽": "Mexico",
    "🇳🇱": "Netherlands",
    "🇳🇴": "Norway",
    "🇳🇿": "New Zealand",
    "🇵🇱": "Poland",
    "🇵🇹": "Portugal",
    "🇷🇴": "Romania",
    "🇷🇺": "Russia",
    "🇷🇸": "Serbia",
    "🇸🇪": "Sweden",
    "🇸🇬": "Singapore",
    "🇸🇮": "Slovenia",
    "🇸🇰": "Slovakia",
    "🇹🇭": "Thailand",
    "🇹🇷": "Turkey",
    "🇺🇦": "Ukraine",
    "🇺🇸": "United States",
    "🇻🇳": "Vietnam",
    "🇪🇺": "Europe",
});

export const FLAG_BY_COUNTRY = Object.freeze(
    Object.fromEntries(
        Object.entries(COUNTRY_BY_FLAG).map(([flag, country]) => [
            country,
            flag,
        ])
    )
);

export const COUNTRY_ALIASES = Object.freeze({
    "albania": "Albania",
    "албания": "Albania",
    "austria": "Austria",
    "австрия": "Austria",
    "united arab emirates": "United Arab Emirates",
    "uae": "United Arab Emirates",
    "оаэ": "United Arab Emirates",
    "объединенные арабские эмираты": "United Arab Emirates",
    "объединённые арабские эмираты": "United Arab Emirates",
    "эмираты": "United Arab Emirates",
    "belarus": "Belarus",
    "беларусь": "Belarus",
    "белоруссия": "Belarus",
    "belgium": "Belgium",
    "бельгия": "Belgium",
    "brazil": "Brazil",
    "бразилия": "Brazil",
    "bulgaria": "Bulgaria",
    "болгария": "Bulgaria",
    "canada": "Canada",
    "канада": "Canada",
    "switzerland": "Switzerland",
    "швейцария": "Switzerland",
    "china": "China",
    "китай": "China",
    "croatia": "Croatia",
    "хорватия": "Croatia",
    "cyprus": "Cyprus",
    "кипр": "Cyprus",
    "czech republic": "Czech Republic",
    "чехия": "Czech Republic",
    "чешская республика": "Czech Republic",
    "germany": "Germany",
    "германия": "Germany",
    "немец": "Germany",
    "denmark": "Denmark",
    "дания": "Denmark",
    "estonia": "Estonia",
    "эстония": "Estonia",
    "spain": "Spain",
    "испания": "Spain",
    "finland": "Finland",
    "финляндия": "Finland",
    "france": "France",
    "франция": "France",
    "united kingdom": "United Kingdom",
    "великобритания": "United Kingdom",
    "англия": "United Kingdom",
    "ук": "United Kingdom",
    "greece": "Greece",
    "греция": "Greece",
    "georgia": "Georgia",
    "грузия": "Georgia",
    "hungary": "Hungary",
    "венгрия": "Hungary",
    "hong kong": "Hong Kong",
    "гонконг": "Hong Kong",
    "indonesia": "Indonesia",
    "индонезия": "Indonesia",
    "ireland": "Ireland",
    "ирландия": "Ireland",
    "india": "India",
    "индия": "India",
    "israel": "Israel",
    "израиль": "Israel",
    "italy": "Italy",
    "италия": "Italy",
    "japan": "Japan",
    "япония": "Japan",
    "kazakhstan": "Kazakhstan",
    "казахстан": "Kazakhstan",
    "lithuania": "Lithuania",
    "литва": "Lithuania",
    "latvia": "Latvia",
    "латвия": "Latvia",
    "mexico": "Mexico",
    "мексика": "Mexico",
    "netherlands": "Netherlands",
    "the netherlands": "Netherlands",
    "нидерланды": "Netherlands",
    "нидерланд": "Netherlands",
    "голландия": "Netherlands",
    "голланд": "Netherlands",
    "norway": "Norway",
    "норвегия": "Norway",
    "new zealand": "New Zealand",
    "новая зеландия": "New Zealand",
    "poland": "Poland",
    "польша": "Poland",
    "portugal": "Portugal",
    "португалия": "Portugal",
    "romania": "Romania",
    "румыния": "Romania",
    "russia": "Russia",
    "russian federation": "Russia",
    "россия": "Russia",
    "рф": "Russia",
    "российская федерация": "Russia",
    "serbia": "Serbia",
    "сербия": "Serbia",
    "sweden": "Sweden",
    "швеция": "Sweden",
    "singapore": "Singapore",
    "сингапур": "Singapore",
    "slovenia": "Slovenia",
    "словения": "Slovenia",
    "slovakia": "Slovakia",
    "словакия": "Slovakia",
    "thailand": "Thailand",
    "таиланд": "Thailand",
    "тайланд": "Thailand",
    "turkey": "Turkey",
    "турция": "Turkey",
    "ukraine": "Ukraine",
    "украина": "Ukraine",
    "united states": "United States",
    "сша": "United States",
    "соединенные штаты": "United States",
    "соединённые штаты": "United States",
    "vietnam": "Vietnam",
    "вьетнам": "Vietnam",
    "europe": "Europe",
    "европа": "Europe",
});

const COUNTRY_TEXT_PATTERNS = Object.entries(COUNTRY_BY_FLAG)
    .map(([flag, country]) => ({
        flag,
        country,
        text: country,
    }))
    .concat(
        Object.entries(COUNTRY_ALIASES).map(([alias, country]) => ({
            flag: FLAG_BY_COUNTRY[country] || "",
            country,
            text: alias,
        }))
    )
    .sort((a, b) => b.text.length - a.text.length);

function escapeRegExp(value = "") {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COUNTRY_TEXT_BOUNDARY = "[\\s\\[\\]().,:;_\\-/]";
const COUNTRY_TEXT_REGEXP = COUNTRY_TEXT_PATTERNS.map(entry => ({
    ...entry,
    pattern: new RegExp(
        `(^|${COUNTRY_TEXT_BOUNDARY})${escapeRegExp(entry.text)}(?=$|${COUNTRY_TEXT_BOUNDARY})`,
        "iu"
    ),
}));

export function countryFromText(
    value = "",
    { allowFlag = true } = {}
) {
    const text = String(value ?? "").trim();
    if (!text) return "";

    for (const entry of COUNTRY_TEXT_REGEXP) {
        if (entry.pattern.test(text)) return entry.country;
    }

    if (allowFlag) {
        const flag = flagFromText(text);
        if (flag) return countryFromFlagValue(flag);
    }

    return "";
}

export function normalizeCountryName(value = "") {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    const cleaned = raw
        .replace(/\|.*$/u, "")
        .replace(/\bGAMING\b.*$/iu, "")
        .replace(/\s+/gu, " ")
        .trim();

    if (!cleaned) return "";

    const canonical = Object.values(COUNTRY_BY_FLAG).find(
        country => country.toLowerCase() === cleaned.toLowerCase()
    );
    if (canonical) return canonical;

    return COUNTRY_ALIASES[cleaned.toLowerCase()] || cleaned;
}

export function flagForCountry(value = "") {
    const country = normalizeCountryName(value);
    return FLAG_BY_COUNTRY[country] || "";
}

export function flagToIso(flag = "") {
    const chars = [...String(flag || "")];
    if (chars.length !== 2) return "";
    if (!chars.every(char => {
        const code = char.codePointAt(0);
        return code >= 0x1f1e6 && code <= 0x1f1ff;
    })) return "";

    return chars
        .map(char => String.fromCharCode(char.codePointAt(0) - 0x1f1e6 + 65))
        .join("");
}

export function countryFromFlagValue(flag = "") {
    const normalizedFlag = String(flag || "").match(
        /[\u{1F1E6}-\u{1F1FF}]{2}/u
    )?.[0] || "";
    if (!normalizedFlag) return "";

    if (COUNTRY_BY_FLAG[normalizedFlag]) {
        return COUNTRY_BY_FLAG[normalizedFlag];
    }

    try {
        return new Intl.DisplayNames(["en"], { type: "region" }).of(
            flagToIso(normalizedFlag)
        ) || "";
    } catch {
        return "";
    }
}

export function flagFromText(value = "") {
    return String(value || "").match(
        /[\u{1F1E6}-\u{1F1FF}]{2}/u
    )?.[0] || "";
}
