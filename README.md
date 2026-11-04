# VPN source report

Последнее обновление: 2026-11-04T00:25:13.749Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **65** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 1516 | 333 | 20 | ✅ |
| **SOURCE_URL16_2** | keylineservices.top/7C3Bc_VExUbbbcfCjFbll3mm0BDEiRcw | 2 | 11 | 4 | 2 | ✅ |
| **SOURCE_URL9_4** | keylineservices.top/-_C7D4CtOEldpLrtnUCHD_gWiAgou_Co | 4 | 12 | 4 | 1 | ✅ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 0 | 0 | 0 | ⚠️ |
| **SOURCE_URL5_6** | keylineservices.top/nxMTAOpyGAGi3xV51ApOwd4eUZhGkwvB | 6 | 17 | 5 | 4 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 111 | 15 | 2 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 144 | 7 | 2 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 84 | 14 | 14 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 95 | 17 | 17 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 7 | 0 | 0 | ⚠️ |

## 🇷🇺 Russia Gate

**Режим:** 2 независимые точки.
Проверено кандидатов: **1289**; прошли: **693**; отброшены: **564**; pending: **32**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| ru1.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru2.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
