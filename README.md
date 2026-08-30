# VPN source report

Последнее обновление: 2026-08-30T17:15:03.437Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **301** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 351 | 171 | 41 | ✅ |
| **SOURCE_URL2_2** | keylineservices.top | 2 | 207 | 9 | 6 | ✅ |
| **SOURCE_URL4_4** | keylineservices.top | 4 | 88 | 0 | 0 | ⚠️ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 310 | 260 | 42 | ✅ |
| **SOURCE_URL5_6** | keylineservices.top | 6 | 19 | 1 | 1 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 78 | 33 | 8 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 128 | 10 | 0 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 169 | 23 | 23 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 56 | 10 | 10 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 13 | 28 | 28 | ✅ |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
