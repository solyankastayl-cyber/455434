"""
P8.0-B — Brain Forecast API Tests (Quantile MoE Model)

Tests for the forecast pipeline with regime-gated Mixture-of-Experts model:
- GET /api/brain/v2/forecast — Quantile forecasts for DXY
- GET /api/brain/v2/forecast/status — Model availability info
- POST /api/brain/v2/forecast/train — MoE model training
- GET /api/brain/v2/forecast/compare — Horizon comparison view
"""

import pytest
import requests
import os
import time
import math

# API base URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://backtest-replay-lab.preview.emergentagent.com').rstrip('/')

# Expected horizons
HORIZONS = ['30D', '90D', '180D', '365D']

# Expected regime keys
REGIME_KEYS = ['EASING', 'TIGHTENING', 'STRESS', 'NEUTRAL']


@pytest.fixture(scope='session')
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestForecastEndpoint:
    """Tests for GET /api/brain/v2/forecast"""
    
    def test_forecast_returns_valid_response(self, api_client):
        """GET /api/brain/v2/forecast?asset=dxy returns valid forecast with 4 horizons"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data.get('ok')}"
        assert data.get('asset') == 'dxy', f"Expected asset=dxy, got {data.get('asset')}"
        
        # Check all 4 horizons present
        by_horizon = data.get('byHorizon', {})
        for h in HORIZONS:
            assert h in by_horizon, f"Missing horizon: {h}"
        
        print(f"✓ Forecast returned with {len(by_horizon)} horizons: {list(by_horizon.keys())}")
    
    def test_forecast_quantile_monotonicity(self, api_client):
        """GET /api/brain/v2/forecast — q05 ≤ q50 ≤ q95 for ALL horizons"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        by_horizon = data.get('byHorizon', {})
        
        for horizon in HORIZONS:
            h_data = by_horizon.get(horizon, {})
            q05 = h_data.get('q05')
            q50 = h_data.get('q50')
            q95 = h_data.get('q95')
            
            assert q05 is not None, f"{horizon}: q05 is None"
            assert q50 is not None, f"{horizon}: q50 is None"
            assert q95 is not None, f"{horizon}: q95 is None"
            
            # Monotonicity: q05 <= q50 <= q95 (allow small epsilon for numerical precision)
            assert q05 <= q50 + 0.001, f"{horizon}: q05 ({q05}) > q50 ({q50})"
            assert q50 <= q95 + 0.001, f"{horizon}: q50 ({q50}) > q95 ({q95})"
            
            print(f"✓ {horizon}: q05={q05:.4f} ≤ q50={q50:.4f} ≤ q95={q95:.4f}")
    
    def test_forecast_all_values_finite(self, api_client):
        """GET /api/brain/v2/forecast — all values are finite numbers"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        by_horizon = data.get('byHorizon', {})
        
        for horizon in HORIZONS:
            h_data = by_horizon.get(horizon, {})
            
            mean = h_data.get('mean')
            q05 = h_data.get('q05')
            q50 = h_data.get('q50')
            q95 = h_data.get('q95')
            tail_risk = h_data.get('tailRisk')
            
            # Check all are finite numbers
            assert isinstance(mean, (int, float)) and math.isfinite(mean), f"{horizon}: mean is not finite ({mean})"
            assert isinstance(q05, (int, float)) and math.isfinite(q05), f"{horizon}: q05 is not finite ({q05})"
            assert isinstance(q50, (int, float)) and math.isfinite(q50), f"{horizon}: q50 is not finite ({q50})"
            assert isinstance(q95, (int, float)) and math.isfinite(q95), f"{horizon}: q95 is not finite ({q95})"
            assert isinstance(tail_risk, (int, float)) and math.isfinite(tail_risk), f"{horizon}: tailRisk is not finite ({tail_risk})"
            
            print(f"✓ {horizon}: all values finite (mean={mean}, q05={q05}, q50={q50}, q95={q95}, tailRisk={tail_risk})")
    
    def test_forecast_determinism(self, api_client):
        """GET /api/brain/v2/forecast — same asOf returns same inputsHash"""
        as_of = "2025-06-15"
        
        response1 = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy&asOf={as_of}")
        assert response1.status_code == 200
        
        response2 = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy&asOf={as_of}")
        assert response2.status_code == 200
        
        hash1 = response1.json().get('integrity', {}).get('inputsHash')
        hash2 = response2.json().get('integrity', {}).get('inputsHash')
        
        assert hash1 is not None, "First response missing inputsHash"
        assert hash2 is not None, "Second response missing inputsHash"
        assert hash1 == hash2, f"Determinism failed: hash1={hash1} != hash2={hash2}"
        
        print(f"✓ Determinism verified: inputsHash={hash1}")
    
    def test_forecast_no_lookahead(self, api_client):
        """GET /api/brain/v2/forecast — noLookahead is true in response"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        no_lookahead = data.get('integrity', {}).get('noLookahead')
        
        assert no_lookahead is True, f"Expected noLookahead=true, got {no_lookahead}"
        print(f"✓ noLookahead={no_lookahead}")
    
    def test_forecast_model_is_not_baseline(self, api_client):
        """GET /api/brain/v2/forecast — model.isBaseline is false (trained MoE active)"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        is_baseline = data.get('model', {}).get('isBaseline')
        
        assert is_baseline is False, f"Expected isBaseline=false, got {is_baseline}"
        print(f"✓ isBaseline={is_baseline} (trained model active)")
    
    def test_forecast_model_version_is_moe(self, api_client):
        """GET /api/brain/v2/forecast — model.modelVersion is 'qv1_moe'"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        model_version = data.get('model', {}).get('modelVersion')
        
        assert model_version == 'qv1_moe', f"Expected modelVersion='qv1_moe', got {model_version}"
        print(f"✓ modelVersion={model_version}")
    
    def test_forecast_tail_risk_in_range(self, api_client):
        """tailRisk is between 0 and 1 for all horizons"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        by_horizon = data.get('byHorizon', {})
        
        for horizon in HORIZONS:
            tail_risk = by_horizon.get(horizon, {}).get('tailRisk')
            assert tail_risk is not None, f"{horizon}: tailRisk is None"
            assert 0 <= tail_risk <= 1, f"{horizon}: tailRisk={tail_risk} out of [0,1] range"
            print(f"✓ {horizon}: tailRisk={tail_risk} in [0,1]")
    
    def test_forecast_regime_probabilities_present(self, api_client):
        """Regime probabilities contain EASING, TIGHTENING, STRESS, NEUTRAL keys"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        regime_p = data.get('regime', {}).get('p', {})
        
        for key in REGIME_KEYS:
            assert key in regime_p, f"Missing regime key: {key}"
            prob = regime_p.get(key)
            assert isinstance(prob, (int, float)), f"{key}: probability is not a number ({prob})"
            assert 0 <= prob <= 1, f"{key}: probability {prob} out of [0,1]"
        
        print(f"✓ Regime probabilities: {regime_p}")


class TestStatusEndpoint:
    """Tests for GET /api/brain/v2/forecast/status"""
    
    def test_status_returns_valid_response(self, api_client):
        """GET /api/brain/v2/forecast/status?asset=dxy — shows model availability"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/status?asset=dxy")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data.get('ok')}"
        assert data.get('asset') == 'dxy', f"Expected asset=dxy"
        assert 'available' in data, "Missing 'available' field"
        assert 'modelVersion' in data, "Missing 'modelVersion' field"
        assert 'coverage' in data, "Missing 'coverage' field"
        
        print(f"✓ Status: modelVersion={data.get('modelVersion')}, available={data.get('available')}")
    
    def test_status_is_not_baseline(self, api_client):
        """GET /api/brain/v2/forecast/status — isBaseline is false when trained model exists"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/status?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        is_baseline = data.get('isBaseline')
        
        assert is_baseline is False, f"Expected isBaseline=false, got {is_baseline}"
        print(f"✓ isBaseline={is_baseline}")
    
    def test_status_coverage_info(self, api_client):
        """GET /api/brain/v2/forecast/status — coverage shows expert regime availability"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/status?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        coverage = data.get('coverage', {})
        
        # Should have coverage info for regimes
        assert isinstance(coverage, dict), f"coverage should be dict, got {type(coverage)}"
        assert len(coverage) > 0, "coverage dict is empty"
        
        # Print coverage status
        active_experts = [k for k, v in coverage.items() if v]
        dropped_experts = [k for k, v in coverage.items() if not v]
        
        print(f"✓ Coverage: active={active_experts}, dropped={dropped_experts}")


class TestTrainEndpoint:
    """Tests for POST /api/brain/v2/forecast/train"""
    
    def test_train_returns_stats(self, api_client):
        """POST /api/brain/v2/forecast/train — returns stats with totalSamples, perExpert, droppedExperts"""
        # Use shorter date range for faster training
        payload = {
            "asset": "dxy",
            "start": "2020-01-01",
            "end": "2025-01-01",
            "step": "WEEKLY",
            "horizons": ["30D", "90D", "180D", "365D"],
            "quantiles": [0.05, 0.5, 0.95],
            "regimeExperts": ["EASING", "TIGHTENING", "STRESS", "NEUTRAL", "NEUTRAL_MIXED"],
            "minSamplesPerExpert": 60,
            "smoothing": 0.25,
            "seed": 42
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/brain/v2/forecast/train",
            json=payload,
            timeout=120  # Training may take time
        )
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data.get('ok')}"
        
        stats = data.get('stats', {})
        assert 'totalSamples' in stats, "Missing totalSamples in stats"
        assert 'perExpert' in stats, "Missing perExpert in stats"
        assert 'droppedExperts' in stats, "Missing droppedExperts in stats"
        
        print(f"✓ Train stats: totalSamples={stats.get('totalSamples')}")
        print(f"  perExpert={stats.get('perExpert')}")
        print(f"  droppedExperts={stats.get('droppedExperts')}")
    
    def test_train_model_version_qv1_moe(self, api_client):
        """POST /api/brain/v2/forecast/train — modelVersion is 'qv1_moe'"""
        # Use minimal params for quick train
        payload = {
            "asset": "dxy",
            "start": "2021-01-01",
            "end": "2024-01-01",
            "step": "WEEKLY"
        }
        
        response = api_client.post(
            f"{BASE_URL}/api/brain/v2/forecast/train",
            json=payload,
            timeout=120
        )
        
        assert response.status_code == 200, f"Train failed: {response.text}"
        
        data = response.json()
        model_version = data.get('modelVersion')
        
        assert model_version == 'qv1_moe', f"Expected modelVersion='qv1_moe', got {model_version}"
        print(f"✓ Trained model: modelVersion={model_version}")
    
    def test_train_then_forecast_uses_trained_model(self, api_client):
        """After training, GET /forecast uses the trained model (not baseline)"""
        # Train with longer date range to ensure enough samples
        train_payload = {
            "asset": "dxy",
            "start": "2015-01-01",
            "end": "2025-01-01",
            "step": "WEEKLY",
            "seed": 123
        }
        
        train_resp = api_client.post(
            f"{BASE_URL}/api/brain/v2/forecast/train",
            json=train_payload,
            timeout=120
        )
        
        assert train_resp.status_code == 200, f"Train failed: {train_resp.text}"
        
        # Small delay for cache invalidation
        time.sleep(1)
        
        # Verify forecast uses trained model
        forecast_resp = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy")
        assert forecast_resp.status_code == 200
        
        data = forecast_resp.json()
        is_baseline = data.get('model', {}).get('isBaseline')
        
        assert is_baseline is False, f"Forecast should use trained model, but isBaseline={is_baseline}"
        print(f"✓ After training, forecast uses trained model (isBaseline={is_baseline})")


class TestCompareEndpoint:
    """Tests for GET /api/brain/v2/forecast/compare"""
    
    def test_compare_returns_valid_response(self, api_client):
        """GET /api/brain/v2/forecast/compare — returns comparison view"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/compare?asset=dxy")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true"
        assert data.get('asset') == 'dxy'
        assert 'comparison' in data, "Missing 'comparison' field"
        assert 'summary' in data, "Missing 'summary' field"
        
        print(f"✓ Compare endpoint returned valid response")
    
    def test_compare_has_all_horizons(self, api_client):
        """GET /api/brain/v2/forecast/compare — contains all 4 horizons"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/compare?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        comparison = data.get('comparison', [])
        
        horizons_in_response = [c.get('horizon') for c in comparison]
        
        for h in HORIZONS:
            assert h in horizons_in_response, f"Missing horizon in compare: {h}"
        
        print(f"✓ Compare includes all horizons: {horizons_in_response}")
    
    def test_compare_has_required_fields(self, api_client):
        """GET /api/brain/v2/forecast/compare — each comparison has direction, mean, range, tailRisk, riskLevel"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/compare?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        comparison = data.get('comparison', [])
        
        required_fields = ['horizon', 'direction', 'mean', 'range', 'tailRisk', 'riskLevel']
        
        for comp in comparison:
            for field in required_fields:
                assert field in comp, f"Missing field '{field}' in comparison item: {comp}"
            
            # Validate direction
            assert comp.get('direction') in ['UP', 'DOWN'], f"Invalid direction: {comp.get('direction')}"
            
            # Validate riskLevel
            assert comp.get('riskLevel') in ['LOW', 'MEDIUM', 'HIGH'], f"Invalid riskLevel: {comp.get('riskLevel')}"
        
        print(f"✓ All comparison items have required fields")
        for c in comparison:
            print(f"  {c.get('horizon')}: direction={c.get('direction')}, mean={c.get('mean')}, tailRisk={c.get('tailRisk')}, riskLevel={c.get('riskLevel')}")
    
    def test_compare_summary_structure(self, api_client):
        """GET /api/brain/v2/forecast/compare — summary has shortTermBias, longTermBias, avgTailRisk"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/compare?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        summary = data.get('summary', {})
        
        assert 'shortTermBias' in summary, "Missing shortTermBias in summary"
        assert 'longTermBias' in summary, "Missing longTermBias in summary"
        assert 'avgTailRisk' in summary, "Missing avgTailRisk in summary"
        
        # Validate bias values
        assert summary.get('shortTermBias') in ['BULLISH', 'BEARISH'], f"Invalid shortTermBias: {summary.get('shortTermBias')}"
        assert summary.get('longTermBias') in ['BULLISH', 'BEARISH'], f"Invalid longTermBias: {summary.get('longTermBias')}"
        
        print(f"✓ Summary: shortTermBias={summary.get('shortTermBias')}, longTermBias={summary.get('longTermBias')}, avgTailRisk={summary.get('avgTailRisk')}")
    
    def test_compare_model_info(self, api_client):
        """GET /api/brain/v2/forecast/compare — shows modelVersion and isBaseline"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/compare?asset=dxy")
        assert response.status_code == 200
        
        data = response.json()
        
        assert 'modelVersion' in data, "Missing modelVersion"
        assert 'isBaseline' in data, "Missing isBaseline"
        
        assert data.get('modelVersion') == 'qv1_moe', f"Expected qv1_moe, got {data.get('modelVersion')}"
        assert data.get('isBaseline') is False, f"Expected isBaseline=false"
        
        print(f"✓ Compare model info: modelVersion={data.get('modelVersion')}, isBaseline={data.get('isBaseline')}")


class TestEdgeCases:
    """Edge case and validation tests"""
    
    def test_forecast_with_past_asOf(self, api_client):
        """Forecast with historical asOf date returns valid response"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy&asOf=2024-01-15")
        assert response.status_code == 200, f"Historical forecast failed: {response.text}"
        
        data = response.json()
        assert data.get('ok') is True
        assert data.get('asOf') == '2024-01-15'
        
        print(f"✓ Historical forecast (2024-01-15) returned successfully")
    
    def test_forecast_default_asset(self, api_client):
        """Forecast without asset param defaults to dxy"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('asset') == 'dxy', f"Default asset should be dxy, got {data.get('asset')}"
        
        print(f"✓ Default asset is dxy")
    
    def test_compare_with_historical_asOf(self, api_client):
        """Compare endpoint with historical asOf"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/compare?asset=dxy&asOf=2024-06-01")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
        assert data.get('asOf') == '2024-06-01'
        
        print(f"✓ Historical compare (2024-06-01) returned successfully")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
