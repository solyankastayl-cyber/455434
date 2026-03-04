"""
TA Module Phase 4 Tests - Pattern Storage + Audit Trail
Tests for audit trail endpoints and MongoDB persistence

Endpoints tested:
- GET /api/ta/analyze?asset=SPX - Should return runId in response
- GET /api/ta/audit/latest?asset=SPX - Returns latest run with patterns and decision
- GET /api/ta/audit/run/:id - Returns specific run by runId
- GET /api/ta/audit/runs?asset=SPX&limit=10 - Lists recent runs

Collections verified:
- ta_runs: Run documents with context snapshot
- ta_patterns: Pattern documents with scoring
- ta_decisions: Decision documents with top-K selection
"""

import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestAnalyzeReturnsRunId:
    """Tests for /api/ta/analyze endpoint returning runId"""
    
    def test_analyze_returns_run_id(self):
        """Analyze endpoint should return runId in response"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
        assert 'runId' in data, "Response missing 'runId' field"
        
    def test_run_id_is_valid_uuid(self):
        """runId should be a valid UUID string"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        run_id = data.get('runId')
        assert run_id is not None, "runId is None"
        
        # Validate UUID format
        try:
            uuid.UUID(run_id)
        except ValueError:
            pytest.fail(f"runId '{run_id}' is not a valid UUID")
    
    def test_each_analyze_creates_new_run_id(self):
        """Each analyze call should create a new unique runId"""
        response1 = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        response2 = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        
        run_id1 = response1.json().get('runId')
        run_id2 = response2.json().get('runId')
        
        assert run_id1 != run_id2, "Two analyze calls returned same runId"


class TestAuditLatest:
    """Tests for /api/ta/audit/latest endpoint"""
    
    def test_audit_latest_returns_ok(self):
        """Audit latest endpoint should return ok=true"""
        # First ensure there's at least one run
        requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_audit_latest_returns_run_object(self):
        """Audit latest should return run object with required fields"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'run' in data, "Response missing 'run' object"
        
        run = data['run']
        required_fields = ['runId', 'asset', 'timeframe', 'ts', 'engineVersion', 
                          'configHash', 'candles', 'contextSnapshot', 'createdAt']
        
        for field in required_fields:
            assert field in run, f"Run object missing field: {field}"
    
    def test_audit_latest_run_has_candles_info(self):
        """Run object should have candles info (startTs, endTs, bars)"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        candles = data['run'].get('candles', {})
        
        assert 'startTs' in candles, "Candles missing 'startTs'"
        assert 'endTs' in candles, "Candles missing 'endTs'"
        assert 'bars' in candles, "Candles missing 'bars'"
        assert isinstance(candles['bars'], int), "bars should be integer"
    
    def test_audit_latest_run_has_context_snapshot(self):
        """Run object should have contextSnapshot with regime info"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        ctx = data['run'].get('contextSnapshot', {})
        
        required_fields = ['regime', 'volatility', 'compression', 'hhhlScore', 
                          'pivotCount', 'levelCount']
        
        for field in required_fields:
            assert field in ctx, f"contextSnapshot missing field: {field}"
    
    def test_audit_latest_returns_patterns_array(self):
        """Audit latest should return patterns array"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'patterns' in data, "Response missing 'patterns' array"
        assert isinstance(data['patterns'], list), "patterns should be an array"
    
    def test_audit_latest_patterns_have_scoring(self):
        """Each pattern should have scoring object with score, confidence, reasons"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        for pattern in patterns:
            assert 'scoring' in pattern, f"Pattern {pattern.get('patternId')} missing scoring"
            scoring = pattern['scoring']
            assert 'score' in scoring, "Scoring missing 'score'"
            assert 'confidence' in scoring, "Scoring missing 'confidence'"
            assert 'reasons' in scoring, "Scoring missing 'reasons'"
    
    def test_audit_latest_patterns_have_rank(self):
        """Each pattern should have rank field"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        for pattern in patterns:
            assert 'rank' in pattern, f"Pattern {pattern.get('patternId')} missing rank"
            assert isinstance(pattern['rank'], int), "rank should be integer"
    
    def test_audit_latest_returns_decision_object(self):
        """Audit latest should return decision object"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'decision' in data, "Response missing 'decision' object"
        
        decision = data['decision']
        if decision is not None:
            required_fields = ['runId', 'asset', 'timeframe', 'decisionType', 
                              'topPatternIds', 'totalCandidates', 'droppedCount', 'createdAt']
            
            for field in required_fields:
                assert field in decision, f"Decision object missing field: {field}"
    
    def test_audit_latest_decision_has_pattern_ids(self):
        """Decision should have primaryPatternId, secondaryPatternId, topPatternIds"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        decision = data.get('decision')
        
        if decision is not None:
            assert 'primaryPatternId' in decision, "Decision missing 'primaryPatternId'"
            assert 'secondaryPatternId' in decision, "Decision missing 'secondaryPatternId'"
            assert 'topPatternIds' in decision, "Decision missing 'topPatternIds'"
            assert isinstance(decision['topPatternIds'], list), "topPatternIds should be array"
    
    def test_audit_latest_no_mongodb_id(self):
        """Response should not contain MongoDB _id fields"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        
        # Check run object
        assert '_id' not in data.get('run', {}), "run contains _id field"
        
        # Check patterns
        for pattern in data.get('patterns', []):
            assert '_id' not in pattern, "pattern contains _id field"
        
        # Check decision
        if data.get('decision'):
            assert '_id' not in data['decision'], "decision contains _id field"
    
    def test_audit_latest_nonexistent_asset(self):
        """Audit latest for nonexistent asset should return error"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=NONEXISTENT_ASSET_XYZ")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is False
        assert 'error' in data


class TestAuditRunById:
    """Tests for /api/ta/audit/run/:id endpoint"""
    
    def test_audit_run_by_id_returns_ok(self):
        """Audit run by ID should return ok=true for valid runId"""
        # First get a valid runId
        analyze_response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        run_id = analyze_response.json().get('runId')
        
        response = requests.get(f"{BASE_URL}/api/ta/audit/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_audit_run_by_id_returns_correct_run(self):
        """Audit run by ID should return the correct run"""
        # First get a valid runId
        analyze_response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        run_id = analyze_response.json().get('runId')
        
        response = requests.get(f"{BASE_URL}/api/ta/audit/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert data['run']['runId'] == run_id, "Returned run has different runId"
    
    def test_audit_run_by_id_returns_patterns(self):
        """Audit run by ID should return patterns array"""
        # First get a valid runId
        analyze_response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        run_id = analyze_response.json().get('runId')
        
        response = requests.get(f"{BASE_URL}/api/ta/audit/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert 'patterns' in data
        assert isinstance(data['patterns'], list)
    
    def test_audit_run_by_id_returns_decision(self):
        """Audit run by ID should return decision object"""
        # First get a valid runId
        analyze_response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        run_id = analyze_response.json().get('runId')
        
        response = requests.get(f"{BASE_URL}/api/ta/audit/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert 'decision' in data
    
    def test_audit_run_by_id_invalid_id(self):
        """Audit run by ID should return error for invalid runId"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/run/invalid-run-id-12345")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is False
        assert 'error' in data
        assert 'not found' in data['error'].lower()
    
    def test_audit_run_by_id_no_mongodb_id(self):
        """Response should not contain MongoDB _id fields"""
        # First get a valid runId
        analyze_response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        run_id = analyze_response.json().get('runId')
        
        response = requests.get(f"{BASE_URL}/api/ta/audit/run/{run_id}")
        assert response.status_code == 200
        
        data = response.json()
        
        # Check run object
        assert '_id' not in data.get('run', {}), "run contains _id field"
        
        # Check patterns
        for pattern in data.get('patterns', []):
            assert '_id' not in pattern, "pattern contains _id field"


class TestAuditRuns:
    """Tests for /api/ta/audit/runs endpoint"""
    
    def test_audit_runs_returns_ok(self):
        """Audit runs endpoint should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/runs?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_audit_runs_returns_asset(self):
        """Audit runs should return the queried asset"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/runs?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('asset') == 'SPX'
    
    def test_audit_runs_returns_count(self):
        """Audit runs should return count of runs"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/runs?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'count' in data
        assert isinstance(data['count'], int)
    
    def test_audit_runs_returns_runs_array(self):
        """Audit runs should return runs array"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/runs?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'runs' in data
        assert isinstance(data['runs'], list)
    
    def test_audit_runs_count_matches_array_length(self):
        """Count should match runs array length"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/runs?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data['count'] == len(data['runs'])
    
    def test_audit_runs_respects_limit(self):
        """Audit runs should respect limit parameter"""
        # First create multiple runs
        for _ in range(3):
            requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        
        response = requests.get(f"{BASE_URL}/api/ta/audit/runs?asset=SPX&limit=2")
        assert response.status_code == 200
        
        data = response.json()
        assert len(data['runs']) <= 2
    
    def test_audit_runs_sorted_by_created_at_desc(self):
        """Runs should be sorted by createdAt descending (newest first)"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/runs?asset=SPX&limit=10")
        assert response.status_code == 200
        
        data = response.json()
        runs = data.get('runs', [])
        
        if len(runs) > 1:
            for i in range(len(runs) - 1):
                current_ts = runs[i].get('createdAt')
                next_ts = runs[i + 1].get('createdAt')
                assert current_ts >= next_ts, "Runs not sorted by createdAt descending"
    
    def test_audit_runs_each_run_has_required_fields(self):
        """Each run in the list should have required fields"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/runs?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        runs = data.get('runs', [])
        
        required_fields = ['runId', 'asset', 'timeframe', 'engineVersion', 
                          'candles', 'contextSnapshot', 'createdAt']
        
        for run in runs:
            for field in required_fields:
                assert field in run, f"Run missing field: {field}"
    
    def test_audit_runs_no_mongodb_id(self):
        """Response should not contain MongoDB _id fields"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/runs?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        
        for run in data.get('runs', []):
            assert '_id' not in run, "run contains _id field"


class TestPatternDocStructure:
    """Tests for pattern document structure in audit trail"""
    
    def test_pattern_has_run_id(self):
        """Pattern document should have runId linking to run"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        run_id = data.get('run', {}).get('runId')
        
        for pattern in patterns:
            assert pattern.get('runId') == run_id, "Pattern runId doesn't match run"
    
    def test_pattern_has_geometry(self):
        """Pattern document should have geometry object"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        for pattern in patterns:
            assert 'geometry' in pattern, "Pattern missing geometry"
            assert isinstance(pattern['geometry'], dict), "geometry should be object"
    
    def test_pattern_has_metrics(self):
        """Pattern document should have metrics object"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        for pattern in patterns:
            assert 'metrics' in pattern, "Pattern missing metrics"
            assert isinstance(pattern['metrics'], dict), "metrics should be object"
    
    def test_pattern_has_timestamps(self):
        """Pattern document should have startTs and endTs"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        for pattern in patterns:
            assert 'startTs' in pattern, "Pattern missing startTs"
            assert 'endTs' in pattern, "Pattern missing endTs"
            assert isinstance(pattern['startTs'], int), "startTs should be integer"
            assert isinstance(pattern['endTs'], int), "endTs should be integer"
    
    def test_pattern_has_trade_info(self):
        """Pattern document should have trade info (entry, stop, targets)"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        for pattern in patterns:
            if 'trade' in pattern and pattern['trade'] is not None:
                trade = pattern['trade']
                assert 'entry' in trade, "Trade missing entry"
                assert 'stop' in trade, "Trade missing stop"
                assert 'target1' in trade, "Trade missing target1"


class TestDecisionDocStructure:
    """Tests for decision document structure in audit trail"""
    
    def test_decision_has_decision_type(self):
        """Decision document should have decisionType='pattern'"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        decision = data.get('decision')
        
        if decision is not None:
            assert decision.get('decisionType') == 'pattern'
    
    def test_decision_has_candidate_counts(self):
        """Decision should have totalCandidates and droppedCount"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        decision = data.get('decision')
        
        if decision is not None:
            assert 'totalCandidates' in decision, "Decision missing totalCandidates"
            assert 'droppedCount' in decision, "Decision missing droppedCount"
            assert isinstance(decision['totalCandidates'], int)
            assert isinstance(decision['droppedCount'], int)
    
    def test_decision_top_pattern_ids_match_patterns(self):
        """topPatternIds in decision should match pattern IDs"""
        response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        decision = data.get('decision')
        patterns = data.get('patterns', [])
        
        if decision is not None and len(patterns) > 0:
            top_ids = decision.get('topPatternIds', [])
            pattern_ids = [p.get('patternId') for p in patterns]
            
            # All top IDs should be in patterns
            for top_id in top_ids:
                assert top_id in pattern_ids, f"topPatternId {top_id} not found in patterns"


class TestEndToEndAuditFlow:
    """End-to-end tests for audit trail flow"""
    
    def test_analyze_creates_retrievable_run(self):
        """Analyze should create a run that can be retrieved by ID"""
        # Create a new run
        analyze_response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert analyze_response.status_code == 200
        
        run_id = analyze_response.json().get('runId')
        assert run_id is not None
        
        # Retrieve by ID
        audit_response = requests.get(f"{BASE_URL}/api/ta/audit/run/{run_id}")
        assert audit_response.status_code == 200
        
        data = audit_response.json()
        assert data.get('ok') is True
        assert data['run']['runId'] == run_id
    
    def test_analyze_creates_run_in_latest(self):
        """Analyze should create a run that appears in latest"""
        # Create a new run
        analyze_response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert analyze_response.status_code == 200
        
        run_id = analyze_response.json().get('runId')
        
        # Check latest
        latest_response = requests.get(f"{BASE_URL}/api/ta/audit/latest?asset=SPX")
        assert latest_response.status_code == 200
        
        data = latest_response.json()
        assert data['run']['runId'] == run_id, "Latest run doesn't match just-created run"
    
    def test_analyze_creates_run_in_runs_list(self):
        """Analyze should create a run that appears in runs list"""
        # Create a new run
        analyze_response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert analyze_response.status_code == 200
        
        run_id = analyze_response.json().get('runId')
        
        # Check runs list
        runs_response = requests.get(f"{BASE_URL}/api/ta/audit/runs?asset=SPX&limit=5")
        assert runs_response.status_code == 200
        
        data = runs_response.json()
        run_ids = [r.get('runId') for r in data.get('runs', [])]
        
        assert run_id in run_ids, "New run not found in runs list"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
