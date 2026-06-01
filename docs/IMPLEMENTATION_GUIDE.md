# Public Realm Planner — Implementation Guide

> Дата: 2026-06-01. Источник: ресёрч 4 агентов с живой проверкой API/датасетов и библиотек.
> Это **практический справочник реализации**: точные endpoints, лицензии, код-паттерны, лимиты, CI/деплой.
> Парный документ: [COMPETITIVE_ANALYSIS_AND_PLAN.md](COMPETITIVE_ANALYSIS_AND_PLAN.md) (стратегия + фазы).

---

## 0. 7 решений, которые надо принять до первой строки кода

1. **Бенчи и урны в Paris/Antwerp берём из OSM, не из city-порталов.** Парижский `plan-de-voirie-mobiliers-urbains-*` — это CAD-слой LineString с типом в поле `lib_classe`, а не точки; у Antwerp вообще нет bench-датасета. Чистые точки от города есть только для **туалетов (Paris `sanisettesparis` / Antwerp `openbaar-toilet`), деревьев (`les-arbres`/`boom`) и остановок (TfL StopPoint)**.
2. **OSM-смещение работает ПРОТИВ equity-цели** — OSM недо-картографирует бедные/периферийные районы → занижает gap именно там, где нужда выше. Это главный pitfall, раскрыть на methods-странице.
3. **Score — мультипликативный с floor 0.1**: `Score = 100×(1 − GapScore × EquityIndex)`, `EquityIndex = 0.1 + 0.9×mean(N_i)`. Не аддитивный.
4. **Within-city и cross-city — разные нормализации.** Внутри города — min-max (TES). Между городами — один `QuantileTransformer`, обученный на пуле всех городов (подход EPA). Подписывать каждый score его режимом.
5. **MVP-оптимизация = greedy (гарантия ~63%), senior = MCLP через spopt+CBC.** Переключатель: `if n_demand × n_candidates ≤ ~5e6 and want_optimal: MCLP else greedy`.
6. **Карта = react-leaflet, НО он v5 требует React 19.** Наш шаблон на React 18 → либо поднять до 19, либо ставить `react-leaflet@^4`.
7. **Слайдер сценария считается в браузере** (greedy по precomputed `candidates.json`), без бэкенда. Тяжёлый счёт — оффлайн в Python, в репо/R2 коммитятся статичные GeoJSON.

---

## 1. Источники данных (проверено живьём 2026-06-01)

### 1.1 Сводная таблица

| Источник | Город | Тип | Endpoint (копировать slug точно) | Лицензия | Уверенность |
|---|---|---|---|---|---|
| Opendatasoft v2.1 | Paris | Туалеты (617) | `…/api/explore/v2.1/catalog/datasets/sanisettesparis/exports/geojson` | ODbL | **Высокая (live)** |
| Opendatasoft v2.1 | Paris | Деревья (218k) | `…/datasets/les-arbres/exports/geojson` | ODbL | **Высокая (live)** |
| Opendatasoft v2.1 | Paris | Бенчи/урны (LineString!) | `…/datasets/plan-de-voirie-mobiliers-urbains-jardinieres-bancs-corbeilles-de-rue/exports/geojson` | ODbL | High, но **не точки** |
| ArcGIS Hub | Antwerp | Туалеты | `openbaar-toilet` → FeatureServer из панели "GeoService" | Open Vlaanderen (CC-BY-eq) | Med (slug да, URL flagged) |
| ArcGIS Hub | Antwerp | Урны (бумага) | `papiermand` | Open | Med |
| ArcGIS Hub | Antwerp | Деревья | `boom` (+ `toekomstboom`) | Open | Med |
| ArcGIS Hub | Antwerp | **Бенчи** | **нет слоя → OSM** | — | Flagged |
| Statbel | BE | Стат. секторы + население | `statbel.fgov.be/en/open-data/statistical-sectors-2024` (shp/geojson/sqlite, EPSG 31370/3812) | **CC BY 4.0** | Высокая |
| Sciensano | BE | BIMD deprivation (сектор) | GitHub `sciensanogit/bimd-pkg`; tool `bimd.sciensano.be` | research/open | Med (2001/2011; 2021 TBC) |
| ONS OGP | London | LSOA 2021 BGC | `services1.arcgis.com/ESMARspQHYMw9BZ9/.../LSOA_Dec_2021_Boundaries_Generalised_Clipped_EW_BGC_V2/FeatureServer/0/query` | OGL v3 | High (проверить суффикс версии) |
| gov.uk | London | IMD 2019 @ LSOA (коды 2011!) | `gov.uk/government/statistics/english-indices-of-deprivation-2019` (File 1/7 CSV) | OGL v3 | Высокая |
| TfL Unified API | London | Остановки | `api.tfl.gov.uk/StopPoint/Mode/bus?app_key=…` | TfL Open Data | Высокая |
| TfL | London | Навесы | **нет в API → OSM `shelter=yes`** | — | Flagged |
| Overpass / OSMnx | все | bench, waste_basket, toilets, park, school, pharmacy, clinic, platform | `overpass-api.de/api/interpreter` ; `ox.features_from_place()` | **ODbL** | Высокая |
| Geofabrik + pyrosm | все | bulk POI | `download.geofabrik.de/…-latest.osm.pbf` | ODbL | Высокая |
| GHSL JRC | все | Население 100 м | `jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/…_54009_100/…zip` | CC BY 4.0 | Высокая |
| WorldPop (альт) | все | Население 100 м (EPSG:4326) | `worldpop.org` country GeoTIFF | CC BY 4.0 | Высокая |
| Telraam | Antwerp | Footfall (ped/bike/car) | `POST telraam-api.net/v1/reports/traffic` (`X-Api-Key`) | Telraam terms (attrib.) | High (endpoint); лицензия flagged |

### 1.2 Paris — Opendatasoft Explore API v2.1
- Base: `https://opendata.paris.fr/api/explore/v2.1`
- **Records:** `GET /catalog/datasets/{id}/records` — JSON `{total_count, results}`. `limit`≤100, `offset`≤10000 → потолок 10 100 строк. ODSQL: `where`/`select`/`group_by`/`order_by`.
- **Export (полный дамп, без лимита):** `GET /catalog/datasets/{id}/exports/{geojson|csv|parquet|shp}`. `where`/`select` тоже работают.
- Геометрия: `geo_point_2d` (lon/lat), `geo_shape` (GeoJSON Feature).
```python
import geopandas as gpd, requests
BASE = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets"
toilets = gpd.read_file(f"{BASE}/sanisettesparis/exports/geojson")   # 617 точек
trees   = gpd.read_file(f"{BASE}/les-arbres/exports/geojson")        # 218k точек
```
Gotchas: slug режется до 50 символов; `plan-de-voirie-*` — LineString с типом в `lib_classe` (не точки); `/records` упирается в offset 10000 → для полного пула только export.

### 1.3 Antwerp — ArcGIS Hub + Statbel + BIMD
- Стандартный ArcGIS REST query: `{FeatureServer}/{layer}/query?where=1=1&outFields=*&f=geojson&outSR=4326&resultOffset=0&resultRecordCount=1000`. Пагинация по `resultOffset`; стоп, когда вернулось меньше `resultRecordCount` (или `exceededTransferLimit=false`).
- **FeatureServer URL копировать из панели "View API Resources → GeoService"** на странице датасета (Hub JS-рендерится, org-ID не угадывать). Bulk-shortcut: `https://portaal-stadantwerpen.opendata.arcgis.com/datasets/<slug>.geojson` (нужен User-Agent, иначе 403).
```python
import geopandas as gpd, requests
def arcgis_all(fs, layer=0, page=1000):
    feats, off = [], 0
    while True:
        r = requests.get(f"{fs}/{layer}/query", params={
            "where":"1=1","outFields":"*","f":"geojson","outSR":4326,
            "resultOffset":off,"resultRecordCount":page}).json()
        feats += r["features"]
        if len(r["features"]) < page: break
        off += page
    return gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326")
```
- **Statbel секторы:** `sh_statbel_statistical_sectors_2024…` (shp/geojson/sqlite, EPSG:31370 и 3812), CC BY 4.0. Население по секторам — отдельная open-data таблица, join по `CD_SECTOR`.
- **BIMD (deprivation):** Sciensano, GitHub `sciensanogit/bimd-pkg` — scores/ranks/deciles + 6 субдоменов по сектору. ⚠ Подтверждены 2001/2011; 2021 в разработке.

### 1.4 London — ONS + IMD + TfL
- **LSOA 2021:** брать **BGC** (generalised 20m clipped — баланс формы/веса). ⚠ ONS ротирует версии сервиса (V2→V3) — сверить актуальный суффикс в "View API Resources". Поля `LSOA21CD/LSOA21NM`, ~4994 в Лондоне.
- **IMD 2019:** File 1 (rank+decile) / File 7 (все домены), CSV, ключ — **коды LSOA 2011** → нужен lookup 2011→2021 для join к границам 2021.
- **TfL:** `GET api.tfl.gov.uk/StopPoint/Mode/bus?app_key=KEY`; радиусный `/StopPoint?lat=..&lon=..&stopTypes=NaptanPublicBusCoachTram&radius=500`. Free `app_key` (api-portal.tfl.gov.uk), лимит **500 req/min**. Навесов в API нет → OSM `highway=bus_stop`+`shelter=yes`.

### 1.5 OSM — универсальный fallback
Запрос по admin-area чище, чем по bbox. `out center` обязателен (иначе теряется геометрия way/relation):
```overpassql
[out:json][timeout:120];
area["name"="Antwerpen"]["admin_level"="8"]->.a;
(
  nwr["amenity"="bench"](area.a);
  nwr["amenity"="waste_basket"](area.a);
  nwr["amenity"="toilets"](area.a);
  nwr["leisure"="park"](area.a);
  nwr["amenity"="school"](area.a);
  nwr["amenity"="pharmacy"](area.a);
  nwr["public_transport"="platform"](area.a);
);
out center tags;
```
```python
import osmnx as ox  # OSMnx 2.x: features_from_place (НЕ geometries_from_*)
tags = {"amenity":["bench","waste_basket","toilets","school","pharmacy","clinic"],
        "leisure":"park","public_transport":"platform"}
gdf = ox.features_from_place("Antwerp, Belgium", tags)
```
Bulk без лимитов: Geofabrik `.osm.pbf` + `pyrosm`. Overpass fair-use ~2 слота/IP, 429 при злоупотреблении.

### 1.6 Население — GHSL GHS-POP R2023A
GeoTIFF, 100 м, **World Mollweide (ESRI:54009)** (или 3″/30″ в WGS84). Ячейка = чел/100м → `sum` по полигону = население (не `mean`!). Альтернатива проще по CRS — **WorldPop** (EPSG:4326, по странам).
```python
import geopandas as gpd
from rasterstats import zonal_stats
units = gpd.read_file("lsoa.geojson").to_crs("ESRI:54009")  # CRS = CRS растра!
units["pop"] = [s["sum"] for s in zonal_stats(units, "GHS_POP_...54009_100_V1_0.tif", stats=["sum"])]
```

### 1.7 Telraam (Antwerp footfall)
`POST https://telraam-api.net/v1/reports/traffic`, header `X-Api-Key`, тело `{id, time_start, time_end (UTC), level:"segments", format:"per-hour"}`, окно ≤3 мес. Лимит 1 req/s, 1000/день. Считает ped/bike/car/heavy + направления + скорость (оценка с камеры, не ground-truth).

---

## 2. Геопространственный движок (Python, оффлайн)

### 2.1 Конвейер
| # | Шаг | Функция | Библиотека |
|---|---|---|---|
| 1 | `load()` | чтение OSM/census/facility | `geopandas.read_file`, `osmnx.features` |
| 2 | `clean()` | дедуп, `make_valid`, drop null | geopandas/shapely |
| 3 | `reproject()` | WGS84 → метрический CRS | `gdf.to_crs(EPSG)` |
| 4 | `grid()` | MAUP-safe единицы | `h3` v4 / квадратная сетка |
| 5 | `population()` | census-полигоны → сетка | `tobler.area_weighted.area_interpolate` |
| 6 | `network()` | walk-граф + дистанции | `osmnx` → `pandana.Network` |
| 7 | `demand()` | 2SFCA/E2SFCA | `access.Access` (или вручную) |
| 8 | `score()` | deficit × equity (TES) | numpy/pandas (§3) |
| 9 | `candidates()` | пул кандидатов | сетка + DBSCAN + узлы сети |
| 10 | `optimize()` | выбор N точек | `spopt.locate.MCLP` или greedy |
| 11 | `before_after()` | прирост покрытия | `scipy.spatial.cKDTree`/pandana |
| 12 | `export()` | GeoJSON/JSON | `to_crs(4326).to_file(...,"GeoJSON")` |

### 2.2 CRS (метрический обязательно перед любой метрикой)
```python
CITY_CRS = {"paris":2154, "london":27700, "antwerp":31370}  # Lambert-93 / BNG / Belgian Lambert 72
# 3812 (Lambert 2008) для Antwerp тоже ок — но НЕ мешать 31370 и 3812 в одном проекте.
gdf_m = gdf.set_crs(4326).to_crs(CITY_CRS[city])
```

### 2.3 MAUP-safe сетка (H3 v4 — порядок координат (lat, lng)!)
H3 res 9 ≈ ~250м-ощущение (рёбро 201м), res 10 ≈ ~76м. v4 переименовал всё: `latlng_to_cell`, `cell_to_boundary`, `h3shape_to_cells`.
```python
import h3, geopandas as gpd
from shapely.geometry import Polygon
def h3_grid(poly_wgs, res=9):
    cells = h3.h3shape_to_cells(h3.geo_to_h3shape(poly_wgs), res)
    rows = [{"h3":c, "geometry":Polygon([(lng,lat) for lat,lng in h3.cell_to_boundary(c)])}
            for c in cells]
    return gpd.GeoDataFrame(rows, crs=4326)
```
Перенос населения: `tobler.area_weighted.area_interpolate(source, target, extensive_variables=["population"], intensive_variables=["pct_over_65"])`. ⚠ counts → `extensive` (дробятся по площади), rates → `intensive` (усредняются). Оба фрейма в одном метрическом CRS.

### 2.4 Сетевые дистанции / изохроны
- **OSMnx** для полигонов-изохрон на немного точек: `graph_from_polygon(poly, network_type="walk")` → `project_graph` → `nearest_nodes` → `nx.ego_graph(G, node, radius=400, distance="length")` → catchment из достижимых узлов/рёбер.
- **pandana** для citywide nearest-POI на 10⁴–10⁵ точек: `Network(...)`, `precompute(2000)`, `set_pois`, `nearest_pois`. Паттерн: OSMnx грузит/чистит граф → pandana делает тяжёлый счёт.

### 2.5 Спрос — 2SFCA / E2SFCA
Ручная векторная версия (без зависимости `access`):
```python
import numpy as np
def two_sfca(D, pop, cap, d0=800, decay=None):   # D: (demand×supply) метры
    W = np.ones_like(D) if decay is None else decay(D)
    W[D > d0] = 0.0
    R = np.divide(cap, (W*pop[:,None]).sum(0), out=np.zeros_like(cap,float), where=(W*pop[:,None]).sum(0)>0)
    return (W * R[None,:]).sum(1)                  # A_i: низкий = недо-обслужен = кандидат
gaussian = lambda s: (lambda D: np.exp(-(D**2)/(2*s**2)))
```
Или PySAL `access.Access(...).enhanced_two_stage_fca(cost="distance", max_cost=900, weight_fn=weights.step_fn({300:1.,600:.68,900:.22}))`.

### 2.6 Кандидаты + оптимизация
Пул: under-served центроиды (нижний перцентиль `A_i`) + DBSCAN-кластеры POI + узлы сети; дедуп; выкинуть в радиусе S от существующих.

**Greedy (MVP, гарантия ≥(1−1/e)≈63%):**
```python
import numpy as np
from scipy.spatial import cKDTree
def greedy_max_coverage(cand_xy, dem_xy, dem_w, S, N):   # метры
    cover = cKDTree(dem_xy).query_ball_point(cand_xy, r=S)
    covered = np.zeros(len(dem_xy), bool); chosen=[]
    for _ in range(N):
        best,bg = -1,0.0
        for c,idx in enumerate(cover):
            if c in chosen: continue
            g = dem_w[idx][~covered[idx]].sum()
            if g>bg: bg,best=g,c
        if best<0 or bg==0: break
        for i in cover[best]: covered[i]=True
        chosen.append(best)
    return chosen, dem_w[covered].sum()/dem_w.sum()
```
(Для больших пулов — lazy-greedy на max-heap: тот же результат, кратно быстрее.)

**MCLP (senior, точный, через PuLP+CBC бесплатно):**
```python
import pulp
from spopt.locate import MCLP   # ещё: LSCP (накрыть всех), PMedian, PCenter (equity)
from scipy.spatial.distance import cdist
m = MCLP.from_cost_matrix(cdist(dem_xy, cand_xy), weights=dem_w,
                          service_radius=S, p_facilities=N)
m = m.solve(pulp.PULP_CBC_CMD(msg=False))
m.perc_cov                                    # % покрытого спроса
chosen = [j for j,v in enumerate(m.fac_vars) if v.value()==1]
```

### 2.7 Before/after
```python
from scipy.spatial import cKDTree
def pct_covered(fac_xy, dem_xy, dem_w, S):
    if len(fac_xy)==0: return 0.0
    d,_ = cKDTree(fac_xy).query(dem_xy, k=1)
    return dem_w[d<=S].sum()/dem_w.sum()
# before = существующие; after = существующие ∪ выбранные. ОДНА метрика для обоих.
```

### 2.8 Производительность (город масштаба Paris/London)
| Величина | Комфортно | Заметка |
|---|---|---|
| Demand-ячейки | 10k–60k | London H3 res 10 ≈ ~100k → тяжело |
| Пул кандидатов | 500–5k | сначала prune до under-served + дедуп |
| **MCLP cost-matrix** | demand×cand ≲ ~10⁷ | 20k×2k=4×10⁷ → CBC уже тяжко |
| Переключатель | `if n_dem×n_cand ≤ 5e6 and want_optimal: MCLP else greedy` | |
Примитивы: `gdf.sindex` (R-tree) для join'ов, `cKDTree` для nearest/в-радиусе, NumPy-маски вместо циклов, `pandana.precompute` один раз.

---

## 3. Scoring (replicating Tree Equity Score)

### 3.1 Формула (мультипликативная, floor 0.1)
```
GapScore   = clip(gap, 0) / gap_max          # gap = (1 − coverage) ИЛИ capped distance, выше = хуже
EquityIndex = 0.1 + 0.9 × mean(N_i)          # N_i = min-max нормализ. индикаторы нужды (0..1)
Score      = 100 × (1 − GapScore × EquityIndex)   # низкий = высокий приоритет
```
Это **истинное мультипликативное взаимодействие**: место приоритетно только при ОБОИХ — большой физический gap И высокая equity-нужда. Любой множитель ≈0 → Score→100.

⚠ В оригинале TES в §5a названо **7** индикаторов, но формула делит на **6** — задокументированная нестыковка. Параметризовать: `mean` по фактическому числу `k` индикаторов, что есть.

### 3.2 Европейские equity-прокси (вместо US-стека)
| TES-индикатор | Наш прокси | Источник |
|---|---|---|
| Age dependency | % 65+ (или dependency ratio с 0–14) | census/Eurostat |
| (контекст плотности) | плотность чел/га | census + площадь |
| Income/poverty UK | IMD дециль (инвертировать: 1=most deprived) | MHCLG IMD |
| Income/poverty BE | BIMD дециль (6 доменов) | Sciensano BIMD |
| Income/poverty FR | FILOSOFI `taux de pauvreté` (IRIS/carreau 200м) или EDI/FDep | INSEE FILOSOFI |
| Child share | % 0–14 (опц.) | census |
| Heat | LST_unit − LST_city (опц.) | Landsat/Sentinel |
**Каждый индикатор ориентировать «выше = больше нужды» ДО нормализации** (инвертировать IMD/доход!).

### 3.3 Нормализация и сравнимость между городами
- **Внутри города → min-max (city-relative).** Максимизирует контраст для бюджета одного города. `MinMaxScaler`.
- **Между городами → один `QuantileTransformer`, обученный на ПУЛЕ всех городов** (подход EPA: ранг против всей вселенной, а не локальной). `QuantileTransformer(output_distribution="uniform")`.
- ⚠ Никогда не сравнивать два city-relative score между городами — это главный мисрид TES-метрик. **Подписывать каждый score его режимом.**

### 3.4 Coverage / before-after честно
Coverage(S) = **доля населения (взвеш.) в пределах сетевого S от ассета**. Лучше distance-decay, чем жёсткий cutoff (401м ≠ «не покрыт»). Показывать **кривую по S** (200/400/800м), а не одно число; одна метрика/decay/слой населения для before и after; знаменатель — всё население города.

### 3.5 Pitfalls + одно-строчные дисклеймеры
| Pitfall | Дисклеймер на methods-странице |
|---|---|
| MAUP | "Scores computed at [IRIS/sector/LSOA]; cross-geography comparison not supported." |
| Ecological fallacy | "Indicators describe areas, not individuals." |
| Edge effects | "Amenities outside the boundary aren't counted; edge gaps may be overstated." |
| Surface vs air temp | "Heat uses satellite land-surface temperature, a proxy for felt air temperature." |
| **OSM completeness** | "Crowd-sourced data is less complete in peripheral areas; missing ≠ absent." ← важнейший, бьёт по equity-цели |

### 3.6 Sensitivity
Варьировать веса (Dirichlet вокруг равных), пересчитать, мерить стабильность: Spearman ρ (общий ранг) + Jaccard топ-N (выживает ли shortlist). ρ>0.9 и Jaccard>0.8 = робастно; ниже — веса решают за вас, показать пользователю. Плюс one-at-a-time (выкидывать по индикатору) — от какого одного зависит ранг.

### 3.7 Reference-функция (сокращённо)
```python
def public_realm_score(units, equity_cols, gap_col="gap_raw", floor=0.10, normalize="minmax", qts=None):
    cols = [c for c in equity_cols if c in units and units[c].notna().any()]
    def mm(s): lo,hi=s.min(),s.max(); return (s-lo)/(hi-lo) if hi>lo else s*0
    N = pd.DataFrame({c:(qts[c].transform(units[[c]]).ravel() if normalize=="quantile_pooled" else mm(units[c]).values)
                      for c in cols}, index=units.index)
    units["EquityIndex"] = floor + (1-floor)*N.mean(axis=1)
    gap = units[gap_col].clip(lower=0); gmax = gap.max()
    units["GapScore"] = gap/gmax if gmax>0 else gap*0
    units["Score"] = 100*(1 - units["GapScore"]*units["EquityIndex"])
    for c in cols:                                   # вклад фактора для explainability-панели
        units[f"contrib_{c}"] = (units["GapScore"]*(1-floor)*(N[f := c and N.columns[N.columns.get_loc(c)]]/len(cols)))
    return units
```
(Полная версия с composite-агрегацией — в ответе агента; composite TES priority-weighted, не плоское среднее.)

---

## 4. Web + Deploy

### 4.1 Карта: react-leaflet (MVP)
⚠ **react-leaflet@5 требует React 19.** Наш шаблон на React 18 → поднять до 19 ИЛИ `npm i react-leaflet@^4 leaflet`.
Данные = choropleth по сотням-тысячам полигонов + точки-кандидаты → в бюджете Leaflet (`preferCanvas:true`). Базовая карта без токена — **CARTO Voyager/Positron** raster (⚠ коммерческое использование требует CARTO-лицензию; для public-interest/demo ок).
```jsx
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
const ramp = v => v>.8?'#08519c':v>.6?'#3182bd':v>.4?'#6baed6':v>.2?'#bdd7e7':'#eff3ff';
<MapContainer center={[48.8566,2.3522]} zoom={12} preferCanvas style={{height:'100vh'}}>
  <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
             attribution='© OpenStreetMap © CARTO'/>
  <GeoJSON key={JSON.stringify(selectedIds)} data={units}
           style={f=>({fillColor:ramp(f.properties.demand_score),weight:.5,color:'#fff',fillOpacity:.7})}/>
  {candidates.map(c=><CircleMarker key={c.id} center={[c.lat,c.lon]}
      radius={selectedIds.includes(c.id)?8:5}/* … */><Popup>{c.name}</Popup></CircleMarker>)}
</MapContainer>
```

### 4.2 Перформанс GeoJSON и когда vector tiles
- Leaflet SVG ~1–2k фич; canvas (`preferCanvas`) ~10k–50k простых путей; markercluster/Supercluster до 100k–500k точек.
- Payload: один GeoJSON < ~3–5 МБ (≈1 МБ gzip). Сначала дешёвые приёмы: `gdf.simplify(tol, preserve_topology=True)` / `mapshaper -simplify 15%` / TopoJSON; обрезать properties до читаемых картой; квантизация координат до 6 знаков; split-слои; gzip.
- **Switch на PMTiles + tippecanoe + MapLibre** когда слой > ~5–10 МБ после упрощения или много городов. `tippecanoe -zg --drop-densest-as-needed -o units.pmtiles -l units units.geojson`; MapLibre читает `pmtiles://…` из статики (⚠ нужен `Range`-CORS на хосте).

### 4.3 Слайдер сценария (greedy в браузере, без бэкенда)
Шипим `candidates.json` (каждый кандидат: `covers:[cellIds]`, `metrics:{equity,access,cost_eff}`); на изменение слайдера — greedy по precomputed данным. ~`budget×N×M` ≈ микросекунды; debounce ~100мс; `selectedIds` → в карту через `key`-restyle. Before/after = два прогона (budget 0 и текущий), diff `coveragePct`.

### 4.4 Раздача статики
- **MVP:** GeoJSON/JSON в Vite `public/` → копируется в `dist/` → `express.static`. `fetch()` для всего > ~100 КБ (не `import` — иначе впекается в JS-бандл).
- **Апгрейд:** большие файлы (PMTiles, multi-MB) → Cloudflare R2 (free egress, 10 ГБ) / GitHub Releases / jsDelivr. База через env:
```js
const BASE = import.meta.env.VITE_DATA_BASE_URL ?? '';   // '' = same-origin /public
fetch(`${BASE}/data/paris/toilets/candidates.json`);
```

### 4.5 PDF-отчёт
`react-to-print@3` (хук `useReactToPrint({contentRef})`) + print CSS. **Не Puppeteer на Render free** (нужно 512МБ+, инстанс 512МБ + спин-даун). Снимок карты: **Leaflet → `leaflet-image`** (растровые тайлы + canvas-оверлеи; ⚠ DOM-маркеры не попадут — использовать `CircleMarker`/canvas). MapLibre потребовал бы `preserveDrawingBuffer:true`.

### 4.6 CI: GitHub Actions гоняет движок + деплой
```yaml
name: engine
on:
  workflow_dispatch:
    inputs: { city:{default:'paris'}, asset:{default:'toilets'} }
  schedule: [{ cron: '0 4 * * 1' }]   # UTC only
permissions: { contents: write }
jobs:
  run-engine:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12', cache: 'pip', cache-dependency-path: requirements.txt }
      - run: pip install -r requirements.txt
      - run: python -m engine.run --city "${{ github.event.inputs.city || 'paris' }}" --asset "${{ github.event.inputs.asset || 'toilets' }}"
      - name: Commit outputs
        run: |
          git config user.name engine-bot; git config user.email engine-bot@users.noreply.github.com
          git add frontend/public/data/**
          git diff --staged --quiet || git commit -m "data: refresh [skip ci]"
          git push
```
**Render auto-deploy on push** → следующий Docker-build копирует `frontend/public/data/**` в `dist/`. ⚠ output-папку **НЕ gitignore'ить** (наш текущий `.gitignore` не трогает её — ок, но не добавлять blanket `*.geojson`/`data/`). Тяжёлые native geo-deps (GDAL) → prebuilt container в CI для скорости. Альтернатива: движок пушит в R2, живой сервис тянет через `VITE_DATA_BASE_URL` (обновление без редеплоя).

### 4.7 Рекоменд. MVP web/deploy-стек
react-leaflet 5 (⚠React 19) + Leaflet 1.9 `preferCanvas` · CARTO Voyager raster · GeoJSON+JSON упрощённые оффлайн · в Vite `public/`, `fetch`, база за `VITE_DATA_BASE_URL` · greedy-слайдер в браузере · `react-to-print`+`leaflet-image` · Express+Sequelize в Docker на Render free · GH Actions `engine.yml` (cron+dispatch, commit-back).

---

## 5. Связь с уже собранным шаблоном

| Шаблон (есть) | Роль в проекте | Действие |
|---|---|---|
| React+Vite frontend | Dashboard-оболочка (путь A) | + `react-leaflet` (⚠ React 18→19 или v4), экраны, `fetch` статики |
| Express+Sequelize backend | Upload CSV жалоб, сохранение сценариев, позже RAG-метаданные | + эндпоинты, модели Scenario/Upload |
| SQLite→Postgres через DATABASE_URL | Хранилище сценариев | без изменений |
| Dockerfile / render.yaml | Free-деплой | без изменений; data попадает в `public/` |
| `.gitignore` | — | **не** добавлять `*.geojson`/`data/`; output-папка должна коммититься (путь A) |
| **новое:** `engine/` (Python) | Геодвижок, оффлайн | новая папка, не на runtime-пути |
| **новое:** `.github/workflows/engine.yml` | Пересчёт + commit-back | новый |
| **новое:** `requirements.txt` | geopandas, osmnx, pandana, h3, tobler, access, spopt, pulp, rasterstats, requests | новый |

---

## 6. Что не удалось подтвердить (сделать до кодинга)
1. Antwerp точные FeatureServer URL (org-ID) — копировать из "GeoService" панели.
2. Antwerp bench-слой — нет; OSM = источник для бенчей там.
3. ONS LSOA/Ward суффикс версии (V2/V3) — сверить в "View API Resources".
4. BIMD 2021 — пока только 2001/2011.
5. Opendatasoft лимиты 100/10000 — подтверждены поведением, не текущей doc-страницей.
6. Telraam точный путь segment-list и лицензия — сверить с живой Postman-коллекцией / telraam.net/terms.
7. h3-py версия (v4 порядок (lat,lng)), OSMnx 2.x неймспейсы, лимиты CBC — сверить на своём окружении/железе.
