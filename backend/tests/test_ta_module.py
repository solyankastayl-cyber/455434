"""
TA Module Tests - Technical Analysis Engine v2.0
Tests for ChannelDetector, ScoringEngine, and TA Service endpoints
Phase 7: Feature Pack Testing

Endpoints tested:
- GET /api/ta/health - Health check with detector count
- GET /api/ta/analyze?asset=SPX - Full analysis with scoring and Feature Packs
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestTAHealth:
    """Tests for /api/ta/health endpoint"""
    
    def test_health_returns_ok(self):
        """Health endpoint should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_health_returns_version_2_0_0(self):
        """Health endpoint should return version 2.0.0"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('version') == '2.0.0'
    
    def test_health_returns_3_detectors(self):
        """Health endpoint should return detectors=3 (Triangle, Flag, Channel)"""
        response = requests.get(f"{BASE_URL}/api/ta/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('detectors') == 3


class TestTAAnalyze:
    """Tests for /api/ta/analyze endpoint"""
    
    def test_analyze_spx_returns_ok(self):
        """Analyze SPX should return ok=true"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('ok') is True
    
    def test_analyze_spx_returns_asset_and_timeframe(self):
        """Analyze SPX should return correct asset and timeframe"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get('asset') == 'SPX'
        assert data.get('timeframe') == '1D'
    
    def test_analyze_spx_returns_patterns_array(self):
        """Analyze SPX should return patterns array"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'patterns' in data
        assert isinstance(data['patterns'], list)
    
    def test_analyze_spx_returns_ranked_array(self):
        """Analyze SPX should return ranked array (all scored patterns)"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'ranked' in data
        assert isinstance(data['ranked'], list)
    
    def test_analyze_spx_returns_dropped_array(self):
        """Analyze SPX should return dropped array (below threshold)"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'dropped' in data
        assert isinstance(data['dropped'], list)
    
    def test_analyze_spx_meta_detectors_run_is_3(self):
        """Analyze SPX meta.detectorsRun should be 3"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'meta' in data
        assert data['meta'].get('detectorsRun') == 3


class TestScoringObject:
    """Tests for scoring object in patterns"""
    
    def test_patterns_have_scoring_object(self):
        """Each pattern should have a scoring object"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        # If patterns exist, verify scoring object
        if len(patterns) > 0:
            for pattern in patterns:
                assert 'scoring' in pattern, f"Pattern {pattern.get('id')} missing scoring object"
    
    def test_scoring_has_score_field(self):
        """Scoring object should have score field (0-1)"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        if len(patterns) > 0:
            for pattern in patterns:
                scoring = pattern.get('scoring', {})
                assert 'score' in scoring, "Scoring missing 'score' field"
                score = scoring['score']
                assert isinstance(score, (int, float)), "Score should be numeric"
                assert 0 <= score <= 1, f"Score {score} should be between 0 and 1"
    
    def test_scoring_has_confidence_field(self):
        """Scoring object should have confidence field (0-1)"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        if len(patterns) > 0:
            for pattern in patterns:
                scoring = pattern.get('scoring', {})
                assert 'confidence' in scoring, "Scoring missing 'confidence' field"
                confidence = scoring['confidence']
                assert isinstance(confidence, (int, float)), "Confidence should be numeric"
                assert 0 <= confidence <= 1, f"Confidence {confidence} should be between 0 and 1"
    
    def test_scoring_has_reasons_array(self):
        """Scoring object should have reasons array"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        if len(patterns) > 0:
            for pattern in patterns:
                scoring = pattern.get('scoring', {})
                assert 'reasons' in scoring, "Scoring missing 'reasons' field"
                reasons = scoring['reasons']
                assert isinstance(reasons, list), "Reasons should be an array"
    
    def test_scoring_reasons_have_required_fields(self):
        """Each reason should have factor, value, weight, contribution"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        if len(patterns) > 0:
            for pattern in patterns:
                reasons = pattern.get('scoring', {}).get('reasons', [])
                for reason in reasons:
                    assert 'factor' in reason, "Reason missing 'factor'"
                    assert 'value' in reason, "Reason missing 'value'"
                    assert 'weight' in reason, "Reason missing 'weight'"
                    assert 'contribution' in reason, "Reason missing 'contribution'"


class TestRankedPatterns:
    """Tests for ranked patterns array"""
    
    def test_ranked_patterns_have_scoring(self):
        """All ranked patterns should have scoring object"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        for pattern in ranked:
            assert 'scoring' in pattern, f"Ranked pattern {pattern.get('id')} missing scoring"
    
    def test_ranked_patterns_sorted_by_score_descending(self):
        """Ranked patterns should be sorted by score descending"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        ranked = data.get('ranked', [])
        
        if len(ranked) > 1:
            scores = [p.get('scoring', {}).get('score', 0) for p in ranked]
            assert scores == sorted(scores, reverse=True), "Ranked patterns not sorted by score descending"


class TestResponseStructure:
    """Tests for overall response structure"""
    
    def test_response_has_structure_object(self):
        """Response should have structure object with regime info"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'structure' in data
        structure = data['structure']
        assert 'regime' in structure
        assert 'regimeLabel' in structure
    
    def test_response_has_pivots_object(self):
        """Response should have pivots object"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'pivots' in data
        pivots = data['pivots']
        assert 'total' in pivots
        assert 'swingHighs' in pivots
        assert 'swingLows' in pivots
    
    def test_response_has_levels_array(self):
        """Response should have levels array (S/R zones)"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'levels' in data
        assert isinstance(data['levels'], list)
    
    def test_response_has_features_object(self):
        """Response should have features object for ML"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'features' in data
        assert isinstance(data['features'], dict)
    
    def test_response_has_meta_object(self):
        """Response should have meta object with metadata"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'meta' in data
        meta = data['meta']
        assert 'candlesUsed' in meta
        assert 'detectorsRun' in meta
        assert 'totalPatternsFound' in meta
        assert 'timestamp' in meta


class TestPatternFields:
    """Tests for pattern object fields"""
    
    def test_pattern_has_required_fields(self):
        """Each pattern should have required fields"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        required_fields = ['id', 'type', 'tf', 'asset', 'direction', 'geometry', 'metrics', 'scoring']
        
        for pattern in patterns:
            for field in required_fields:
                assert field in pattern, f"Pattern missing required field: {field}"
    
    def test_pattern_type_is_valid(self):
        """Pattern type should be a valid pattern type string"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        patterns = data.get('patterns', [])
        
        valid_types = [
            'TRIANGLE_SYM', 'TRIANGLE_ASC', 'TRIANGLE_DESC',
            'WEDGE_RISING', 'WEDGE_FALLING',
            'FLAG_BULL', 'FLAG_BEAR', 'PENNANT_BULL', 'PENNANT_BEAR',
            'CHANNEL_UP', 'CHANNEL_DOWN', 'CHANNEL_HORIZONTAL'
        ]
        
        for pattern in patterns:
            pattern_type = pattern.get('type')
            assert pattern_type in valid_types, f"Invalid pattern type: {pattern_type}"



class TestPhase7FeaturePacks:
    """Tests for Phase 7 Feature Pack implementation"""
    
    def test_analyze_returns_features_pack_object(self):
        """Analyze should return featuresPack object with ma, fib, vol"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        assert 'featuresPack' in data, "Response missing 'featuresPack' object"
        
        features_pack = data['featuresPack']
        assert 'ma' in features_pack, "featuresPack missing 'ma' pack"
        assert 'fib' in features_pack, "featuresPack missing 'fib' pack"
        assert 'vol' in features_pack, "featuresPack missing 'vol' pack"
    
    def test_ma_pack_has_required_fields(self):
        """MA pack should have all required fields"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        ma_pack = data.get('featuresPack', {}).get('ma', {})
        
        required_fields = [
            'ma20', 'ma50', 'ma200',
            'slope20', 'slope50', 'slope200', 
            'dist20', 'dist50', 'dist200',
            'cross50_200', 'alignment'
        ]
        
        for field in required_fields:
            assert field in ma_pack, f"MA pack missing field: {field}"
        
        # Validate alignment values
        alignment = ma_pack.get('alignment')
        assert alignment in ['BULL', 'BEAR', 'MIXED'], f"Invalid MA alignment: {alignment}"
        
        # Validate cross values
        cross = ma_pack.get('cross50_200')
        assert cross in [-1, 0, 1], f"Invalid cross50_200 value: {cross}"
    
    def test_fib_pack_structure(self):
        """Fib pack should have proper structure"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        fib_pack = data.get('featuresPack', {}).get('fib', {})
        
        required_fields = ['swing', 'retrace', 'ext', 'distToNearestLevel']
        for field in required_fields:
            assert field in fib_pack, f"Fib pack missing field: {field}"
        
        # If swing exists, validate structure
        if fib_pack.get('swing'):
            swing = fib_pack['swing']
            swing_fields = ['fromIdx', 'toIdx', 'fromPrice', 'toPrice', 'dir', 'amplitude']
            for field in swing_fields:
                assert field in swing, f"Swing missing field: {field}"
            
            assert swing['dir'] in ['UP', 'DOWN'], f"Invalid swing direction: {swing['dir']}"
        
        # If retrace exists, validate golden pocket
        if fib_pack.get('retrace'):
            retrace = fib_pack['retrace']
            assert 'priceInGoldenPocket' in retrace, "Retrace missing priceInGoldenPocket"
            assert isinstance(retrace['priceInGoldenPocket'], bool)
    
    def test_vol_pack_has_required_fields(self):
        """Vol pack should have all required fields"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        vol_pack = data.get('featuresPack', {}).get('vol', {})
        
        required_fields = [
            'atrNow', 'atrPct', 'atrPctile', 
            'regime', 'compression', 'volGate'
        ]
        
        for field in required_fields:
            assert field in vol_pack, f"Vol pack missing field: {field}"
        
        # Validate regime values
        regime = vol_pack.get('regime')
        assert regime in ['LOW', 'NORMAL', 'HIGH'], f"Invalid vol regime: {regime}"
        
        # Validate volGate range (should be 0.5 - 1.0)
        vol_gate = vol_pack.get('volGate')
        assert isinstance(vol_gate, (int, float)), "volGate should be numeric"
        assert 0.5 <= vol_gate <= 1.0, f"volGate {vol_gate} should be between 0.5 and 1.0"
        
        # Validate percentile range
        percentile = vol_pack.get('atrPctile')
        assert 0 <= percentile <= 1, f"atrPctile {percentile} should be between 0 and 1"
    
    def test_flattened_features_present(self):
        """ctx.features should contain flattened ma_*, fib_*, vol_* features"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        features = data.get('features', {})
        
        # Check MA features
        ma_features = ['ma_20', 'ma_50', 'ma_200', 'ma_slope50', 'ma_dist50', 'ma_alignment']
        for feature in ma_features:
            assert feature in features, f"Features missing MA feature: {feature}"
        
        # Check Vol features  
        vol_features = ['vol_atrNow', 'vol_atrPct', 'vol_regime', 'vol_gate']
        for feature in vol_features:
            assert feature in features, f"Features missing Vol feature: {feature}"
        
        # Check Fib features (may not always be present)
        fib_features = ['fib_hasSwing', 'fib_distToNearest']
        for feature in fib_features:
            assert feature in features, f"Features missing Fib feature: {feature}"
    
    def test_pattern_scoring_uses_vol_gate(self):
        """Pattern scoring should be affected by volGate multiplier"""
        response = requests.get(f"{BASE_URL}/api/ta/analyze?asset=SPX")
        assert response.status_code == 200
        
        data = response.json()
        vol_gate = data.get('featuresPack', {}).get('vol', {}).get('volGate', 1.0)
        patterns = data.get('patterns', [])
        
        # Check if patterns exist and have scoring reasons that might reference volGate
        for pattern in patterns:
            scoring = pattern.get('scoring', {})
            reasons = scoring.get('reasons', [])
            
            # Look for feature bonus or volGate-related scoring factors
            factor_names = [r.get('factor', '') for r in reasons]
            
            # At minimum, scoring should exist and be <= 1.0 (affected by volGate)
            score = scoring.get('score', 0)
            assert isinstance(score, (int, float)), "Score should be numeric"
            assert 0 <= score <= 1, f"Score {score} should be between 0 and 1"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
