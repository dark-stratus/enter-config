# VPN source report

Последнее обновление: 2026-11-27T04:44:00.072Z

Статистика **по каждому источнику отдельно**: **взяли → живы → в итоговом пуле**.

🧠 Из памяти предыдущего пула сохранено: **90** серверов.

## Источники

| Секрет | Источник | Слот | Взяли | Живы | В итоговом пуле | Состояние |
|---|---|---:|---:|---:|---:|---|
| **SOURCE_URL16_2** | keylineservices.top/_0SC3ltN5CB_StcZBtzHR4Vg_5QrjjFR | 2 | 10 | 6 | 6 | ✅ |
| **SOURCE_URL9_4** | keylineservices.top/hq6Fk_tyij5kg2Xhb67t8kCrfrigjug1 | 4 | 2 | 1 | 1 | ✅ |
| **SOURCE_URL5_6** | keylineservices.top/C7xwkp_3uLj0mcXO1b6D6BBojSvCOvpH | 6 | 2 | 0 | 0 | ⚠️ |
| **SOURCE_URL_9** | zieng2/wl — vless_universal.txt | 9 | 118 | 41 | 41 | ✅ |
| **SOURCE_URL_10** | igareck/vpn-configs-for-russia — WHITE-CIDR-RU-all.txt | 10 | 170 | 59 | 59 | ✅ |
| **SOURCE_URL_11** | igareck/vpn-configs-for-russia — WHITE-SNI-RU-all.txt | 11 | 0 | 0 | 0 | ⚠️ |

## 🇷🇺 Russia Gate

**Режим:** Check-Host 2/2.
**Предупреждение:** Check-Host 2/2 passed preflight; Globalping 2/3 was used for endpoint-level uncertainty.
Проверено кандидатов: **295**; прошли: **226**; отброшены: **69**; pending: **0**.

| Russian checker | Проверок | Reachable | Inconclusive | Timeout | 429 | Другие ошибки |
|---|---:|---:|---:|---:|---:|---:|
| ru1.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |
| ru3.node.check-host.net | 0 | 0 | 0 | 0 | 0 | 0 |

## Правила слотов

**Слоты 1–8** — обычные источники.
**Слоты 9–15** — whitelist / LTE-источники.

У имени секрета может быть произвольный номер источника перед последним `_`: например, `SOURCE_URL1_1`, `SOURCE_URL15_1`, `SOURCE_URL20_2`. **Последнее число — единственное, которое определяет слот.**

Для обычных источников дополнительно работает автоматическое распознавание whitelist по текущим ключевым словам: если найден такой конкретный сервер, он уходит в LTE-пул сам по себе; весь источник целиком whitelist-источником не становится.
