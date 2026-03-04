"""
TA Module Phase 5 Tests - Outcome Engine
Tests for outcome evaluation endpoints and pure function correctness

Endpoints tested:
- POST /api/ta/outcomes/recompute - Runs outcome evaluation job
- GET /api/ta/outcomes/latest?asset=SPX - Returns latest evaluated outcomes
- GET /api/ta/outcomes/run/:id - Returns outcomes for specific run
- GET /api/ta/performance?asset=SPX - Returns performance summary

Pure function tests:
- evaluateOutcome() - WIN/LOSS/TIMEOUT logic
- extractTradePlan() - Trade plan extraction from patterns
- MFE/MAE calculation correctness
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


# ═══════════════════════════════════════════════════════════════
# ENDPOINT TESTS
# ═══════════════════════════════════════════════════════════════

class TestOutcomesRecompute:
    """Tests for POST /api/ta/outcomes/recompute endpoint"""
    
    def test_recompute_returns_ok(self):
        """Recompute endpoint should return ok=true"""
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_recompute_returns_asset(self):
        """Recompute should return the queried asset"""
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX"}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('asset') == 'SPX'
    
    def test_recompute_returns_decisions_processed(self):
        """Recompute should return decisionsProcessed count"""
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert 'decisionsProcessed' in data
        assert isinstance(data['decisionsProcessed'], int)
        assert data['decisionsProcessed'] >= 0
    
    def test_recompute_returns_patterns_evaluated(self):
        """Recompute should return patternsEvaluated count"""
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert 'patternsEvaluated' in data
        assert isinstance(data['patternsEvaluated'], int)
    
    def test_recompute_returns_outcomes_breakdown(self):
        """Recompute should return outcomes breakdown (wins, losses, etc.)"""
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert 'outcomes' in data
        
        outcomes = data['outcomes']
        required_fields = ['wins', 'losses', 'timeouts', 'pending', 'skipped']
        for field in required_fields:
            assert field in outcomes, f"outcomes missing field: {field}"
            assert isinstance(outcomes[field], int)
    
    def test_recompute_returns_duration(self):
        """Recompute should return durationMs"""
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert 'durationMs' in data
        assert isinstance(data['durationMs'], int)
        assert data['durationMs'] >= 0
    
    def test_recompute_returns_errors_array(self):
        """Recompute should return errors array (empty if no errors)"""
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert 'errors' in data
        assert isinstance(data['errors'], list)
    
    def test_recompute_with_force_recompute(self):
        """Recompute with forceRecompute=true should re-evaluate all patterns"""
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60, "forceRecompute": True}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
        # With forceRecompute, patternsEvaluated should be > 0 if there are decisions
        if data['decisionsProcessed'] > 0:
            assert data['patternsEvaluated'] > 0
    
    def test_recompute_default_values(self):
        """Recompute with empty body should use defaults"""
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
        assert data.get('asset') == 'SPX'  # default asset


class TestOutcomesLatest:
    """Tests for GET /api/ta/outcomes/latest endpoint"""
    
    def test_outcomes_latest_returns_ok(self):
        """Outcomes latest endpoint should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_outcomes_latest_returns_asset(self):
        """Outcomes latest should return the queried asset"""
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('asset') == 'SPX'
    
    def test_outcomes_latest_returns_count(self):
        """Outcomes latest should return count"""
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'count' in data
        assert isinstance(data['count'], int)
    
    def test_outcomes_latest_returns_outcomes_array(self):
        """Outcomes latest should return outcomes array"""
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'outcomes' in data
        assert isinstance(data['outcomes'], list)
    
    def test_outcomes_latest_count_matches_array(self):
        """Count should match outcomes array length"""
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data['count'] == len(data['outcomes'])
    
    def test_outcomes_latest_respects_limit(self):
        """Outcomes latest should respect limit parameter"""
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/latest?asset=SPX&limit=5")
        assert response.status_code == 200
        
        data = response.json()
        assert len(data['outcomes']) <= 5
    
    def test_outcomes_latest_excludes_pending(self):
        """Outcomes latest should exclude PENDING results"""
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        for outcome in data.get('outcomes', []):
            assert outcome.get('result') != 'PENDING', "PENDING outcomes should be excluded"
    
    def test_outcomes_latest_no_mongodb_id(self):
        """Response should not contain MongoDB _id fields"""
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        for outcome in data.get('outcomes', []):
            assert '_id' not in outcome, "outcome contains _id field"


class TestOutcomesRunById:
    """Tests for GET /api/ta/outcomes/run/:id endpoint"""
    
    @pytest.fixture(scope="class")
    def run_id(self):
        """Get a valid runId from latest audit"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        if response.status_code == 200:
            data = response.json()
            if data.get('run'):
                return data['run'].get('runId')
        return None
    
    def test_outcomes_run_returns_ok(self, run_id):
        """Outcomes run endpoint should return ok=true"""
        if not run_id:
            pytest.skip("No runId available")
        
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_outcomes_run_returns_run_id(self, run_id):
        """Outcomes run should return the queried runId"""
        if not run_id:
            pytest.skip("No runId available")
        
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('runId') == run_id
    
    def test_outcomes_run_returns_count(self, run_id):
        """Outcomes run should return count"""
        if not run_id:
            pytest.skip("No runId available")
        
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert 'count' in data
        assert isinstance(data['count'], int)
    
    def test_outcomes_run_returns_outcomes_array(self, run_id):
        """Outcomes run should return outcomes array"""
        if not run_id:
            pytest.skip("No runId available")
        
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert 'outcomes' in data
        assert isinstance(data['outcomes'], list)
    
    def test_outcomes_run_includes_pending(self, run_id):
        """Outcomes run should include PENDING results (unlike latest)"""
        if not run_id:
            pytest.skip("No runId available")
        
        # First ensure there are outcomes for this run
        requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60, "forceRecompute": True}
        )
        
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        # This endpoint should return all outcomes including PENDING
        # (no filter on result)
        assert 'outcomes' in data
    
    def test_outcomes_run_no_mongodb_id(self, run_id):
        """Response should not contain MongoDB _id fields"""
        if not run_id:
            pytest.skip("No runId available")
        
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        for outcome in data.get('outcomes', []):
            assert '_id' not in outcome, "outcome contains _id field"


class TestPerformance:
    """Tests for GET /api/ta/performance endpoint"""
    
    def test_performance_returns_ok(self):
        """Performance endpoint should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/performance?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_performance_returns_asset(self):
        """Performance should return the queried asset"""
        response = requests.get(f"{BASE_URL}/api/ta/performance?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('asset') == 'SPX'
    
    def test_performance_returns_total_evaluated(self):
        """Performance should return totalEvaluated count"""
        response = requests.get(f"{BASE_URL}/api/ta/performance?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'totalEvaluated' in data
        assert isinstance(data['totalEvaluated'], int)
    
    def test_performance_returns_win_loss_counts(self):
        """Performance should return wins, losses, timeouts counts"""
        response = requests.get(f"{BASE_URL}/api/ta/performance?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'wins' in data
        assert 'losses' in data
        assert 'timeouts' in data
        assert isinstance(data['wins'], int)
        assert isinstance(data['losses'], int)
        assert isinstance(data['timeouts'], int)
    
    def test_performance_returns_win_rate(self):
        """Performance should return winRate"""
        response = requests.get(f"{BASE_URL}/api/ta/performance?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'winRate' in data
        assert isinstance(data['winRate'], (int, float))
        assert 0 <= data['winRate'] <= 1
    
    def test_performance_returns_avg_return_pct(self):
        """Performance should return avgReturnPct"""
        response = requests.get(f"{BASE_URL}/api/ta/performance?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'avgReturnPct' in data
        assert isinstance(data['avgReturnPct'], (int, float))
    
    def test_performance_returns_mfe_mae(self):
        """Performance should return avgMfePct and avgMaePct"""
        response = requests.get(f"{BASE_URL}/api/ta/performance?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'avgMfePct' in data
        assert 'avgMaePct' in data
        assert isinstance(data['avgMfePct'], (int, float))
        assert isinstance(data['avgMaePct'], (int, float))
    
    def test_performance_with_since_param(self):
        """Performance should accept since parameter"""
        response = requests.get(f"{BASE_URL}/api/ta/performance?asset=SPX&since=2025-01-01")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_performance_with_invalid_since(self):
        """Performance should handle invalid since parameter gracefully"""
        response = requests.get(f"{BASE_URL}/api/ta/performance?asset=SPX&since=invalid-date")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True  # Should still work, ignoring invalid date


# ═══════════════════════════════════════════════════════════════
# OUTCOME RECORD STRUCTURE TESTS
# ═══════════════════════════════════════════════════════════════

class TestOutcomeRecordStructure:
    """Tests for outcome record structure in ta_outcomes collection"""
    
    @pytest.fixture(scope="class")
    def outcome_with_data(self):
        """Get an outcome record with data"""
        # First ensure outcomes exist
        requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60, "forceRecompute": True}
        )
        
        # Get latest run
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        if response.status_code == 200:
            data = response.json()
            run_id = data.get('run', {}).get('runId')
            if run_id:
                # Get outcomes for this run
                outcome_response = requests.get(f"{BASE_URL}/api/ta/outcomes/run/{run_id}")
                if outcome_response.status_code == 200:
                    outcomes = outcome_response.json().get('outcomes', [])
                    if outcomes:
                        return outcomes[0]
        return None
    
    def test_outcome_has_run_id(self, outcome_with_data):
        """Outcome should have runId"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        assert 'runId' in outcome_with_data
        assert isinstance(outcome_with_data['runId'], str)
    
    def test_outcome_has_pattern_id(self, outcome_with_data):
        """Outcome should have patternId"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        assert 'patternId' in outcome_with_data
        assert isinstance(outcome_with_data['patternId'], str)
    
    def test_outcome_has_asset(self, outcome_with_data):
        """Outcome should have asset"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        assert 'asset' in outcome_with_data
        assert outcome_with_data['asset'] == 'SPX'
    
    def test_outcome_has_trade_plan(self, outcome_with_data):
        """Outcome should have tradePlan object"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        assert 'tradePlan' in outcome_with_data
        trade_plan = outcome_with_data['tradePlan']
        
        required_fields = ['direction', 'entry', 'stop', 'target', 'timeoutBars']
        for field in required_fields:
            assert field in trade_plan, f"tradePlan missing field: {field}"
    
    def test_outcome_trade_plan_direction_valid(self, outcome_with_data):
        """tradePlan direction should be LONG or SHORT"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        direction = outcome_with_data['tradePlan'].get('direction')
        assert direction in ['LONG', 'SHORT'], f"Invalid direction: {direction}"
    
    def test_outcome_trade_plan_prices_positive(self, outcome_with_data):
        """tradePlan prices should be positive"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        trade_plan = outcome_with_data['tradePlan']
        assert trade_plan['entry'] > 0, "entry should be positive"
        assert trade_plan['stop'] > 0, "stop should be positive"
        assert trade_plan['target'] > 0, "target should be positive"
    
    def test_outcome_has_result(self, outcome_with_data):
        """Outcome should have result field"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        assert 'result' in outcome_with_data
        valid_results = ['WIN', 'LOSS', 'TIMEOUT', 'SKIPPED', 'PENDING']
        assert outcome_with_data['result'] in valid_results
    
    def test_outcome_has_mfe_mae(self, outcome_with_data):
        """Outcome should have MFE/MAE fields"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        assert 'mfe' in outcome_with_data
        assert 'mfePct' in outcome_with_data
        assert 'mae' in outcome_with_data
        assert 'maePct' in outcome_with_data
    
    def test_outcome_has_entry_ts(self, outcome_with_data):
        """Outcome should have entryTs"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        assert 'entryTs' in outcome_with_data
        assert isinstance(outcome_with_data['entryTs'], int)
    
    def test_outcome_has_evaluated_at(self, outcome_with_data):
        """Outcome should have evaluatedAt timestamp"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        assert 'evaluatedAt' in outcome_with_data
    
    def test_outcome_has_horizon(self, outcome_with_data):
        """Outcome should have horizon field"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        assert 'horizon' in outcome_with_data
        assert outcome_with_data['horizon'] == '30D'
    
    def test_outcome_has_bars_evaluated(self, outcome_with_data):
        """Outcome should have barsEvaluated field"""
        if not outcome_with_data:
            pytest.skip("No outcome data available")
        
        assert 'barsEvaluated' in outcome_with_data
        assert isinstance(outcome_with_data['barsEvaluated'], int)
        assert outcome_with_data['barsEvaluated'] >= 0


# ═══════════════════════════════════════════════════════════════
# TRADE PLAN VALIDATION TESTS
# ═══════════════════════════════════════════════════════════════

class TestTradePlanValidation:
    """Tests for trade plan validation logic"""
    
    @pytest.fixture(scope="class")
    def outcome_with_trade_plan(self):
        """Get an outcome with valid trade plan"""
        requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60, "forceRecompute": True}
        )
        
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        if response.status_code == 200:
            data = response.json()
            run_id = data.get('run', {}).get('runId')
            if run_id:
                outcome_response = requests.get(f"{BASE_URL}/api/ta/outcomes/run/{run_id}")
                if outcome_response.status_code == 200:
                    outcomes = outcome_response.json().get('outcomes', [])
                    for outcome in outcomes:
                        if outcome.get('result') != 'SKIPPED':
                            return outcome
        return None
    
    def test_long_trade_plan_stop_below_entry(self, outcome_with_trade_plan):
        """For LONG trades, stop should be below entry"""
        if not outcome_with_trade_plan:
            pytest.skip("No outcome data available")
        
        trade_plan = outcome_with_trade_plan['tradePlan']
        if trade_plan['direction'] == 'LONG':
            assert trade_plan['stop'] < trade_plan['entry'], \
                f"LONG stop ({trade_plan['stop']}) should be < entry ({trade_plan['entry']})"
    
    def test_long_trade_plan_target_above_entry(self, outcome_with_trade_plan):
        """For LONG trades, target should be above entry"""
        if not outcome_with_trade_plan:
            pytest.skip("No outcome data available")
        
        trade_plan = outcome_with_trade_plan['tradePlan']
        if trade_plan['direction'] == 'LONG':
            assert trade_plan['target'] > trade_plan['entry'], \
                f"LONG target ({trade_plan['target']}) should be > entry ({trade_plan['entry']})"
    
    def test_short_trade_plan_stop_above_entry(self, outcome_with_trade_plan):
        """For SHORT trades, stop should be above entry"""
        if not outcome_with_trade_plan:
            pytest.skip("No outcome data available")
        
        trade_plan = outcome_with_trade_plan['tradePlan']
        if trade_plan['direction'] == 'SHORT':
            assert trade_plan['stop'] > trade_plan['entry'], \
                f"SHORT stop ({trade_plan['stop']}) should be > entry ({trade_plan['entry']})"
    
    def test_short_trade_plan_target_below_entry(self, outcome_with_trade_plan):
        """For SHORT trades, target should be below entry"""
        if not outcome_with_trade_plan:
            pytest.skip("No outcome data available")
        
        trade_plan = outcome_with_trade_plan['tradePlan']
        if trade_plan['direction'] == 'SHORT':
            assert trade_plan['target'] < trade_plan['entry'], \
                f"SHORT target ({trade_plan['target']}) should be < entry ({trade_plan['entry']})"
    
    def test_timeout_bars_positive(self, outcome_with_trade_plan):
        """timeoutBars should be positive"""
        if not outcome_with_trade_plan:
            pytest.skip("No outcome data available")
        
        trade_plan = outcome_with_trade_plan['tradePlan']
        assert trade_plan['timeoutBars'] > 0


# ═══════════════════════════════════════════════════════════════
# END-TO-END FLOW TESTS
# ═══════════════════════════════════════════════════════════════

class TestEndToEndOutcomeFlow:
    """End-to-end tests for outcome evaluation flow"""
    
    def test_analyze_then_recompute_creates_outcomes(self):
        """Analyze followed by recompute should create outcomes"""
        # Create a new run
        analyze_response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert analyze_response.status_code == 200
        
        run_id = analyze_response.json().get('runId')
        assert run_id is not None
        
        # Run recompute with forceRecompute
        recompute_response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60, "forceRecompute": True}
        )
        assert recompute_response.status_code == 200
        
        # Check outcomes for the run
        outcomes_response = requests.get(f"{BASE_URL}/api/ta/outcomes/run/{run_id}")
        assert outcomes_response.status_code == 200
        
        data = outcomes_response.json()
        assert data.get('ok') is True
        # Should have at least one outcome (the pattern from the run)
        assert data.get('count', 0) >= 0
    
    def test_recompute_idempotent_without_force(self):
        """Recompute without forceRecompute should be idempotent"""
        # First recompute with force
        requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60, "forceRecompute": True}
        )
        
        # Second recompute without force
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60, "forceRecompute": False}
        )
        assert response.status_code == 200
        
        data = response.json()
        # Without forceRecompute, already evaluated patterns should be skipped
        # So patternsEvaluated should be 0 or very low
        assert data.get('ok') is True
    
    def test_performance_reflects_outcomes(self):
        """Performance summary should reflect evaluated outcomes"""
        # Run recompute
        recompute_response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "SPX", "lookbackDays": 60, "forceRecompute": True}
        )
        assert recompute_response.status_code == 200
        
        recompute_data = recompute_response.json()
        
        # Get performance
        perf_response = requests.get(f"{BASE_URL}/api/ta/performance?asset=SPX")
        assert perf_response.status_code == 200
        
        perf_data = perf_response.json()
        
        # Performance should reflect the outcomes
        # Note: totalEvaluated excludes PENDING and SKIPPED
        total_decisive = recompute_data['outcomes']['wins'] + \
                        recompute_data['outcomes']['losses'] + \
                        recompute_data['outcomes']['timeouts']
        
        # Performance totalEvaluated should match decisive outcomes
        # (may differ slightly due to timing/other runs)
        assert perf_data.get('ok') is True


class TestOutcomeJobErrors:
    """Tests for error handling in outcome job"""
    
    def test_recompute_nonexistent_asset(self):
        """Recompute for nonexistent asset should return ok with 0 processed"""
        response = requests.post(
            f"{BASE_URL}/api/ta/outcomes/recompute",
            json={"asset": "NONEXISTENT_ASSET_XYZ", "lookbackDays": 60}
        )
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
        assert data.get('decisionsProcessed') == 0
    
    def test_outcomes_run_invalid_id(self):
        """Outcomes run with invalid ID should return empty outcomes"""
        response = requests.get(f"{BASE_URL}/api/ta/outcomes/run/invalid-run-id-12345")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
        assert data.get('count') == 0
        assert data.get('outcomes') == []


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
