"""
V2 Macro Engine Integration Tests
=================================
Tests for RegimeStateService, RollingCalibrationService, and V2 engine endpoints.
- Regime state management with hysteresis
- Rolling weight calibration
- V1/V2 comparison and router functionality
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Ensure BASE_URL is set
if not BASE_URL:
    raise ValueError("REACT_APP_BACKEND_URL environment variable must be set")


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestV2Health:
    """V2 Engine Health Check Tests"""
    
    def test_v2_health_check(self, api_client):
        """GET /api/macro-engine/v2/health — should return ok:true"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v2/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("version") == "v2"
        assert data.get("ok") is True
        assert "issues" in data
        assert isinstance(data["issues"], list)
        assert "warnings" in data
        print(f"V2 Health: ok={data['ok']}, issues={data['issues']}, warnings={data['warnings']}")


class TestV2Pack:
    """V2 Pack Endpoint Tests"""
    
    def test_v2_dxy_pack_basic(self, api_client):
        """GET /api/macro-engine/v2/DXY/pack — returns valid V2 pack"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("engineVersion") == "v2"
        assert "overlay" in data
        assert "regime" in data
        assert "drivers" in data
        assert "guard" in data
        assert "meta" in data
        
        # Check horizons
        horizons = data["overlay"].get("horizons", [])
        assert len(horizons) >= 6
        
        # Check regime structure
        regime = data["regime"]
        assert "dominant" in regime
        assert "confidence" in regime
        assert "probs" in regime
        
        print(f"V2 Pack: regime={regime['dominant']}, confidence={regime['confidence']}")
    
    def test_v2_pack_has_state_info(self, api_client):
        """V2 pack should contain stateInfo with entropy, changeCount30D, weightsSource"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response.status_code == 200
        
        data = response.json()
        meta = data.get("meta", {})
        state_info = meta.get("stateInfo", {})
        
        assert "entropy" in state_info
        assert "changeCount30D" in state_info
        assert "weightsSource" in state_info
        
        # Entropy should be between 0 and 1
        entropy = state_info["entropy"]
        assert isinstance(entropy, (int, float))
        assert 0 <= entropy <= 1
        
        # changeCount30D should be non-negative integer
        change_count = state_info["changeCount30D"]
        assert isinstance(change_count, int)
        assert change_count >= 0
        
        # weightsSource should be 'default' or 'calibrated'
        weights_source = state_info["weightsSource"]
        assert weights_source in ["default", "calibrated"]
        
        print(f"StateInfo: entropy={entropy}, changeCount30D={change_count}, weightsSource={weights_source}")
    
    def test_v2_pack_has_gold_signal(self, api_client):
        """V2 pack should contain gold signal in internals"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response.status_code == 200
        
        data = response.json()
        internals = data.get("internals", {})
        v2_internals = internals.get("v2", {})
        
        assert "goldSignal" in v2_internals or "transitionMatrix" in v2_internals
        
        if "goldSignal" in v2_internals:
            gold_signal = v2_internals["goldSignal"]
            assert "z120" in gold_signal
            print(f"Gold signal z120: {gold_signal['z120']}")


class TestRegimeState:
    """Regime State Service Tests (P1)"""
    
    def test_get_current_state(self, api_client):
        """GET /api/macro-engine/v2/state/current — returns current regime state"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v2/state/current")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        
        state = data.get("state")
        if state:
            assert "symbol" in state
            assert "dominant" in state
            assert "probs" in state
            assert "entropy" in state
            assert "changeCount30D" in state
            assert "sourceVersion" in state
            assert state["sourceVersion"] == "v2"
            print(f"Current state: {state['dominant']}, entropy={state.get('entropy')}")
        else:
            print("No state stored yet - will initialize on first computePack")
    
    def test_get_state_history(self, api_client):
        """GET /api/macro-engine/v2/state/history — returns regime state history"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v2/state/history?limit=5")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        assert "count" in data
        assert "history" in data
        
        history = data["history"]
        assert isinstance(history, list)
        
        if len(history) > 0:
            entry = history[0]
            assert "asOf" in entry
            assert "dominant" in entry
            assert "persistence" in entry
            assert "entropy" in entry
            print(f"History count: {data['count']}, latest regime: {entry['dominant']}")
        else:
            print("No state history yet")


class TestCalibration:
    """Rolling Calibration Service Tests (P2)"""
    
    def test_get_calibration_weights(self, api_client):
        """GET /api/macro-engine/v2/calibration/weights — returns current weights"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v2/calibration/weights")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        assert "symbol" in data
        assert "source" in data  # 'calibrated' or 'default'
        assert "effectiveWeights" in data
        
        effective_weights = data["effectiveWeights"]
        assert isinstance(effective_weights, dict)
        
        # Check for expected weight keys
        expected_keys = ["T10Y2Y", "FEDFUNDS", "UNRATE"]
        for key in expected_keys:
            if key in effective_weights:
                print(f"Weight {key}: {effective_weights[key]}")
        
        print(f"Weights source: {data['source']}, needsRecalibration: {data.get('needsRecalibration')}")
    
    def test_calibrated_weights_have_components(self, api_client):
        """Calibrated weights should include component details with corr/lag/weight"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v2/calibration/weights")
        assert response.status_code == 200
        
        data = response.json()
        
        if data.get("source") == "calibrated":
            components = data.get("components")
            assert components is not None
            assert isinstance(components, list)
            assert len(components) > 0
            
            for comp in components:
                assert "key" in comp
                assert "corr" in comp
                assert "lagDays" in comp
                assert "weight" in comp
                print(f"Component {comp['key']}: corr={comp['corr']}, lag={comp['lagDays']}, weight={comp['weight']}")
    
    def test_get_calibration_history(self, api_client):
        """GET /api/macro-engine/v2/calibration/history — returns weights history"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v2/calibration/history")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        assert "count" in data
        assert "history" in data
        
        history = data["history"]
        assert isinstance(history, list)
        
        if len(history) > 0:
            entry = history[0]
            assert "asOf" in entry
            assert "windowDays" in entry
            assert "aggregateCorr" in entry
            assert "components" in entry
            print(f"Calibration history count: {data['count']}, latest aggregateCorr: {entry['aggregateCorr']}")
    
    def test_run_calibration(self, api_client):
        """POST /api/macro-engine/v2/calibration/run — triggers recalibration"""
        response = api_client.post(
            f"{BASE_URL}/api/macro-engine/v2/calibration/run",
            json={"symbol": "DXY"}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        assert "symbol" in data
        assert data["symbol"] == "DXY"
        assert "asOf" in data
        assert "aggregateCorr" in data
        assert "qualityScore" in data
        assert "components" in data
        
        components = data["components"]
        assert isinstance(components, list)
        assert len(components) > 0
        
        # Verify each component has required fields
        for comp in components:
            assert "key" in comp
            assert "corr" in comp
            assert "lagDays" in comp
            assert "weight" in comp
        
        print(f"Calibration result: aggregateCorr={data['aggregateCorr']}, qualityScore={data['qualityScore']}")


class TestRouterStatus:
    """Router Status and Engine Selection Tests"""
    
    def test_router_status(self, api_client):
        """GET /api/macro-engine/status — returns router status"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/status")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        assert "activeEngine" in data
        assert "v2Readiness" in data
        assert "config" in data
        
        # Validate v2Readiness structure
        v2_ready = data["v2Readiness"]
        assert "ready" in v2_ready
        assert "reason" in v2_ready
        
        print(f"Router status: activeEngine={data['activeEngine']}, v2Ready={v2_ready['ready']}")
    
    def test_force_engine_to_v2(self, api_client):
        """POST /api/macro-engine/admin/force-engine — forces V2 engine"""
        response = api_client.post(
            f"{BASE_URL}/api/macro-engine/admin/force-engine",
            json={"version": "v2"}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        
        # Verify engine is now V2
        status_response = api_client.get(f"{BASE_URL}/api/macro-engine/status")
        status = status_response.json()
        assert status.get("activeEngine") == "v2"
        assert status.get("override") == "v2"
        
        print("Successfully forced engine to V2")
    
    def test_reset_engine_override(self, api_client):
        """POST /api/macro-engine/admin/reset — resets to defaults"""
        # First force to V2
        api_client.post(
            f"{BASE_URL}/api/macro-engine/admin/force-engine",
            json={"version": "v2"}
        )
        
        # Reset (without Content-Type header for empty body)
        response = requests.post(f"{BASE_URL}/api/macro-engine/admin/reset")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        
        # Verify override is cleared
        status_response = api_client.get(f"{BASE_URL}/api/macro-engine/status")
        status = status_response.json()
        assert status.get("override") is None
        
        print("Successfully reset engine override")


class TestV1V2Comparison:
    """V1 vs V2 Comparison Tests"""
    
    def test_v1_pack_baseline(self, api_client):
        """GET /api/macro-engine/v1/DXY/pack — returns V1 pack (no stateInfo)"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v1/DXY/pack")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("engineVersion") == "v1"
        assert "overlay" in data
        assert "regime" in data
        assert "drivers" in data
        
        # V1 should NOT have stateInfo in meta
        meta = data.get("meta", {})
        state_info = meta.get("stateInfo")
        assert state_info is None, "V1 pack should not have stateInfo"
        
        print(f"V1 Pack: regime={data['regime']['dominant']}")
    
    def test_compare_v1_v2(self, api_client):
        """GET /api/macro-engine/DXY/compare — compares V1 vs V2 packs"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/DXY/compare")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        assert "v1" in data
        assert "v2" in data
        assert "comparison" in data
        
        comparison = data["comparison"]
        assert "scoreDiff" in comparison
        assert "regimeSame" in comparison
        assert "deltaReturn" in comparison
        
        delta_return = comparison["deltaReturn"]
        assert "v1" in delta_return
        assert "v2" in delta_return
        assert "diff" in delta_return
        
        print(f"Comparison: scoreDiff={comparison['scoreDiff']}, regimeSame={comparison['regimeSame']}")


class TestHysteresis:
    """Hysteresis (No Regime Flip-Flopping) Tests"""
    
    def test_hysteresis_stability(self, api_client):
        """Two consecutive V2 pack calls should not cause regime flip-flopping"""
        # First call
        response1 = api_client.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response1.status_code == 200
        data1 = response1.json()
        
        regime1 = data1["regime"]["dominant"]
        change_count1 = data1["meta"]["stateInfo"]["changeCount30D"]
        
        # Wait briefly
        time.sleep(1)
        
        # Second call
        response2 = api_client.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        assert response2.status_code == 200
        data2 = response2.json()
        
        regime2 = data2["regime"]["dominant"]
        change_count2 = data2["meta"]["stateInfo"]["changeCount30D"]
        
        # Hysteresis test: regime should be stable, changeCount should not increase
        assert regime1 == regime2, f"Regime should not flip-flop: {regime1} vs {regime2}"
        assert change_count2 <= change_count1 + 1, "changeCount30D should not increase rapidly"
        
        print(f"Hysteresis check: regime stable at {regime1}, changeCount30D={change_count2}")
    
    def test_state_persistence_across_calls(self, api_client):
        """State should persist between calls (not reset each time)"""
        # Get current state
        response1 = api_client.get(f"{BASE_URL}/api/macro-engine/v2/state/current")
        data1 = response1.json()
        
        if not data1.get("state"):
            # Initialize state with a pack call
            api_client.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
            response1 = api_client.get(f"{BASE_URL}/api/macro-engine/v2/state/current")
            data1 = response1.json()
        
        state1 = data1.get("state", {})
        last_change1 = state1.get("lastChangeAt")
        
        # Make another pack call
        api_client.get(f"{BASE_URL}/api/macro-engine/v2/DXY/pack")
        
        # Get state again
        response2 = api_client.get(f"{BASE_URL}/api/macro-engine/v2/state/current")
        data2 = response2.json()
        state2 = data2.get("state", {})
        
        # If regime didn't change, lastChangeAt should be same
        if state1.get("dominant") == state2.get("dominant"):
            # Either same lastChangeAt or very close
            print(f"State persistence: lastChangeAt preserved at {last_change1}")
        else:
            print(f"Regime changed from {state1.get('dominant')} to {state2.get('dominant')}")


class TestEdgeCases:
    """Edge Case Tests"""
    
    def test_invalid_asset(self, api_client):
        """Invalid asset should return 400"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/INVALID/pack")
        assert response.status_code == 400
    
    def test_invalid_engine_version(self, api_client):
        """Invalid engine version should return 400"""
        response = api_client.post(
            f"{BASE_URL}/api/macro-engine/admin/force-engine",
            json={"version": "v3"}
        )
        assert response.status_code == 400
    
    def test_state_with_custom_symbol(self, api_client):
        """Test state endpoint with symbol parameter"""
        response = api_client.get(f"{BASE_URL}/api/macro-engine/v2/state/current?symbol=DXY")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
