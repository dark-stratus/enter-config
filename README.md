# VPN source report

Последнее обновление: 2026-09-04T00:47:15.262Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **135** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 488 | 411 | 34 | ✅ |
| **SOURCE_URL2_2** | keylineservices.top/QXUDAX9FdsKyV_plyYL0g8SNrrE5d-U4 | 2 | 207 | 15 | 4 | ✅ |
| **SOURCE_URL4_4** | keylineservices.top/kNIF5Xx9nGBKSCnSqBAJL6rqvkQrZKu7 | 4 | 88 | 13 | 3 | ✅ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 277 | 241 | 11 | ✅ |
| **SOURCE_URL5_6** | keylineservices.top/Fzo26Xemako8Zyb3PLRKMNDBSP8LPsEj | 6 | 19 | 16 | 1 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 64 | 29 | 3 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 140 | 53 | 3 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 110 | 27 | 27 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 113 | 104 | 104 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 0 | 0 | 0 | ⚠️ |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
