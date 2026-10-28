# VPN source report

Последнее обновление: 2026-10-28T15:18:01.900Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **155** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL_1** | rtwo2/FastNodes — verified.txt | 1 | 1709 | 823 | 26 | ✅ |
| **SOURCE_URL16_2** | keylineservices.top/Y3ge9VqTYBif5pVPXsbStMdtoeRbZq1d | 2 | 9 | 5 | 3 | ✅ |
| **SOURCE_URL9_4** | keylineservices.top/obZh2U-WPxIOTY1Cn4SkiEjQ9xtNVA2o | 4 | 12 | 7 | 2 | ✅ |
| **SOURCE_URL_5** | VovaplusEXP/p-configs — vless.txt | 5 | 0 | 0 | 0 | ⚠️ |
| **SOURCE_URL5_6** | keylineservices.top/87aTfb13RYm9huXf-Q8QUW-79N7mt8wK | 6 | 16 | 5 | 1 | ✅ |
| **SOURCE_URL_7** | wlunlocker/vpn-configs — blacklist_vpn1.txt | 7 | 81 | 57 | 3 | ✅ |
| **SOURCE_URL_8** | igareck/vpn-configs-for-russia — BLACK_VLESS_RUS_mobile.txt | 8 | 127 | 9 | 0 | ✅ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 128 | 110 | 110 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 136 | 58 | 58 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 3 | 1 | 1 | ✅ |

## 🇷🇺 Russia Gate

**Режим:** ПРОПУЩЕН (⚠️).
**Предупреждение:** No Russian Check-Host nodes were available. Russia Gate was skipped; candidates were passed directly to Heavy.
Проверено кандидатов: **1659**; прошли: **0**; отброшены: **0**; pending: **0**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| ru1.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru2.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru3.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
