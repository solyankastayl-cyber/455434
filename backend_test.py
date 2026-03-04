#!/usr/bin/env python3
"""
Backend Test Suite - Phase 6: ML Training Pipeline
Tests the TypeScript backend endpoints for ML training, model registry, quality gates, and SHADOW→LIVE rollout
"""

import requests
import sys
import json
from datetime import datetime

class TAEngineMLTrainingTester:
    def __init__(self, base_url="http://localhost:8002"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.results = []

    def log_result(self, name, success, response_data=None, error_msg=None):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {error_msg}")
        
        self.results.append({
            "test": name,
            "success": success,
            "data": response_data,
            "error": error_msg
        })

    def run_test(self, name, method, endpoint, expected_status=200, data=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            
            success = response.status_code == expected_status
            response_data = None
            error_msg = None
            
            try:
                response_data = response.json()
            except:
                response_data = {"raw_response": response.text}
            
            if not success:
                error_msg = f"Expected {expected_status}, got {response.status_code}"
                if response_data and isinstance(response_data, dict):
                    if 'error' in response_data:
                        error_msg += f" - {response_data['error']}"
                    elif 'message' in response_data:
                        error_msg += f" - {response_data['message']}"

            self.log_result(name, success, response_data, error_msg)
            return success, response_data

        except requests.exceptions.RequestException as e:
            error_msg = f"Request failed: {str(e)}"
            self.log_result(name, False, None, error_msg)
            return False, {}

    def test_health(self):
        """Test server health - GET /api/ta/health"""
        return self.run_test("Health Check", "GET", "api/ta/health")

    def test_ml_registry_models(self):
        """Test model registry list - GET /api/ta/ml/registry/models"""
        return self.run_test("ML Registry - List Models", "GET", "api/ta/ml/registry/models")

    def test_rollout_check(self):
        """Test quality gates rollout check - GET /api/ta/ml/rollout/check/model_001?targetStage=LIVE_LITE"""
        return self.run_test("ML Quality Gates - Rollout Check", "GET", "api/ta/ml/rollout/check/model_001?targetStage=LIVE_LITE")

    def test_overlay_status(self):
        """Test ML overlay status - GET /api/ta/ml/overlay_v2/status"""
        return self.run_test("ML Overlay - Status", "GET", "api/ta/ml/overlay_v2/status")

    def test_ml_predict(self):
        """Test ML prediction - POST /api/ta/ml/overlay_v2/predict"""
        data = {
            "features": {
                "pattern_height_pct": 4.2,
                "volatility_recent": 0.8,
                "rsi_14": 65.0,
                "volume_ratio": 1.5,
                "trend_strength": 0.7
            },
            "baseProbability": 0.55,
            "symbol": "BTCUSDT", 
            "tf": "1H"
        }
        return self.run_test("ML Overlay - Predict", "POST", "api/ta/ml/overlay_v2/predict", 200, data)

    def run_all_tests(self):
        """Run all ML Training Pipeline tests"""
        print("🚀 Starting Phase 6: ML Training Pipeline Tests")
        print(f"📍 Testing server: {self.base_url}")
        print("=" * 60)

        # Test 1: Health check
        success, _ = self.test_health()
        if not success:
            print("❌ Server not responding. Stopping tests.")
            return False

        # Test 2: ML Registry - should contain model_001
        print("\n📊 Testing ML Model Registry...")
        success, data = self.test_ml_registry_models()
        if success and data:
            models = data.get('models', [])
            active_model = data.get('activeModel')
            
            if models:
                print(f"   ✓ Found {len(models)} registered models")
                model_001_found = any(m.get('modelId') == 'model_001' for m in models)
                if model_001_found:
                    print(f"   ✓ model_001 found in registry")
                else:
                    print(f"   ⚠️  model_001 not found in registry")
                
                # Check for SHADOW stage model
                shadow_models = [m for m in models if m.get('stage') == 'SHADOW']
                if shadow_models:
                    print(f"   ✓ Found {len(shadow_models)} models in SHADOW stage")
            else:
                print(f"   ⚠️  No models found in registry")

            if active_model:
                print(f"   ✓ Active model: {active_model.get('modelId')} ({active_model.get('stage')})")
            else:
                print(f"   ⚠️  No active model found")

        # Test 3: Quality Gates - rollout check
        print("\n🚥 Testing Quality Gates & Rollout Check...")
        success, data = self.test_rollout_check()
        if success and data:
            can_enable = data.get('canEnable', False)
            target_stage = data.get('targetStage')
            reasons = data.get('reasons', [])
            metrics = data.get('metrics', {})
            
            print(f"   ✓ Quality gate check completed for {target_stage}")
            if can_enable:
                print(f"   ✅ Model can be promoted to {target_stage}")
            else:
                print(f"   ⚠️  Model blocked from {target_stage}: {', '.join(reasons)}")
            
            if metrics:
                auc = metrics.get('auc')
                ece = metrics.get('ece')
                rows = metrics.get('rows')
                auc_str = f"{auc:.3f}" if auc is not None else 'N/A'
                ece_str = f"{ece:.3f}" if ece is not None else 'N/A'
                print(f"   📊 Metrics: AUC={auc_str}, ECE={ece_str}, Rows={rows}")

        # Test 4: ML Overlay Status
        print("\n🔄 Testing ML Overlay Status...")
        success, data = self.test_overlay_status()
        if success and data:
            enabled = data.get('enabled', False)
            active_model = data.get('activeModel')
            config = data.get('config', {})
            
            print(f"   ✓ Overlay enabled: {enabled}")
            if active_model:
                print(f"   ✓ Active overlay model: {active_model.get('modelId')} ({active_model.get('stage')})")
            
            alpha_stages = config.get('alphaByStage', {})
            if alpha_stages:
                print(f"   ✓ Alpha config: SHADOW={alpha_stages.get('SHADOW', 0)}, LIVE_LITE={alpha_stages.get('LIVE_LITE', 0)}")

        # Test 5: ML Prediction
        print("\n🧠 Testing ML Prediction...")
        success, data = self.test_ml_predict()
        if success and data:
            ok = data.get('ok', False)
            probability_source = data.get('probabilitySource', 'UNKNOWN')
            final_probability = data.get('finalProbability')
            ml_probability = data.get('mlProbability')
            delta = data.get('delta')
            stage = data.get('stage')
            gates_applied = data.get('gatesApplied', [])
            
            print(f"   ✓ Prediction successful: {ok}")
            print(f"   📈 Source: {probability_source}, Stage: {stage}")
            if final_probability is not None:
                print(f"   📊 Final probability: {final_probability:.3f}")
            if ml_probability is not None:
                print(f"   🤖 ML probability: {ml_probability:.3f}")
            if delta is not None:
                print(f"   🔄 Delta: {delta:.3f}")
            if gates_applied:
                print(f"   🚥 Gates applied: {', '.join(gates_applied)}")

        return True

    def print_summary(self):
        """Print test results summary"""
        print("\n" + "=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed! Phase 6 ML Training Pipeline is working correctly.")
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed.")
        
        print(f"🔧 ML Training Pipeline: LightGBM, Model Registry, Quality Gates")
        print(f"🚀 SHADOW→LIVE rollout with configurable alpha blending")
        
        # Show failed tests
        failed_tests = [r for r in self.results if not r['success']]
        if failed_tests:
            print("\n❌ Failed Tests:")
            for test in failed_tests:
                print(f"   - {test['test']}: {test.get('error', 'Unknown error')}")

def main():
    """Main test runner"""
    print("TA Engine Phase 6: ML Training Pipeline Testing")
    print("Testing LightGBM, Model Registry, Quality Gates, SHADOW→LIVE rollout")
    print()

    tester = TAEngineMLTrainingTester()
    
    # Run all tests
    success = tester.run_all_tests()
    
    # Print summary
    tester.print_summary()
    
    # Return appropriate exit code
    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)