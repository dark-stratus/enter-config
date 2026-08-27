# VPN source report

Этот файл обновляется после каждого успешного health-check.

Статистика по каждому источнику: **взяли → живы → в итоговом пуле**.

## Источники

| Слот | Источник | Назначение |
|---:|---|---|
| 1–14 | Существующие источники проекта | Обычный пул |
| 15 | igareck/vpn-configs-for-russia — `BLACK_VLESS_RUS_mobile.txt` | Быстрый VLESS/mobile pool |
| 16 | Baarcuda/vpn-configs — `top100.txt` | Top 100 по latency |
| 17 | mehrtat/vless-collector — `sub.txt` | xray-tested VLESS |
| 18 | morpheusadam/v2ray-config — `subs/bundles/best.txt` | Измеренный best bundle |
| 19 | igareck — `Vless-Reality-White-Lists-Rus-Mobile.txt` | Whitelist |
| 20 | igareck — `Vless-Reality-White-Lists-Rus-Mobile-2.txt` | Whitelist |
| 21 | igareck — `WHITE-SNI-RU-all.txt` | Whitelist |
| 22 | igareck — `WHITE-CIDR-RU-checked.txt` | Whitelist |
| 23 | igareck — `WHITE-CIDR-RU-all.txt` | Whitelist |
| 24 | zieng2/wl — `vless_universal.txt` | Whitelist |

### Secrets

`SOURCE_URL_1` … `SOURCE_URL_18` — обычные источники.
`SOURCE_URL_19` … `SOURCE_URL_24` — whitelist-источники.

Публичные URL источников не хранятся в коде репозитория.
