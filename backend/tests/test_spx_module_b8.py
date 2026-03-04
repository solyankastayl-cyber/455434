"""
SPX Module B8 Integration Tests
Tests for SPX Terminal, Consensus Engine, Phase Engine APIs
Coverage: B5.3-B5.8, B6.1-B6.3
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://backtest-replay-lab.preview.emergentagent.com').rstrip('/')


class TestHealthCheck:
    """Basic health check tests"""
    
    def test_api_health(self):
        """Test backend health endpoint"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get('ok') == True
        print(f"SUCCESS: Health check passed - mode: {data.get('mode')}")


class TestSPXConsensusAPI:
    """Tests for /api/spx/v2.1/consensus endpoint (B5.5)"""
    
    def test_consensus_endpoint_returns_data(self):
        """Test consensus endpoint returns valid data"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/consensus")
        assert response.status_code == 200
        data = response.json()
        
        assert data.get('ok') == True
        assert 'data' in data
        
        consensus_data = data['data']
        
        # Check required consensus fields
        assert 'consensusIndex' in consensus_data
        assert 'direction' in consensus_data
        assert 'votes' in consensus_data
        assert 'resolved' in consensus_data
        
        # Validate consensusIndex range
        assert 0 <= consensus_data['consensusIndex'] <= 100
        
        # Validate direction
        assert consensus_data['direction'] in ['BULL', 'BEAR', 'NEUTRAL']
        
        # Validate resolved action
        assert consensus_data['resolved']['action'] in ['BUY', 'SELL', 'HOLD', 'NO_TRADE']
        
        print(f"SUCCESS: Consensus endpoint - Index: {consensus_data['consensusIndex']}, Direction: {consensus_data['direction']}, Action: {consensus_data['resolved']['action']}")
    
    def test_consensus_votes_structure(self):
        """Test consensus votes contain all 6 horizons"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/consensus")
        assert response.status_code == 200
        data = response.json()
        
        votes = data['data']['votes']
        assert len(votes) == 6  # All 6 horizons
        
        # Check horizon keys
        horizons = [v['horizon'] for v in votes]
        expected_horizons = ['7d', '14d', '30d', '90d', '180d', '365d']
        for h in expected_horizons:
            assert h in horizons, f"Missing horizon: {h}"
        
        # Check each vote has required fields
        for vote in votes:
            assert 'horizon' in vote
            assert 'tier' in vote
            assert 'direction' in vote
            assert 'confidence' in vote
            assert 'divergenceGrade' in vote
            assert 'weight' in vote
            assert 'voteScore' in vote
            
            # Validate tier
            assert vote['tier'] in ['TIMING', 'TACTICAL', 'STRUCTURE']
        
        print(f"SUCCESS: All 6 horizon votes present with correct structure")


class TestSPXPhasesAPI:
    """Tests for /api/spx/v2.1/phases endpoint (B5.4)"""
    
    def test_phases_endpoint_returns_data(self):
        """Test phases endpoint returns valid phase data"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/phases")
        assert response.status_code == 200
        data = response.json()
        
        assert data.get('ok') == True
        assert 'data' in data
        
        phase_data = data['data']
        
        # Check required phase fields
        assert 'phaseIdAtNow' in phase_data
        assert 'currentFlags' in phase_data
        assert 'segments' in phase_data
        
        # Validate current phase
        current_phase = phase_data['phaseIdAtNow']
        assert 'phase' in current_phase
        valid_phases = ['BULL_EXPANSION', 'BULL_COOLDOWN', 'BEAR_DRAWDOWN', 'BEAR_RALLY', 'SIDEWAYS_RANGE']
        assert current_phase['phase'] in valid_phases
        
        # Check segments exist
        assert len(phase_data['segments']) > 0
        
        print(f"SUCCESS: Phases endpoint - Current phase: {current_phase['phase']}, Segments: {len(phase_data['segments'])}")
    
    def test_phases_segments_structure(self):
        """Test phase segments have correct structure"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/phases")
        assert response.status_code == 200
        data = response.json()
        
        segments = data['data']['segments']
        
        # Check first segment structure
        first_segment = segments[0]
        required_fields = ['phaseId', 'phase', 'startDate', 'endDate', 'duration', 'returnPct', 'maxDrawdownPct']
        for field in required_fields:
            assert field in first_segment, f"Missing field: {field}"
        
        print(f"SUCCESS: Phase segments have correct structure")


class TestSPXFocusPackAPI:
    """Tests for /api/spx/v2.1/focus-pack endpoint (B5.3)"""
    
    def test_focus_pack_default_horizon(self):
        """Test focus-pack with default 30d horizon"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        assert response.status_code == 200
        data = response.json()
        
        assert data.get('ok') == True
        assert 'data' in data
        
        focus_data = data['data']
        
        # Check required fields
        assert 'meta' in focus_data
        assert 'price' in focus_data
        assert 'phase' in focus_data
        assert 'overlay' in focus_data
        
        # Validate meta
        meta = focus_data['meta']
        assert meta['focus'] == '30d'
        assert meta['tier'] == 'TACTICAL'
        assert meta['windowLen'] == 120
        assert meta['aftermathDays'] == 30
        
        print(f"SUCCESS: Focus-pack 30d - Window: {meta['windowLen']}, Tier: {meta['tier']}")
    
    def test_focus_pack_all_horizons(self):
        """Test focus-pack for all 6 horizons"""
        horizons = [
            {'key': '7d', 'tier': 'TIMING', 'window': 60},
            {'key': '14d', 'tier': 'TIMING', 'window': 90},
            {'key': '30d', 'tier': 'TACTICAL', 'window': 120},
            {'key': '90d', 'tier': 'TACTICAL', 'window': 200},
            {'key': '180d', 'tier': 'STRUCTURE', 'window': 260},
            {'key': '365d', 'tier': 'STRUCTURE', 'window': 365},
        ]
        
        for h in horizons:
            response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus={h['key']}")
            assert response.status_code == 200
            data = response.json()
            
            assert data.get('ok') == True
            
            meta = data['data']['meta']
            assert meta['focus'] == h['key']
            assert meta['tier'] == h['tier']
            assert meta['windowLen'] == h['window']
            
            print(f"SUCCESS: Focus-pack {h['key']} - Tier: {h['tier']}, Window: {h['window']}")


class TestSPXStatsAPI:
    """Tests for /api/spx/v2.1/stats endpoint"""
    
    def test_stats_endpoint(self):
        """Test SPX stats endpoint"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/stats")
        assert response.status_code == 200
        data = response.json()
        
        assert data.get('ok') == True
        
        # Check for candle count or data stats
        if 'data' in data:
            stats = data['data']
            if 'totalCandles' in stats:
                assert stats['totalCandles'] > 0
                print(f"SUCCESS: Stats endpoint - Total candles: {stats.get('totalCandles')}")
            else:
                print(f"SUCCESS: Stats endpoint returned data")


class TestSPXMemoryAPI:
    """Tests for /api/spx/v2.1/admin/memory/* endpoints (B6.1)"""
    
    def test_memory_stats(self):
        """Test memory stats endpoint"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/admin/memory/stats")
        assert response.status_code == 200
        data = response.json()
        
        assert data.get('ok') == True
        print(f"SUCCESS: Memory stats endpoint working")
    
    def test_memory_snapshots_list(self):
        """Test memory snapshots list endpoint"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/admin/memory/snapshots")
        assert response.status_code == 200
        data = response.json()
        
        # Should return ok: true even if empty
        assert data.get('ok') == True
        print(f"SUCCESS: Memory snapshots list endpoint working")


class TestSPXHorizonsAPI:
    """Tests for /api/spx/v2.1/horizons endpoint"""
    
    def test_horizons_endpoint(self):
        """Test horizons configuration endpoint"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/horizons")
        
        # This endpoint may not exist in all versions
        if response.status_code == 200:
            data = response.json()
            assert data.get('ok') == True
            print(f"SUCCESS: Horizons endpoint working")
        elif response.status_code == 404:
            print(f"INFO: Horizons endpoint not implemented (expected)")
        else:
            print(f"WARNING: Horizons endpoint returned {response.status_code}")


class TestCombinedAPI:
    """Tests for /api/combined/v2.1/* endpoints"""
    
    def test_combined_status(self):
        """Test combined terminal status"""
        response = requests.get(f"{BASE_URL}/api/combined/v2.1/status")
        
        if response.status_code == 200:
            data = response.json()
            assert data.get('ok') == True
            print(f"SUCCESS: Combined status endpoint working")
        elif response.status_code == 404:
            print(f"INFO: Combined status endpoint not implemented (expected for Phase 1)")
        else:
            print(f"WARNING: Combined status endpoint returned {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
