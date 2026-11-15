# VPN source report

Последнее обновление: 2026-11-15T20:19:22.900Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **13** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 1517 | 19 | 11 | ✅ |
| **SOURCE_URL16_2** | keylineservices.top/G1231Mb_UJlDqkyCubrtWdMcuc-YcvWO | 2 | 8 | 2 | 2 | ✅ |
| **SOURCE_URL9_4** | keylineservices.top/hq6Fk_tyij5kg2Xhb67t8kCrfrigjug1 | 4 | 13 | 0 | 0 | ⚠️ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 0 | 0 | 0 | ⚠️ |
| **SOURCE_URL5_6** | keylineservices.top/C7xwkp_3uLj0mcXO1b6D6BBojSvCOvpH | 6 | 17 | 0 | 0 | ⚠️ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 130 | 2 | 0 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 112 | 2 | 0 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 156 | 8 | 8 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 126 | 8 | 8 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 0 | 0 | 0 | ⚠️ |

## 🇷🇺 Russia Gate

**Режим:** неизвестно.
**Предупреждение:** ⚠️ ru1+ru2 Check-Host unavailable; strict Globalping 3/3 fallback was applied.
Проверено кандидатов: **1570**; прошли: **190**; отброшены: **1380**; pending: **0**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| — | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
