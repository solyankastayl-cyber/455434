"""
P9.1 — Brain Compare Tests
P9.2 — Brain Simulation Tests

Tests brain_off vs brain_on comparison endpoint and walk-forward simulation.
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = "https://backtest-replay-lab.preview.emergentagent.com"

TIMEOUT = 60  # Compare can take 5-10 seconds
SIM_TIMEOUT = 120  # Simulation can take longer


class TestBrainCompareP91:
    """P9.1 — Brain ON vs OFF Compare endpoint tests"""

    @pytest.fixture(scope="class")
    def compare_response(self):
        """Cache compare response for the class - it's slow"""
        response = requests.get(f"{BASE_URL}/api/brain/v2/compare", timeout=TIMEOUT)
        assert response.status_code == 200, f"Compare failed: {response.text}"
        data = response.json()
        assert data.get("ok") is True, f"Compare not ok: {data}"
        return data

    def test_compare_returns_brain_compare_pack(self, compare_response):
        """GET /api/brain/v2/compare — returns BrainComparePack with base, brain, diff, context"""
        data = compare_response
        assert "asOf" in data, "Missing asOf"
        assert "base" in data, "Missing base (brain_off)"
        assert "brain" in data, "Missing brain (brain_on)"
        assert "diff" in data, "Missing diff"
        assert "context" in data, "Missing context"
        print(f"✓ Compare returns BrainComparePack structure for asOf={data['asOf']}")

    def test_compare_base_allocations(self, compare_response):
        """GET /api/brain/v2/compare — base.allocations has spxSize, btcSize, cashSize (all 0..1)"""
        base = compare_response.get("base", {})
        assert base.get("engineMode") == "brain_off", f"base engineMode={base.get('engineMode')}"
        
        alloc = base.get("allocations", {})
        for field in ["spxSize", "btcSize", "cashSize"]:
            value = alloc.get(field)
            assert value is not None, f"Missing base.allocations.{field}"
            assert 0 <= value <= 1, f"base.allocations.{field}={value} not in [0,1]"
        
        print(f"✓ base.allocations: spx={alloc['spxSize']:.3f}, btc={alloc['btcSize']:.3f}, cash={alloc['cashSize']:.3f}")

    def test_compare_brain_allocations(self, compare_response):
        """GET /api/brain/v2/compare — brain.allocations has spxSize, btcSize, cashSize (all 0..1)"""
        brain = compare_response.get("brain", {})
        assert brain.get("engineMode") == "brain_on", f"brain engineMode={brain.get('engineMode')}"
        
        alloc = brain.get("allocations", {})
        for field in ["spxSize", "btcSize", "cashSize"]:
            value = alloc.get(field)
            assert value is not None, f"Missing brain.allocations.{field}"
            assert 0 <= value <= 1, f"brain.allocations.{field}={value} not in [0,1]"
        
        print(f"✓ brain.allocations: spx={alloc['spxSize']:.3f}, btc={alloc['btcSize']:.3f}, cash={alloc['cashSize']:.3f}")

    def test_compare_brain_decision(self, compare_response):
        """GET /api/brain/v2/compare — brain.decision has scenario, probabilities, directives"""
        decision = compare_response.get("brain", {}).get("decision", {})
        
        # Scenario
        scenario = decision.get("scenario")
        assert scenario in ["BASE", "RISK", "TAIL"], f"Invalid scenario: {scenario}"
        print(f"✓ brain.decision.scenario = {scenario}")
        
        # Probabilities
        probs = decision.get("probabilities", {})
        for p in ["base", "risk", "tail"]:
            assert p in probs, f"Missing probability: {p}"
            assert 0 <= probs[p] <= 1, f"Probability {p}={probs[p]} not in [0,1]"
        
        prob_sum = probs["base"] + probs["risk"] + probs["tail"]
        assert 0.99 <= prob_sum <= 1.01, f"Probabilities don't sum to 1: {prob_sum}"
        print(f"✓ brain.decision.probabilities: base={probs['base']:.2f}, risk={probs['risk']:.2f}, tail={probs['tail']:.2f}")
        
        # Directives
        directives = decision.get("directives", [])
        assert isinstance(directives, list), "directives should be a list"
        print(f"✓ brain.decision.directives: {len(directives)} directives")

    def test_compare_diff_structure(self, compare_response):
        """GET /api/brain/v2/compare — diff has allocationsDelta, changed[], severity, diffHash"""
        diff = compare_response.get("diff", {})
        
        # allocationsDelta
        delta = diff.get("allocationsDelta", {})
        for field in ["spx", "btc", "cash"]:
            assert field in delta, f"Missing allocationsDelta.{field}"
            assert -1 <= delta[field] <= 1, f"delta.{field}={delta[field]} out of range"
        print(f"✓ diff.allocationsDelta: spx={delta['spx']:.3f}, btc={delta['btc']:.3f}, cash={delta['cash']:.3f}")
        
        # changed array
        changed = diff.get("changed", [])
        assert isinstance(changed, list), "changed should be a list"
        print(f"✓ diff.changed: {len(changed)} changed fields")
        
        # severity
        severity = diff.get("severity")
        assert severity in ["NONE", "LOW", "MEDIUM", "HIGH"], f"Invalid severity: {severity}"
        print(f"✓ diff.severity = {severity}")
        
        # diffHash
        diff_hash = diff.get("diffHash")
        assert diff_hash is not None and len(diff_hash) > 0, "Missing diffHash"
        print(f"✓ diff.diffHash = {diff_hash}")

    def test_compare_diff_severity_valid(self, compare_response):
        """GET /api/brain/v2/compare — diff.severity is one of NONE, LOW, MEDIUM, HIGH"""
        severity = compare_response.get("diff", {}).get("severity")
        valid_severities = ["NONE", "LOW", "MEDIUM", "HIGH"]
        assert severity in valid_severities, f"Invalid severity: {severity}"
        print(f"✓ Severity '{severity}' is valid")

    def test_compare_changed_fields_structure(self, compare_response):
        """GET /api/brain/v2/compare — diff.changed[].field, from, to, delta, reasons, sources are present"""
        changed = compare_response.get("diff", {}).get("changed", [])
        
        for i, c in enumerate(changed):
            assert "field" in c, f"changed[{i}] missing field"
            assert c["field"] in ["spxSize", "btcSize", "cashSize"], f"Invalid field: {c['field']}"
            assert "from" in c, f"changed[{i}] missing from"
            assert "to" in c, f"changed[{i}] missing to"
            assert "delta" in c, f"changed[{i}] missing delta"
            assert "reasons" in c and isinstance(c["reasons"], list), f"changed[{i}] missing reasons array"
            assert "sources" in c and isinstance(c["sources"], list), f"changed[{i}] missing sources array"
            print(f"✓ changed[{i}]: {c['field']} {c['from']:.3f}→{c['to']:.3f} (δ={c['delta']:.3f})")
        
        if len(changed) == 0:
            print("✓ No changed fields (allocations identical)")

    def test_compare_context_structure(self, compare_response):
        """GET /api/brain/v2/compare — context has crossAsset.label, macro.regime, guard.level"""
        context = compare_response.get("context", {})
        
        # crossAsset (optional)
        if context.get("crossAsset"):
            assert "label" in context["crossAsset"], "crossAsset missing label"
            assert "confidence" in context["crossAsset"], "crossAsset missing confidence"
            print(f"✓ context.crossAsset: label={context['crossAsset']['label']}, conf={context['crossAsset']['confidence']:.2f}")
        else:
            print("✓ context.crossAsset: not present (optional)")
        
        # macro
        if context.get("macro"):
            assert "regime" in context["macro"], "macro missing regime"
            assert "activeEngine" in context["macro"], "macro missing activeEngine"
            print(f"✓ context.macro: regime={context['macro']['regime']}, engine={context['macro']['activeEngine']}")
        
        # guard
        if context.get("guard"):
            assert "level" in context["guard"], "guard missing level"
            print(f"✓ context.guard: level={context['guard']['level']}")

    def test_compare_determinism(self):
        """GET /api/brain/v2/compare — determinism: same asOf → same diffHash"""
        test_date = "2025-10-15"
        
        # First call
        r1 = requests.get(f"{BASE_URL}/api/brain/v2/compare?asOf={test_date}", timeout=TIMEOUT)
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1.get("ok") is True
        
        # Second call
        r2 = requests.get(f"{BASE_URL}/api/brain/v2/compare?asOf={test_date}", timeout=TIMEOUT)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("ok") is True
        
        # Compare hashes
        assert d1["diff"]["diffHash"] == d2["diff"]["diffHash"], \
            f"Non-deterministic: diffHash1={d1['diff']['diffHash']} != diffHash2={d2['diff']['diffHash']}"
        print(f"✓ Determinism verified: diffHash={d1['diff']['diffHash']} (same for both calls)")

    def test_compare_inputs_hash_present(self, compare_response):
        """GET /api/brain/v2/compare — inputsHash is present and consistent"""
        inputs_hash = compare_response.get("inputsHash")
        assert inputs_hash is not None, "Missing inputsHash"
        assert len(inputs_hash) > 0, "inputsHash is empty"
        print(f"✓ inputsHash = {inputs_hash}")


class TestBrainSimP92:
    """P9.2 — Walk-Forward Simulation tests"""

    @pytest.fixture(scope="class")
    def sim_run_response(self):
        """Run a short simulation and cache response"""
        payload = {
            "asset": "dxy",
            "start": "2025-10-01",
            "end": "2025-12-01",
            "stepDays": 30,
            "horizons": [30],
            "mode": "compare"
        }
        response = requests.post(
            f"{BASE_URL}/api/brain/v2/sim/run",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=SIM_TIMEOUT
        )
        assert response.status_code == 200, f"Sim run failed: {response.text}"
        data = response.json()
        assert data.get("ok") is True, f"Sim run not ok: {data}"
        return data

    def test_sim_run_returns_report(self, sim_run_response):
        """POST /api/brain/v2/sim/run — returns simulation report with id, window, metrics, samples, verdict"""
        data = sim_run_response
        assert "id" in data, "Missing report id"
        assert "window" in data, "Missing window"
        assert "metrics" in data, "Missing metrics"
        assert "samples" in data, "Missing samples"
        assert "verdict" in data, "Missing verdict"
        print(f"✓ Sim report id={data['id']}, window={data['window']}")

    def test_sim_run_hit_rates(self, sim_run_response):
        """POST /api/brain/v2/sim/run — metrics has hitRate_off, hitRate_on, deltaPp for requested horizons"""
        metrics = sim_run_response.get("metrics", {})
        
        assert "hitRate_off" in metrics, "Missing hitRate_off"
        assert "hitRate_on" in metrics, "Missing hitRate_on"
        assert "deltaPp" in metrics, "Missing deltaPp"
        
        # Check 30D horizon exists
        assert "30D" in metrics["hitRate_off"], "Missing hitRate_off[30D]"
        assert "30D" in metrics["hitRate_on"], "Missing hitRate_on[30D]"
        assert "30D" in metrics["deltaPp"], "Missing deltaPp[30D]"
        
        print(f"✓ hitRate_off[30D]={metrics['hitRate_off']['30D']:.3f}")
        print(f"✓ hitRate_on[30D]={metrics['hitRate_on']['30D']:.3f}")
        print(f"✓ deltaPp[30D]={metrics['deltaPp']['30D']:.1f}pp")

    def test_sim_run_exposure_metrics(self, sim_run_response):
        """POST /api/brain/v2/sim/run — metrics has avgExposure_off, avgExposure_on, brainFlipRate, avgOverrideIntensity, maxOverrideIntensity"""
        metrics = sim_run_response.get("metrics", {})
        
        # Average exposures
        for mode in ["avgExposure_off", "avgExposure_on"]:
            assert mode in metrics, f"Missing {mode}"
            exp = metrics[mode]
            for field in ["spx", "btc", "cash"]:
                assert field in exp, f"Missing {mode}.{field}"
                assert 0 <= exp[field] <= 1, f"{mode}.{field}={exp[field]} not in [0,1]"
        
        print(f"✓ avgExposure_off: {metrics['avgExposure_off']}")
        print(f"✓ avgExposure_on: {metrics['avgExposure_on']}")
        
        # Other metrics
        assert "brainFlipRate" in metrics, "Missing brainFlipRate"
        assert "avgOverrideIntensity" in metrics, "Missing avgOverrideIntensity"
        assert "maxOverrideIntensity" in metrics, "Missing maxOverrideIntensity"
        
        print(f"✓ brainFlipRate={metrics['brainFlipRate']:.2f}/year")
        print(f"✓ avgOverrideIntensity={metrics['avgOverrideIntensity']:.3f}")
        print(f"✓ maxOverrideIntensity={metrics['maxOverrideIntensity']:.3f}")

    def test_sim_run_verdict_structure(self, sim_run_response):
        """POST /api/brain/v2/sim/run — verdict has ready boolean, reasons[], gates with pass/value/threshold"""
        verdict = sim_run_response.get("verdict", {})
        
        assert "ready" in verdict, "Missing verdict.ready"
        assert isinstance(verdict["ready"], bool), "verdict.ready should be boolean"
        
        assert "reasons" in verdict, "Missing verdict.reasons"
        assert isinstance(verdict["reasons"], list), "verdict.reasons should be array"
        
        assert "gates" in verdict, "Missing verdict.gates"
        assert isinstance(verdict["gates"], dict), "verdict.gates should be dict"
        
        print(f"✓ verdict.ready = {verdict['ready']}")
        print(f"✓ verdict.reasons: {verdict['reasons']}")

    def test_sim_run_verdict_gates(self, sim_run_response):
        """POST /api/brain/v2/sim/run — verdict.gates includes deltaHitRateAny, noDegradation, brainFlipRate, maxOverrideIntensity"""
        gates = sim_run_response.get("verdict", {}).get("gates", {})
        
        required_gates = ["deltaHitRateAny", "noDegradation", "brainFlipRate", "maxOverrideIntensity"]
        for gate_name in required_gates:
            assert gate_name in gates, f"Missing gate: {gate_name}"
            gate = gates[gate_name]
            assert "pass" in gate, f"gate[{gate_name}] missing pass"
            assert "value" in gate, f"gate[{gate_name}] missing value"
            assert "threshold" in gate, f"gate[{gate_name}] missing threshold"
            print(f"✓ gate[{gate_name}]: pass={gate['pass']}, value={gate['value']}, threshold={gate['threshold']}")

    def test_sim_run_samples_structure(self, sim_run_response):
        """POST /api/brain/v2/sim/run — samples array contains asOf, compare.scenario, compare.delta, realized returns"""
        samples = sim_run_response.get("samples", [])
        assert len(samples) > 0, "No samples in simulation"
        
        for i, s in enumerate(samples[:3]):  # Check first 3 samples
            assert "asOf" in s, f"sample[{i}] missing asOf"
            assert "compare" in s, f"sample[{i}] missing compare"
            assert "realized" in s, f"sample[{i}] missing realized"
            
            compare = s["compare"]
            assert "scenario" in compare, f"sample[{i}].compare missing scenario"
            assert "delta" in compare, f"sample[{i}].compare missing delta"
            assert "severity" in compare, f"sample[{i}].compare missing severity"
            
            print(f"✓ sample[{i}]: asOf={s['asOf']}, scenario={compare['scenario']}, severity={compare['severity']}")
        
        print(f"✓ Total samples: {len(samples)}")

    def test_sim_status_list_reports(self, sim_run_response):
        """GET /api/brain/v2/sim/status — lists stored report IDs"""
        # First ensure we have at least one report
        report_id = sim_run_response.get("id")
        assert report_id is not None
        
        # Get status list
        response = requests.get(f"{BASE_URL}/api/brain/v2/sim/status", timeout=30)
        assert response.status_code == 200, f"Status list failed: {response.text}"
        data = response.json()
        assert data.get("ok") is True
        
        stored = data.get("storedReports", [])
        assert isinstance(stored, list), "storedReports should be array"
        assert report_id in stored, f"Report {report_id} not in storedReports"
        print(f"✓ Stored reports: {stored}")

    def test_sim_status_specific_report(self, sim_run_response):
        """GET /api/brain/v2/sim/status?id=X — returns status of specific simulation"""
        report_id = sim_run_response.get("id")
        
        response = requests.get(f"{BASE_URL}/api/brain/v2/sim/status?id={report_id}", timeout=30)
        assert response.status_code == 200, f"Status failed: {response.text}"
        data = response.json()
        assert data.get("ok") is True
        
        assert data.get("id") == report_id, f"Wrong id: {data.get('id')}"
        assert data.get("status") == "COMPLETED", f"Wrong status: {data.get('status')}"
        assert "window" in data, "Missing window"
        assert "verdict" in data, "Missing verdict"
        
        print(f"✓ Status for {report_id}: {data.get('status')}")

    def test_sim_report_retrieval(self, sim_run_response):
        """GET /api/brain/v2/sim/report?id=X — returns full report"""
        report_id = sim_run_response.get("id")
        
        response = requests.get(f"{BASE_URL}/api/brain/v2/sim/report?id={report_id}", timeout=30)
        assert response.status_code == 200, f"Report retrieval failed: {response.text}"
        data = response.json()
        assert data.get("ok") is True
        
        # Verify it matches original
        assert data.get("id") == report_id
        assert data.get("window") == sim_run_response.get("window")
        assert "metrics" in data
        assert "samples" in data
        assert "verdict" in data
        
        print(f"✓ Full report retrieved: {report_id}")


class TestRegressionP91P92:
    """Regression tests — ensure existing endpoints still work"""

    def test_cross_asset_still_works(self):
        """GET /api/brain/v2/cross-asset — still works (regression)"""
        response = requests.get(f"{BASE_URL}/api/brain/v2/cross-asset", timeout=30)
        assert response.status_code == 200, f"Cross-asset failed: {response.text}"
        data = response.json()
        assert data.get("ok") is True, f"Cross-asset not ok: {data}"
        assert "regime" in data, "Missing regime in cross-asset"
        print(f"✓ Cross-asset works: regime={data['regime'].get('label')}")

    def test_decision_still_works(self):
        """GET /api/brain/v2/decision — still works (regression)"""
        response = requests.get(f"{BASE_URL}/api/brain/v2/decision", timeout=30)
        assert response.status_code == 200, f"Decision failed: {response.text}"
        data = response.json()
        # Decision endpoint doesn't return ok field, check for scenario instead
        assert "scenario" in data, "Missing scenario in decision"
        assert "name" in data.get("scenario", {}), "Missing scenario.name"
        print(f"✓ Decision works: scenario={data.get('scenario', {}).get('name')}")

    def test_forecast_still_works(self):
        """GET /api/brain/v2/forecast — still works (regression)"""
        response = requests.get(f"{BASE_URL}/api/brain/v2/forecast", timeout=30)
        assert response.status_code == 200, f"Forecast failed: {response.text}"
        data = response.json()
        # Forecast endpoint returns byHorizon instead of forecast
        assert "byHorizon" in data or "forecast" in data, "Missing forecast data (byHorizon or forecast)"
        assert "asOf" in data, "Missing asOf in forecast"
        print(f"✓ Forecast works: asOf={data.get('asOf')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
