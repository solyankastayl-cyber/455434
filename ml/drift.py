"""
Phase 6.3: Drift Monitor (PSI Calculator)
Monitors feature distribution drift between baseline and current data.

Usage:
  python drift.py --baseline baseline.jsonl --current current.jsonl --out drift_report.json
"""

import argparse
import json
import numpy as np
import pandas as pd
from typing import Dict, List, Tuple


# ═══════════════════════════════════════════════════════════════
# MONITORED FEATURES (24 key features)
# ═══════════════════════════════════════════════════════════════

MONITOR_FEATURES = {
    "geometry": [
        "pattern_height_pct", "pattern_width_bars", "compression_score",
        "symmetry_score", "touches_upper", "touches_lower"
    ],
    "structure": [
        "trend_strength", "range_width_pct", "pivot_density",
        "distance_to_support_pct", "distance_to_resistance_pct", "bos_count_50"
    ],
    "volatility": [
        "atr_percentile", "volatility_regime", "volatility_expanding", "candle_range_mean_20"
    ],
    "momentum": [
        "rsi", "rsi_slope", "macd_histogram", "momentum_strength"
    ],
    "risk": [
        "stop_distance_pct", "rr_to_target1", "risk_to_volatility", "position_duration_expected"
    ],
}

# Flatten for iteration
ALL_MONITOR_FEATURES = [f for group in MONITOR_FEATURES.values() for f in group]


# ═══════════════════════════════════════════════════════════════
# PSI CALCULATION
# ═══════════════════════════════════════════════════════════════

def calculate_psi(baseline: np.ndarray, current: np.ndarray, n_bins: int = 10) -> float:
    """
    Calculate Population Stability Index between two distributions.
    
    PSI < 0.10: No significant change
    0.10-0.20: Moderate shift, attention needed
    > 0.20: Significant shift, model may need retraining
    """
    # Handle edge cases
    if len(baseline) == 0 or len(current) == 0:
        return 0.0
    
    # Create bins from baseline quantiles
    try:
        _, bin_edges = pd.qcut(baseline, q=n_bins, retbins=True, duplicates='drop')
    except ValueError:
        # Not enough unique values for quantiles
        return 0.0
    
    # Ensure edges cover all values
    bin_edges[0] = min(baseline.min(), current.min()) - 1e-10
    bin_edges[-1] = max(baseline.max(), current.max()) + 1e-10
    
    # Calculate proportions
    baseline_counts = np.histogram(baseline, bins=bin_edges)[0]
    current_counts = np.histogram(current, bins=bin_edges)[0]
    
    # Add small epsilon to avoid division by zero
    eps = 1e-10
    baseline_pct = (baseline_counts + eps) / (len(baseline) + eps * len(baseline_counts))
    current_pct = (current_counts + eps) / (len(current) + eps * len(current_counts))
    
    # PSI formula
    psi = np.sum((current_pct - baseline_pct) * np.log(current_pct / baseline_pct))
    
    return float(psi)


def get_drift_status(psi: float) -> str:
    """Get drift status from PSI value"""
    if psi < 0.10:
        return "OK"
    elif psi < 0.20:
        return "WARN"
    elif psi < 0.30:
        return "DRIFT"
    else:
        return "HARD_DRIFT"


# ═══════════════════════════════════════════════════════════════
# BASELINE BUILDING
# ═══════════════════════════════════════════════════════════════

def build_baseline_bins(df: pd.DataFrame, n_bins: int = 10) -> Dict[str, List[float]]:
    """Build bin edges from baseline data"""
    bins = {}
    
    for feature in ALL_MONITOR_FEATURES:
        if feature not in df.columns:
            continue
        
        values = df[feature].dropna().values
        if len(values) < n_bins:
            continue
        
        try:
            _, edges = pd.qcut(values, q=n_bins, retbins=True, duplicates='drop')
            bins[feature] = edges.tolist()
        except ValueError:
            continue
    
    return bins


# ═══════════════════════════════════════════════════════════════
# DRIFT CALCULATION
# ═══════════════════════════════════════════════════════════════

def calculate_drift(baseline_df: pd.DataFrame, current_df: pd.DataFrame) -> dict:
    """Calculate drift metrics between baseline and current datasets"""
    
    feature_psi = {}
    group_psi = {}
    
    # Calculate PSI for each monitored feature
    for feature in ALL_MONITOR_FEATURES:
        if feature not in baseline_df.columns or feature not in current_df.columns:
            feature_psi[feature] = 0.0
            continue
        
        baseline_vals = baseline_df[feature].dropna().values
        current_vals = current_df[feature].dropna().values
        
        psi = calculate_psi(baseline_vals, current_vals)
        feature_psi[feature] = round(psi, 4)
    
    # Calculate group PSI
    for group_name, features in MONITOR_FEATURES.items():
        group_vals = [feature_psi.get(f, 0.0) for f in features if f in feature_psi]
        group_psi[group_name] = round(np.mean(group_vals) if group_vals else 0.0, 4)
    
    # Overall drift score (max of groups - conservative)
    drift_score = max(group_psi.values()) if group_psi else 0.0
    
    return {
        "feature_psi": feature_psi,
        "group_psi": group_psi,
        "drift_score": round(drift_score, 4),
        "status": get_drift_status(drift_score),
        "rows_baseline": len(baseline_df),
        "rows_current": len(current_df),
    }


# ═══════════════════════════════════════════════════════════════
# FILE LOADING
# ═══════════════════════════════════════════════════════════════

def load_data(path: str) -> pd.DataFrame:
    """Load JSONL or CSV file"""
    if path.endswith('.jsonl'):
        rows = []
        with open(path, 'r') as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
        return pd.json_normalize(rows)
    else:
        return pd.read_csv(path)


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Drift Monitor")
    parser.add_argument("--baseline", required=True, help="Baseline dataset path")
    parser.add_argument("--current", required=True, help="Current dataset path")
    parser.add_argument("--out", help="Output JSON path")
    args = parser.parse_args()
    
    print(f"Loading baseline: {args.baseline}")
    baseline_df = load_data(args.baseline)
    
    print(f"Loading current: {args.current}")
    current_df = load_data(args.current)
    
    print(f"Calculating drift...")
    result = calculate_drift(baseline_df, current_df)
    
    print(f"\nDrift Report:")
    print(f"  Status: {result['status']}")
    print(f"  Drift Score: {result['drift_score']}")
    print(f"  Group PSI:")
    for group, psi in result['group_psi'].items():
        status = get_drift_status(psi)
        print(f"    {group}: {psi} ({status})")
    
    if args.out:
        with open(args.out, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"\nReport saved to: {args.out}")
    
    return 0


if __name__ == "__main__":
    exit(main())
