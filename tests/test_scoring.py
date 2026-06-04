"""Invariants for the TES-style scoring functions (engine/scoring.py)."""

from __future__ import annotations

import numpy as np

from engine.scoring import compute_equity_index, compute_score


def test_equity_index_in_bounds(synthetic_grid):
    """EquityIndex = 0.1 + 0.9·mean(normed) must always land in [0.1, 1.0]."""
    g = compute_equity_index(
        synthetic_grid, equity_cols=["deprivation_score", "demand_weight"]
    )
    ei = g["EquityIndex"].values
    assert np.all(ei >= 0.1 - 1e-9)
    assert np.all(ei <= 1.0 + 1e-9)


def test_equity_index_neutral_when_no_usable_cols(synthetic_grid):
    """With no usable equity columns the index defaults to the neutral 0.5."""
    g = compute_equity_index(synthetic_grid, equity_cols=["does_not_exist"])
    assert (g["EquityIndex"] == 0.5).all()


def test_score_in_bounds(synthetic_grid):
    """Score = 100·(1 − GapScore·EquityIndex) must be clipped to [0, 100]."""
    g = compute_equity_index(
        synthetic_grid, equity_cols=["deprivation_score", "demand_weight"]
    )
    g = compute_score(g)
    s = g["Score"].values
    assert np.all(s >= 0.0)
    assert np.all(s <= 100.0)


def test_score_monotonic_in_gap(synthetic_grid):
    """Holding EquityIndex fixed, a larger GapScore must not raise Score."""
    g = synthetic_grid.copy()
    g["EquityIndex"] = 0.8
    g["GapScore"] = 0.2
    low_gap = compute_score(g)["Score"].iloc[0]
    g["GapScore"] = 0.9
    high_gap = compute_score(g)["Score"].iloc[0]
    assert high_gap <= low_gap
