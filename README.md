# VPN source report

Этот файл обновляется после каждого успешного health-check.

Статистика ведётся **для каждого источника отдельно**: **взяли → живы → в итоговом пуле**.

## Обычные источники

| Источник | Взяли | Живы | В итоговом пуле | Состояние |
|---|---:|---:|---:|---|
| SOURCE_URL_1 | — | — | — | — |
| SOURCE_URL_2 | — | — | — | — |
| SOURCE_URL_3 | — | — | — | — |
| SOURCE_URL_4 | — | — | — | — |
| SOURCE_URL_5 | — | — | — | — |
| SOURCE_URL_6 | — | — | — | — |
| SOURCE_URL_7 | — | — | — | — |
| SOURCE_URL_8 | — | — | — | — |
| SOURCE_URL_9 | — | — | — | — |
| SOURCE_URL_10 | — | — | — | — |
| SOURCE_URL_11 | — | — | — | — |
| SOURCE_URL_12 | — | — | — | — |
| SOURCE_URL_13 | — | — | — | — |
| SOURCE_URL_14 | — | — | — | — |
| SOURCE_URL_15 — igareck/vpn-configs-for-russia — `BLACK_VLESS_RUS_mobile.txt` | — | — | — | — |
| SOURCE_URL_16 — Baarcuda/vpn-configs — `top100.txt` | — | — | — | — |
| SOURCE_URL_17 — mehrtat/vless-collector — `sub.txt` | — | — | — | — |
| SOURCE_URL_18 — morpheusadam/v2ray-config — `subs/bundles/best.txt` | — | — | — | — |
| SOURCE_URL_19 | — | — | — | — |
| SOURCE_URL_20 | — | — | — | — |

## Whitelist

| Источник | Взяли | Живы | В итоговом пуле | Состояние |
|---|---:|---:|---:|---|
| SOURCE_URL_21 — igareck/vpn-configs-for-russia — `Vless-Reality-White-Lists-Rus-Mobile.txt` | — | — | — | — |
| SOURCE_URL_22 — igareck/vpn-configs-for-russia — `Vless-Reality-White-Lists-Rus-Mobile-2.txt` | — | — | — | — |
| SOURCE_URL_23 — igareck/vpn-configs-for-russia — `WHITE-SNI-RU-all.txt` | — | — | — | — |
| SOURCE_URL_24 — igareck/vpn-configs-for-russia — `WHITE-CIDR-RU-checked.txt` | — | — | — | — |
| SOURCE_URL_25 — igareck/vpn-configs-for-russia — `WHITE-CIDR-RU-all.txt` | — | — | — | — |
| SOURCE_URL_26 — zieng2/wl — `vless_universal.txt` | — | — | — | — |
| SOURCE_URL_27 | — | — | — | — |
| SOURCE_URL_28 | — | — | — | — |
| SOURCE_URL_29 | — | — | — | — |
| SOURCE_URL_30 | — | — | — | — |
| SOURCE_URL_31 | — | — | — | — |
| SOURCE_URL_32 | — | — | — | — |
| SOURCE_URL_33 | — | — | — | — |
| SOURCE_URL_34 | — | — | — | — |
| SOURCE_URL_35 | — | — | — | — |
| SOURCE_URL_36 | — | — | — | — |
| SOURCE_URL_37 | — | — | — | — |
| SOURCE_URL_38 | — | — | — | — |
| SOURCE_URL_39 | — | — | — | — |
| SOURCE_URL_40 | — | — | — | — |

### Схема

- **SOURCE_URL_1–20** — обычные источники.
- **SOURCE_URL_21–40** — whitelist-источники.
- Один secret может содержать одну ссылку или несколько ссылок, разделённых переводом строки, запятой или `;`.
- URL и значения секретов не публикуются в README. Для известных источников рядом со слотом указаны автор, репозиторий и файл.
- Старые `KEYLINE_URL_N` используются только как fallback, когда соответствующий `SOURCE_URL_N` не задан.
