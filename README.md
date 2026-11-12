# VPN source report

Последнее обновление: 2026-11-12T00:09:49.517Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **54** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 1640 | 644 | 27 | ✅ |
| **SOURCE_URL16_2** | keylineservices.top/7C3Bc_VExUbbbcfCjFbll3mm0BDEiRcw | 2 | 1 | 0 | 0 | ⚠️ |
| **SOURCE_URL9_4** | keylineservices.top/-_C7D4CtOEldpLrtnUCHD_gWiAgou_Co | 4 | 13 | 9 | 4 | ✅ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 0 | 0 | 0 | ⚠️ |
| **SOURCE_URL5_6** | keylineservices.top/nxMTAOpyGAGi3xV51ApOwd4eUZhGkwvB | 6 | 17 | 8 | 2 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 164 | 57 | 1 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 128 | 20 | 2 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 112 | 16 | 16 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 139 | 37 | 37 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 0 | 0 | 0 | ⚠️ |

## 🇷🇺 Russia Gate

**Режим:** 2 независимые точки.
**Предупреждение:** ⚠️ Only two Check-Host nodes were available; both had to pass.
Проверено кандидатов: **1741**; прошли: **1210**; отброшены: **509**; pending: **22**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| ru1.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru2.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
