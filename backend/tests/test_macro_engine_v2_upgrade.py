"""
Macro Engine V2 Upgrade Tests - Iteration 6
Tests for:
- Real XAUUSD gold data (5200+ points from stooq)
- V2 auto-activation (confidence >= 0.6, auto-switches to V2)
- Admin lifecycle (promote/rollback/reset)
- Calibration sanity checks (sumWeights, maxWeight, coverage)
- Router response with proper router field (mode/chosen/reason)
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestMacroEngineStatus:
    """Test /api/macro-engine/status endpoint - V2 auto-activation"""

    def test_status_endpoint_ok(self):
        """GET /api/macro-engine/status returns ok with activeEngine and v2Readiness"""
        res = requests.get(f"{BASE_URL}/api/macro-engine/status")
        assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
        data = res.json()
        
        assert data.get('ok') is True
        assert 'activeEngine' in data
        assert 'activeReason' in data
        assert 'v2Readiness' in data

    def test_status_v2_auto_activated(self):
        """Status shows activeEngine=v2 with AUTO_V2_READY when V2 confidence >= 0.6"""
        # First reset to auto mode
        requests.post(f"{BASE_URL}/api/macro-engine/admin/reset")
        
        res = requests.get(f"{BASE_URL}/api/macro-engine/status")
        assert res.status_code == 200
        data = res.json()
        
        # V2 should be active in auto mode
        assert data.get('activeEngine') == 'v2', f"Expected v2, got {data.get('activeEngine')}"
        assert data.get('activeReason') == 'AUTO_V2_READY', f"Expected AUTO_V2_READY, got {data.get('activeReason')}"
        
        # V2 readiness should be true
        v2_readiness = data.get('v2Readiness', {})
        assert v2_readiness.get('ready') is True


class TestMacroEngineV2Health:
    """Test /api/macro-engine/v2/health endpoint - Gold data sufficiency"""

    def test_v2_health_ok(self):
        """GET /api/macro-engine/v2/health returns ok=true with no issues"""
        res = requests.get(f"{BASE_URL}/api/macro-engine/v2/health")
        assert res.status_code == 200
        data = res.json()
        
        assert data.get('ok') is True
        assert data.get('version') == 'v2'
        # No critical issues
        assert data.get('issues', []) == []


class TestMacroEngineDXYPack:
    """Test /api/macro-engine/DXY/pack - Router with auto V2"""

    def test_dxy_pack_returns_v2_with_router(self):
        """GET /api/macro-engine/DXY/pack returns engineVersion=v2 with router field"""
        # Reset to auto mode first
        requests.post(f"{BASE_URL}/api/macro-engine/admin/reset")
        
        res = requests.get(f"{BASE_URL}/api/macro-engine/DXY/pack")
        assert res.status_code == 200
        data = res.json()
        
        # Should be V2
        assert data.get('engineVersion') == 'v2'
        
        # Router field should be present with mode, chosen, reason
        router = data.get('router', {})
        assert router.get('mode') == 'auto', f"Expected auto, got {router.get('mode')}"
        assert router.get('chosen') == 'v2', f"Expected v2, got {router.get('chosen')}"
        assert router.get('reason') == 'AUTO_V2_READY'


class TestMacroEngineV2DXYPack:
    """Test /api/macro-engine/v2/DXY/pack - Direct V2 access"""

    def test_v2_pack_has_gold_driver(self):
        """V2 pack includes GOLD driver with displayName containing XAUUSD"""
        res = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert res.status_code == 200
        data = res.json()
        
        components = data.get('drivers', {}).get('components', [])
        gold_drivers = [c for c in components if c.get('key') == 'GOLD']
        
        assert len(gold_drivers) == 1, "Expected exactly 1 GOLD driver"
        gold = gold_drivers[0]
        
        # Check displayName contains XAUUSD
        assert 'XAUUSD' in gold.get('displayName', ''), f"Gold displayName should contain XAUUSD, got {gold.get('displayName')}"
        # Check weight > 0
        assert gold.get('weight', 0) > 0, f"Gold weight should be > 0, got {gold.get('weight')}"

    def test_v2_pack_has_state_info(self):
        """V2 pack contains meta.stateInfo with volScale and weightsSource"""
        res = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert res.status_code == 200
        data = res.json()
        
        state_info = data.get('meta', {}).get('stateInfo', {})
        
        # volScale should be present
        assert 'volScale' in state_info, "stateInfo should have volScale"
        vol_scale = state_info.get('volScale')
        assert isinstance(vol_scale, (int, float)), f"volScale should be numeric, got {type(vol_scale)}"
        
        # weightsSource should be calibrated
        assert state_info.get('weightsSource') == 'calibrated', f"Expected calibrated, got {state_info.get('weightsSource')}"

    def test_v2_pack_regime_confidence_high(self):
        """V2 regime confidence should be >= 0.6 (not old 0.48)"""
        res = requests.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert res.status_code == 200
        data = res.json()
        
        confidence = data.get('regime', {}).get('confidence', 0)
        
        # V2 computes its own confidence >= 0.6
        assert confidence >= 0.6, f"V2 confidence should be >= 0.6, got {confidence}"


class TestMacroEngineAdminActive:
    """Test /api/macro-engine/admin/active endpoint"""

    def test_get_admin_active(self):
        """GET /api/macro-engine/admin/active returns active engine and mode"""
        # Reset to auto mode first
        requests.post(f"{BASE_URL}/api/macro-engine/admin/reset")
        
        res = requests.get(f"{BASE_URL}/api/macro-engine/admin/active?asset=DXY")
        assert res.status_code == 200
        data = res.json()
        
        assert data.get('ok') is True
        assert data.get('asset') == 'DXY'
        assert data.get('active') == 'v2'
        assert data.get('mode') == 'auto'


class TestMacroEngineAdminLifecycle:
    """Test admin promote/rollback/reset sequence"""

    def test_rollback_to_v1(self):
        """POST /api/macro-engine/admin/rollback switches to V1"""
        payload = {"asset": "DXY", "to": "v1", "reason": "test_rollback"}
        res = requests.post(f"{BASE_URL}/api/macro-engine/admin/rollback",
                          json=payload)
        assert res.status_code == 200
        data = res.json()
        
        assert data.get('ok') is True
        assert data.get('to') == 'v1'

    def test_verify_v1_after_rollback(self):
        """GET /api/macro-engine/DXY/pack returns V1 after rollback"""
        # First rollback to V1
        requests.post(f"{BASE_URL}/api/macro-engine/admin/rollback",
                     json={"asset": "DXY", "to": "v1", "reason": "test"})
        
        res = requests.get(f"{BASE_URL}/api/macro-engine/DXY/pack")
        assert res.status_code == 200
        data = res.json()
        
        assert data.get('engineVersion') == 'v1', f"Expected v1 after rollback, got {data.get('engineVersion')}"

    def test_promote_to_v2(self):
        """POST /api/macro-engine/admin/promote switches to V2"""
        payload = {"asset": "DXY", "from": "v1", "to": "v2", "reason": "test_promote"}
        res = requests.post(f"{BASE_URL}/api/macro-engine/admin/promote",
                          json=payload)
        assert res.status_code == 200
        data = res.json()
        
        assert data.get('ok') is True
        assert data.get('to') == 'v2'

    def test_verify_v2_after_promote(self):
        """GET /api/macro-engine/DXY/pack returns V2 after promote"""
        # First promote to V2
        requests.post(f"{BASE_URL}/api/macro-engine/admin/promote",
                     json={"asset": "DXY", "from": "v1", "to": "v2", "reason": "test"})
        
        res = requests.get(f"{BASE_URL}/api/macro-engine/DXY/pack")
        assert res.status_code == 200
        data = res.json()
        
        assert data.get('engineVersion') == 'v2', f"Expected v2 after promote, got {data.get('engineVersion')}"

    def test_reset_to_auto(self):
        """POST /api/macro-engine/admin/reset resets to auto mode"""
        res = requests.post(f"{BASE_URL}/api/macro-engine/admin/reset")
        assert res.status_code == 200
        data = res.json()
        
        assert data.get('ok') is True

    def test_verify_auto_after_reset(self):
        """GET /api/macro-engine/DXY/pack uses auto mode after reset"""
        # Reset to auto
        requests.post(f"{BASE_URL}/api/macro-engine/admin/reset")
        
        res = requests.get(f"{BASE_URL}/api/macro-engine/DXY/pack")
        assert res.status_code == 200
        data = res.json()
        
        router = data.get('router', {})
        assert router.get('mode') == 'auto', f"Expected auto mode after reset, got {router.get('mode')}"


class TestMacroEngineCalibration:
    """Test /api/macro-engine/v2/calibration/run with sanity checks"""

    def test_calibration_run_sanity_checks(self):
        """POST /api/macro-engine/v2/calibration/run returns sanity checks passing"""
        payload = {"symbol": "DXY"}
        res = requests.post(f"{BASE_URL}/api/macro-engine/v2/calibration/run",
                          json=payload)
        assert res.status_code == 200
        data = res.json()
        
        assert data.get('ok') is True
        
        sanity = data.get('sanity', {})
        
        # Check pass
        assert sanity.get('pass') is True, f"Sanity check should pass, got {sanity}"
        
        # Check sumWeights ~ 1.0
        sum_weights = sanity.get('sumWeights', 0)
        assert sanity.get('sumWeightsOk') is True, f"sumWeights should be ~1.0, got {sum_weights}"
        
        # Check maxWeight < 0.35
        max_weight = sanity.get('maxWeight', 1)
        assert sanity.get('maxWeightOk') is True, f"maxWeight should be < 0.35, got {max_weight}"
        
        # Check coverage >= 0.8
        assert sanity.get('coverageOk') is True

    def test_calibration_includes_gold(self):
        """Calibration topWeights includes GOLD"""
        payload = {"symbol": "DXY"}
        res = requests.post(f"{BASE_URL}/api/macro-engine/v2/calibration/run",
                          json=payload)
        assert res.status_code == 200
        data = res.json()
        
        top_weights = data.get('topWeights', [])
        gold_weights = [w for w in top_weights if w.get('key') == 'GOLD']
        
        # GOLD should be in top weights
        assert len(gold_weights) > 0, "GOLD should be in topWeights"


class TestMacroEngineCompare:
    """Test /api/macro-engine/DXY/compare - V1 vs V2 comparison"""

    def test_compare_v2_has_gold_v1_does_not(self):
        """GET /api/macro-engine/DXY/compare shows V2 has GOLD, V1 does not"""
        res = requests.get(f"{BASE_URL}/api/macro-engine/DXY/compare")
        assert res.status_code == 200
        data = res.json()
        
        assert data.get('ok') is True
        
        # V1 should not have GOLD
        v1_components = data.get('v1', {}).get('drivers', {}).get('components', [])
        v1_gold = [c for c in v1_components if c.get('key') == 'GOLD']
        assert len(v1_gold) == 0, "V1 should not have GOLD driver"
        
        # V2 should have GOLD
        v2_components = data.get('v2', {}).get('drivers', {}).get('components', [])
        v2_gold = [c for c in v2_components if c.get('key') == 'GOLD']
        assert len(v2_gold) == 1, "V2 should have GOLD driver"


class TestMacroEngineStateCurrent:
    """Test /api/macro-engine/v2/state/current - Stored state with confidence"""

    def test_state_current_has_confidence(self):
        """GET /api/macro-engine/v2/state/current returns stored state with confidence >= 0.6"""
        res = requests.get(f"{BASE_URL}/api/macro-engine/v2/state/current?symbol=DXY")
        assert res.status_code == 200
        data = res.json()
        
        assert data.get('ok') is True
        
        state = data.get('state')
        if state:  # State may be null if not initialized
            confidence = state.get('confidence', 0)
            assert confidence >= 0.6, f"State confidence should be >= 0.6, got {confidence}"


# Ensure tests reset to auto mode after running
@pytest.fixture(scope="module", autouse=True)
def reset_after_tests():
    """Reset to auto mode after all tests complete"""
    yield
    requests.post(f"{BASE_URL}/api/macro-engine/admin/reset")
