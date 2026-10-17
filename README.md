# VPN source report

Последнее обновление: 2026-10-17T14:49:19.717Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **234** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 312 | 44 | 11 | ✅ |
| **SOURCE_URL16_2** | keylineservices.top/dNcp_5djL_q1jK53rb7LHR1jxHFjndlO | 2 | 10 | 2 | 0 | ✅ |
| **SOURCE_URL9_4** | keylineservices.top/VXAAN0wjnfBMoacwWDbdiX6VtVt4nLsZ | 4 | 13 | 8 | 3 | ✅ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 83 | 22 | 3 | ✅ |
| **SOURCE_URL5_6** | keylineservices.top/hzMLjH6lA88DzV3nfb18wnq6JSht4SNf | 6 | 17 | 6 | 3 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 94 | 13 | 1 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 145 | 18 | 2 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 205 | 125 | 125 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 94 | 37 | 37 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 2 | 2 | 2 | ✅ |

## 🇷🇺 Russia Gate

**Режим:** 2 независимые точки.
Проверено кандидатов: **804**; прошли: **621**; отброшены: **147**; pending: **36**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| ru1.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru3.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
