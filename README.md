# VPN source report

Последнее обновление: 2026-09-05T19:49:00.572Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **71** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 406 | 326 | 29 | ✅ |
| **SOURCE_URL2_2** | keylineservices.top/QXUDAX9FdsKyV_plyYL0g8SNrrE5d-U4 | 2 | 207 | 12 | 4 | ✅ |
| **SOURCE_URL4_4** | keylineservices.top/kNIF5Xx9nGBKSCnSqBAJL6rqvkQrZKu7 | 4 | 88 | 2 | 0 | ✅ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 227 | 191 | 19 | ✅ |
| **SOURCE_URL5_6** | keylineservices.top/Fzo26Xemako8Zyb3PLRKMNDBSP8LPsEj | 6 | 23 | 5 | 2 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 28 | 0 | 0 | ⚠️ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 64 | 8 | 0 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 107 | 15 | 15 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 27 | 2 | 2 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 7 | 9 | 9 | ✅ |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
