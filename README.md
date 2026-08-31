# VPN source report

Последнее обновление: 2026-08-31T23:51:13.236Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **89** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 842 | 688 | 41 | ✅ |
| **SOURCE_URL2_2** | keylineservices.top/QXUDAX9FdsKyV_plyYL0g8SNrrE5d-U4 | 2 | 207 | 16 | 5 | ✅ |
| **SOURCE_URL4_4** | keylineservices.top/j05AYSxzTKKaXyqB_mX55QQQamcgwcD3 | 4 | 88 | 2 | 0 | ✅ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 255 | 197 | 12 | ✅ |
| **SOURCE_URL5_6** | keylineservices.top/dgi_Ho1irp5dETw9TzCiNCaBkx41fr3e | 6 | 19 | 7 | 1 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 63 | 19 | 0 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 119 | 1 | 0 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 176 | 58 | 58 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 85 | 42 | 42 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 34 | 15 | 15 | ✅ |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
