"""
Phase 6: ML Training Pipeline
LightGBM classifier for WIN_PROB prediction.

Usage:
  python train.py --jsonl dataset.jsonl --out /app/ml_artifacts/model_001
"""

import argparse
import json
import os
import hashlib
from datetime import datetime
import joblib
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, log_loss, brier_score_loss
import lightgbm as lgb


# ═══════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════

DROP_COLS = [
    "rowId", "runId", "scenarioId", "symbol", "timeframe", "timestamp",
    "schemaVersion", "createdAt", "processedAt",
    "winLoss", "rMultiple", "mfePct", "maePct", "barsInTrade",
    "patternType", "patternFamily", "entryPrice", "stopPrice",
    "target1Price", "target2Price", "exitPrice", "exitReason",
    "side", "regime", "volatilityRegime"
]

# Target threshold: R >= 0.5 = WIN
R_THRESHOLD = 0.5


# ═══════════════════════════════════════════════════════════════
# DATA LOADING
# ═══════════════════════════════════════════════════════════════

def load_jsonl(path: str) -> pd.DataFrame:
    """Load JSONL file into DataFrame"""
    rows = []
    with open(path, "r") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return pd.json_normalize(rows)


def load_csv(path: str) -> pd.DataFrame:
    """Load CSV file into DataFrame"""
    return pd.read_csv(path)


def prepare_data(df: pd.DataFrame):
    """Prepare features and target"""
    # Target: WIN if R >= threshold
    if "rMultiple" in df.columns:
        y = (df["rMultiple"] >= R_THRESHOLD).astype(int)
    elif "labels.rMultiple" in df.columns:
        y = (df["labels.rMultiple"] >= R_THRESHOLD).astype(int)
    else:
        raise ValueError("No rMultiple column found")
    
    # Drop non-feature columns
    X = df.drop(columns=[c for c in DROP_COLS if c in df.columns], errors="ignore")
    
    # Drop any remaining label columns
    label_cols = [c for c in X.columns if c.startswith("labels.") or c.startswith("meta.")]
    X = X.drop(columns=label_cols, errors="ignore")
    
    # Fill NaN with 0
    X = X.fillna(0.0)
    
    # Keep only numeric columns
    X = X.select_dtypes(include=[np.number])
    
    return X, y


# ═══════════════════════════════════════════════════════════════
# CALIBRATION (ECE)
# ═══════════════════════════════════════════════════════════════

def expected_calibration_error(y_true, y_prob, n_bins=10):
    """Calculate Expected Calibration Error"""
    bin_boundaries = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    
    for i in range(n_bins):
        mask = (y_prob >= bin_boundaries[i]) & (y_prob < bin_boundaries[i + 1])
        if mask.sum() > 0:
            bin_acc = y_true[mask].mean()
            bin_conf = y_prob[mask].mean()
            bin_size = mask.sum() / len(y_true)
            ece += bin_size * abs(bin_acc - bin_conf)
    
    return ece


# ═══════════════════════════════════════════════════════════════
# TRAINING
# ═══════════════════════════════════════════════════════════════

def train_model(X_train, y_train, X_test, y_test):
    """Train LightGBM classifier"""
    
    model = lgb.LGBMClassifier(
        n_estimators=800,
        learning_rate=0.03,
        max_depth=6,
        num_leaves=63,
        subsample=0.9,
        colsample_bytree=0.9,
        min_child_samples=20,
        reg_alpha=0.1,
        reg_lambda=0.1,
        random_state=42,
        verbose=-1,
    )
    
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        callbacks=[lgb.early_stopping(50, verbose=False)],
    )
    
    return model


def evaluate_model(model, X_test, y_test):
    """Evaluate model and return metrics"""
    y_prob = model.predict_proba(X_test)[:, 1]
    
    auc = roc_auc_score(y_test, y_prob)
    logloss = log_loss(y_test, y_prob)
    brier = brier_score_loss(y_test, y_prob)
    ece = expected_calibration_error(y_test.values, y_prob)
    
    return {
        "auc": float(auc),
        "logloss": float(logloss),
        "brier": float(brier),
        "ece": float(ece),
    }


# ═══════════════════════════════════════════════════════════════
# ARTIFACT SAVING
# ═══════════════════════════════════════════════════════════════

def save_artifact(model, columns, out_dir, metrics, rows):
    """Save model artifact and metadata"""
    os.makedirs(out_dir, exist_ok=True)
    
    # Save model
    model_path = os.path.join(out_dir, "model.joblib")
    joblib.dump({
        "model": model,
        "columns": columns,
        "r_threshold": R_THRESHOLD,
    }, model_path)
    
    # Calculate checksum
    with open(model_path, "rb") as f:
        checksum = hashlib.sha256(f.read()).hexdigest()
    
    # Save metrics
    meta = {
        "model_id": os.path.basename(out_dir),
        "created_at": datetime.utcnow().isoformat(),
        "rows": rows,
        "features_version": "v2",
        "features_count": len(columns),
        "task": "WIN_PROB",
        "r_threshold": R_THRESHOLD,
        "artifact": {
            "kind": "LOCAL_FILE",
            "path": model_path,
            "checksum_sha256": checksum,
        },
        "metrics": metrics,
        "gates": {
            "min_rows_to_enable": 5000,
            "min_auc_to_enable": 0.56,
            "max_ece_to_enable": 0.08,
            "max_delta_prob": 0.15,
        },
    }
    
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    
    # Save feature importance
    importance = pd.DataFrame({
        "feature": columns,
        "importance": model.feature_importances_,
    }).sort_values("importance", ascending=False)
    importance.to_csv(os.path.join(out_dir, "feature_importance.csv"), index=False)
    
    return meta


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Train ML model for TA Engine")
    parser.add_argument("--jsonl", help="Path to JSONL dataset")
    parser.add_argument("--csv", help="Path to CSV dataset")
    parser.add_argument("--out", required=True, help="Output directory for artifact")
    parser.add_argument("--test-size", type=float, default=0.2)
    args = parser.parse_args()
    
    # Load data
    if args.jsonl:
        print(f"Loading JSONL: {args.jsonl}")
        df = load_jsonl(args.jsonl)
    elif args.csv:
        print(f"Loading CSV: {args.csv}")
        df = load_csv(args.csv)
    else:
        raise ValueError("Provide --jsonl or --csv")
    
    print(f"Loaded {len(df)} rows")
    
    # Prepare data
    X, y = prepare_data(df)
    print(f"Features: {len(X.columns)}, Target distribution: {y.value_counts().to_dict()}")
    
    # Split (time-ordered, no shuffle for financial data)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=args.test_size, shuffle=False
    )
    print(f"Train: {len(X_train)}, Test: {len(X_test)}")
    
    # Train
    print("Training LightGBM...")
    model = train_model(X_train, y_train, X_test, y_test)
    
    # Evaluate
    metrics = evaluate_model(model, X_test, y_test)
    print(f"Metrics: AUC={metrics['auc']:.4f}, LogLoss={metrics['logloss']:.4f}, ECE={metrics['ece']:.4f}")
    
    # Save
    meta = save_artifact(model, list(X.columns), args.out, metrics, len(df))
    print(f"Artifact saved to: {args.out}")
    print(f"Model ID: {meta['model_id']}")
    
    # Quality gate check
    gates_passed = True
    if metrics['auc'] < 0.56:
        print("⚠️ AUC below threshold (0.56)")
        gates_passed = False
    if metrics['ece'] > 0.08:
        print("⚠️ ECE above threshold (0.08)")
        gates_passed = False
    
    if gates_passed:
        print("✅ Quality gates PASSED - model can be enabled for LIVE_LITE")
    else:
        print("⚠️ Quality gates FAILED - model should stay in SHADOW")
    
    return 0


if __name__ == "__main__":
    exit(main())
