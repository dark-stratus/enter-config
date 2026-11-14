# VPN source report

Последнее обновление: 2026-11-14T01:05:42.100Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **71** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 1779 | 618 | 24 | ✅ |
| **SOURCE_URL16_2** | keylineservices.top/G1231Mb_UJlDqkyCubrtWdMcuc-YcvWO | 2 | 10 | 7 | 2 | ✅ |
| **SOURCE_URL9_4** | keylineservices.top/hq6Fk_tyij5kg2Xhb67t8kCrfrigjug1 | 4 | 13 | 9 | 4 | ✅ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 0 | 0 | 0 | ⚠️ |
| **SOURCE_URL5_6** | keylineservices.top/C7xwkp_3uLj0mcXO1b6D6BBojSvCOvpH | 6 | 16 | 7 | 5 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 158 | 85 | 0 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 149 | 25 | 1 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 116 | 62 | 62 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 148 | 59 | 59 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 0 | 0 | 0 | ⚠️ |

## 🇷🇺 Russia Gate

**Режим:** 2 независимые точки.
**Предупреждение:** Both Check-Host nodes passed preflight; Globalping 3/3 was used for endpoint-level Check-Host errors.
Проверено кандидатов: **1786**; прошли: **1305**; отброшены: **481**; pending: **0**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| ru1.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru2.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
