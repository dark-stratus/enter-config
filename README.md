# VPN source report

Последнее обновление: 2026-08-29T22:19:21.942Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **175** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 584 | 392 | 76 | ✅ |
| **SOURCE_URL2_2** | keylineservices.top | 2 | 207 | 11 | 5 | ✅ |
| **SOURCE_URL4_4** | keylineservices.top | 4 | 88 | 0 | 0 | ⚠️ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 330 | 220 | 18 | ✅ |
| **SOURCE_URL5_6** | keylineservices.top | 6 | 18 | 4 | 0 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 100 | 32 | 9 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 133 | 4 | 3 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 169 | 39 | 39 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 35 | 0 | 0 | ⚠️ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 19 | 15 | 15 | ✅ |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
