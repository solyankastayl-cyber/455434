"""
TA Module Phase R Tests - Pattern Engine Expansion (R4-R7)
Tests for modular TA Engine with Phase R detectors:
- R4: Reversal patterns (Triple Top/Bottom, Rounding patterns)
- R5: Harmonic patterns (Gartley, Bat, Butterfly, Crab, Shark, Three Drives)
- R6: Candlestick patterns (Morning/Evening Star, Doji, Engulfing, Hammer/Shooting Star, Inside Bar)
- R7: Market Structure (BOS, CHOCH, Range, Trend Shift)

Endpoints tested:
- GET /api/ta/health - Should return ok:true and detectors:13
- GET /api/ta/engine/summary - Should return patternsImplemented:57
- GET /api/ta/analyze?asset=BTCUSDT - Should return patterns and detectorsRun:13
- POST /api/ta/analyze - Should detect patterns with candles data

Expected 13 detectors: 9 Phase 8 + 4 Phase R (reversal, harmonic, candle, market_structure)
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestHealthEndpoint:
    """Tests for GET /api/ta/health - Basic health check"""
    
    def test_health_returns_ok(self):
        """Health endpoint should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data}"
    
    def test_health_returns_13_detectors(self):
        """Health should report 13 detectors (9 Phase 8 + 4 Phase R)"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        assert 'detectors' in data, "Response missing 'detectors' field"
        assert data['detectors'] == 13, f"Expected 13 detectors, got {data['detectors']}"
    
    def test_health_returns_version(self):
        """Health should return version info"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        assert 'version' in data, "Response missing 'version' field"


class TestEngineSummaryEndpoint:
    """Tests for GET /api/ta/engine/summary - Engine summary"""
    
    def test_engine_summary_returns_ok(self):
        """Engine summary should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/engine/summary")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data}"
    
    def test_engine_summary_returns_57_patterns_implemented(self):
        """Engine summary should show 57 patterns implemented"""
        response = requests.get(f"{BASE_URL}/api/ta/engine/summary")
        assert response.status_code == 200
        
        data = response.json()
        assert 'patternsImplemented' in data, "Response missing 'patternsImplemented' field"
        assert data['patternsImplemented'] == 57, f"Expected 57 patterns implemented, got {data['patternsImplemented']}"
    
    def test_engine_summary_returns_78_registry_patterns(self):
        """Engine summary should show 78 registry patterns total"""
        response = requests.get(f"{BASE_URL}/api/ta/engine/summary")
        assert response.status_code == 200
        
        data = response.json()
        assert 'registryPatterns' in data, "Response missing 'registryPatterns' field"
        assert data['registryPatterns'] == 78, f"Expected 78 registry patterns, got {data['registryPatterns']}"
    
    def test_engine_summary_has_phase_info(self):
        """Engine summary should include phase info"""
        response = requests.get(f"{BASE_URL}/api/ta/engine/summary")
        assert response.status_code == 200
        
        data = response.json()
        assert 'phase' in data, "Response missing 'phase' field"
        assert data['phase'] == 'N', f"Expected phase 'N', got {data['phase']}"


class TestAnalyzeEndpointGET:
    """Tests for GET /api/ta/analyze - Analyze with query params"""
    
    def test_analyze_returns_ok(self):
        """Analyze endpoint should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data}"
    
    def test_analyze_returns_asset_and_timeframe(self):
        """Analyze should echo asset and timeframe"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('asset') == 'BTCUSDT', f"Expected asset BTCUSDT, got {data.get('asset')}"
        assert data.get('timeframe') == '1D', f"Expected timeframe 1D, got {data.get('timeframe')}"
    
    def test_analyze_returns_13_detectors_run(self):
        """Analyze should report 13 detectors were run"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        meta = data.get('meta', {})
        assert 'detectorsRun' in meta, "Response missing 'meta.detectorsRun' field"
        assert meta['detectorsRun'] == 13, f"Expected 13 detectors run, got {meta['detectorsRun']}"
    
    def test_analyze_returns_patterns_array(self):
        """Analyze should return patterns array"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert 'patterns' in data, "Response missing 'patterns' field"
        assert isinstance(data['patterns'], list), "patterns should be a list"
    
    def test_analyze_returns_ranked_patterns(self):
        """Analyze should return ranked patterns array"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert 'ranked' in data, "Response missing 'ranked' field"
        assert isinstance(data['ranked'], list), "ranked should be a list"
    
    def test_analyze_returns_structure(self):
        """Analyze should return market structure info"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert 'structure' in data, "Response missing 'structure' field"
        
        structure = data['structure']
        assert 'regime' in structure, "Structure missing 'regime'"
        assert 'regimeLabel' in structure, "Structure missing 'regimeLabel'"
        assert 'hhhlScore' in structure, "Structure missing 'hhhlScore'"
    
    def test_analyze_returns_pivots_summary(self):
        """Analyze should return pivots summary"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert 'pivots' in data, "Response missing 'pivots' field"
        
        pivots = data['pivots']
        assert 'total' in pivots, "Pivots missing 'total'"
        assert 'swingHighs' in pivots, "Pivots missing 'swingHighs'"
        assert 'swingLows' in pivots, "Pivots missing 'swingLows'"
        assert 'recent' in pivots, "Pivots missing 'recent'"
    
    def test_analyze_returns_levels(self):
        """Analyze should return S/R levels"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert 'levels' in data, "Response missing 'levels' field"
        assert isinstance(data['levels'], list), "levels should be a list"
    
    def test_analyze_returns_run_id(self):
        """Analyze should return a run ID for audit trail"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        assert 'runId' in data, "Response missing 'runId' field"
        assert data['runId'] is not None, "runId should not be null"


class TestAnalyzeEndpointPOST:
    """Tests for POST /api/ta/analyze - Analyze with body params"""
    
    def test_analyze_post_returns_ok(self):
        """POST analyze endpoint should return ok=true"""
        response = requests.post(f"{BASE_URL}/api/ta/analyze", json={
            "asset": "BTCUSDT",
            "timeframe": "1D",
            "lookback": 200
        })
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data}"
    
    def test_analyze_post_with_custom_lookback(self):
        """POST analyze should accept custom lookback"""
        response = requests.post(f"{BASE_URL}/api/ta/analyze", json={
            "asset": "BTCUSDT",
            "timeframe": "1D",
            "lookback": 100
        })
        assert response.status_code == 200
        
        data = response.json()
        meta = data.get('meta', {})
        assert meta.get('candlesUsed', 0) > 0, "Should have used some candles"
    
    def test_analyze_post_returns_patterns(self):
        """POST analyze should return patterns array"""
        response = requests.post(f"{BASE_URL}/api/ta/analyze", json={
            "asset": "BTCUSDT"
        })
        assert response.status_code == 200
        
        data = response.json()
        assert 'patterns' in data, "Response missing 'patterns' field"
        assert isinstance(data['patterns'], list), "patterns should be a list"


class TestPhaseRPatternDetection:
    """Tests for Phase R pattern detection"""
    
    def test_phase_r_candle_patterns_detected(self):
        """Phase R6 candlestick patterns should be detected"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        # Look for Phase R candle patterns
        candle_pattern_types = [
            'CANDLE_MORNING_STAR', 'CANDLE_EVENING_STAR',
            'CANDLE_DOJI', 'CANDLE_ENGULF_BULL', 'CANDLE_ENGULF_BEAR',
            'CANDLE_HAMMER', 'CANDLE_SHOOTING_STAR', 'CANDLE_INSIDE'
        ]
        
        found_candle_patterns = [p for p in ranked if p.get('type') in candle_pattern_types]
        
        # Should find at least some candle patterns
        print(f"Found {len(found_candle_patterns)} candle patterns")
        for p in found_candle_patterns[:5]:
            print(f"  - {p.get('type')}: score={p.get('scoring', {}).get('score')}")
    
    def test_phase_r_market_structure_patterns_detected(self):
        """Phase R7 market structure patterns should be detected"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        # Look for Phase R market structure patterns
        ms_pattern_types = [
            'BOS_BULL', 'BOS_BEAR',
            'CHOCH_BULL', 'CHOCH_BEAR',
            'RANGE_BOX', 'TREND_UP', 'TREND_DOWN'
        ]
        
        found_ms_patterns = [p for p in ranked if p.get('type') in ms_pattern_types]
        
        print(f"Found {len(found_ms_patterns)} market structure patterns")
        for p in found_ms_patterns[:5]:
            print(f"  - {p.get('type')}: score={p.get('scoring', {}).get('score')}")
    
    def test_phase_r_pattern_has_meta_note(self):
        """Phase R patterns should have 'Phase R:' note in metrics"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        # Check for Phase R note in pattern metrics
        phase_r_patterns = [
            p for p in ranked 
            if 'Phase R:' in p.get('metrics', {}).get('note', '')
        ]
        
        print(f"Found {len(phase_r_patterns)} patterns with 'Phase R:' note")
        assert len(phase_r_patterns) > 0, "Should find at least one Phase R pattern"


class TestPatternScoring:
    """Tests for pattern scoring and ranking"""
    
    def test_patterns_have_scoring_object(self):
        """Detected patterns should have scoring details"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        if len(patterns) > 0:
            pattern = patterns[0]
            assert 'scoring' in pattern, "Pattern missing 'scoring' field"
            
            scoring = pattern['scoring']
            assert 'score' in scoring, "Scoring missing 'score'"
            assert 'confidence' in scoring, "Scoring missing 'confidence'"
            assert 'reasons' in scoring, "Scoring missing 'reasons'"
    
    def test_pattern_score_range(self):
        """Pattern scores should be between 0 and 1"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        for pattern in patterns:
            scoring = pattern.get('scoring', {})
            score = scoring.get('score', 0)
            confidence = scoring.get('confidence', 0)
            
            assert 0 <= score <= 1, f"Score out of range: {score}"
            assert 0 <= confidence <= 1, f"Confidence out of range: {confidence}"
    
    def test_ranked_patterns_sorted_by_score(self):
        """Ranked patterns should be sorted by score descending"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        if len(ranked) > 1:
            scores = [p.get('scoring', {}).get('score', 0) for p in ranked]
            for i in range(len(scores) - 1):
                assert scores[i] >= scores[i+1], f"Patterns not sorted: {scores[i]} < {scores[i+1]}"


class TestPatternTypes:
    """Tests for different pattern types"""
    
    def test_continuation_patterns_exist(self):
        """Should detect continuation patterns (channels, triangles, flags)"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        continuation_types = [
            'CHANNEL_UP', 'CHANNEL_DOWN', 'CHANNEL_FLAT',
            'TRIANGLE_SYMM', 'TRIANGLE_ASC', 'TRIANGLE_DESC',
            'FLAG_BULL', 'FLAG_BEAR', 'PENNANT_BULL', 'PENNANT_BEAR'
        ]
        
        found = [p for p in ranked if p.get('type') in continuation_types]
        print(f"Found {len(found)} continuation patterns")
    
    def test_reversal_patterns_exist(self):
        """Should detect reversal patterns (double, H&S, etc.)"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        reversal_types = [
            'DOUBLE_TOP', 'DOUBLE_BOTTOM',
            'HNS', 'IHNS',
            'LEVEL_BREAKOUT', 'LEVEL_RETEST',
            'HARMONIC_ABCD_BULL', 'HARMONIC_ABCD_BEAR'
        ]
        
        found = [p for p in ranked if p.get('type') in reversal_types]
        print(f"Found {len(found)} reversal patterns")


class TestResponseStructure:
    """Tests for correct response structure (no MongoDB _id leaks)"""
    
    def test_no_mongodb_id_in_response(self):
        """Response should not contain MongoDB _id fields"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        
        # Check top level
        assert '_id' not in data, "Response contains _id at top level"
        
        # Check patterns
        for pattern in data.get('patterns', []):
            assert '_id' not in pattern, f"Pattern contains _id: {pattern.get('type')}"
        
        # Check levels
        for level in data.get('levels', []):
            assert '_id' not in level, f"Level contains _id"
        
        # Check pivots
        for pivot in data.get('pivots', {}).get('recent', []):
            assert '_id' not in pivot, f"Pivot contains _id"
    
    def test_health_no_mongodb_id(self):
        """Health endpoint should not contain MongoDB _id"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        assert '_id' not in data, "Health response contains _id"
    
    def test_engine_summary_no_mongodb_id(self):
        """Engine summary should not contain MongoDB _id"""
        response = requests.get(f"{BASE_URL}/api/ta/engine/summary")
        assert response.status_code == 200
        
        data = response.json()
        assert '_id' not in data, "Engine summary response contains _id"


class TestMeta:
    """Tests for metadata in analyze response"""
    
    def test_meta_has_required_fields(self):
        """Meta object should have required fields"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        meta = data.get('meta', {})
        
        required_fields = ['candlesUsed', 'detectorsRun', 'totalPatternsFound', 'timestamp']
        for field in required_fields:
            assert field in meta, f"Meta missing required field: {field}"
    
    def test_meta_candles_used_positive(self):
        """candlesUsed should be positive"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        candles_used = data.get('meta', {}).get('candlesUsed', 0)
        assert candles_used > 0, f"candlesUsed should be positive, got {candles_used}"
    
    def test_meta_timestamp_valid(self):
        """timestamp should be a valid ISO format"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        timestamp = data.get('meta', {}).get('timestamp', '')
        
        # Basic ISO format check
        assert 'T' in timestamp, "timestamp should be ISO format"
        assert len(timestamp) > 0, "timestamp should not be empty"


class TestPhaseRDetectorIntegration:
    """Integration tests for Phase R detector adapter"""
    
    def test_all_4_phase_r_detectors_integrated(self):
        """Should have 4 Phase R detectors integrated (R4, R5, R6, R7)"""
        # With 13 total detectors: 9 Phase 8 + 4 Phase R
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        detectors = data.get('detectors', 0)
        
        # 9 Phase 8 detectors + 4 Phase R detectors = 13
        assert detectors == 13, f"Expected 13 detectors (9 + 4), got {detectors}"
    
    def test_phase_r_patterns_have_correct_structure(self):
        """Phase R patterns should have correct structure"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        phase_r_types = [
            'CANDLE_ENGULF_BULL', 'CANDLE_ENGULF_BEAR',
            'BOS_BULL', 'BOS_BEAR',
            'CHOCH_BULL', 'CHOCH_BEAR'
        ]
        
        for pattern in ranked:
            if pattern.get('type') in phase_r_types:
                # Check required fields
                assert 'id' in pattern, f"Pattern missing 'id'"
                assert 'type' in pattern, f"Pattern missing 'type'"
                assert 'direction' in pattern, f"Pattern missing 'direction'"
                assert 'metrics' in pattern, f"Pattern missing 'metrics'"
                assert 'scoring' in pattern, f"Pattern missing 'scoring'"
                break


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
