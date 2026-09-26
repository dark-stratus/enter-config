# VPN source report

Последнее обновление: 2026-09-26T19:06:28.332Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **92** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 416 | 53 | 16 | ✅ |
| **SOURCE_URL15_2** | keylineservices.top/9v5QqXjc18TPKTyQn8KCONuJYGAS8bfU | 2 | 36 | 6 | 4 | ✅ |
| **SOURCE_URL4_4** | keylineservices.top/kNIF5Xx9nGBKSCnSqBAJL6rqvkQrZKu7 | 4 | 2 | 0 | 0 | ⚠️ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 46 | 5 | 0 | ✅ |
| **SOURCE_URL5_6** | keylineservices.top/3hvMuQN5gPyCaXiHNsVGVPdmQB9wDJN_ | 6 | 31 | 12 | 8 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 155 | 0 | 0 | ⚠️ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 134 | 5 | 1 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 83 | 9 | 9 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 43 | 11 | 11 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 1 | 1 | 1 | ✅ |

## 🇷🇺 Russia Gate

**Режим:** 2 независимые точки.
Проверено кандидатов: **719**; прошли: **493**; отброшены: **226**; pending: **0**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| ru1.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru3.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
