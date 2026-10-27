# VPN source report

Последнее обновление: 2026-10-27T11:59:43.382Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **186** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 1680 | 369 | 23 | ✅ |
| **SOURCE_URL16_2** | keylineservices.top/Y3ge9VqTYBif5pVPXsbStMdtoeRbZq1d | 2 | 10 | 4 | 4 | ✅ |
| **SOURCE_URL9_4** | keylineservices.top/obZh2U-WPxIOTY1Cn4SkiEjQ9xtNVA2o | 4 | 12 | 8 | 3 | ✅ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 0 | 0 | 0 | ⚠️ |
| **SOURCE_URL5_6** | keylineservices.top/87aTfb13RYm9huXf-Q8QUW-79N7mt8wK | 6 | 16 | 8 | 3 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 111 | 25 | 1 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 114 | 6 | 0 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 126 | 95 | 95 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 99 | 61 | 61 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 1 | 0 | 0 | ⚠️ |

## 🇷🇺 Russia Gate

**Режим:** 2 независимые точки.
Проверено кандидатов: **1594**; прошли: **1043**; отброшены: **448**; pending: **103**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| ru1.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru3.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
