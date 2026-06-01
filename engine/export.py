"""
Export engine outputs as static GeoJSON + JSON report.
Files land in frontend/public/data/{city}/{asset}/ so Express serves them as-is.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import geopandas as gpd
import pandas as pd

from .config import OUTPUT_BASE


def _trim_gdf(gdf: gpd.GeoDataFrame, keep_cols: list[str]) -> gpd.GeoDataFrame:
    """Return only the columns that exist + geometry, reprojected to WGS84."""
    cols = ["geometry"] + [c for c in keep_cols if c in gdf.columns]
    return gdf[cols].to_crs(4326)


def write_outputs(
    city: str,
    asset: str,
    grid: gpd.GeoDataFrame,
    assets: gpd.GeoDataFrame,
    candidates: gpd.GeoDataFrame,
    selected: gpd.GeoDataFrame,
    pois: gpd.GeoDataFrame,
    report: dict,
    repo_root: str | None = None,
) -> Path:
    """
    Write all layers and the report JSON to frontend/public/data/{city}/{asset}/.

    Returns the output directory path.
    """
    base = Path(repo_root or Path(__file__).parent.parent) / OUTPUT_BASE / city / asset
    base.mkdir(parents=True, exist_ok=True)

    # augment report counts before writing scenario (slider needs them in meta)
    report["city"] = city
    report["asset"] = asset
    report["n_existing_assets"] = len(assets)
    report["n_candidates_pool"] = len(candidates)
    report["n_grid_cells"] = len(grid)

    # --- analysis units (choropleth) ---
    units_out = _trim_gdf(grid, ["h3_id", "Score", "GapScore", "EquityIndex",
                                  "demand_weight", "poi_count", "dist_to_nearest_m", "priority"])
    units_out.to_file(base / "units.geojson", driver="GeoJSON")

    # --- existing assets ---
    assets_out = _trim_gdf(assets, ["asset_type", "name", "open", "accessible", "source"])
    assets_out.to_file(base / "existing_assets.geojson", driver="GeoJSON")

    # --- all candidates ---
    if not candidates.empty:
        cands_out = _trim_gdf(candidates, ["id", "Score", "GapScore", "EquityIndex",
                                            "demand_weight", "poi_count", "rank"])
        cands_out.to_file(base / "candidates.geojson", driver="GeoJSON")

    # --- selected (greedy result) ---
    if not selected.empty:
        sel_out = _trim_gdf(selected, ["id", "rank", "Score", "GapScore",
                                        "EquityIndex", "demand_weight"])
        sel_out.to_file(base / "selected.geojson", driver="GeoJSON")

    # --- demand POIs (parks/schools/stops) ---
    if not pois.empty:
        pois_out = _trim_gdf(pois, ["poi_type"])
        pois_out.to_file(base / "demand_pois.geojson", driver="GeoJSON")

    # --- scenario data for the browser slider ---
    _write_scenario_json(base, grid, candidates, report)

    # --- summary report ---
    with open(base / "report.json", "w") as f:
        json.dump(report, f, indent=2)

    # --- update top-level index (consumed by city selector in frontend) ---
    _update_index(base.parent.parent, city, asset, report)

    print(f"  output → {base}")
    return base


def _write_scenario_json(
    out_dir: Path,
    grid: gpd.GeoDataFrame,
    candidates: gpd.GeoDataFrame,
    report: dict,
) -> None:
    """
    Pre-computed scenario data for the client-side greedy slider.
    Schema matches the browser greedy function in the frontend.
    """
    # demand: h3_id → demand_weight
    demand = {row["h3_id"]: float(row.get("demand_weight", 1.0))
              for _, row in grid.iterrows() if "h3_id" in row}

    cands_list = []
    for _, row in candidates.iterrows():
        geom = row.geometry
        entry = {
            "id":     row.get("id", ""),
            "lat":    round(geom.y, 6),
            "lon":    round(geom.x, 6),
            "cost":   1,
            "metrics": {
                "gap":    float(row.get("GapScore", 0)),
                "equity": float(row.get("EquityIndex", 0.5)),
                "demand": float(row.get("demand_weight", 1.0)),
            },
        }
        cands_list.append(entry)

    scenario = {
        "meta": {
            "city":              report.get("city", ""),
            "asset":             report.get("asset", ""),
            "service_radius_m":  report.get("service_radius_m", 500),
            "n_demand_cells":    len(demand),
            "n_existing_assets": report.get("n_existing_assets", 0),
            "n_candidates_pool": report.get("n_candidates_pool", 0),
        },
        "coverage_steps": report.get("coverage_steps", []),
        "demand":         demand,
        "candidates":     cands_list,
    }
    with open(out_dir / "scenario.json", "w") as f:
        json.dump(scenario, f)


def _update_index(data_root: Path, city: str, asset: str, report: dict) -> None:
    """Keep frontend/public/data/index.json current with all generated city/asset runs."""
    from .config import CITIES

    index_path = data_root / "index.json"
    if index_path.exists():
        with open(index_path) as f:
            index = json.load(f)
    else:
        index = {"available": []}

    key = f"{city}/{asset}"
    lookup = {f"{e['city']}/{e['asset']}": i for i, e in enumerate(index["available"])}
    entry = {
        "city":             city,
        "asset":            asset,
        "label":            f"{CITIES[city]['display_name']} · {asset.capitalize()}",
        "coverage_before":  report.get("coverage_before", 0),
        "coverage_after":   report.get("coverage_after", 0),
        "n_existing":       report.get("n_existing_assets", 0),
    }
    if key in lookup:
        index["available"][lookup[key]] = entry
    else:
        index["available"].append(entry)

    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)
