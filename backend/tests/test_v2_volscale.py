"""
Test V2 Macro Engine - volScale Volatility Adaptation (P1 Feature)

Tests the new volScale field in V2 pack and the related UI data points:
- volScale computation and inclusion in stateInfo
- V1 vs V2 comparison showing volScale only in V2
- Regime state card data
- Guard card data
- Macro impact card data
- Drivers card data
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://backtest-replay-lab.preview.emergentagent.com').rstrip('/')


class TestV2VolScaleFeature:
    """Tests for V2 engine volScale integration"""

    def test_v2_pack_contains_volscale(self):
        """GET /api/macro-engine/v2/DXY/pack should have volScale ~0.9"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get('engineVersion') == 'v2', "Expected engineVersion v2"
        
        state_info = data.get('meta', {}).get('stateInfo', {})
        assert 'volScale' in state_info, "volScale missing from stateInfo"
        
        vol_scale = state_info['volScale']
        assert isinstance(vol_scale, (int, float)), "volScale should be numeric"
        assert 0.5 <= vol_scale <= 1.5, f"volScale {vol_scale} out of expected range [0.5, 1.5]"
        print(f"✓ volScale = {vol_scale}")

    def test_v2_pack_has_complete_structure(self):
        """V2 pack should have regime, drivers, guard, overlay, meta"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response.status_code == 200
        
        data = response.json()
        
        # Check all required top-level fields
        required_fields = ['engineVersion', 'regime', 'drivers', 'guard', 'overlay', 'meta']
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"
        
        # Check regime structure
        regime = data['regime']
        assert 'dominant' in regime, "Missing regime.dominant"
        assert 'confidence' in regime, "Missing regime.confidence"
        assert 'persistence' in regime, "Missing regime.persistence"
        print(f"✓ regime: {regime['dominant']}, conf={regime['confidence']}")

    def test_v2_pack_regime_state_data(self):
        """Regime state card data: dominant, confidence %, persistence %"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response.status_code == 200
        
        regime = response.json().get('regime', {})
        
        # Dominant regime should be a valid string
        dominant = regime.get('dominant')
        valid_regimes = ['NEUTRAL', 'EASING', 'TIGHTENING', 'STRESS', 'RISK_ON', 'RISK_OFF']
        assert dominant in valid_regimes, f"Invalid regime: {dominant}"
        
        # Confidence as percentage (0-1)
        confidence = regime.get('confidence', 0)
        assert 0 <= confidence <= 1, f"Confidence {confidence} out of range"
        
        # Persistence as percentage (0-1)
        persistence = regime.get('persistence', 0)
        assert 0 <= persistence <= 1, f"Persistence {persistence} out of range"
        
        print(f"✓ Regime: {dominant}, Confidence: {confidence*100:.0f}%, Persistence: {persistence*100:.0f}%")

    def test_v2_pack_guard_card_data(self):
        """Guard card data: level, reasonCodes"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response.status_code == 200
        
        guard = response.json().get('guard', {})
        
        # Guard level
        level = guard.get('level')
        valid_levels = ['NONE', 'SOFT', 'HARD']
        assert level in valid_levels, f"Invalid guard level: {level}"
        
        # Reason codes should be list
        reason_codes = guard.get('reasonCodes', [])
        assert isinstance(reason_codes, list), "reasonCodes should be a list"
        
        print(f"✓ Guard: {level}, Reasons: {reason_codes}")

    def test_v2_pack_macro_impact_card_data(self):
        """Macro impact card data: hybridBase, delta, adjusted"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack?horizon=30D")
        assert response.status_code == 200
        
        overlay = response.json().get('overlay', {})
        horizons = overlay.get('horizons', [])
        
        # Find 30D horizon
        h30d = next((h for h in horizons if h['horizon'] == '30D'), None)
        assert h30d is not None, "30D horizon not found"
        
        # Check values
        hybrid_end = h30d.get('hybridEndReturn')
        delta = h30d.get('delta')
        macro_end = h30d.get('macroEndReturn')
        
        assert hybrid_end is not None, "Missing hybridEndReturn"
        assert delta is not None, "Missing delta"
        assert macro_end is not None, "Missing macroEndReturn"
        
        # Verify math: macroEndReturn ≈ hybridEndReturn + delta
        expected = hybrid_end + delta
        assert abs(macro_end - expected) < 0.0001, f"Math check failed: {macro_end} != {hybrid_end} + {delta}"
        
        print(f"✓ Impact: Base={hybrid_end*100:.2f}%, Delta={delta*100:.2f}%, Adjusted={macro_end*100:.2f}%")

    def test_v2_pack_drivers_card_data(self):
        """Top drivers card data: key, contribution, weight"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response.status_code == 200
        
        drivers = response.json().get('drivers', {})
        components = drivers.get('components', [])
        
        assert len(components) > 0, "No driver components found"
        
        # Check first driver structure
        first = components[0]
        assert 'key' in first, "Driver missing 'key'"
        assert 'contribution' in first, "Driver missing 'contribution'"
        assert 'weight' in first, "Driver missing 'weight'"
        
        top_5 = components[:5]
        print(f"✓ Top drivers: {[d['key'] for d in top_5]}")

    def test_v2_state_current_endpoint(self):
        """GET /api/macro-engine/v2/state/current returns state"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v2/state/current")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') == True
        
        state = data.get('state')
        if state:
            assert 'dominant' in state
            assert 'confidence' in state
            assert 'persistence' in state
            print(f"✓ State: {state['dominant']}, conf={state['confidence']}")
        else:
            print("✓ No state stored yet (expected on fresh start)")

    def test_v2_calibration_weights_endpoint(self):
        """GET /api/macro-engine/v2/calibration/weights returns weights"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v2/calibration/weights")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') == True
        
        source = data.get('source')
        assert source in ['calibrated', 'default'], f"Invalid source: {source}"
        
        effective = data.get('effectiveWeights', {})
        assert isinstance(effective, dict), "effectiveWeights should be dict"
        
        print(f"✓ Weights source: {source}, keys: {list(effective.keys())[:5]}")

    def test_v1_vs_v2_compare_volscale_difference(self):
        """GET /api/macro-engine/DXY/compare - V2 should have volScale, V1 should not"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/DXY/compare")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') == True
        
        # V2 should have volScale in stateInfo
        v2_state_info = data.get('v2', {}).get('meta', {}).get('stateInfo', {})
        assert 'volScale' in v2_state_info, "V2 should have volScale"
        
        # V1 should NOT have volScale (or have empty stateInfo)
        v1_state_info = data.get('v1', {}).get('meta', {}).get('stateInfo', {})
        # V1 doesn't have stateInfo at all or it's minimal
        assert v1_state_info.get('volScale') is None, "V1 should NOT have volScale"
        
        print(f"✓ V2 volScale: {v2_state_info.get('volScale')}, V1 volScale: None")

    def test_v2_pack_stateinfo_weightsource(self):
        """V2 stateInfo should have weightsSource (default or calibrated)"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response.status_code == 200
        
        state_info = response.json().get('meta', {}).get('stateInfo', {})
        weights_source = state_info.get('weightsSource')
        
        assert weights_source in ['default', 'calibrated'], f"Invalid weightsSource: {weights_source}"
        print(f"✓ weightsSource: {weights_source}")


class TestV2EngineVersionBadge:
    """Tests for engine version identification"""

    def test_v2_direct_endpoint_returns_v2(self):
        """Direct V2 endpoint should return engineVersion: v2"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('engineVersion') == 'v2'
        print("✓ V2 direct endpoint returns v2")

    def test_v1_direct_endpoint_returns_v1(self):
        """Direct V1 endpoint should return engineVersion: v1"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/v1/DXY/pack")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('engineVersion') == 'v1'
        print("✓ V1 direct endpoint returns v1")

    def test_compare_shows_both_versions(self):
        """Compare endpoint shows both V1 and V2"""
        response = requests.get(f"{BASE_URL}/api/macro-engine/DXY/compare")
        assert response.status_code == 200
        
        data = response.json()
        
        v1_version = data.get('v1', {}).get('engineVersion')
        v2_version = data.get('v2', {}).get('engineVersion')
        
        assert v1_version == 'v1', f"Expected v1, got {v1_version}"
        assert v2_version == 'v2', f"Expected v2, got {v2_version}"
        print("✓ Compare shows v1 and v2 correctly")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
