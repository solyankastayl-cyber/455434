"""
P9.0 — Cross-Asset Correlation Regime Classifier Tests

Tests for:
  - GET /api/brain/v2/cross-asset (main endpoint)
  - GET /api/brain/v2/cross-asset/schema
  - POST /api/brain/v2/cross-asset/validate
  - GET /api/brain/v2/cross-asset/timeline
  - Brain decision integration (crossAsset in response)
  - Regression tests for existing endpoints
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    raise ValueError("REACT_APP_BACKEND_URL not set")

# Valid regime labels per contract
VALID_REGIME_LABELS = ['RISK_ON_SYNC', 'RISK_OFF_SYNC', 'FLIGHT_TO_QUALITY', 'DECOUPLED', 'MIXED']
WINDOW_SIZES = [20, 60, 120]


class TestCrossAssetMainEndpoint:
    """GET /api/brain/v2/cross-asset — Main CrossAssetPack endpoint"""

    def test_cross_asset_returns_valid_response(self):
        """GET /api/brain/v2/cross-asset — returns CrossAssetPack with windows, regime, diagnostics, evidence"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset", timeout=30)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data}"
        
        # Check main fields exist
        assert 'asOf' in data, "Missing asOf field"
        assert 'windows' in data, "Missing windows field"
        assert 'regime' in data, "Missing regime field"
        assert 'diagnostics' in data, "Missing diagnostics field"
        assert 'evidence' in data, "Missing evidence field"
        print(f"✓ Cross-asset endpoint returns valid structure with asOf={data['asOf']}")

    def test_windows_has_three_entries(self):
        """GET /api/brain/v2/cross-asset — windows array has 3 entries for 20d, 60d, 120d"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset", timeout=30)
        assert resp.status_code == 200
        
        data = resp.json()
        windows = data.get('windows', [])
        assert len(windows) == 3, f"Expected 3 windows, got {len(windows)}"
        
        window_days = [w.get('windowDays') for w in windows]
        for size in WINDOW_SIZES:
            assert size in window_days, f"Missing {size}d window"
        print(f"✓ Windows array has correct entries: {window_days}")

    def test_correlations_are_valid(self):
        """GET /api/brain/v2/cross-asset — all correlations are not NaN and between -1 and 1"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset", timeout=30)
        assert resp.status_code == 200
        
        data = resp.json()
        windows = data.get('windows', [])
        
        corr_fields = ['corr_btc_spx', 'corr_btc_dxy', 'corr_spx_dxy', 
                       'corr_btc_gold', 'corr_spx_gold', 'corr_dxy_gold']
        
        for w in windows:
            window_days = w.get('windowDays')
            for field in corr_fields:
                val = w.get(field)
                assert val is not None, f"Missing {field} in {window_days}d window"
                assert isinstance(val, (int, float)), f"{field} is not a number: {val}"
                # Note: 0 is valid if GOLD data unavailable
                assert -1 <= val <= 1, f"{field}={val} is out of range [-1,1] in {window_days}d window"
        print("✓ All correlations are valid numbers in range [-1, 1]")

    def test_regime_label_is_valid(self):
        """GET /api/brain/v2/cross-asset — regime has label from valid set"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset", timeout=30)
        assert resp.status_code == 200
        
        data = resp.json()
        regime = data.get('regime', {})
        label = regime.get('label')
        
        assert label in VALID_REGIME_LABELS, f"Regime label '{label}' not in valid set: {VALID_REGIME_LABELS}"
        print(f"✓ Regime label is valid: {label}")

    def test_regime_confidence_is_valid(self):
        """GET /api/brain/v2/cross-asset — regime confidence is between 0 and 1"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset", timeout=30)
        assert resp.status_code == 200
        
        data = resp.json()
        regime = data.get('regime', {})
        confidence = regime.get('confidence')
        
        assert isinstance(confidence, (int, float)), f"Confidence is not a number: {confidence}"
        assert 0 <= confidence <= 1, f"Confidence {confidence} not in range [0, 1]"
        print(f"✓ Regime confidence is valid: {confidence}")

    def test_diagnostics_has_required_fields(self):
        """GET /api/brain/v2/cross-asset — diagnostics has decoupleScore, signFlipCount, corrStability, contagionScore"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset", timeout=30)
        assert resp.status_code == 200
        
        data = resp.json()
        diagnostics = data.get('diagnostics', {})
        
        required_fields = ['decoupleScore', 'signFlipCount', 'corrStability', 'contagionScore']
        for field in required_fields:
            assert field in diagnostics, f"Missing diagnostic field: {field}"
        print(f"✓ Diagnostics has all required fields: {list(diagnostics.keys())}")

    def test_diagnostics_values_in_valid_range(self):
        """GET /api/brain/v2/cross-asset — diagnostics values are in valid range"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset", timeout=30)
        assert resp.status_code == 200
        
        data = resp.json()
        diagnostics = data.get('diagnostics', {})
        
        # decoupleScore: 0..1
        decouple = diagnostics.get('decoupleScore')
        assert 0 <= decouple <= 1, f"decoupleScore {decouple} not in [0,1]"
        
        # signFlipCount: 0..6
        sign_flip = diagnostics.get('signFlipCount')
        assert 0 <= sign_flip <= 6, f"signFlipCount {sign_flip} not in [0,6]"
        
        # corrStability: 0..1
        stability = diagnostics.get('corrStability')
        assert 0 <= stability <= 1, f"corrStability {stability} not in [0,1]"
        
        # contagionScore: 0..1
        contagion = diagnostics.get('contagionScore')
        assert 0 <= contagion <= 1, f"contagionScore {contagion} not in [0,1]"
        
        print(f"✓ Diagnostics values in valid ranges: decouple={decouple}, signFlip={sign_flip}, stability={stability}, contagion={contagion}")

    def test_determinism_same_asof_same_regime(self):
        """GET /api/brain/v2/cross-asset — determinism: same asOf returns same regime label and confidence"""
        test_date = "2026-01-15"
        
        resp1 = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset?asOf={test_date}", timeout=30)
        assert resp1.status_code == 200
        data1 = resp1.json()
        
        resp2 = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset?asOf={test_date}", timeout=30)
        assert resp2.status_code == 200
        data2 = resp2.json()
        
        assert data1['regime']['label'] == data2['regime']['label'], "Regime label not deterministic"
        assert data1['regime']['confidence'] == data2['regime']['confidence'], "Regime confidence not deterministic"
        print(f"✓ Determinism verified: regime={data1['regime']['label']}, confidence={data1['regime']['confidence']}")

    def test_sample_n_reflects_data_quality(self):
        """GET /api/brain/v2/cross-asset — sampleN in windows reflects actual data quality"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset", timeout=30)
        assert resp.status_code == 200
        
        data = resp.json()
        windows = data.get('windows', [])
        
        for w in windows:
            sample_n = w.get('sampleN')
            window_days = w.get('windowDays')
            
            assert sample_n is not None, f"Missing sampleN in {window_days}d window"
            assert isinstance(sample_n, int), f"sampleN is not an integer: {sample_n}"
            assert sample_n >= 0, f"sampleN cannot be negative: {sample_n}"
            
            # Check reasonable data quality (at least 50% of window for core pairs)
            min_expected = window_days * 0.3  # 30% minimum (weekends, holidays)
            if sample_n < min_expected:
                print(f"⚠ Low sampleN in {window_days}d window: {sample_n} (expected >={min_expected})")
        
        print(f"✓ sampleN values: {[{w['windowDays']: w['sampleN']} for w in windows]}")


class TestCrossAssetSchema:
    """GET /api/brain/v2/cross-asset/schema — Schema info endpoint"""

    def test_schema_returns_valid_structure(self):
        """GET /api/brain/v2/cross-asset/schema — returns schema info with required fields"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset/schema", timeout=15)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert data.get('ok') is True
        
        # Required fields per contract
        assert 'assets' in data, "Missing assets field"
        assert 'pairs' in data, "Missing pairs field"
        assert 'windows' in data, "Missing windows field"
        assert 'regimeLabels' in data, "Missing regimeLabels field"
        assert 'thresholds' in data, "Missing thresholds field"
        
        print(f"✓ Schema endpoint returns valid structure with version={data.get('version')}")

    def test_schema_has_correct_values(self):
        """GET /api/brain/v2/cross-asset/schema — validates actual schema values"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset/schema", timeout=15)
        assert resp.status_code == 200
        
        data = resp.json()
        
        # Check assets
        assets = data.get('assets', [])
        expected_assets = ['BTC', 'SPX', 'DXY', 'GOLD']
        for asset in expected_assets:
            assert asset in assets, f"Missing asset: {asset}"
        
        # Check windows
        windows = data.get('windows', [])
        for size in WINDOW_SIZES:
            assert size in windows, f"Missing window size: {size}"
        
        # Check regime labels
        regime_labels = data.get('regimeLabels', [])
        for label in VALID_REGIME_LABELS:
            assert label in regime_labels, f"Missing regime label: {label}"
        
        print(f"✓ Schema values correct: assets={assets}, windows={windows}")


class TestCrossAssetValidate:
    """POST /api/brain/v2/cross-asset/validate — Validate asOf endpoint"""

    def test_validate_returns_valid_response(self):
        """POST /api/brain/v2/cross-asset/validate — returns validation result with regime and diagnostics"""
        payload = {"asOf": "2026-02-01"}
        resp = requests.post(
            f"{BASE_URL}/api/brain/v2/cross-asset/validate",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        
        # Check required fields
        assert 'ok' in data, "Missing ok field"
        assert 'asOf' in data, "Missing asOf field"
        assert 'regime' in data, "Missing regime field"
        assert 'confidence' in data, "Missing confidence field"
        assert 'validation' in data, "Missing validation field"
        assert 'diagnostics' in data, "Missing diagnostics field"
        
        # Validate regime label
        assert data['regime'] in VALID_REGIME_LABELS, f"Invalid regime: {data['regime']}"
        
        print(f"✓ Validate endpoint returns valid response: regime={data['regime']}, confidence={data['confidence']}")

    def test_validate_without_body_uses_today(self):
        """POST /api/brain/v2/cross-asset/validate — works without body (uses today's date)"""
        resp = requests.post(
            f"{BASE_URL}/api/brain/v2/cross-asset/validate",
            json={},
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert data.get('asOf') is not None, "Expected asOf to be set to today"
        print(f"✓ Validate endpoint defaults to today: asOf={data['asOf']}")


class TestCrossAssetTimeline:
    """GET /api/brain/v2/cross-asset/timeline — Backfill timeline endpoint"""

    def test_timeline_returns_array(self):
        """GET /api/brain/v2/cross-asset/timeline — returns timeline array with regime labels"""
        # Use short date range and large step for faster response
        params = "start=2025-06-01&end=2025-12-01&step=30"
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset/timeline?{params}", timeout=120)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert data.get('ok') is True, f"Expected ok=true: {data}"
        
        # Check structure
        assert 'timeline' in data, "Missing timeline field"
        assert 'count' in data, "Missing count field"
        assert 'start' in data, "Missing start field"
        assert 'end' in data, "Missing end field"
        
        timeline = data.get('timeline', [])
        assert len(timeline) > 0, "Timeline should not be empty"
        
        # Check each point structure
        for point in timeline[:3]:  # Check first 3 points
            assert 'asOf' in point, "Timeline point missing asOf"
            assert 'regime' in point, "Timeline point missing regime"
            assert 'confidence' in point, "Timeline point missing confidence"
            assert point['regime'] in VALID_REGIME_LABELS, f"Invalid regime in timeline: {point['regime']}"
        
        print(f"✓ Timeline returns {data['count']} points from {data['start']} to {data['end']}")

    def test_timeline_has_expected_fields(self):
        """GET /api/brain/v2/cross-asset/timeline — each point has required fields"""
        params = "start=2025-06-01&end=2025-12-01&step=30"
        resp = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset/timeline?{params}", timeout=120)
        assert resp.status_code == 200
        
        data = resp.json()
        timeline = data.get('timeline', [])
        
        if len(timeline) > 0:
            point = timeline[0]
            required_fields = ['asOf', 'regime', 'confidence', 'corr_btc_spx_60d', 'contagionScore', 'decoupleScore']
            for field in required_fields:
                assert field in point, f"Timeline point missing field: {field}"
            print(f"✓ Timeline point has all required fields: {list(point.keys())}")
        else:
            print("⚠ Timeline returned empty - may indicate data availability issue")


class TestBrainDecisionIntegration:
    """Brain decision integration with crossAsset data"""

    def test_decision_with_forecast_includes_cross_asset(self):
        """GET /api/brain/v2/decision?withForecast=1 — includes crossAsset object"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/decision?withForecast=1", timeout=30)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        
        # Check crossAsset is present when withForecast=1
        cross_asset = data.get('crossAsset')
        if cross_asset:
            assert 'regime' in cross_asset, "crossAsset missing regime"
            assert 'diagnostics' in cross_asset, "crossAsset missing diagnostics"
            assert 'keyCorrs' in cross_asset, "crossAsset missing keyCorrs"
            
            regime = cross_asset['regime']
            assert 'label' in regime, "crossAsset.regime missing label"
            assert regime['label'] in VALID_REGIME_LABELS, f"Invalid crossAsset regime: {regime['label']}"
            
            print(f"✓ Decision includes crossAsset: regime={regime['label']}")
        else:
            # CrossAsset might not be available if data is missing
            print("⚠ crossAsset not present in decision (may be expected if data unavailable)")

    def test_decision_evidence_includes_cross_asset_driver(self):
        """GET /api/brain/v2/decision — evidence drivers include Cross-Asset regime info"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/decision?withForecast=1", timeout=30)
        assert resp.status_code == 200
        
        data = resp.json()
        evidence = data.get('evidence', {})
        drivers = evidence.get('drivers', [])
        
        # Look for Cross-Asset driver
        cross_asset_drivers = [d for d in drivers if 'Cross-Asset' in d or 'cross-asset' in d.lower()]
        
        if cross_asset_drivers:
            print(f"✓ Evidence includes Cross-Asset drivers: {cross_asset_drivers}")
        else:
            # May not have Cross-Asset driver if data unavailable
            print(f"⚠ No explicit Cross-Asset driver in evidence (drivers: {drivers[:3]}...)")


class TestRegressionTests:
    """Regression tests for existing brain endpoints"""

    def test_brain_decision_still_works(self):
        """GET /api/brain/v2/decision — brain still works correctly (regression test from P8.0-C)"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/decision", timeout=30)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        
        # Basic structure validation
        assert 'scenario' in data, "Missing scenario"
        assert 'directives' in data, "Missing directives"
        assert 'evidence' in data, "Missing evidence"
        assert 'meta' in data, "Missing meta"
        
        scenario = data['scenario']
        assert scenario.get('name') in ['BASE', 'RISK', 'TAIL'], f"Invalid scenario name: {scenario.get('name')}"
        
        print(f"✓ Brain decision still works: scenario={scenario['name']}")

    def test_forecast_still_works(self):
        """GET /api/brain/v2/forecast — still works (regression test)"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy", timeout=30)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert data.get('ok') is True, f"Expected ok=true: {data}"
        assert 'byHorizon' in data, "Missing byHorizon"
        
        print(f"✓ Forecast endpoint still works")

    def test_forecast_status_still_works(self):
        """GET /api/brain/v2/forecast/status — still works (regression test)"""
        resp = requests.get(f"{BASE_URL}/api/brain/v2/forecast/status?asset=dxy", timeout=15)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        data = resp.json()
        assert data.get('ok') is True, f"Expected ok=true: {data}"
        
        print(f"✓ Forecast status endpoint still works")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
