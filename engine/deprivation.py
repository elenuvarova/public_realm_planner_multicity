"""engine/deprivation.py

Real census deprivation data for equity scoring.

Paris   → INSEE FILOSOFI 2019 — taux de pauvreté (%) at IRIS level
Antwerp → Statbel BIMD 2011   — composite deprivation at statistical sector level
London  → ONS IMD 2019        — Index of Multiple Deprivation at LSOA 2011 level

Downloaded once, cached under cache/deprivation/.
Each loader returns the input grid with a new column `deprivation_score` ∈ [0, 1]
where 1 = most deprived.  Cells outside all zones get the median score.
Falls back to neutral 0.5 on any download / parse failure.
"""

from __future__ import annotations

import io
import json
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests

_REPO_ROOT = Path(__file__).parent.parent
_DEPR_CACHE = _REPO_ROOT / "cache" / "deprivation"
_UA = {"User-Agent": "PublicRealmPlanner/1.0 (research; open-source)"}


def _get(url: str, params: dict | None = None, timeout: int = 90) -> requests.Response:
    r = requests.get(url, params=params, headers=_UA, timeout=timeout)
    r.raise_for_status()
    return r


def _cache_dir(city: str) -> Path:
    p = _DEPR_CACHE / city
    p.mkdir(parents=True, exist_ok=True)
    return p


def _spatial_join_scores(
    grid: gpd.GeoDataFrame,
    zones: gpd.GeoDataFrame,
    score_col: str,
    city_crs: int,
) -> gpd.GeoDataFrame:
    """Point-in-polygon join: attach zone score to each H3 centroid."""
    grid = grid.copy()
    zones_m = zones[[score_col, "geometry"]].to_crs(city_crs)

    centroids = grid.to_crs(city_crs).copy()
    centroids["geometry"] = centroids.geometry.centroid

    joined = gpd.sjoin(
        centroids[["geometry"]], zones_m,
        how="left", predicate="within",
    )
    # Drop duplicate index entries (centroid on zone boundary → multiple matches)
    joined = joined[~joined.index.duplicated(keep="first")]
    scores = joined[score_col].reindex(grid.index)
    median_val = scores.median()
    if pd.isna(median_val):
        median_val = 0.5
    grid["deprivation_score"] = scores.fillna(median_val).values
    return grid


# ─────────────────────────────────────────────────────────────────────────────
# Paris — INSEE FILOSOFI 2019
# ─────────────────────────────────────────────────────────────────────────────

# Public opendatasoft dataset: French IRIS geometries
# filter: département 75 (Paris), pagination via limit/offset
_PARIS_IRIS_API = (
    "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/"
    "georef-france-iris-millesime/records"
)
# INSEE FILOSOFI 2019 national CSV (dept-filtered below)
_PARIS_FILO_URL = (
    "https://www.insee.fr/fr/statistiques/fichier/6049648/"
    "BASE_TD_FILO_DISP_IRIS_2019.zip"
)
# Fallback: resolve the latest contours-IRIS resource URL via data.gouv.fr API
_PARIS_IRIS_DATAGOUV_DATASET = "contours-iris"


def _load_paris_iris_api() -> gpd.GeoDataFrame:
    """
    Fetch Paris IRIS geometries from opendatasoft georef-france-iris-millesime.
    The dataset is time-series (multiple millesimes), so we deduplicate by iris_code
    after download to get one polygon per IRIS zone.
    dep_code='75' returns Paris département only (~992 IRIS × N millesimes).
    """
    from shapely.geometry import shape as shapely_shape

    cached = _cache_dir("paris") / "iris_geom_75.gpkg"
    if cached.exists():
        return gpd.read_file(cached)

    print("  fetching Paris IRIS geometries (opendatasoft)...")
    features: list[dict] = []
    offset = 0
    page = 100
    while True:
        resp = _get(_PARIS_IRIS_API, params={
            "where": "dep_code='75'",
            "select": "iris_code,geo_shape",
            "limit": page,
            "offset": offset,
        })
        records = resp.json().get("results", [])
        for rec in records:
            geo = rec.get("geo_shape")
            # iris_code may be returned as a list ['XXXXXXXXX']; normalise to str
            raw = rec.get("iris_code", "")
            code = (raw[0] if isinstance(raw, list) else str(raw)).strip()
            if geo and code:
                features.append({"IRIS": code, "geo": geo})
        if len(records) < page:
            break
        offset += page

    if not features:
        raise ValueError("opendatasoft returned no Paris IRIS features")

    rows = []
    for feat in features:
        try:
            geom = shapely_shape(feat["geo"])
            rows.append({"IRIS": feat["IRIS"], "geometry": geom})
        except Exception:
            continue

    gdf = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    # Deduplicate: multiple millesimes share the same IRIS code; keep one geometry
    gdf = gdf.drop_duplicates(subset="IRIS").reset_index(drop=True)
    gdf.to_file(cached, driver="GPKG")
    print(f"  cached {len(gdf)} Paris IRIS polygons")
    return gdf


def _load_paris_iris_zip() -> gpd.GeoDataFrame:
    """
    Fallback: resolve and download the latest contours-IRIS zip from data.gouv.fr,
    filter for Paris dept 75.
    """
    from shapely.geometry import shape as shapely_shape

    cached = _cache_dir("paris") / "iris_geom_75.gpkg"
    if cached.exists():
        return gpd.read_file(cached)

    # Resolve latest resource URL via data.gouv.fr API
    print("  resolving contours-IRIS resource URL (data.gouv.fr)...")
    meta = _get(f"https://www.data.gouv.fr/api/1/datasets/{_PARIS_IRIS_DATAGOUV_DATASET}/").json()
    resources = meta.get("resources", [])
    # Find a zip resource whose URL points to a shapefile archive
    zip_resource = next(
        (r for r in resources if r.get("url", "").endswith(".zip") and "IRIS" in r.get("url", "").upper()),
        resources[0] if resources else None,
    )
    if not zip_resource:
        raise ValueError("No zip resource found on data.gouv.fr for contours-IRIS")
    zip_url = zip_resource["url"]
    print(f"  downloading IRIS contours from {zip_url}...")
    resp = _get(zip_url, timeout=180)
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        shp = next((n for n in zf.namelist() if n.endswith(".shp")), None)
        if shp:
            with tempfile.TemporaryDirectory() as tmp:
                zf.extractall(tmp)
                gdf = gpd.read_file(Path(tmp) / shp)
        else:
            jsn = next(n for n in zf.namelist() if n.endswith((".geojson", ".json")))
            with zf.open(jsn) as f:
                gdf = gpd.read_file(f)

    iris_col = next((c for c in ["CODE_IRIS", "IRIS", "GRD_QUART"] if c in gdf.columns), gdf.columns[0])
    gdf = gdf[gdf[iris_col].astype(str).str.startswith("75", na=False)].copy()
    gdf = gdf.rename(columns={iris_col: "IRIS"})[["IRIS", "geometry"]]
    gdf.to_file(cached, driver="GPKG")
    return gdf


def _load_paris_filosofi() -> pd.DataFrame:
    """Download and cache FILOSOFI 2019 poverty rates for Paris IRIS."""
    cached = _cache_dir("paris") / "filosofi_paris_2019.csv"
    if cached.exists():
        return pd.read_csv(cached, dtype={"IRIS": str})

    print("  downloading INSEE FILOSOFI 2019 (national zip, filtered to dept 75)...")
    resp = _get(_PARIS_FILO_URL, timeout=180)
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        csv_name = next(
            n for n in zf.namelist()
            if n.upper().endswith(".CSV") and "IRIS" in n.upper()
        )
        with zf.open(csv_name) as f:
            try:
                df = pd.read_csv(f, sep=";", dtype=str, encoding="utf-8")
            except UnicodeDecodeError:
                f.seek(0)
                df = pd.read_csv(f, sep=";", dtype=str, encoding="latin-1")

    # Filter Paris (IRIS code starts with 75)
    iris_col = next(c for c in df.columns if "IRIS" in c.upper())
    df = df[df[iris_col].str.startswith("75", na=False)].copy()
    df = df.rename(columns={iris_col: "IRIS"})

    # Poverty rate column: TP6019 (taux pauvreté 60%, 2019) or variant names
    # FILOSOFI 2019 column: DISP_TP6019 (taux de pauvreté 60%, revenus disponibles)
    # Older exports may drop the DISP_ prefix
    rate_col = next(
        (c for c in [
            "DISP_TP6019", "TP6019",
            "DISP_PACT19", "PACT19",
            "DISP_TP60",   "TP60",
        ] if c in df.columns),
        None,
    )
    if rate_col is None:
        # Fallback: any column matching TP60 pattern (poverty rate at 60% threshold)
        rate_col = next(
            (c for c in df.columns if "TP60" in c.upper()),
            None,
        )
    if rate_col is None:
        raise ValueError(f"Poverty rate column not found in FILOSOFI. Columns: {list(df.columns[:20])}")

    df["poverty_rate"] = pd.to_numeric(df[rate_col], errors="coerce")
    result = df[["IRIS", "poverty_rate"]].dropna(subset=["poverty_rate"])
    result.to_csv(cached, index=False)
    print(f"  FILOSOFI: {len(result)} Paris IRIS with poverty data")
    return result


def load_deprivation_paris(
    grid: gpd.GeoDataFrame,
    boundary: gpd.GeoDataFrame,
    city_crs: int,
) -> gpd.GeoDataFrame:
    """INSEE FILOSOFI 2019 poverty rate → deprivation_score [0, 1]."""
    # IRIS geometry: try fast API first, fall back to large zip
    try:
        iris_geom = _load_paris_iris_api()
    except Exception as e:
        print(f"  opendatasoft IRIS API failed ({e!r}), trying data.gouv.fr zip...")
        iris_geom = _load_paris_iris_zip()

    filosofi = _load_paris_filosofi()

    zones = iris_geom.merge(filosofi, on="IRIS", how="inner")
    if zones.empty:
        raise ValueError("Paris FILOSOFI/IRIS join is empty — check IRIS code format")

    lo, hi = zones["poverty_rate"].min(), zones["poverty_rate"].max()
    zones["deprivation_score"] = (
        ((zones["poverty_rate"] - lo) / (hi - lo)).clip(0, 1)
        if hi > lo else 0.5
    )
    grid = _spatial_join_scores(grid, zones, "deprivation_score", city_crs)
    covered = (grid["deprivation_score"] != grid["deprivation_score"].median()).mean() * 100
    print(f"  Paris deprivation: {len(zones)} IRIS zones joined  "
          f"(poverty range {lo:.1f}%–{hi:.1f}%)")
    return grid


# ─────────────────────────────────────────────────────────────────────────────
# Antwerp — Statbel BIMD 2011
# ─────────────────────────────────────────────────────────────────────────────

# BIMD 2011 data lives on GitHub (Statbel URLs are dead)
_BIMD_REPO = "https://raw.githubusercontent.com/bimd-project/bimd/main"
_ANTWERP_BIMD_URL = (
    f"{_BIMD_REPO}/FILE%202%20BIMD2011%20DOMAINS%20%28SCORES%2C%20RANKS%2C%20DECILES%29/"
    "BIMD2011_DOMAINS_STATISTICAL_SECTOR_ELLIS_WIDE.csv"
)
_ANTWERP_SECTORS_URL = (
    f"{_BIMD_REPO}/FILE%203%20SHAPEFILES/SHAPE_FILES_2011.zip"
)
# Antwerp city NIS-code prefix in sector codes  (CD_RES_SECTOR format: "11002A00-")
_ANTWERP_NIS_PREFIX = "11002"


def _load_antwerp_bimd() -> pd.DataFrame:
    """
    BIMD 2011 CSV from github.com/bimd-project/BIMD.
    Sector code: CD_RES_SECTOR (format '11002A00-').
    Score: BIMD2011_score (composite index; higher = more deprived).
    Filter to Antwerp city (NIS prefix '11002').
    """
    cached = _cache_dir("antwerp") / "bimd2011.csv"
    if cached.exists():
        return pd.read_csv(cached, dtype={"cd_sector": str})

    print("  downloading BIMD 2011 from github.com/bimd-project/BIMD...")
    resp = _get(_ANTWERP_BIMD_URL)
    df = pd.read_csv(io.StringIO(resp.text))

    df = df.rename(columns={"CD_RES_SECTOR": "cd_sector"})
    df["cd_sector"] = df["cd_sector"].astype(str).str.strip()
    df = df[df["cd_sector"].str.startswith(_ANTWERP_NIS_PREFIX)].copy()

    if "BIMD2011_score" not in df.columns:
        raise ValueError(f"BIMD2011_score column missing. Columns: {list(df.columns)}")

    df["bimd_score"] = pd.to_numeric(df["BIMD2011_score"], errors="coerce")
    result = df[["cd_sector", "bimd_score"]].dropna(subset=["bimd_score"])
    result.to_csv(cached, index=False)
    print(f"  BIMD: {len(result)} Antwerp sectors with scores")
    return result


def _load_antwerp_sectors() -> gpd.GeoDataFrame:
    """
    BIMD 2011 shapefile from github.com/bimd-project/BIMD (already EPSG:31370).
    Filter by CD_MUNTY_R == 11002 (Antwerp city).
    Join key: CD_SECTOR → cd_sector (matches BIMD CSV CD_RES_SECTOR).
    """
    cached = _cache_dir("antwerp") / "stat_sectors_antwerp.gpkg"
    if cached.exists():
        return gpd.read_file(cached)

    print("  downloading BIMD 2011 shapefile from github.com/bimd-project/BIMD...")
    resp = _get(_ANTWERP_SECTORS_URL, timeout=120)
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        shp = next((n for n in zf.namelist() if n.endswith(".shp")), None)
        if shp is None:
            raise ValueError(f"No .shp found in BIMD zip. Contents: {zf.namelist()}")
        with tempfile.TemporaryDirectory() as tmp:
            zf.extractall(tmp)
            gdf = gpd.read_file(Path(tmp) / shp)

    # Filter to Antwerp city (NIS code 11002)
    gdf = gdf[gdf["CD_MUNTY_R"].astype(str) == _ANTWERP_NIS_PREFIX].copy()
    gdf = gdf.rename(columns={"CD_SECTOR": "cd_sector"})[["cd_sector", "geometry"]]
    gdf["cd_sector"] = gdf["cd_sector"].astype(str).str.strip()
    gdf.to_file(cached, driver="GPKG")
    print(f"  Antwerp stat sectors: {len(gdf)} zones saved")
    return gdf


def load_deprivation_antwerp(
    grid: gpd.GeoDataFrame,
    boundary: gpd.GeoDataFrame,
    city_crs: int,
) -> gpd.GeoDataFrame:
    """Statbel BIMD 2011 → deprivation_score [0, 1]."""
    bimd = _load_antwerp_bimd()
    sectors = _load_antwerp_sectors()

    zones = sectors.merge(bimd, on="cd_sector", how="inner")
    if zones.empty:
        # Try matching on different prefix lengths (NIS codes sometimes 8 vs 9 chars)
        bimd["cd_sector_short"] = bimd["cd_sector"].str[:9]
        sectors["cd_sector_short"] = sectors["cd_sector"].str[:9]
        zones = sectors.merge(bimd.rename(columns={"cd_sector": "cd_sector_orig"}),
                              left_on="cd_sector_short", right_on="cd_sector_short", how="inner")
    if zones.empty:
        raise ValueError("Antwerp BIMD/sector join is empty — check sector code format")

    lo, hi = zones["bimd_score"].min(), zones["bimd_score"].max()
    zones["deprivation_score"] = (
        ((zones["bimd_score"] - lo) / (hi - lo)).clip(0, 1)
        if hi > lo else 0.5
    )
    grid = _spatial_join_scores(grid, zones, "deprivation_score", city_crs)
    print(f"  Antwerp deprivation: {len(zones)} sectors joined  "
          f"(BIMD range {lo:.2f}–{hi:.2f})")
    return grid


# ─────────────────────────────────────────────────────────────────────────────
# London — ONS IMD 2019
# ─────────────────────────────────────────────────────────────────────────────

_LONDON_IMD_URL = (
    "https://assets.publishing.service.gov.uk/government/uploads/system/uploads/"
    "attachment_data/file/833970/File_1_-_IMD2019_Index_of_Multiple_Deprivation.xlsx"
)
# ONS ArcGIS REST: LSOA 2011 super-generalised boundaries (England & Wales)
_LSOA_SERVICE = (
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/"
    "LSOA_2011_Boundaries_Super_Generalised_Clipped_BSC_EW_V4/"
    "FeatureServer/0/query"
)
_LSOA_PAGE = 1000   # max records per REST page


def _load_london_imd() -> pd.DataFrame:
    """
    ONS IMD 2019 File 1 from gov.uk.
    Prefers 'Score' column; falls back to 'Rank' (inverted: lower rank = more deprived).
    Decile is also accepted as a last resort.
    """
    cached = _cache_dir("london") / "imd2019_file1.csv"
    if cached.exists():
        return pd.read_csv(cached, dtype={"LSOA11CD": str})

    print("  downloading ONS IMD 2019 (File 1)...")
    resp = _get(_LONDON_IMD_URL)
    df = pd.read_excel(io.BytesIO(resp.content), sheet_name="IMD2019", dtype=str)

    # LSOA code column
    code_col = next(
        (c for c in df.columns if "LSOA" in c and "code" in c.lower()),
        None,
    )
    if code_col is None:
        raise ValueError(f"LSOA code column not found. Columns: {list(df.columns)}")
    df = df.rename(columns={code_col: "LSOA11CD"})

    # Prefer IMD Score > Rank > Decile
    score_col = next((c for c in df.columns if "IMD" in c and "Score" in c), None)
    use_inverted = False
    if score_col is None:
        score_col = next((c for c in df.columns if "IMD" in c and "Rank" in c), None)
        use_inverted = True  # rank 1 = most deprived; we invert later
    if score_col is None:
        score_col = next((c for c in df.columns if "IMD" in c and "Decile" in c), None)
        use_inverted = True

    if score_col is None:
        raise ValueError(f"No IMD score/rank/decile column found. Columns: {list(df.columns)}")

    df["_raw"] = pd.to_numeric(df[score_col], errors="coerce")
    df = df.dropna(subset=["_raw"]).copy()

    if use_inverted:
        # Rank/decile: lower = more deprived → invert so that high value = more deprived
        max_val = df["_raw"].max()
        df["imd_score"] = max_val + 1 - df["_raw"]
    else:
        df["imd_score"] = df["_raw"]

    result = df[["LSOA11CD", "imd_score"]]
    result.to_csv(cached, index=False)
    print(f"  IMD 2019: {len(result)} LSOAs ({'rank-inverted' if use_inverted else 'score'})")
    return result


def _load_london_lsoa(boundary: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    cached = _cache_dir("london") / "lsoa2011_london.gpkg"
    if cached.exists():
        return gpd.read_file(cached)

    print("  downloading London LSOA 2011 boundaries (ONS ArcGIS REST)...")
    bbox = boundary.to_crs(4326).total_bounds
    env = f"{bbox[0]:.4f},{bbox[1]:.4f},{bbox[2]:.4f},{bbox[3]:.4f}"

    gdfs: list[gpd.GeoDataFrame] = []
    offset = 0
    while True:
        resp = _get(_LSOA_SERVICE, params={
            "where": "1=1",
            "geometry": env,
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "LSOA11CD",
            "outSR": "4326",
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": _LSOA_PAGE,
        })
        chunk = gpd.read_file(io.StringIO(resp.text))
        if chunk.empty:
            break
        gdfs.append(chunk[["LSOA11CD", "geometry"]])
        if len(chunk) < _LSOA_PAGE:
            break
        offset += _LSOA_PAGE

    if not gdfs:
        raise ValueError("No LSOA boundaries returned by ONS service")

    result = gpd.GeoDataFrame(
        pd.concat(gdfs, ignore_index=True), crs="EPSG:4326"
    )
    result.to_file(cached, driver="GPKG")
    print(f"  LSOA: {len(result)} zones saved")
    return result


def load_deprivation_london(
    grid: gpd.GeoDataFrame,
    boundary: gpd.GeoDataFrame,
    city_crs: int,
) -> gpd.GeoDataFrame:
    """ONS IMD 2019 score → deprivation_score [0, 1]."""
    imd = _load_london_imd()
    lsoa = _load_london_lsoa(boundary)

    zones = lsoa.merge(imd, on="LSOA11CD", how="inner")
    if zones.empty:
        raise ValueError("London LSOA/IMD join is empty — check LSOA11CD format")

    lo, hi = zones["imd_score"].min(), zones["imd_score"].max()
    zones["deprivation_score"] = (
        ((zones["imd_score"] - lo) / (hi - lo)).clip(0, 1)
        if hi > lo else 0.5
    )
    grid = _spatial_join_scores(grid, zones, "deprivation_score", city_crs)
    print(f"  London deprivation: {len(zones)} LSOA zones joined  "
          f"(IMD score range {lo:.1f}–{hi:.1f})")
    return grid


# ─────────────────────────────────────────────────────────────────────────────
# Dispatcher
# ─────────────────────────────────────────────────────────────────────────────

_LOADERS = {
    "paris":   load_deprivation_paris,
    "antwerp": load_deprivation_antwerp,
    "london":  load_deprivation_london,
}


def load_deprivation(
    city_key: str,
    grid: gpd.GeoDataFrame,
    boundary: gpd.GeoDataFrame,
    city_crs: int,
) -> gpd.GeoDataFrame:
    """
    Return grid with `deprivation_score` ∈ [0, 1] (1 = most deprived).
    Falls back to neutral 0.5 on any failure so the engine run continues.
    """
    loader = _LOADERS.get(city_key)
    if loader is None:
        print(f"  no deprivation loader for {city_key!r} — using neutral 0.5")
        grid = grid.copy()
        grid["deprivation_score"] = 0.5
        return grid
    try:
        return loader(grid, boundary, city_crs)
    except Exception as exc:
        print(f"  ⚠ deprivation failed for {city_key} ({exc!r}) — using neutral 0.5")
        grid = grid.copy()
        grid["deprivation_score"] = 0.5
        return grid
