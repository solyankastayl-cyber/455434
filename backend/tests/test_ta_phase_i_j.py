"""
TA Module Phase I & J Tests - Calibration v2 & Market Provider
Tests for per-regime calibration, regime classification, and market data providers

Endpoints tested:
Phase I (Calibration v2 & Regime):
- GET /api/ta/regime/current - Regime classification (market, volatility, bucket)
- POST /api/ta/regime/recompute - Update regime labels for historical runs
- GET /api/ta/calibration_v2/status - Show loaded calibration models
- POST /api/ta/calibration_v2/calibrate - Calibrate score to probability
- POST /api/ta/calibration_v2/rebuild - Build calibration models from outcomes

Phase J (Market Provider):
- GET /api/ta/market/candles - Get candles (test with provider=mock)
- GET /api/ta/market/price - Get latest price

Integration:
- POST /api/ta/outcomes_v2/recompute - Evaluate outcomes using market provider
- GET /api/ta/decision/full - Return regime info and calibrated probabilities

Collections: ta_runs, ta_scenarios, ta_hypotheses, ta_outcomes, ta_calibration_models
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestRegimeCurrentEndpoint:
    """Tests for GET /api/ta/regime/current - Regime classification"""
    
    def test_regime_current_returns_ok(self):
        """Regime current endpoint should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/regime/current?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data}"
    
    def test_regime_current_has_regime_object(self):
        """Response should have regime object with market, volatility, bucket"""
        response = requests.get(f"{BASE_URL}/api/ta/regime/current?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert 'regime' in data, "Response missing 'regime' object"
        
        regime = data['regime']
        assert 'market' in regime, "Regime missing 'market' field"
        assert 'volatility' in regime, "Regime missing 'volatility' field"
        assert 'bucket' in regime, "Regime missing 'bucket' field"
        assert 'confidence' in regime, "Regime missing 'confidence' field"
    
    def test_regime_market_valid_values(self):
        """Market regime should be valid enum value"""
        response = requests.get(f"{BASE_URL}/api/ta/regime/current?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        market = data['regime']['market']
        
        valid_market_regimes = ['TREND_UP', 'TREND_DOWN', 'RANGE', 'TRANSITION']
        assert market in valid_market_regimes, f"Invalid market regime: {market}"
    
    def test_regime_volatility_valid_values(self):
        """Volatility regime should be valid enum value"""
        response = requests.get(f"{BASE_URL}/api/ta/regime/current?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        volatility = data['regime']['volatility']
        
        valid_vol_regimes = ['LOW', 'NORMAL', 'HIGH', 'EXTREME']
        assert volatility in valid_vol_regimes, f"Invalid volatility regime: {volatility}"
    
    def test_regime_bucket_format(self):
        """Bucket should be formatted as market_volatility"""
        response = requests.get(f"{BASE_URL}/api/ta/regime/current?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        bucket = data['regime']['bucket']
        market = data['regime']['market']
        volatility = data['regime']['volatility']
        
        expected_bucket = f"{market}_{volatility}"
        assert bucket == expected_bucket, f"Bucket format mismatch: {bucket} != {expected_bucket}"
    
    def test_regime_has_signals(self):
        """Response should have signals object with classification inputs"""
        response = requests.get(f"{BASE_URL}/api/ta/regime/current?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert 'signals' in data, "Response missing 'signals' object"
        
        signals = data['signals']
        expected_fields = ['maAlignment', 'maSlope20', 'maSlope50', 'structure', 'compression', 'atrPercentile']
        
        for field in expected_fields:
            assert field in signals, f"Signals missing field: {field}"
    
    def test_regime_confidence_range(self):
        """Confidence should be between 0 and 1"""
        response = requests.get(f"{BASE_URL}/api/ta/regime/current?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        confidence = data['regime']['confidence']
        
        assert 0 <= confidence <= 1, f"Confidence out of range: {confidence}"


class TestRegimeRecomputeEndpoint:
    """Tests for POST /api/ta/regime/recompute - Update regime labels"""
    
    def test_regime_recompute_returns_ok(self):
        """Regime recompute endpoint should return ok field"""
        response = requests.post(f"{BASE_URL}/api/ta/regime/recompute", json={
            "limit": 5
        })
        assert response.status_code == 200
        
        data = response.json()
        assert 'ok' in data, "Response missing 'ok' field"
    
    def test_regime_recompute_returns_updated_count(self):
        """Response should have updated count"""
        response = requests.post(f"{BASE_URL}/api/ta/regime/recompute", json={
            "limit": 5
        })
        assert response.status_code == 200
        
        data = response.json()
        assert 'updated' in data, "Response missing 'updated' field"
        assert isinstance(data['updated'], int), "updated should be integer"
    
    def test_regime_recompute_with_asset_filter(self):
        """Recompute should accept asset filter"""
        response = requests.post(f"{BASE_URL}/api/ta/regime/recompute", json={
            "asset": "BTCUSDT",
            "limit": 2
        })
        assert response.status_code == 200
        
        data = response.json()
        assert 'ok' in data


class TestCalibrationV2StatusEndpoint:
    """Tests for GET /api/ta/calibration_v2/status - Show loaded models"""
    
    def test_calibration_status_returns_ok(self):
        """Calibration status endpoint should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/calibration_v2/status")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_calibration_status_has_phase_info(self):
        """Response should have phase and description"""
        response = requests.get(f"{BASE_URL}/api/ta/calibration_v2/status")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('phase') == 'I', f"Expected phase 'I', got {data.get('phase')}"
        assert 'description' in data, "Missing description field"
    
    def test_calibration_status_has_models_count(self):
        """Response should have modelsLoaded count"""
        response = requests.get(f"{BASE_URL}/api/ta/calibration_v2/status")
        assert response.status_code == 200
        
        data = response.json()
        assert 'modelsLoaded' in data, "Missing modelsLoaded field"
        assert isinstance(data['modelsLoaded'], int)
    
    def test_calibration_status_has_models_array(self):
        """Response should have models array"""
        response = requests.get(f"{BASE_URL}/api/ta/calibration_v2/status")
        assert response.status_code == 200
        
        data = response.json()
        assert 'models' in data, "Missing models array"
        assert isinstance(data['models'], list)
    
    def test_calibration_model_structure(self):
        """Each model should have required fields"""
        response = requests.get(f"{BASE_URL}/api/ta/calibration_v2/status")
        assert response.status_code == 200
        
        data = response.json()
        models = data.get('models', [])
        
        for model in models:
            assert 'regime' in model, "Model missing 'regime' field"
            assert 'sampleCount' in model, "Model missing 'sampleCount' field"
            assert 'winRate' in model, "Model missing 'winRate' field"


class TestCalibrationV2CalibrateEndpoint:
    """Tests for POST /api/ta/calibration_v2/calibrate - Calibrate score"""
    
    def test_calibrate_returns_ok(self):
        """Calibrate endpoint should return ok=true"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/calibrate", json={
            "score": 0.75
        })
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_calibrate_requires_score(self):
        """Calibrate should reject request without score"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/calibrate", json={})
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is False
        assert 'error' in data
    
    def test_calibrate_returns_probability(self):
        """Response should have probability value"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/calibrate", json={
            "score": 0.75
        })
        assert response.status_code == 200
        
        data = response.json()
        assert 'result' in data, "Missing 'result' object"
        assert 'probability' in data['result'], "Result missing 'probability'"
    
    def test_calibrate_probability_range(self):
        """Probability should be between 0 and 1"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/calibrate", json={
            "score": 0.75
        })
        assert response.status_code == 200
        
        data = response.json()
        probability = data['result']['probability']
        
        assert 0 <= probability <= 1, f"Probability out of range: {probability}"
    
    def test_calibrate_returns_source(self):
        """Response should indicate calibration source (CALIBRATED or FALLBACK)"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/calibrate", json={
            "score": 0.75
        })
        assert response.status_code == 200
        
        data = response.json()
        source = data['result'].get('source')
        
        valid_sources = ['CALIBRATED', 'FALLBACK']
        assert source in valid_sources, f"Invalid source: {source}"
    
    def test_calibrate_with_regime(self):
        """Calibrate should accept regime parameter"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/calibrate", json={
            "score": 0.75,
            "regime": "TREND_UP_NORMAL"
        })
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_calibrate_multiple_scores(self):
        """Test calibration for various score ranges"""
        test_scores = [0.1, 0.3, 0.5, 0.7, 0.9]
        
        for score in test_scores:
            response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/calibrate", json={
                "score": score
            })
            assert response.status_code == 200
            
            data = response.json()
            assert data.get('ok') is True, f"Failed for score {score}"
            prob = data['result']['probability']
            assert 0 <= prob <= 1, f"Invalid probability {prob} for score {score}"


class TestCalibrationV2RebuildEndpoint:
    """Tests for POST /api/ta/calibration_v2/rebuild - Build models"""
    
    def test_rebuild_returns_ok(self):
        """Rebuild endpoint should return ok field"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/rebuild", json={})
        assert response.status_code == 200
        
        data = response.json()
        assert 'ok' in data, "Response missing 'ok' field"
    
    def test_rebuild_returns_models_built_count(self):
        """Response should have modelsBuilt count"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/rebuild", json={})
        assert response.status_code == 200
        
        data = response.json()
        assert 'modelsBuilt' in data, "Missing 'modelsBuilt' field"
        assert isinstance(data['modelsBuilt'], int)
    
    def test_rebuild_returns_global_model_info(self):
        """Response should have globalModel info (if built)"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/rebuild", json={})
        assert response.status_code == 200
        
        data = response.json()
        # globalModel can be null if insufficient data
        assert 'globalModel' in data, "Missing 'globalModel' field"
    
    def test_rebuild_returns_regime_models_list(self):
        """Response should have regimeModels array"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/rebuild", json={})
        assert response.status_code == 200
        
        data = response.json()
        assert 'regimeModels' in data, "Missing 'regimeModels' field"
        assert isinstance(data['regimeModels'], list)
    
    def test_rebuild_returns_skipped_regimes(self):
        """Response should have skippedRegimes array"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/rebuild", json={})
        assert response.status_code == 200
        
        data = response.json()
        assert 'skippedRegimes' in data, "Missing 'skippedRegimes' field"
        assert isinstance(data['skippedRegimes'], list)
    
    def test_rebuild_returns_timestamp(self):
        """Response should have timestamp"""
        response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/rebuild", json={})
        assert response.status_code == 200
        
        data = response.json()
        assert 'timestamp' in data, "Missing 'timestamp' field"


class TestMarketCandlesEndpoint:
    """Tests for GET /api/ta/market/candles - Get candles with provider"""
    
    def test_market_candles_returns_ok(self):
        """Market candles endpoint should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/market/candles?symbol=BTCUSDT&provider=mock")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_market_candles_returns_candles_array(self):
        """Response should have candles array"""
        response = requests.get(f"{BASE_URL}/api/ta/market/candles?symbol=BTCUSDT&provider=mock")
        assert response.status_code == 200
        
        data = response.json()
        assert 'candles' in data, "Missing 'candles' array"
        assert isinstance(data['candles'], list)
    
    def test_market_candles_returns_count(self):
        """Response should have count of candles"""
        response = requests.get(f"{BASE_URL}/api/ta/market/candles?symbol=BTCUSDT&provider=mock")
        assert response.status_code == 200
        
        data = response.json()
        assert 'count' in data, "Missing 'count' field"
        assert isinstance(data['count'], int)
    
    def test_market_candles_returns_symbol_and_provider(self):
        """Response should echo symbol and provider"""
        response = requests.get(f"{BASE_URL}/api/ta/market/candles?symbol=BTCUSDT&provider=mock")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('symbol') == 'BTCUSDT'
        assert data.get('provider') == 'mock'
    
    def test_market_candles_structure(self):
        """Each candle should have OHLCV fields"""
        response = requests.get(f"{BASE_URL}/api/ta/market/candles?symbol=BTCUSDT&provider=mock")
        assert response.status_code == 200
        
        data = response.json()
        candles = data.get('candles', [])
        
        if len(candles) > 0:
            candle = candles[0]
            required_fields = ['ts', 'o', 'h', 'l', 'c', 'v']
            
            for field in required_fields:
                assert field in candle, f"Candle missing field: {field}"
    
    def test_market_candles_returns_latest_price(self):
        """Response should have latestPrice"""
        response = requests.get(f"{BASE_URL}/api/ta/market/candles?symbol=BTCUSDT&provider=mock")
        assert response.status_code == 200
        
        data = response.json()
        assert 'latestPrice' in data, "Missing 'latestPrice' field"
    
    def test_market_candles_with_interval(self):
        """Candles endpoint should accept interval parameter"""
        response = requests.get(f"{BASE_URL}/api/ta/market/candles?symbol=BTCUSDT&interval=1H&provider=mock")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True


class TestMarketPriceEndpoint:
    """Tests for GET /api/ta/market/price - Get latest price"""
    
    def test_market_price_returns_ok_field(self):
        """Market price endpoint should return ok field"""
        response = requests.get(f"{BASE_URL}/api/ta/market/price?symbol=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        # Note: ok can be false if Binance is blocked
        assert 'ok' in data, "Missing 'ok' field"
    
    def test_market_price_returns_symbol(self):
        """Response should echo symbol"""
        response = requests.get(f"{BASE_URL}/api/ta/market/price?symbol=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('symbol') == 'BTCUSDT'
    
    def test_market_price_returns_timestamp(self):
        """Response should have timestamp"""
        response = requests.get(f"{BASE_URL}/api/ta/market/price?symbol=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert 'timestamp' in data, "Missing 'timestamp' field"
    
    def test_market_price_has_price_field(self):
        """Response should have price field (can be null if Binance blocked)"""
        response = requests.get(f"{BASE_URL}/api/ta/market/price?symbol=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert 'price' in data, "Missing 'price' field"


class TestOutcomesV2RecomputeEndpoint:
    """Tests for POST /api/ta/outcomes_v2/recompute - Evaluate outcomes"""
    
    def test_outcomes_recompute_returns_ok(self):
        """Outcomes recompute should return ok field"""
        response = requests.post(f"{BASE_URL}/api/ta/outcomes_v2/recompute", json={
            "provider": "mock",
            "limit": 5
        })
        assert response.status_code == 200
        
        data = response.json()
        assert 'ok' in data, "Missing 'ok' field"
    
    def test_outcomes_recompute_returns_counts(self):
        """Response should have processed and updated counts"""
        response = requests.post(f"{BASE_URL}/api/ta/outcomes_v2/recompute", json={
            "provider": "mock",
            "limit": 5
        })
        assert response.status_code == 200
        
        data = response.json()
        assert 'processed' in data, "Missing 'processed' field"
        assert 'updated' in data, "Missing 'updated' field"
    
    def test_outcomes_recompute_with_mock_provider(self):
        """Should work with mock provider"""
        response = requests.post(f"{BASE_URL}/api/ta/outcomes_v2/recompute", json={
            "provider": "mock",
            "limit": 3
        })
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('provider') == 'mock'


class TestDecisionFullEndpoint:
    """Tests for GET /api/ta/decision/full - Decision with regime and calibration"""
    
    def test_decision_full_returns_ok(self):
        """Decision full endpoint should return ok"""
        response = requests.get(f"{BASE_URL}/api/ta/decision/full?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        # Can return ok=false if no patterns found
        assert 'ok' in data, "Missing 'ok' field"
    
    def test_decision_full_has_regime_info(self):
        """Response should have regime object"""
        response = requests.get(f"{BASE_URL}/api/ta/decision/full?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        
        if data.get('ok'):
            assert 'regime' in data, "Missing 'regime' field"
            regime = data['regime']
            assert 'market' in regime, "Regime missing 'market'"
            assert 'volatility' in regime, "Regime missing 'volatility'"
            assert 'bucket' in regime, "Regime missing 'bucket'"
    
    def test_decision_full_has_probability_source(self):
        """Response should indicate probability source"""
        response = requests.get(f"{BASE_URL}/api/ta/decision/full?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        
        if data.get('ok'):
            assert 'probabilitySource' in data, "Missing 'probabilitySource' field"
            valid_sources = ['CALIBRATED', 'FALLBACK']
            assert data['probabilitySource'] in valid_sources, f"Invalid source: {data['probabilitySource']}"
    
    def test_decision_full_has_top_scenarios(self):
        """Response should have top scenarios"""
        response = requests.get(f"{BASE_URL}/api/ta/decision/full?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        
        if data.get('ok'):
            assert 'top' in data, "Missing 'top' field"
            assert isinstance(data['top'], list)
    
    def test_decision_full_has_summary(self):
        """Response should have summary"""
        response = requests.get(f"{BASE_URL}/api/ta/decision/full?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        
        if data.get('ok'):
            assert 'summary' in data, "Missing 'summary' field"
    
    def test_decision_full_scenarios_have_risk_packs(self):
        """Top scenarios should have riskPack"""
        response = requests.get(f"{BASE_URL}/api/ta/decision/full?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        
        if data.get('ok') and len(data.get('top', [])) > 0:
            scenario = data['top'][0]
            assert 'riskPack' in scenario, "Scenario missing 'riskPack'"
    
    def test_decision_full_with_calibration_disabled(self):
        """Should work with calibration disabled"""
        response = requests.get(f"{BASE_URL}/api/ta/decision/full?asset=BTCUSDT&useCalibration=false")
        assert response.status_code == 200
        
        data = response.json()
        assert 'ok' in data


class TestIntegrationCalibratedDecision:
    """Integration tests for calibrated probability flow"""
    
    def test_rebuild_then_calibrate(self):
        """After rebuild, calibrate should return CALIBRATED source (if data exists)"""
        # Rebuild calibration models
        rebuild_response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/rebuild", json={})
        assert rebuild_response.status_code == 200
        
        rebuild_data = rebuild_response.json()
        models_built = rebuild_data.get('modelsBuilt', 0)
        
        # Calibrate a score
        calibrate_response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/calibrate", json={
            "score": 0.75
        })
        assert calibrate_response.status_code == 200
        
        calibrate_data = calibrate_response.json()
        assert calibrate_data.get('ok') is True
        
        # Source depends on whether models were built
        source = calibrate_data['result']['source']
        if models_built > 0:
            print(f"Models built: {models_built}, source: {source}")
        else:
            print(f"No models built (insufficient data), source: {source}")
    
    def test_regime_affects_calibration(self):
        """Calibration with different regimes may yield different results"""
        # Test with different regimes
        regimes = ['TREND_UP_NORMAL', 'RANGE_LOW', 'TRANSITION_HIGH']
        results = []
        
        for regime in regimes:
            response = requests.post(f"{BASE_URL}/api/ta/calibration_v2/calibrate", json={
                "score": 0.75,
                "regime": regime
            })
            assert response.status_code == 200
            
            data = response.json()
            results.append({
                'regime': regime,
                'probability': data['result']['probability'],
                'source': data['result']['source']
            })
        
        # Verify all calls succeeded
        for r in results:
            assert 0 <= r['probability'] <= 1
    
    def test_full_decision_with_regime_and_calibration(self):
        """Full decision should include regime info and calibration status"""
        response = requests.get(f"{BASE_URL}/api/ta/decision/full?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        
        if data.get('ok'):
            # Verify regime present
            regime = data.get('regime', {})
            assert 'market' in regime
            assert 'volatility' in regime
            assert 'bucket' in regime
            
            # Verify probability source indicated
            assert 'probabilitySource' in data
            
            print(f"Regime: {regime.get('bucket')}, ProbabilitySource: {data.get('probabilitySource')}")


class TestDataConsistency:
    """Tests for data consistency and no MongoDB _id leaks"""
    
    def test_calibration_status_no_mongodb_id(self):
        """Calibration status should not expose MongoDB _id"""
        response = requests.get(f"{BASE_URL}/api/ta/calibration_v2/status")
        assert response.status_code == 200
        
        data = response.json()
        models = data.get('models', [])
        
        for model in models:
            assert '_id' not in model, "Model contains _id field"
    
    def test_regime_current_no_mongodb_id(self):
        """Regime current should not expose MongoDB _id"""
        response = requests.get(f"{BASE_URL}/api/ta/regime/current?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        
        # Check all nested objects
        assert '_id' not in data
        assert '_id' not in data.get('regime', {})
        assert '_id' not in data.get('signals', {})
    
    def test_decision_full_no_mongodb_id(self):
        """Decision full should not expose MongoDB _id"""
        response = requests.get(f"{BASE_URL}/api/ta/decision/full?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        
        assert '_id' not in data
        
        for scenario in data.get('top', []):
            assert '_id' not in scenario


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
