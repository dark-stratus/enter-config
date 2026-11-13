# VPN source report

Последнее обновление: 2026-11-13T03:25:08.124Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **58** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 1826 | 751 | 26 | ✅ |
| **SOURCE_URL16_2** | keylineservices.top/G1231Mb_UJlDqkyCubrtWdMcuc-YcvWO | 2 | 10 | 7 | 3 | ✅ |
| **SOURCE_URL9_4** | keylineservices.top/hq6Fk_tyij5kg2Xhb67t8kCrfrigjug1 | 4 | 13 | 10 | 2 | ✅ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 0 | 0 | 0 | ⚠️ |
| **SOURCE_URL5_6** | keylineservices.top/C7xwkp_3uLj0mcXO1b6D6BBojSvCOvpH | 6 | 16 | 9 | 5 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 180 | 90 | 0 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 150 | 85 | 1 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 112 | 15 | 15 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 98 | 32 | 32 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 9 | 9 | 9 | ✅ |

## 🇷🇺 Russia Gate

**Режим:** 2 независимые точки.
**Предупреждение:** Both ru1 and ru2 were available; accepted candidates passed 2/2.
Проверено кандидатов: **1946**; прошли: **1462**; отброшены: **484**; pending: **0**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| ru1.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru2.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
