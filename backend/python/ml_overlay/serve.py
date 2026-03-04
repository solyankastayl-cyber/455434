#!/usr/bin/env python3
"""Phase L: ML Overlay Inference Service (FastAPI)"""

import json
import joblib
from pathlib import Path
from typing import List
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="ML Overlay Service")
MODEL = None

class PredictRequest(BaseModel):
    version: str = "overlay_v1"
    x: List[float]

@app.on_event("startup")
def load_model():
    global MODEL
    model_path = Path("./artifacts/ml_overlay/overlay_v1_lgbm.joblib")
    if model_path.exists():
        MODEL = joblib.load(model_path)
        print(f"Loaded model from {model_path}")

@app.get("/health")
def health():
    return {"ok": True, "model_loaded": MODEL is not None}

@app.post("/predict")
def predict(req: PredictRequest):
    if MODEL is None:
        return {"p": req.x[0] if req.x else 0.5}
    try:
        p = float(MODEL.predict_proba([req.x])[0][1])
        return {"p": p}
    except:
        return {"p": 0.5}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5001)
