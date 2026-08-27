# VPN source report

Этот файл обновляется после каждого успешного health-check.

Статистика по каждому источнику: **взяли → живы → в итоговом пуле**.

| № | Источник | Взяли | Живы | В итоговом пуле | Состояние |
|---:|---|---:|---:|---:|---|
| 1–20 | Обычные источники | — | — | — | — |
| 21–40 | Whitelist-источники | — | — | — | — |

## Раскладка источников

`SOURCE_URL_1` … `SOURCE_URL_20` — обычные источники.

`SOURCE_URL_21` … `SOURCE_URL_40` — whitelist-источники.

`SOURCE_URL_N` можно использовать как для GitHub/raw-ссылки, так и для keyline/subscription URL. Для обратной совместимости старые `KEYLINE_URL_N` остаются fallback, если соответствующий `SOURCE_URL_N` не задан.

Известные дополнительные источники:

15 — igareck/vpn-configs-for-russia — `BLACK_VLESS_RUS_mobile.txt`.

16 — Baarcuda/vpn-configs — `top100.txt`.

17 — mehrtat/vless-collector — `sub.txt`.

18 — morpheusadam/v2ray-config — `subs/bundles/best.txt`.

21 — igareck/vpn-configs-for-russia — `Vless-Reality-White-Lists-Rus-Mobile.txt`.

22 — igareck/vpn-configs-for-russia — `Vless-Reality-White-Lists-Rus-Mobile-2.txt`.

23 — igareck/vpn-configs-for-russia — `WHITE-SNI-RU-all.txt`.

24 — igareck/vpn-configs-for-russia — `WHITE-CIDR-RU-checked.txt`.

25 — igareck/vpn-configs-for-russia — `WHITE-CIDR-RU-all.txt`.

26 — zieng2/wl — `vless_universal.txt`.

Публичные URL источников не хранятся в коде репозитория.
