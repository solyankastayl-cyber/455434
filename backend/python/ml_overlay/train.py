#!/usr/bin/env python3
"""
Phase L: LightGBM Training Pipeline
Trains ML model on TA dataset for probability refinement
"""

import json
import joblib
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, brier_score_loss
import lightgbm as lgb

FEATURE_ORDER = [
    'score', 'calibratedProbability',
    'rrToT1', 'rrToT2', 'riskPct', 'rewardPct',
    'ma20Slope', 'ma50Slope', 'maAlignment',
    'atrPercentile', 'compression',
    'patternCount', 'confluenceScore', 'confluenceFactors', 'trendAlignment',
    'marketRegime_TREND_UP', 'marketRegime_TREND_DOWN', 
    'marketRegime_RANGE', 'marketRegime_TRANSITION',
    'volRegime_LOW', 'volRegime_NORMAL', 'volRegime_HIGH', 'volRegime_EXTREME',
]

def prepare_features(df):
    if 'marketRegime' in df.columns:
        for regime in ['TREND_UP', 'TREND_DOWN', 'RANGE', 'TRANSITION']:
            df[f'marketRegime_{regime}'] = (df['marketRegime'] == regime).astype(int)
    if 'volRegime' in df.columns:
        for vol in ['LOW', 'NORMAL', 'HIGH', 'EXTREME']:
            df[f'volRegime_{vol}'] = (df['volRegime'] == vol).astype(int)
    for col in FEATURE_ORDER:
        if col not in df.columns:
            df[col] = 0.0
    return df

def train_model(df, version='overlay_v1'):
    print(f"Training model {version} with {len(df)} samples...")
    df = prepare_features(df)
    y = df['outcome'].astype(int)
    X = df[FEATURE_ORDER].fillna(0.0).values
    X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    
    model = lgb.LGBMClassifier(n_estimators=400, learning_rate=0.03, num_leaves=31, subsample=0.9, colsample_bytree=0.9, reg_lambda=1.0, verbose=-1)
    model.fit(X_train, y_train)
    
    p_val = model.predict_proba(X_val)[:, 1]
    auc = roc_auc_score(y_val, p_val)
    brier = brier_score_loss(y_val, p_val)
    
    metrics = {'auc': float(auc), 'brier': float(brier), 'rows_train': int(len(y_train)), 'rows_val': int(len(y_val)), 'positive_rate': float(y.mean())}
    schema = {'feature_order': FEATURE_ORDER, 'version': version}
    return model, schema, metrics

def save_artifacts(model, schema, metrics, version, output_dir):
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, output_path / f'{version}_lgbm.joblib')
    with open(output_path / f'{version}_schema.json', 'w') as f:
        json.dump(schema, f, indent=2)
    with open(output_path / f'{version}_metrics.json', 'w') as f:
        json.dump(metrics, f, indent=2)
    print(f"Saved artifacts for {version}, AUC={metrics['auc']:.4f}")

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', default='./data/ml_dataset.csv')
    parser.add_argument('--output', default='./artifacts/ml_overlay')
    parser.add_argument('--version', default='overlay_v1')
    args = parser.parse_args()
    
    df = pd.read_csv(args.input)
    if len(df) < 50:
        print("Not enough data for training")
        return
    model, schema, metrics = train_model(df, args.version)
    save_artifacts(model, schema, metrics, args.version, args.output)

if __name__ == '__main__':
    main()
