"""
Phase 6: ML Inference Runner
Loads model and returns probability prediction.

Usage:
  python predict.py --model /app/ml_artifacts/model_001 --features '{"pattern_height_pct": 0.05, ...}'
  
Or as HTTP server:
  python predict.py --model /app/ml_artifacts/model_001 --serve --port 8003
"""

import argparse
import json
import sys
import joblib
import numpy as np
from typing import Dict, Optional


# ═══════════════════════════════════════════════════════════════
# MODEL CACHE
# ═══════════════════════════════════════════════════════════════

_model_cache: Dict[str, dict] = {}


def load_model(model_path: str) -> dict:
    """Load model from path (cached)"""
    if model_path not in _model_cache:
        artifact = joblib.load(f"{model_path}/model.joblib")
        _model_cache[model_path] = artifact
    return _model_cache[model_path]


# ═══════════════════════════════════════════════════════════════
# PREDICTION
# ═══════════════════════════════════════════════════════════════

def predict(model_path: str, features: Dict[str, float]) -> dict:
    """Predict probability from features"""
    try:
        artifact = load_model(model_path)
        model = artifact["model"]
        columns = artifact["columns"]
        
        # Align features to model columns
        X = np.zeros((1, len(columns)))
        for i, col in enumerate(columns):
            X[0, i] = features.get(col, 0.0)
        
        # Predict probability
        prob = model.predict_proba(X)[0, 1]
        
        return {
            "ok": True,
            "probability": float(prob),
            "threshold": artifact.get("r_threshold", 0.5),
            "features_used": len(columns),
            "features_provided": len(features),
        }
    
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "probability": None,
        }


# ═══════════════════════════════════════════════════════════════
# HTTP SERVER (optional)
# ═══════════════════════════════════════════════════════════════

def run_server(model_path: str, port: int):
    """Run simple HTTP prediction server"""
    from http.server import HTTPServer, BaseHTTPRequestHandler
    import json
    
    # Preload model
    load_model(model_path)
    print(f"Model loaded from: {model_path}")
    
    class PredictHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            content_length = int(self.headers['Content-Length'])
            body = self.rfile.read(content_length).decode('utf-8')
            
            try:
                data = json.loads(body)
                features = data.get("features", {})
                result = predict(model_path, features)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())
            
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode())
        
        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ready", "model": model_path}).encode())
        
        def log_message(self, format, *args):
            pass  # Suppress logs
    
    server = HTTPServer(('0.0.0.0', port), PredictHandler)
    print(f"Prediction server running on port {port}")
    server.serve_forever()


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="ML Inference Runner")
    parser.add_argument("--model", required=True, help="Path to model directory")
    parser.add_argument("--features", help="JSON features dict")
    parser.add_argument("--serve", action="store_true", help="Run as HTTP server")
    parser.add_argument("--port", type=int, default=8003)
    args = parser.parse_args()
    
    if args.serve:
        run_server(args.model, args.port)
    elif args.features:
        features = json.loads(args.features)
        result = predict(args.model, features)
        print(json.dumps(result, indent=2))
    else:
        # Read from stdin
        for line in sys.stdin:
            if line.strip():
                features = json.loads(line)
                result = predict(args.model, features)
                print(json.dumps(result))
                sys.stdout.flush()


if __name__ == "__main__":
    main()
