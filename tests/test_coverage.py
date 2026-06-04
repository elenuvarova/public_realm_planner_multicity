"""Invariants for the max-coverage optimisers (engine/candidates.py)."""

from __future__ import annotations

import geopandas as gpd
import pytest
from shapely.geometry import Point

from engine.candidates import greedy_max_coverage, mclp_max_coverage

from .conftest import TEST_CRS


def _candidates(points: list[tuple[float, float]]) -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {"id": [f"cand_{i}" for i in range(len(points))]},
        geometry=[Point(x, y) for x, y in points],
        crs=TEST_CRS,
    )


def test_coverage_steps_length_is_n_plus_one(synthetic_grid, synthetic_assets):
    """coverage_steps must be length n_selected + 1 (step 0 = before any new asset)."""
    cands = _candidates([(500_400, 200_400), (500_800, 200_800), (500_200, 200_600)])
    budget = 3
    selected, report = greedy_max_coverage(
        cands, synthetic_grid, synthetic_assets, TEST_CRS,
        service_radius_m=300.0, budget=budget,
    )
    assert len(report["coverage_steps"]) == report["n_selected"] + 1
    assert report["n_selected"] == len(selected)
    assert report["n_selected"] <= budget


def test_coverage_steps_monotonic_non_decreasing(synthetic_grid, synthetic_assets):
    """Each additional facility can only add coverage, never remove it."""
    cands = _candidates([(500_400, 200_400), (500_800, 200_800), (500_200, 200_600)])
    _, report = greedy_max_coverage(
        cands, synthetic_grid, synthetic_assets, TEST_CRS,
        service_radius_m=300.0, budget=3,
    )
    steps = report["coverage_steps"]
    assert all(b >= a - 1e-9 for a, b in zip(steps, steps[1:]))


def test_coverage_after_at_least_before(synthetic_grid, synthetic_assets):
    cands = _candidates([(500_400, 200_400), (500_800, 200_800)])
    _, report = greedy_max_coverage(
        cands, synthetic_grid, synthetic_assets, TEST_CRS,
        service_radius_m=300.0, budget=2,
    )
    assert report["coverage_after"] >= report["coverage_before"] - 1e-9


def test_greedy_equals_mclp_on_trivial_instance(synthetic_grid, synthetic_assets):
    """
    On a trivial instance (budget large enough to pick everything useful), the
    greedy submodular optimum equals the exact MCLP optimum in total coverage.
    """
    pulp = pytest.importorskip("pulp", reason="pulp/CBC not available")
    cands = _candidates([(500_400, 200_400), (500_800, 200_800), (500_200, 200_600)])

    g_sel, g_rep = greedy_max_coverage(
        cands, synthetic_grid, synthetic_assets, TEST_CRS,
        service_radius_m=300.0, budget=len(cands),
    )
    m_sel, m_rep = mclp_max_coverage(
        cands, synthetic_grid, synthetic_assets, TEST_CRS,
        service_radius_m=300.0, budget=len(cands),
    )
    assert g_rep["coverage_after"] == pytest.approx(m_rep["coverage_after"], abs=1e-6)
