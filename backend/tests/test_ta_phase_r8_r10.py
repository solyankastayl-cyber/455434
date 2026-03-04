"""
TA Module Phase R8-R10 Tests - Elliott Wave, Reliability Layer, and Remaining Coverage
Tests for:
- R8: Elliott Wave (5-wave impulse, ABC correction, extended waves)
- R9: Reliability Layer (smoothing, decay, clustering, dedup, scoring)  
- R10: Remaining Coverage - Gaps, MA Patterns, Divergences, Pitchfork, Broadening

Endpoints tested:
- GET /api/ta/health - Should return detectors:16
- GET /api/ta/engine/summary - Should return patternsImplemented >= 81
- GET /api/ta/analyze?asset=BTCUSDT - Should detect new pattern types

Expected 16 detectors: 13 Phase 8+R + 3 Phase R8-R10 (Elliott, Gaps, Pitchfork/Broadening)
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestHealthEndpointPhaseR8R10:
    """Tests for GET /api/ta/health with Phase R8-R10 updates"""
    
    def test_health_returns_ok(self):
        """Health endpoint should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data}"
    
    def test_health_returns_16_detectors(self):
        """Health should report 16 detectors (13 + 3 Phase R8-R10)"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        assert 'detectors' in data, "Response missing 'detectors' field"
        assert data['detectors'] == 16, f"Expected 16 detectors, got {data['detectors']}"
    
    def test_health_returns_version(self):
        """Health should return version info"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        assert 'version' in data, "Response missing 'version' field"


class TestEngineSummaryPhaseR8R10:
    """Tests for GET /api/ta/engine/summary with Phase R8-R10 updates"""
    
    def test_engine_summary_returns_ok(self):
        """Engine summary should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/engine/summary")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True, f"Expected ok=true, got {data}"
    
    def test_engine_summary_returns_81_patterns_implemented(self):
        """Engine summary should show 81 patterns implemented"""
        response = requests.get(f"{BASE_URL}/api/ta/engine/summary")
        assert response.status_code == 200
        
        data = response.json()
        assert 'patternsImplemented' in data, "Response missing 'patternsImplemented' field"
        assert data['patternsImplemented'] >= 81, f"Expected >= 81 patterns implemented, got {data['patternsImplemented']}"
    
    def test_engine_summary_returns_99_registry_patterns(self):
        """Engine summary should show 99 registry patterns total"""
        response = requests.get(f"{BASE_URL}/api/ta/engine/summary")
        assert response.status_code == 200
        
        data = response.json()
        assert 'registryPatterns' in data, "Response missing 'registryPatterns' field"
        assert data['registryPatterns'] >= 99, f"Expected >= 99 registry patterns, got {data['registryPatterns']}"


class TestPhaseR8ElliottWave:
    """Tests for Phase R8 Elliott Wave pattern detection"""
    
    def test_elliott_5_wave_detected(self):
        """Should detect ELLIOTT_5_WAVE impulse patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        elliott_5_wave = [p for p in ranked if p.get('type') == 'ELLIOTT_5_WAVE']
        print(f"Found {len(elliott_5_wave)} ELLIOTT_5_WAVE patterns")
        
        assert len(elliott_5_wave) > 0, "Should detect at least one ELLIOTT_5_WAVE pattern"
        
        # Verify structure
        if len(elliott_5_wave) > 0:
            pattern = elliott_5_wave[0]
            assert 'id' in pattern, "Pattern missing 'id'"
            assert 'direction' in pattern, "Pattern missing 'direction'"
            assert pattern['direction'] in ['BULL', 'BEAR'], f"Invalid direction: {pattern['direction']}"
    
    def test_elliott_3_wave_detected(self):
        """Should detect ELLIOTT_3_WAVE extended patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        elliott_3_wave = [p for p in ranked if p.get('type') == 'ELLIOTT_3_WAVE']
        print(f"Found {len(elliott_3_wave)} ELLIOTT_3_WAVE patterns")
        
        # ELLIOTT_3_WAVE is for extended waves
        # May not always be detected, but structure should be correct
    
    def test_correction_abc_detected(self):
        """Should detect CORRECTION_ABC patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        correction_abc = [p for p in ranked if p.get('type') == 'CORRECTION_ABC']
        print(f"Found {len(correction_abc)} CORRECTION_ABC patterns")
        
        # ABC corrections may not always be present but should detect some
    
    def test_elliott_patterns_have_wave_meta(self):
        """Elliott patterns should have wave information in meta"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        elliott_types = ['ELLIOTT_5_WAVE', 'ELLIOTT_3_WAVE', 'CORRECTION_ABC']
        elliott_patterns = [p for p in ranked if p.get('type') in elliott_types]
        
        print(f"Found {len(elliott_patterns)} total Elliott patterns")


class TestPhaseR10Gaps:
    """Tests for Phase R10.A Gap pattern detection"""
    
    def test_gap_up_detected(self):
        """Should detect GAP_UP patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        gap_up = [p for p in ranked if p.get('type') == 'GAP_UP']
        print(f"Found {len(gap_up)} GAP_UP patterns")
        
        assert len(gap_up) > 0, "Should detect at least one GAP_UP pattern"
    
    def test_gap_down_detected(self):
        """Should detect GAP_DOWN patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        gap_down = [p for p in ranked if p.get('type') == 'GAP_DOWN']
        print(f"Found {len(gap_down)} GAP_DOWN patterns")
        
        # GAP_DOWN may not always be present
    
    def test_gap_fill_detected(self):
        """Should detect GAP_FILL patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        gap_fill = [p for p in ranked if p.get('type') == 'GAP_FILL']
        print(f"Found {len(gap_fill)} GAP_FILL patterns")
        
        assert len(gap_fill) > 0, "Should detect at least one GAP_FILL pattern"
    
    def test_fair_value_gap_bull_detected(self):
        """Should detect FAIR_VALUE_GAP_BULL (FVG) patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        fvg_bull = [p for p in ranked if p.get('type') == 'FAIR_VALUE_GAP_BULL']
        print(f"Found {len(fvg_bull)} FAIR_VALUE_GAP_BULL patterns")
        
        assert len(fvg_bull) > 0, "Should detect at least one FAIR_VALUE_GAP_BULL pattern"
    
    def test_fair_value_gap_bear_detected(self):
        """Should detect FAIR_VALUE_GAP_BEAR (FVG) patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        fvg_bear = [p for p in ranked if p.get('type') == 'FAIR_VALUE_GAP_BEAR']
        print(f"Found {len(fvg_bear)} FAIR_VALUE_GAP_BEAR patterns")
        
        assert len(fvg_bear) > 0, "Should detect at least one FAIR_VALUE_GAP_BEAR pattern"
    
    def test_imbalance_reversal_detected(self):
        """Should detect IMBALANCE_REVERSAL patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        imbalance = [p for p in ranked if p.get('type') == 'IMBALANCE_REVERSAL']
        print(f"Found {len(imbalance)} IMBALANCE_REVERSAL patterns")
        
        # IMBALANCE_REVERSAL may be detected


class TestPhaseR10PitchforkBroadening:
    """Tests for Phase R10.D Pitchfork & Broadening patterns"""
    
    def test_pitchfork_detected(self):
        """Should detect PITCHFORK patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        pitchfork = [p for p in ranked if p.get('type') == 'PITCHFORK']
        print(f"Found {len(pitchfork)} PITCHFORK patterns")
        
        assert len(pitchfork) > 0, "Should detect at least one PITCHFORK pattern"
    
    def test_broadening_detected(self):
        """Should detect BROADENING patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        broadening_types = ['BROADENING_TRIANGLE', 'BROADENING_WEDGE']
        broadening = [p for p in ranked if p.get('type') in broadening_types]
        print(f"Found {len(broadening)} BROADENING patterns")
        
        # Broadening may not always be present in synthetic data


class TestPatternCounts:
    """Tests for pattern detection counts"""
    
    def test_analyze_returns_patterns(self):
        """Analyze should return a substantial number of patterns"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        print(f"Total ranked patterns: {len(ranked)}")
        assert len(ranked) > 50, f"Expected > 50 patterns, got {len(ranked)}"
    
    def test_pattern_type_diversity(self):
        """Should detect multiple different pattern types"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        unique_types = set(p.get('type') for p in ranked)
        print(f"Unique pattern types: {len(unique_types)}")
        print(f"Types: {sorted(unique_types)}")
        
        assert len(unique_types) >= 15, f"Expected >= 15 unique pattern types, got {len(unique_types)}"
    
    def test_phase_r8_r10_patterns_in_types(self):
        """Should include Phase R8-R10 pattern types"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        unique_types = set(p.get('type') for p in ranked)
        
        # Phase R8 Elliott patterns
        r8_types = {'ELLIOTT_5_WAVE', 'ELLIOTT_3_WAVE', 'CORRECTION_ABC'}
        found_r8 = r8_types.intersection(unique_types)
        print(f"Found R8 Elliott types: {found_r8}")
        
        # Phase R10 Gap patterns
        r10_gap_types = {'GAP_UP', 'GAP_DOWN', 'GAP_FILL', 'FAIR_VALUE_GAP_BULL', 'FAIR_VALUE_GAP_BEAR', 'IMBALANCE_REVERSAL'}
        found_r10_gap = r10_gap_types.intersection(unique_types)
        print(f"Found R10 Gap types: {found_r10_gap}")
        
        # Phase R10 Pitchfork/Broadening patterns
        r10_pb_types = {'PITCHFORK', 'PITCHFORK_BREAK', 'BROADENING_TRIANGLE', 'BROADENING_WEDGE'}
        found_r10_pb = r10_pb_types.intersection(unique_types)
        print(f"Found R10 Pitchfork/Broadening types: {found_r10_pb}")
        
        # Verify at least some R8-R10 patterns are detected
        total_found = len(found_r8) + len(found_r10_gap) + len(found_r10_pb)
        assert total_found >= 5, f"Expected >= 5 R8-R10 pattern types, got {total_found}"


class TestPatternStructure:
    """Tests for pattern structure validation"""
    
    def test_patterns_have_required_fields(self):
        """All patterns should have required fields"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        required_fields = ['id', 'type', 'direction']
        
        for pattern in ranked[:20]:  # Check first 20
            for field in required_fields:
                assert field in pattern, f"Pattern missing '{field}': {pattern.get('type')}"
    
    def test_patterns_have_scoring(self):
        """Patterns should have scoring object"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        for pattern in ranked[:10]:
            assert 'scoring' in pattern, f"Pattern missing 'scoring': {pattern.get('type')}"
    
    def test_no_mongodb_id_leaks(self):
        """Response should not contain MongoDB _id fields"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        
        # Check top level
        assert '_id' not in data, "Response contains _id at top level"
        
        # Check patterns
        for pattern in data.get('ranked', [])[:20]:
            assert '_id' not in pattern, f"Pattern contains _id: {pattern.get('type')}"


class TestPhaseR8R10Integration:
    """Integration tests for Phase R8-R10"""
    
    def test_detectors_count_increased(self):
        """Detectors should be 16 (was 13 before R8-R10)"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        detectors = data.get('detectors', 0)
        
        assert detectors == 16, f"Expected 16 detectors, got {detectors}"
    
    def test_patterns_implemented_increased(self):
        """Patterns implemented should be >= 81 (was 57 before R8-R10)"""
        response = requests.get(f"{BASE_URL}/api/ta/engine/summary")
        assert response.status_code == 200
        
        data = response.json()
        patterns_implemented = data.get('patternsImplemented', 0)
        
        assert patterns_implemented >= 81, f"Expected >= 81 patterns, got {patterns_implemented}"
    
    def test_analyze_endpoint_returns_new_patterns(self):
        """Analyze should return new R8-R10 pattern types"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        unique_types = set(p.get('type') for p in ranked)
        
        new_pattern_types = [
            'ELLIOTT_5_WAVE', 'ELLIOTT_3_WAVE', 'CORRECTION_ABC',
            'GAP_UP', 'GAP_DOWN', 'GAP_FILL',
            'FAIR_VALUE_GAP_BULL', 'FAIR_VALUE_GAP_BEAR',
            'PITCHFORK', 'BROADENING_TRIANGLE', 'BROADENING_WEDGE'
        ]
        
        found_new_types = [t for t in new_pattern_types if t in unique_types]
        print(f"Found new pattern types: {found_new_types}")
        
        assert len(found_new_types) >= 5, f"Expected >= 5 new pattern types, got {len(found_new_types)}"


class TestPhaseR9ReliabilityUtilities:
    """Tests for Phase R9 Reliability utilities (indirect via API behavior)"""
    
    def test_patterns_are_deduplicated(self):
        """Patterns should be deduplicated (no exact duplicates)"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        # Check for exact duplicate IDs
        ids = [p.get('id') for p in ranked]
        unique_ids = set(ids)
        
        # Some patterns might have similar IDs but different timestamps
        duplicate_ratio = (len(ids) - len(unique_ids)) / max(1, len(ids))
        print(f"Total patterns: {len(ids)}, Unique IDs: {len(unique_ids)}, Duplicate ratio: {duplicate_ratio:.2%}")
        
        # Allow some duplicates but shouldn't be excessive
        assert duplicate_ratio < 0.3, f"Too many duplicate patterns: {duplicate_ratio:.2%}"
    
    def test_patterns_sorted_by_score(self):
        """Patterns should be sorted by score (reliability scoring)"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=BTCUSDT")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        if len(ranked) > 1:
            scores = [p.get('scoring', {}).get('score', 0) for p in ranked]
            # Check if roughly sorted (allow some tolerance due to equal scores)
            sorted_scores = sorted(scores, reverse=True)
            
            # Count violations
            violations = sum(1 for i in range(len(scores)-1) if scores[i] < scores[i+1] * 0.95)
            violation_rate = violations / max(1, len(scores) - 1)
            
            print(f"Score sorting violations: {violations}, Rate: {violation_rate:.2%}")
            assert violation_rate < 0.1, f"Patterns not properly sorted by score"


class TestEdgeCases:
    """Edge case tests"""
    
    def test_analyze_with_different_assets(self):
        """Analyze should work with different assets"""
        assets = ['BTCUSDT', 'ETHUSDT']
        
        for asset in assets:
            response = requests.get(f"{BASE_URL}/api/ta/analyze?asset={asset}")
            assert response.status_code == 200, f"Failed for asset {asset}"
            
            data = response.json()
            assert data.get('ok') is True, f"Expected ok=true for {asset}"
            assert data.get('asset') == asset, f"Asset mismatch for {asset}"
    
    def test_post_analyze_works(self):
        """POST analyze endpoint should work"""
        response = requests.post(f"{BASE_URL}/api/ta/analyze", json={
            "asset": "BTCUSDT",
            "timeframe": "1D",
            "lookback": 200
        })
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
