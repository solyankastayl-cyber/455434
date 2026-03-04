"""
P8.0-C Brain Decision Rules Integration Test Suite

Tests the integration of Quantile Forecast into Brain Decision Rules:
  WorldState → Quantile Forecast (MoE) → Scenario Engine → Risk Engine → Directives → EngineGlobal

Tests cover:
  - GET /api/brain/v2/decision — scenario, directives, evidence, meta
  - GET /api/brain/v2/decision?withForecast=1 — forecasts, overrideReasoning, forecastMeta
  - GET /api/brain/v2/summary — condensed view with override reasoning
  - GET /api/brain/v2/status — capabilities list (quantile_forecast_moe, etc.)
  - POST /api/brain/v2/apply-overrides — applies Brain directives to engine output
  - Regression tests for /api/brain/v2/forecast endpoints
"""

import pytest
import requests
import os
import math

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# ═══════════════════════════════════════════════════════════════
# FIXTURES
# ═══════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session

@pytest.fixture(scope="module")
def decision_response(api_client):
    """Cache the decision response for multiple tests"""
    response = api_client.get(f"{BASE_URL}/api/brain/v2/decision")
    assert response.status_code == 200, f"Decision endpoint failed: {response.text}"
    return response.json()

@pytest.fixture(scope="module")
def decision_with_forecast(api_client):
    """Cache the decision response with forecast data"""
    response = api_client.get(f"{BASE_URL}/api/brain/v2/decision?withForecast=1")
    assert response.status_code == 200, f"Decision with forecast failed: {response.text}"
    return response.json()

# ═══════════════════════════════════════════════════════════════
# TEST CLASS: /api/brain/v2/decision
# ═══════════════════════════════════════════════════════════════

class TestBrainDecisionEndpoint:
    """Tests for GET /api/brain/v2/decision"""
    
    def test_decision_returns_200(self, api_client):
        """Decision endpoint returns 200"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/decision")
        assert response.status_code == 200
        print("✓ GET /api/brain/v2/decision returns 200")
    
    def test_decision_has_scenario_structure(self, decision_response):
        """Decision response has scenario with name, probs, confidence, description"""
        scenario = decision_response.get('scenario')
        assert scenario is not None, "scenario is missing"
        
        # Check scenario.name is valid
        assert scenario.get('name') in ['BASE', 'RISK', 'TAIL'], \
            f"scenario.name must be BASE/RISK/TAIL, got {scenario.get('name')}"
        
        # Check probs structure
        probs = scenario.get('probs')
        assert probs is not None, "scenario.probs is missing"
        assert 'BASE' in probs, "probs.BASE missing"
        assert 'RISK' in probs, "probs.RISK missing"
        assert 'TAIL' in probs, "probs.TAIL missing"
        
        # Check confidence
        assert 'confidence' in scenario, "scenario.confidence missing"
        assert isinstance(scenario['confidence'], (int, float)), "confidence must be numeric"
        
        # Check description
        assert 'description' in scenario, "scenario.description missing"
        
        print(f"✓ Scenario structure valid: {scenario['name']} with probs={probs}")
    
    def test_scenario_probs_sum_to_approximately_one(self, decision_response):
        """Scenario probabilities sum to approximately 1.0"""
        probs = decision_response['scenario']['probs']
        total = sum(probs.values())
        
        # Allow small tolerance for floating point
        assert abs(total - 1.0) < 0.05, f"Probs sum to {total}, expected ~1.0"
        print(f"✓ Scenario probs sum correctly: BASE={probs['BASE']}, RISK={probs['RISK']}, TAIL={probs['TAIL']} = {total}")
    
    def test_scenario_probs_all_non_negative(self, decision_response):
        """All scenario probabilities are >= 0"""
        probs = decision_response['scenario']['probs']
        
        for name, prob in probs.items():
            assert prob >= 0, f"Prob for {name} is negative: {prob}"
        
        print(f"✓ All probs non-negative: BASE={probs['BASE']}, RISK={probs['RISK']}, TAIL={probs['TAIL']}")
    
    def test_directives_has_risk_mode(self, decision_response):
        """Directives contain riskMode (RISK_ON, RISK_OFF, NEUTRAL)"""
        directives = decision_response.get('directives')
        assert directives is not None, "directives is missing"
        
        risk_mode = directives.get('riskMode')
        assert risk_mode in ['RISK_ON', 'RISK_OFF', 'NEUTRAL'], \
            f"riskMode must be RISK_ON/RISK_OFF/NEUTRAL, got {risk_mode}"
        
        print(f"✓ riskMode present and valid: {risk_mode}")
    
    def test_evidence_has_required_fields(self, decision_response):
        """Evidence has headline, drivers, confidenceFactors"""
        evidence = decision_response.get('evidence')
        assert evidence is not None, "evidence is missing"
        
        # headline
        assert 'headline' in evidence, "evidence.headline missing"
        assert isinstance(evidence['headline'], str), "headline must be string"
        
        # drivers
        assert 'drivers' in evidence, "evidence.drivers missing"
        assert isinstance(evidence['drivers'], list), "drivers must be list"
        assert len(evidence['drivers']) > 0, "drivers should not be empty"
        
        # confidenceFactors
        assert 'confidenceFactors' in evidence, "evidence.confidenceFactors missing"
        assert isinstance(evidence['confidenceFactors'], list), "confidenceFactors must be list"
        
        print(f"✓ Evidence valid: headline='{evidence['headline'][:50]}...', {len(evidence['drivers'])} drivers")
    
    def test_meta_has_brain_version_moe(self, decision_response):
        """Meta has brainVersion 'v2.1.0-moe' and engineVersion 'v2'"""
        meta = decision_response.get('meta')
        assert meta is not None, "meta is missing"
        
        assert meta.get('brainVersion') == 'v2.1.0-moe', \
            f"Expected brainVersion 'v2.1.0-moe', got '{meta.get('brainVersion')}'"
        
        assert meta.get('engineVersion') == 'v2', \
            f"Expected engineVersion 'v2', got '{meta.get('engineVersion')}'"
        
        print(f"✓ Meta versions correct: brainVersion={meta['brainVersion']}, engineVersion={meta['engineVersion']}")
    
    def test_meta_has_inputs_hash(self, decision_response):
        """Meta contains inputsHash for determinism"""
        meta = decision_response.get('meta')
        inputs_hash = meta.get('inputsHash')
        
        assert inputs_hash is not None, "inputsHash missing"
        assert isinstance(inputs_hash, str), "inputsHash must be string"
        assert len(inputs_hash) > 0, "inputsHash should not be empty"
        
        print(f"✓ inputsHash present: {inputs_hash}")


# ═══════════════════════════════════════════════════════════════
# TEST CLASS: /api/brain/v2/decision?withForecast=1
# ═══════════════════════════════════════════════════════════════

class TestBrainDecisionWithForecast:
    """Tests for GET /api/brain/v2/decision?withForecast=1"""
    
    def test_includes_forecasts_object(self, decision_with_forecast):
        """Response includes 'forecasts' object with dxy byHorizon data"""
        forecasts = decision_with_forecast.get('forecasts')
        assert forecasts is not None, "forecasts missing when withForecast=1"
        
        dxy_forecast = forecasts.get('dxy')
        assert dxy_forecast is not None, "forecasts.dxy missing"
        
        by_horizon = dxy_forecast.get('byHorizon')
        assert by_horizon is not None, "forecasts.dxy.byHorizon missing"
        
        # Check all horizons present
        for horizon in ['30D', '90D', '180D', '365D']:
            assert horizon in by_horizon, f"Horizon {horizon} missing from forecasts"
            hf = by_horizon[horizon]
            assert 'mean' in hf, f"{horizon}: mean missing"
            assert 'q05' in hf, f"{horizon}: q05 missing"
            assert 'q50' in hf, f"{horizon}: q50 missing"
            assert 'q95' in hf, f"{horizon}: q95 missing"
            assert 'tailRisk' in hf, f"{horizon}: tailRisk missing"
        
        print(f"✓ Forecasts object present with all 4 horizons")
    
    def test_includes_override_reasoning(self, decision_with_forecast):
        """Response includes 'overrideReasoning' with tailAmplified, bullExtension, neutralDampened booleans"""
        reasoning = decision_with_forecast.get('overrideReasoning')
        assert reasoning is not None, "overrideReasoning missing when withForecast=1"
        
        # Check required boolean fields
        assert 'tailAmplified' in reasoning, "tailAmplified missing"
        assert isinstance(reasoning['tailAmplified'], bool), "tailAmplified must be boolean"
        
        assert 'bullExtension' in reasoning, "bullExtension missing"
        assert isinstance(reasoning['bullExtension'], bool), "bullExtension must be boolean"
        
        assert 'neutralDampened' in reasoning, "neutralDampened missing"
        assert isinstance(reasoning['neutralDampened'], bool), "neutralDampened must be boolean"
        
        print(f"✓ overrideReasoning present: tailAmplified={reasoning['tailAmplified']}, "
              f"bullExtension={reasoning['bullExtension']}, neutralDampened={reasoning['neutralDampened']}")
    
    def test_override_reasoning_has_scenario_inputs(self, decision_with_forecast):
        """overrideReasoning contains scenarioInputs with maxTailRisk, regimePStress, volSpike, riskScore"""
        reasoning = decision_with_forecast.get('overrideReasoning', {})
        inputs = reasoning.get('scenarioInputs')
        
        assert inputs is not None, "scenarioInputs missing from overrideReasoning"
        
        required_fields = ['maxTailRisk', 'regimePStress', 'volSpike', 'riskScore']
        for field in required_fields:
            assert field in inputs, f"scenarioInputs.{field} missing"
            assert isinstance(inputs[field], (int, float)), f"{field} must be numeric"
        
        print(f"✓ scenarioInputs present: maxTailRisk={inputs['maxTailRisk']:.2f}, "
              f"regimePStress={inputs['regimePStress']:.2f}, volSpike={inputs['volSpike']:.2f}, "
              f"riskScore={inputs['riskScore']:.2f}")
    
    def test_includes_forecast_meta(self, decision_with_forecast):
        """Response includes 'forecastMeta' with modelVersion, isBaseline, trainedAt, regime"""
        meta = decision_with_forecast.get('forecastMeta')
        assert meta is not None, "forecastMeta missing when withForecast=1"
        
        assert 'modelVersion' in meta, "forecastMeta.modelVersion missing"
        assert 'isBaseline' in meta, "forecastMeta.isBaseline missing"
        assert 'trainedAt' in meta, "forecastMeta.trainedAt missing"
        assert 'regime' in meta, "forecastMeta.regime missing"
        
        print(f"✓ forecastMeta present: modelVersion={meta['modelVersion']}, "
              f"isBaseline={meta['isBaseline']}, trainedAt={meta.get('trainedAt', 'N/A')[:10]}...")


# ═══════════════════════════════════════════════════════════════
# TEST CLASS: Determinism
# ═══════════════════════════════════════════════════════════════

class TestBrainDecisionDeterminism:
    """Tests for determinism of Brain decision"""
    
    def test_same_asof_produces_same_inputs_hash(self, api_client):
        """Same asOf produces same inputsHash (determinism)"""
        # Use a fixed date
        fixed_date = "2026-02-25"
        
        # Make two requests with same asOf
        resp1 = api_client.get(f"{BASE_URL}/api/brain/v2/decision?asOf={fixed_date}")
        resp2 = api_client.get(f"{BASE_URL}/api/brain/v2/decision?asOf={fixed_date}")
        
        assert resp1.status_code == 200, f"First request failed: {resp1.text}"
        assert resp2.status_code == 200, f"Second request failed: {resp2.text}"
        
        hash1 = resp1.json()['meta']['inputsHash']
        hash2 = resp2.json()['meta']['inputsHash']
        
        assert hash1 == hash2, f"inputsHash differs: {hash1} vs {hash2}"
        
        print(f"✓ Determinism confirmed: same asOf '{fixed_date}' → same inputsHash '{hash1}'")


# ═══════════════════════════════════════════════════════════════
# TEST CLASS: /api/brain/v2/summary
# ═══════════════════════════════════════════════════════════════

class TestBrainSummaryEndpoint:
    """Tests for GET /api/brain/v2/summary"""
    
    def test_summary_returns_200(self, api_client):
        """Summary endpoint returns 200"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/summary")
        assert response.status_code == 200, f"Summary failed: {response.text}"
        print("✓ GET /api/brain/v2/summary returns 200")
    
    def test_summary_has_condensed_view(self, api_client):
        """Summary returns condensed view with scenario, riskMode, haircuts, caps, scales, overrideReasoning, forecastSummary"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/summary")
        data = response.json()
        
        assert data.get('ok') == True, "Summary response not ok"
        
        # Required fields
        required = ['scenario', 'riskMode', 'haircuts', 'caps', 'scales', 'overrideReasoning', 'forecastSummary']
        for field in required:
            assert field in data, f"Summary missing field: {field}"
        
        # Validate scenario
        assert data['scenario'] in ['BASE', 'RISK', 'TAIL'], f"Invalid scenario: {data['scenario']}"
        
        # Validate riskMode
        assert data['riskMode'] in ['RISK_ON', 'RISK_OFF', 'NEUTRAL'], f"Invalid riskMode: {data['riskMode']}"
        
        # Validate overrideReasoning has the booleans
        reasoning = data['overrideReasoning']
        assert 'tailAmplified' in reasoning, "tailAmplified missing from summary.overrideReasoning"
        assert 'bullExtension' in reasoning, "bullExtension missing from summary.overrideReasoning"
        assert 'neutralDampened' in reasoning, "neutralDampened missing from summary.overrideReasoning"
        
        # Validate forecastSummary has byHorizon
        assert 'byHorizon' in data['forecastSummary'], "forecastSummary.byHorizon missing"
        
        print(f"✓ Summary condensed view valid: scenario={data['scenario']}, riskMode={data['riskMode']}")


# ═══════════════════════════════════════════════════════════════
# TEST CLASS: /api/brain/v2/status
# ═══════════════════════════════════════════════════════════════

class TestBrainStatusEndpoint:
    """Tests for GET /api/brain/v2/status"""
    
    def test_status_returns_200(self, api_client):
        """Status endpoint returns 200"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/status")
        assert response.status_code == 200, f"Status failed: {response.text}"
        print("✓ GET /api/brain/v2/status returns 200")
    
    def test_status_has_brain_version_moe(self, api_client):
        """Status shows brainVersion 'v2.1.0-moe'"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/status")
        data = response.json()
        
        assert data.get('brainVersion') == 'v2.1.0-moe', \
            f"Expected brainVersion 'v2.1.0-moe', got '{data.get('brainVersion')}'"
        
        print(f"✓ Status brainVersion correct: {data['brainVersion']}")
    
    def test_status_capabilities_include_p80c_features(self, api_client):
        """Status capabilities list includes quantile_forecast_moe, probabilistic_scenario_engine, 
           forecast_driven_overrides, tail_amplification, bull_extension, neutral_dampening"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/status")
        data = response.json()
        
        capabilities = data.get('capabilities', [])
        
        required_capabilities = [
            'quantile_forecast_moe',
            'probabilistic_scenario_engine',
            'forecast_driven_overrides',
            'tail_amplification',
            'bull_extension',
            'neutral_dampening',
        ]
        
        for cap in required_capabilities:
            assert cap in capabilities, f"Capability '{cap}' missing from status"
        
        print(f"✓ All P8.0-C capabilities present: {required_capabilities}")


# ═══════════════════════════════════════════════════════════════
# TEST CLASS: POST /api/brain/v2/apply-overrides
# ═══════════════════════════════════════════════════════════════

class TestBrainApplyOverrides:
    """Tests for POST /api/brain/v2/apply-overrides"""
    
    def test_apply_overrides_returns_200(self, api_client):
        """Apply-overrides endpoint returns 200 with valid body"""
        response = api_client.post(
            f"{BASE_URL}/api/brain/v2/apply-overrides",
            json={
                "engineOutput": {
                    "allocations": {
                        "btc": {"size": 0.15, "direction": "LONG"}
                    }
                }
            }
        )
        assert response.status_code == 200, f"Apply-overrides failed: {response.text}"
        print("✓ POST /api/brain/v2/apply-overrides returns 200")
    
    def test_apply_overrides_includes_brain_decision(self, api_client):
        """Apply-overrides response includes brainDecision"""
        response = api_client.post(
            f"{BASE_URL}/api/brain/v2/apply-overrides",
            json={
                "engineOutput": {
                    "allocations": {
                        "btc": {"size": 0.10, "direction": "LONG"},
                        "spx": {"size": 0.20, "direction": "LONG"}
                    }
                }
            }
        )
        data = response.json()
        
        assert data.get('ok') == True, f"Response not ok: {data}"
        assert 'brainDecision' in data, "brainDecision missing from apply-overrides response"
        
        brain = data['brainDecision']
        assert 'scenario' in brain, "brainDecision.scenario missing"
        assert 'directives' in brain, "brainDecision.directives missing"
        assert 'meta' in brain, "brainDecision.meta missing"
        
        print(f"✓ brainDecision included: scenario={brain['scenario']['name']}, "
              f"riskMode={brain['directives'].get('riskMode')}")
    
    def test_apply_overrides_has_applied_output(self, api_client):
        """Apply-overrides response includes 'applied' with modified allocations"""
        response = api_client.post(
            f"{BASE_URL}/api/brain/v2/apply-overrides",
            json={
                "engineOutput": {
                    "allocations": {
                        "btc": {"size": 0.15, "direction": "LONG"}
                    }
                }
            }
        )
        data = response.json()
        
        assert 'applied' in data, "applied missing from response"
        assert 'original' in data, "original missing from response"
        assert 'wouldChange' in data, "wouldChange missing from response"
        
        applied = data['applied']
        assert 'allocations' in applied, "applied.allocations missing"
        assert 'brainApplied' in applied, "applied.brainApplied missing"
        
        print(f"✓ Apply-overrides structure valid: brainApplied={applied['brainApplied']}, "
              f"wouldChange={data['wouldChange']}")
    
    def test_apply_overrides_missing_body_returns_400(self, api_client):
        """Apply-overrides returns 400 if engineOutput is missing"""
        response = api_client.post(
            f"{BASE_URL}/api/brain/v2/apply-overrides",
            json={}
        )
        assert response.status_code == 400, f"Expected 400 for missing body, got {response.status_code}"
        print("✓ Apply-overrides returns 400 for missing engineOutput")


# ═══════════════════════════════════════════════════════════════
# TEST CLASS: Regression tests for /api/brain/v2/forecast/*
# ═══════════════════════════════════════════════════════════════

class TestBrainForecastRegression:
    """Regression tests for /api/brain/v2/forecast endpoints"""
    
    def test_forecast_endpoint_still_works(self, api_client):
        """GET /api/brain/v2/forecast still works (regression test)"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast?asset=dxy")
        assert response.status_code == 200, f"Forecast failed: {response.text}"
        
        data = response.json()
        assert data.get('ok') == True, "Forecast response not ok"
        assert 'byHorizon' in data, "byHorizon missing from forecast"
        assert 'model' in data, "model missing from forecast"
        
        print(f"✓ /api/brain/v2/forecast still works: modelVersion={data['model']['modelVersion']}")
    
    def test_forecast_status_still_works(self, api_client):
        """GET /api/brain/v2/forecast/status still works (regression test)"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/status?asset=dxy")
        assert response.status_code == 200, f"Forecast status failed: {response.text}"
        
        data = response.json()
        assert data.get('ok') == True, "Forecast status response not ok"
        assert 'available' in data, "available missing from forecast status"
        assert 'isBaseline' in data, "isBaseline missing from forecast status"
        
        print(f"✓ /api/brain/v2/forecast/status still works: available={data['available']}, "
              f"isBaseline={data['isBaseline']}")
    
    def test_forecast_compare_still_works(self, api_client):
        """GET /api/brain/v2/forecast/compare still works (regression test)"""
        response = api_client.get(f"{BASE_URL}/api/brain/v2/forecast/compare?asset=dxy")
        assert response.status_code == 200, f"Forecast compare failed: {response.text}"
        
        data = response.json()
        assert data.get('ok') == True, "Forecast compare response not ok"
        assert 'comparison' in data, "comparison missing from forecast compare"
        assert 'summary' in data, "summary missing from forecast compare"
        
        # Check comparison has all horizons
        assert len(data['comparison']) == 4, f"Expected 4 horizons, got {len(data['comparison'])}"
        
        print(f"✓ /api/brain/v2/forecast/compare still works: {len(data['comparison'])} horizons")


# ═══════════════════════════════════════════════════════════════
# RUN TESTS
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
