# VPN source report

Последнее обновление: 2026-09-25T07:25:55.951Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **139** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 592 | 103 | 14 | ✅ |
| **SOURCE_URL15_2** | keylineservices.top/9v5QqXjc18TPKTyQn8KCONuJYGAS8bfU | 2 | 36 | 7 | 6 | ✅ |
| **SOURCE_URL4_4** | keylineservices.top/kNIF5Xx9nGBKSCnSqBAJL6rqvkQrZKu7 | 4 | 2 | 0 | 0 | ⚠️ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 63 | 5 | 2 | ✅ |
| **SOURCE_URL5_6** | keylineservices.top/3hvMuQN5gPyCaXiHNsVGVPdmQB9wDJN_ | 6 | 31 | 14 | 10 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 74 | 2 | 0 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 113 | 6 | 1 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 129 | 60 | 60 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 51 | 13 | 13 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 0 | 0 | 0 | ⚠️ |

## 🇷🇺 Russia Gate

**Режим:** 2 независимые точки.
Проверено кандидатов: **856**; прошли: **546**; отброшены: **283**; pending: **27**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| ru1.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru3.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
