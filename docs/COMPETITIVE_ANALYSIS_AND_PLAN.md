# Public Realm Planner — Конкурентный анализ и план реализации

> Дата: 2026-06-01. Источник: ресёрч 4 агентов по commercial GIS, civic-tech, scoring-аналогам и govtech-рынку.
> Цель документа: (1) карта конкурентов, (2) где white space, (3) какие фичи заимствовать, (4) что изменить в концепте, (5) детальный план реализации.

---

## 0. Главный вывод за 30 секунд

Я проверил ~35 продуктов и инструментов. Ни один не делает то, что заявлено в концепте, **целиком**:

> **рекомендовать конкретные новые точки для small public infrastructure, с прозрачным score, с before/after coverage, в рамках бюджета, по нескольким городам с единой методикой.**

Рынок распадается на тех, кто **собирает мнения** (Commonplace, Maptionnaire, Decidim), тех, кто **измеряет что есть** (Vivacity, Numina, Telraam, Strava Metro, StreetLight), тех, кто **визуализирует gap доступности** (CityAccessMap, UrbanAccess, Walk Score, Sony 15-min), и тех, кто **даёт дорогой GIS-конструктор** (Esri, CARTO, UrbanFootprint, Replica). Единственное место, где реально **генерируются оптимальные точки с equity-score и приростом покрытия — это академические статьи** (2SFCA, MCLP, Kolm-Pollak EDE), а не готовый продукт.

**Вывод: концепт занимает реальную пустую нишу. Но MVP надо резать жёстче, а scoring и архитектуру — переделать по образцу Tree Equity Score + Conveyal + PySAL spopt.**

---

## 1. Карта конкурентов

### Группа A — Enterprise GIS / location intelligence (дорогой конструктор)

| Продукт | Что делает | Цена | Слабость для нас |
|---|---|---|---|
| **Esri ArcGIS Urban + Business Analyst** | 3D master-planning + weighted suitability scoring («где разместить X») — ближайший прямой конкурент по сути | Не публична; нужен топ-тариф Professional Plus + GIS-штат; реально 5-значные суммы/год (один кейс — £280k/год) | Дорого, сложно, нужен обученный GIS-аналитик; не упакован под benches/bins/toilets; нет turnkey multi-city |
| **UrbanFootprint** | Scenario-modeling, accessibility/equity по parcel | Не публична; в отзывах «expensive» | **Только данные США**; крупный land-use, не микро-ассеты; ушёл от муниципалитетов к utilities/finance |
| **Replica** | Синтетическая mobility-модель, трафик/потоки | Не публична, VC-backed | Только США; это потоки, не siting |
| **CARTO** | Spatial analysis поверх облачного DWH | Usage-based, нет free tier | Это toolkit, не ответ; нужен data-engineer + warehouse |
| **Bentley iTwin / Cityzenith** | Городские digital twins, 3D | Enterprise | **Cityzenith и TwinUp обанкротились**, Sidewalk Labs Delve закрыт — «продать городу тяжёлый twin» как модель проваливается раз за разом |
| **Placer.ai** | Foot-traffic для retail site-selection | Enterprise | Цель — коммерческая выручка, не public value; США |

**Что это говорит:** у всех прямых конкурентов цена «contact sales», географический lock на США, и они работают на altitude land-use/zoning/потоков — **никто не владеет нишей мелкого public-realm ассета на фиксированном бюджете.**

### Группа B — Civic-tech участие (собирают мнения)

Commonplace (→Zencity), **Maptionnaire** (лучший геопространственный ввод), Social Pinpoint / EngagementHQ (Granicus), **Decidim** (open-source, Барселона), Streetmix (рисование сечения улицы). → Все собирают opinion на карте. **Никто не превращает это в ранжированные scored-решения.** Это фича для интеграции, а не рынок для борьбы.

### Группа C — Сенсоры/аналитика (измеряют что есть)

Vivacity Labs, Numina, **Telraam** (Бельгия! citizen-сенсоры, open data, дёшево — идеален для Antwerp), Strava Metro (бесплатно, но сильный sample bias), StreetLight (куплен Jacobs), Placemeter (мёртв с 2016). → Отличные **входные сигналы спроса**, но описательные: не замыкают петлю до «поэтому поставь скамейку здесь».

### Группа D — Accessibility / 15-min / walkability (визуализируют gap)

- **CityAccessMap** (TU Delft) — глобальный, бесплатный, OSM+GHSL, явно про equity-gap — но только визуализация.
- **UrbanAccess.io** — «Liveable Neighbourhoods» выделяет amenity-gaps — ближайший коммерческий gap-анализ, но **останавливается на выявлении gap**, не рекомендует точки.
- **Conveyal Analysis** — строгий access-to-opportunities, **делает before/after** — но для transit-сценариев, которые планировщик рисует руками; не генерирует точки.
- **Walk Score / Walkshed / EPA Walkability / Sony 15-min City** — прозрачные score, но **оценивают существующие места**, не предлагают новые.
- **TfL Healthy Streets Check** — прозрачный score из 31 метрики — но оценивает **данную** улицу, по одной, только Лондон.

### Группа E — Ближайший идейный аналог ★

**American Forests Tree Equity Score (treeequityscore.org)** — бесплатный, национальный, методика опубликована, equity-взвешенный, говорит «сажай здесь» + «нужно N деревьев» + считает co-benefits. **Это золотой эталон, который надо копировать по структуре.** Подробно — в разделе 3.

### Scorecard: кто реально рекомендует новые точки?

| Инструмент | Прозрачный score? | Before/after? | **Рекомендует НОВЫЕ точки?** |
|---|---|---|---|
| Conveyal | Да | **Да** | Нет — планировщик рисует сценарий |
| TfL Healthy Streets | **Да** (31 метрика) | Нет | Нет — оценивает данную улицу |
| UrbanAccess.io | Частично | Нет | Нет — только gap |
| CityAccessMap / Walk Score / Sony 15-min | Да | Нет | Нет |
| Esri Business Analyst | Да (suitability) | Частично | Полу-вручную, дорого, нужен GIS |
| Maptionnaire / Commonplace / Decidim | Нет (opinion) | Нет | Нет |
| Telraam / Vivacity / Strava | Нет (counts) | Нет | Нет |
| **Академия (MCLP, 2SFCA, Kolm-Pollak EDE)** | **Да** | **Да** | **Да — но не продукт** |

**Пустая клетка = наш продукт: «рекомендует + объясняет + before/after + бюджет + multi-city».**

---

## 2. Как выделиться (5 защитимых дифференциаторов)

1. **«Рекомендует, а не визуализирует».** Это единственный реальный водораздел. Все вокруг либо показывают что есть, либо собирают мнения. Мы выдаём **ранжированный список конкретных новых точек на бюджет N**.
2. **Прозрачный, объяснимый score.** Каждая рекомендация показывает свои веса и входы. Это прямо ложится на критерии доверия публичного сектора («почему именно эта улица?») и на EU/NEB-формулировки «trustworthy».
3. **Before/after impact на бюджете.** «Добавь эти 15 скамеек → покрытие rest-stop 58% → 79%». Это **тот артефакт, который чиновнику нужен для заявки на грант** — за это консультанты берут деньги.
4. **Free + open + multi-city.** Снижает procurement-трение почти до нуля (пилот без тендера) и превращает в грант-фондируемое public good, а не vendor lock-in. Multi-city с единой методикой почти отсутствует на рынке (TfL=только Лондон, Walk Score=NA/AU).
5. **Враг — не ArcGIS-софт, а ArcGIS-стоимость+сложность.** Позиционирование: «не замена GIS, а decision-support слой поверх открытых данных, который выдаёт защитимую siting-рекомендацию + impact-memo».

**Что не моё и не надо воевать:** participation (интегрировать Maptionnaire-подобный ввод), сенсоры (потреблять Telraam/Strava как сигнал), инвентаризацию (потреблять OSM/Paris/Antwerp open data как feedstock).

---

## 3. Какие фичи заимствовать (как конкуренты их делают)

### 3.1 Структура score — копировать у Tree Equity Score (мультипликативная)

В концепте сейчас scoring **аддитивный**: `Bench Need = 25% dist + 20% transit + 20% clinics + …`. Проблема: аддитивная сумма «размывает» — место с нулевым реальным дефицитом может набрать баллы за демографию.

**TES делает умнее — мультипликативно:**
```
Score = 100 × (1 − GapScore × EquityIndex)

GapScore   = нормализованный физический дефицит (как далеко до ближайшего ассета /
             % жителей за порогом пешей доступности)
EquityIndex = среднее равновзвешенных min-max нормализованных индикаторов нужды
             (доля пожилых, deprivation, heat, плотность, дети)
```
Смысл: **equity только усиливает наказание за реальный физический gap.** Место с высокой нуждой, но без gap — остаётся 100 (не трогаем). Это интуитивно, объяснимо и защищаемо политически.

Дополнительно от TES:
- **Равные веса** индикаторов нужды — снимают бесконечный спор о коэффициентах (но честно раскрыть, что это ценностный выбор, и дать продвинутым перевзвесить).
- **Density-adjusted цель** — не штрафовать плотный центр за «мало места».
- **Панель факторов на каждую единицу** — показать вклад каждого входа.
- **Action + co-benefit**: не просто score, а «нужно N ассетов здесь → +X% покрытия, −Y°C, $Z value». Это killer-фича TES.
- **Methods-страница + скачиваемые данные** — прозрачность *и есть* кредибилити для муниципалитета.

### 3.2 Before/after — копировать у Conveyal

Conveyal даёт «% спроса покрыто до/после». Для нас: «с этими N скамейками покрыто 78% спроса против 41% сегодня». Это siting-аналог TES-овского «trees needed → benefits».

### 3.3 Прозрачный rubric — копировать у TfL Healthy Streets

31 явная метрика, min-max нормализация, сумма — это методический бар, который ждут лондонские покупатели. Их 10-Healthy-Streets-индикаторов — хороший готовый чек-лист «что делает место хорошим для public realm».

### 3.4 Оптимизация — copy у PySAL spopt (для senior-версии)

Есть два **принципиально разных** действия:
- **(a) Ранжирование** — посчитать score каждой ячейки и отсортировать (так делают TES/Walk Score/15-min). Проблема: две скамейки в 50 м друг от друга обе наберут высокий score → дубль.
- **(b) Оптимизация** — решить coverage/median MIP, который учитывает **взаимодействие** точек (вторая скамейка рядом избыточна).

Реализация:
- **MVP = прозрачное ранжирование + жадный non-overlapping выбор** (взять лучшую, выкинуть кандидатов в радиусе, повторить). Быстро, объяснимо, без солвера. У жадного coverage есть гарантия ~63% от оптимума — так и сказать в методике.
- **Senior = MCLP / p-median через `PySAL spopt` + солвер CBC (бесплатный COIN-OR)** или Google OR-Tools. Бюджет = p точек, радиус = S пешей доступности, отчёт «% спроса покрыто before/after». `p-center` добавляет явную equity-цель (минимизировать худший случай).

### 3.5 Подводные камни scoring (и как их раскрывают лидеры)

- **MAUP** (результат зависит от выбора единицы): зафиксировать одну единицу и раскрыть её (TES=block group), либо использовать **дорожно-независимую регулярную сетку** (Conveyal, Sony hexbin). Никогда не сравнивать через несовпадающие единицы.
- **Straight-line vs network distance**: евклидово расстояние завышает доступность (игнорирует реки/магистрали). Лучшие используют **network-изохроны** (OSM + OSMnx/routing). Для MVP — изохроны достижимы и дают огромный прирост кредибилити над буферами.
- **Нормализация между городами**: min-max относителен к выборке → «60» в Antwerp ≠ «60» в Paris. EPA использует национальные фиксированные квантили — контрпример, который *сравним*. **Решить осознанно**: city-relative (хорошо внутри города, плохо между) vs абсолютные пороги (сравнимо), и **подписывать каждый score его системой отсчёта**. Также: surface temp ≠ air temp ≠ human exposure; AI-canopy ≠ street-level GVI; демографические категории различаются по странам.

---

## 4. Что изменить и улучшить в концепте

### 4.1 Сузить MVP с 3 модулей × 3 города → 1 ассет × 1 город

Концепт v1 = Bench + Toilet + Bin по Antwerp+London+Paris. Это слишком много для walking skeleton. **Wedge: equitable siting одного типа ассета в одном городе**, со score на accessibility + deprivation + footfall, на выходе — **before/after one-pager**.

- **Какой ассет**: public toilets (Paris 617 sanisettes / Antwerp `openbaar-toilet` — чистые open data) **или** age-friendly benches (сильный нарратив старения+климата, бэкап через OSM).
- **Какой город для демо/портфолио**: **Paris** — один портал, чистый API, реальные счётчики (617 туалетов, 218k деревьев) → самые убедительные скриншоты быстрее всего.
- **Какой город для «реального» beachhead**: **Antwerp** — уникально сочетает open street-furniture (ArcGIS Hub, подтверждён `openbaar-toilet`), **sector-level deprivation (Statbel BIMD)** и **citizen footfall (Telraam, плотный в Фландрии)**, плюс один владелец данных (GIS-отдел) = мало фрагментации.
- **London — позже**: лучшая demand/deprivation (LSOA Atlas, TfL), но **инвентаризация мебели фрагментирована по 33 боро** → зависимость от OSM. Самый тяжёлый интеграционный lift.

### 4.2 Переделать архитектуру: offline Python precompute → статичные выходы

Концепт предлагает React→FastAPI→Python engine→PostGIS. Для senior-версии ок, **для MVP/портфолио — overkill и мешает бесплатному деплою.**

**Рекомендуемая MVP-архитектура (lean):**
```
Python-скрипты/ноутбуки (offline, локально):
  fetch open data (OSM/Overpass, Paris/Antwerp portals, Statbel/INSEE, Telraam)
  → clean + reproject в локальный CRS (Lambert-93 / BNG / Belgian Lambert)
  → spatial join, изохроны, demand, score (deficit × equity)
  → candidate generation + greedy/MCLP
  → ЭКСПОРТ: GeoJSON слои + scenario JSON + report JSON
        ↓ (коммит в репо или в object storage)
Веб-приложение (ВАШ существующий шаблон React+Vite+Express+Sequelize):
  грузит статичные GeoJSON → Leaflet/MapLibre рендерит карту, scorecards
  scenario-слайдер = client-side ре-ранжирование уже посчитанных кандидатов
  экспорт decision-report (HTML/PDF)
  Express+Sequelize (опц.): загрузка CSV жалоб, сохранение сценариев, позже RAG
```
**Почему так:** интеллект — в Python (где geopandas/osmnx/spopt и живут), а **живое приложение остаётся тривиально-деплоимым бесплатно на Render** ровно как ваш шаблон. Никакого PostGIS-сервера на critical path. Тяжёлый счёт — раз в N дней, не на каждый запрос.

**Senior-эволюция (когда оправдано):** вынести Python в **FastAPI-сервис** (Render умеет Python web service бесплатно), добавить **PostgreSQL+PostGIS** для живой оптимизации по запросу и хранения сценариев. Это путь B, не блокирующий MVP.

> Связь с вашим шаблоном: React+Express+Sequelize-шаблон, который мы уже собрали, идеально работает как **dashboard-оболочка пути A**. Sequelize-модели понадобятся для сценариев/загрузок/RAG-метаданных. Геодвижок добавляется отдельной папкой `engine/` (Python) — он не на runtime-пути, поэтому Render-деплой шаблона не усложняется.

### 4.3 Сделать «data readiness» и честность ядром, а не сноской

Сильнейший senior-сигнал из концепта — Data Readiness Panel. Усилить:
- **Source confidence score** на каждый слой (authoritative city portal vs OSM «complete-ish»).
- Явно помечать, где инвентарь — OSM (не authoritative) → не over-claim'ить «слой скамеек».
- Sensitivity-анализ: показать, как меняется топ-10 при сдвиге весов.
- Manual override / city CSV upload (ваш Express+Sequelize тут к месту).

### 4.4 RAG-слой — это реальный white space, но строго v2

**Ни один** конкурент не привязывает spatial-рекомендации к собственным policy-документам города. «Где действовать» ⨯ «что говорит ваша принятая стратегия» — настоящая пустая ниша и сильная trust-фича. Но это v2: сначала docs upload → chunk → embeddings (bge-small/e5-small локально или pgvector) → source-backed ответ. Не тратить на это MVP-бюджет.

### 4.5 GTM: входить через грант/пилот, а не продажу

- Боль у public-space/mobility-офицеров, **бюджет — не у них**. Govtech-закупка в среднем **~22 месяца (Gartner)**.
- **Первые деньги — гранты, чьи критерии совпадают с продуктом почти дословно:** Bloomberg Mayors Challenge (последний раунд — 24 города × $1M, фокус «AI + resident input»), **New European Bauhaus Facility** (~€120M/год, «трансформация районов»), **Nesta**, **Interreg** (cross-border = идеально под multi-city), CIVITAS (Telraam уже там — канал кредибилити).
- UK-шорткат: **G-Cloud direct award** (без полного тендера, но надо быть в каталоге). EU — через TED / joint procurement.
- **Никогда не моделировать bottom-up SaaS-выручку** с этого. Это public good + услуги/RAG-апсейл.

### 4.6 Мелкие правки концепта

- CRS: для корректных расстояний считать в projected CRS (Lambert-93 EPSG:2154 для Paris, BNG EPSG:27700 для London, Belgian Lambert для Antwerp) — уже верно в доке, но сделать это **обязательным**, а не «можно приближённо».
- Демо-сценарий «15 benches / 10 bins / 5 toilets» — оставить как маркетинговый, но MVP-демо строить на **одном** типе.
- В UI заменить «statistical sector/LSOA/IRIS» на нейтральное **«local analysis area»** (уже в доке — хорошо).

---

## 5. Детальный план реализации

Принцип: **walking skeleton сначала** — один город, один ассет, end-to-end от open data до before/after one-pager. Потом ширина (ассеты), потом глубина (оптимизация, RAG, города).

### Фаза 0 — Data spike (1 город, 1 ассет) · ~неделя
**Цель:** доказать, что можно достать и нормализовать минимум данных и посчитать один score.
- Выбрать **Paris + public toilets** (чистейший API для быстрых скриншотов).
- `engine/`: Python-проект (`pandas, geopandas, shapely, pyproj, osmnx, requests`).
- Достать: `sanisettesparis` (617), INSEE IRIS boundaries + население, OSM POIs (parks, stations, markets, playgrounds) через Overpass.
- Reproject всё в EPSG:2154. Валидация геометрий, дедуп.
- **Выход:** один ноутбук, который грузит и чистит данные, рендерит слои в GeoPandas. Чек: «сошлись ли счётчики, бьётся ли геометрия».

### Фаза 1 — Unified data model + city adapter · ~1–1.5 недели
**Цель:** схема, переносимая на другие города.
- Реализовать сущности из концепта: `City, AnalysisUnit, Asset, POI, DemandPoint, CandidateLocation, Scenario, Recommendation` (как Python dataclasses / GeoDataFrame-схемы; в вебе — Sequelize-модели для Scenario/Upload).
- Паттерн **city adapter**: интерфейс `load_units() / load_assets() / load_pois()`, конкретная реализация `ParisAdapter`.
- **Выход:** unified GeoJSON для Paris-toilets; адаптер-контракт задокументирован.

### Фаза 2 — Scoring model (deficit × equity) · ~1.5 недели
**Цель:** прозрачный, объяснимый score на analysis unit и на сетке.
- Реализовать **TES-структуру**: `Score = 100 × (1 − GapScore × EquityIndex)`.
  - `GapScore`: дистанция до ближайшего туалета / % населения IRIS за порогом 5-мин пешком. **Сетка 250 м** как дорожно-независимая единица (anti-MAUP).
  - `EquityIndex`: равновзвешенные min-max нормализованные индикаторы (доля пожилых, плотность, deprivation-прокси, footfall-прокси из POI/Telraam).
- **Distance**: MVP — буферы; **апгрейд в этой же фазе — network-изохроны через OSMnx** (большой прирост кредибилити).
- Раскрыть систему отсчёта (city-relative), подписать score.
- **Выход:** GeoJSON со score на ячейку + панель факторов (вклад каждого входа).

### Фаза 3 — Recommendation engine (candidates + before/after) · ~1.5 недели
**Цель:** ранжированный список конкретных новых точек + прирост покрытия.
- Генерация кандидатов: высоко-score ячейки, кластеры спроса, коридоры, рядом с POI/транспортом, в underserved units.
- **MVP-отбор:** жадный non-overlapping (взять лучший, выкинуть радиус S, повторить до бюджета N). Зафиксировать гарантию ~63% в методике.
- **Before/after:** % спроса в пределах S до и после (Conveyal-стиль).
- **Senior-апгрейд (отдельная ветка):** MCLP/p-median через `PySAL spopt` + CBC; `p-center` для equity.
- **Выход:** `recommendations.json` (rank, lat/lon, score, why, tradeoffs) + `coverage_before_after.json`.

### Фаза 4 — Frontend dashboard (поверх вашего шаблона) · ~2 недели
**Цель:** превратить статичные выходы в продукт.
- Взять собранный **React+Vite-шаблон**; добавить **Leaflet или MapLibre** (free, без Mapbox-токена).
- Экраны из концепта, по приоритету:
  1. City + asset + analysis-mode selector.
  2. **Data readiness panel** (с source-confidence — senior-сигнал).
  3. Map overview (слои: existing assets, units, demand, candidates).
  4. **Recommendation panel** («15 туалетов, покрытие 44%→71%, топ-зоны…»).
  5. Scenario slider (бюджет 5/10/20/50; ре-ранжирование client-side по precomputed score).
  6. **Before/after** view.
- Express+Sequelize (из шаблона): эндпоинт загрузки CSV жалоб, сохранение сценариев.
- **Выход:** работающий дашборд, деплоится бесплатно на Render как есть.

### Фаза 5 — Decision report export · ~неделя
**Цель:** артефакт для грант-заявки чиновника.
- Генерировать one-page memo: recommended interventions, methodology, data sources + **confidence**, expected impact, equity impact, maintenance, **limitations** (честно: OSM-полнота, straight-line vs network, MAUP).
- Экспорт HTML→PDF (print stylesheet или `react-to-print`).
- **Выход:** скачиваемый decision report.

### Фаза 6 — Ширина: 2-й город + 2-й ассет · ~2 недели
- Добавить **Antwerp adapter** (Statbel sectors + BIMD + `openbaar-toilet` + Telraam) — доказать переносимость city-adapter.
- Добавить **benches** (age-friendly rest-stop нарратив).
- Добавить **city comparison** экран (benches per 1000, toilet coverage near parks) — **с явной пометкой системы отсчёта** (city-relative vs absolute).

### Фаза 7 (v2) — RAG над policy-документами · отдельный трек
- Upload PDF (waste strategy, mobility plan, accessibility strategy) → parse → chunk → embeddings (bge-small/e5-small или pgvector) → retrieval → source-backed ответ.
- Вопросы: «почему эти 10 точек?», «какие рекомендации поддерживают accessibility strategy?», «сгенерируй 1-page brief для совета».
- Это и есть незанятый white space — но только после того, как ядро siting доказано.

### Параллельный трек — GTM / портфолио (с Фазы 2)
- Оформлять как **senior PM case study**: stakeholder map, data ecosystem map, scoring methodology, before/after, decision report.
- Подготовить заявку под **NEB Facility / Bloomberg Mayors Challenge / Nesta** (multi-city + open + explainable + resident-centered ложится в их критерии дословно).

---

## 6. Технологический стек (итог)

| Слой | MVP (путь A) | Senior (путь B) |
|---|---|---|
| Геодвижок | Python offline: `pandas, geopandas, shapely, pyproj, osmnx, networkx, scikit-learn` | + `PySAL spopt`, `PuLP`/CBC или OR-Tools |
| Оптимизация | Жадный non-overlapping (~63% гарантия) | MCLP / p-median / p-center |
| Выходы | Статичные GeoJSON + JSON в репо/storage | Live API |
| Backend | **Ваш шаблон** Express + Sequelize (SQLite→Postgres) для upload/scenarios | + FastAPI Python service, PostgreSQL + **PostGIS** |
| Frontend | **Ваш шаблон** React+Vite + **Leaflet/MapLibre** | + deck.gl для тяжёлых слоёв |
| RAG (v2) | — | Chroma/FAISS/pgvector + bge-small/e5-small |
| Деплой | **Render free** (как шаблон) | Render web service (Python) + free Postgres |

---

## 7. Топ-риски (и митигировать)

1. **Street-furniture данные — слабый слой.** Authoritative только там, где один владелец (TfL, Paris portal, Antwerp GIS); иначе зависимость от OSM («complete-ish, не authoritative»). → Не over-claim'ить инвентарь; показывать source-confidence; начать с Paris/Antwerp, где данные чистые.
2. **Нет бюджетной строки / цикл 22 мес.** «Free» снимает ценовое трение, но не attention/integration-стоимость → риск застрять в pilot purgatory. → Входить через гранты, а не продажу.
3. **Консультанты (Arup City Modelling Lab, Mott MacDonald Cities Studio) и Esri могут поглотить идею.** → Единственный устойчивый ров — быть **open, explainable, multi-city из коробки**, что они структурно не воспроизведут.
4. **Normalization-ловушка между городами** → подписывать каждый score системой отсчёта; рассмотреть абсолютные пороги для сравнения.

---

## Источники (выборка)

treeequityscore.org (+ Toronto methodology PDF) · conveyal.com/analysis · pysal.org/spopt · esri.com ArcGIS Urban/Business Analyst · urbanfootprint.com · replicahq.com · carto.com · cityaccessmap.com (TU Delft) · urbanaccess.io · healthystreetsscorecard.london · walkscore.com/methodology · whatif.sonycsl.it/15mincity · opendata.paris.fr (sanisettesparis, les-arbres) · portaal-stadantwerpen.opendata.arcgis.com (openbaar-toilet) · statbel.fgov.be · data.london.gov.uk (LSOA Atlas) · tfl.gov.uk open data · telraam.net · Gartner govtech 22-month cycle · Bloomberg Mayors Challenge · New European Bauhaus Facility · MDPI 2SFCA toilet siting · arXiv Kolm-Pollak EDE facility location.
