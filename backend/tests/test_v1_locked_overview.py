"""
V1 LOCKED Overview API Tests
Tests the V1 LOCKED requirements for Fractal Platform:
1. History starts from 2026-01-01 
2. BTC crossAsset snapshots required (no fallback)
3. Overview reads only from prediction_snapshots
4. Anchor Lock: anchorTime == lastCandleTime
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestV1AuditEndpoint:
    """V1 LOCKED audit endpoint should return 100% pass rate"""
    
    def test_v1_audit_returns_all_pass(self):
        """Verify V1 audit endpoint returns 100% pass rate"""
        response = requests.get(f"{BASE_URL}/api/audit/v1-check")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data['ok'] == True, "Audit should return ok=true"
        
        # Check 100% pass rate
        summary = data.get('summary', {})
        assert summary.get('passRate') == 100, f"Expected 100% pass rate, got {summary.get('passRate')}%"
        assert summary.get('status') == 'ALL_PASS', f"Expected ALL_PASS, got {summary.get('status')}"
        assert summary.get('grade') == 'A', f"Expected grade A, got {summary.get('grade')}"
        
    def test_v1_audit_all_checks_pass(self):
        """Verify all individual V1 checks pass"""
        response = requests.get(f"{BASE_URL}/api/audit/v1-check")
        data = response.json()
        
        checks = data.get('checks', [])
        assert len(checks) == 10, f"Expected 10 checks, got {len(checks)}"
        
        failed_checks = [c for c in checks if not c.get('passed')]
        assert len(failed_checks) == 0, f"Failed checks: {[c['name'] for c in failed_checks]}"
        

class TestOverviewSPX:
    """SPX Overview API tests"""
    
    def test_spx_overview_returns_correct_asset(self):
        """SPX overview returns SPX data (not mixed with other assets)"""
        response = requests.get(f"{BASE_URL}/api/ui/overview?asset=spx&horizon=90")
        assert response.status_code == 200
        
        data = response.json()
        assert data['ok'] == True
        assert data['asset'] == 'spx', f"Expected asset=spx, got {data['asset']}"
        
    def test_spx_overview_has_charts_data(self):
        """SPX overview has proper charts with actual and predicted data"""
        response = requests.get(f"{BASE_URL}/api/ui/overview?asset=spx&horizon=90")
        data = response.json()
        
        charts = data.get('charts', {})
        actual_len = len(charts.get('actual', []))
        predicted_len = len(charts.get('predicted', []))
        
        assert actual_len > 0, f"Expected actual charts data, got {actual_len}"
        assert predicted_len >= 45, f"Expected >= 45 predicted points for 90d horizon, got {predicted_len}"
        
    def test_spx_overview_has_verdict(self):
        """SPX overview has complete verdict data"""
        response = requests.get(f"{BASE_URL}/api/ui/overview?asset=spx&horizon=90")
        data = response.json()
        
        verdict = data.get('verdict', {})
        assert 'stance' in verdict, "Verdict should have stance"
        assert 'actionHint' in verdict, "Verdict should have actionHint"
        assert 'confidencePct' in verdict, "Verdict should have confidencePct"
        assert verdict['stance'] in ['BULLISH', 'BEARISH', 'HOLD'], f"Invalid stance: {verdict['stance']}"


class TestOverviewBTC:
    """BTC Overview API tests - V1 LOCKED requires crossAsset snapshots"""
    
    def test_btc_overview_returns_correct_asset(self):
        """BTC overview returns BTC data"""
        response = requests.get(f"{BASE_URL}/api/ui/overview?asset=btc&horizon=90")
        assert response.status_code == 200
        
        data = response.json()
        assert data['ok'] == True
        assert data['asset'] == 'btc', f"Expected asset=btc, got {data['asset']}"
        
    def test_btc_overview_has_charts_data(self):
        """BTC overview has proper charts with actual and predicted data"""
        response = requests.get(f"{BASE_URL}/api/ui/overview?asset=btc&horizon=90")
        data = response.json()
        
        charts = data.get('charts', {})
        actual_len = len(charts.get('actual', []))
        predicted_len = len(charts.get('predicted', []))
        
        assert actual_len > 0, f"Expected actual charts data, got {actual_len}"
        assert predicted_len >= 45, f"Expected >= 45 predicted points for 90d horizon, got {predicted_len}"
        
    def test_btc_overview_uses_crossasset(self):
        """BTC overview should use crossAsset view (V1 LOCKED requirement)"""
        # Verify BTC crossAsset snapshot exists via audit check
        response = requests.get(f"{BASE_URL}/api/audit/v1-check")
        data = response.json()
        
        btc_crossasset_check = next((c for c in data['checks'] if c['name'] == 'BTC_CROSSASSET_REQUIRED'), None)
        assert btc_crossasset_check is not None, "BTC_CROSSASSET_REQUIRED check should exist"
        assert btc_crossasset_check['passed'] == True, "BTC crossAsset snapshot must exist"


class TestOverviewDXY:
    """DXY Overview API tests"""
    
    def test_dxy_overview_returns_correct_asset(self):
        """DXY overview returns DXY data (not mixed with other assets)"""
        response = requests.get(f"{BASE_URL}/api/ui/overview?asset=dxy&horizon=90")
        assert response.status_code == 200
        
        data = response.json()
        assert data['ok'] == True
        assert data['asset'] == 'dxy', f"Expected asset=dxy, got {data['asset']}"
        
    def test_dxy_overview_has_charts_data(self):
        """DXY overview has proper charts with actual and predicted data"""
        response = requests.get(f"{BASE_URL}/api/ui/overview?asset=dxy&horizon=90")
        data = response.json()
        
        charts = data.get('charts', {})
        actual_len = len(charts.get('actual', []))
        predicted_len = len(charts.get('predicted', []))
        
        assert actual_len > 0, f"Expected actual charts data, got {actual_len}"
        assert predicted_len >= 45, f"Expected >= 45 predicted points for 90d horizon, got {predicted_len}"
        
    def test_dxy_values_in_correct_range(self):
        """DXY values should be in typical DXY range (90-130), not SPX range (5000+)"""
        response = requests.get(f"{BASE_URL}/api/ui/overview?asset=dxy&horizon=90")
        data = response.json()
        
        charts = data.get('charts', {})
        actual = charts.get('actual', [])
        
        if actual:
            # Check first and last actual values are in DXY range (not SPX range)
            first_val = actual[0].get('v', 0)
            last_val = actual[-1].get('v', 0)
            
            assert 80 < first_val < 150, f"DXY first value {first_val} should be in 80-150 range"
            assert 80 < last_val < 150, f"DXY last value {last_val} should be in 80-150 range"


class TestSnapshotGenerators:
    """Test BTC crossAsset and DXY snapshot generators"""
    
    def test_btc_crossasset_generator_works(self):
        """POST /api/ui/generate-btc-crossasset should generate valid snapshot"""
        response = requests.post(f"{BASE_URL}/api/ui/generate-btc-crossasset?horizon=90")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data['ok'] == True
        assert data['snapshot']['asset'] == 'BTC'
        assert data['snapshot']['view'] == 'crossAsset'
        assert data['snapshot']['seriesLength'] > 0
        assert data['snapshot']['anchorIndex'] > 0
        
    def test_dxy_snapshot_generator_works(self):
        """POST /api/ui/generate-dxy-snapshot should generate valid snapshot"""
        response = requests.post(f"{BASE_URL}/api/ui/generate-dxy-snapshot?horizon=90")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data['ok'] == True
        assert data['snapshot']['asset'] == 'DXY'
        assert data['snapshot']['view'] == 'hybrid'
        assert data['snapshot']['seriesLength'] > 0
        assert data['snapshot']['anchorIndex'] > 0


class TestHistoryStartDate:
    """V1 LOCKED: All assets history should start from 2026-01-01"""
    
    def test_btc_history_starts_from_fixed_date(self):
        """BTC history should start from 2026-01-01"""
        response = requests.get(f"{BASE_URL}/api/audit/v1-check")
        data = response.json()
        
        btc_check = next((c for c in data['checks'] if c['name'] == 'HISTORY_START_BTC'), None)
        assert btc_check is not None
        assert btc_check['passed'] == True
        assert btc_check['actual'] == '2026-01-01'
        
    def test_spx_history_starts_from_fixed_date(self):
        """SPX history should start from 2026-01-01 or 2026-01-02 (market holiday)"""
        response = requests.get(f"{BASE_URL}/api/audit/v1-check")
        data = response.json()
        
        spx_check = next((c for c in data['checks'] if c['name'] == 'HISTORY_START_SPX'), None)
        assert spx_check is not None
        assert spx_check['passed'] == True
        assert spx_check['actual'] in ['2026-01-01', '2026-01-02']
        
    def test_dxy_history_starts_from_fixed_date(self):
        """DXY history should start from 2026-01-01 or 2026-01-02 (market holiday)"""
        response = requests.get(f"{BASE_URL}/api/audit/v1-check")
        data = response.json()
        
        dxy_check = next((c for c in data['checks'] if c['name'] == 'HISTORY_START_DXY'), None)
        assert dxy_check is not None
        assert dxy_check['passed'] == True
        assert dxy_check['actual'] in ['2026-01-01', '2026-01-02']


class TestAnchorLock:
    """V1 LOCKED: anchorTime == lastCandleTime"""
    
    def test_btc_anchor_lock(self):
        """BTC anchor should be synced with asOf date"""
        response = requests.get(f"{BASE_URL}/api/audit/v1-check")
        data = response.json()
        
        btc_check = next((c for c in data['checks'] if c['name'] == 'ANCHOR_LOCK_BTC'), None)
        assert btc_check is not None
        assert btc_check['passed'] == True
        
    def test_spx_anchor_lock(self):
        """SPX anchor should be synced with asOf date"""
        response = requests.get(f"{BASE_URL}/api/audit/v1-check")
        data = response.json()
        
        spx_check = next((c for c in data['checks'] if c['name'] == 'ANCHOR_LOCK_SPX'), None)
        assert spx_check is not None
        assert spx_check['passed'] == True
        
    def test_dxy_anchor_lock(self):
        """DXY anchor should be synced with asOf date"""
        response = requests.get(f"{BASE_URL}/api/audit/v1-check")
        data = response.json()
        
        dxy_check = next((c for c in data['checks'] if c['name'] == 'ANCHOR_LOCK_DXY'), None)
        assert dxy_check is not None
        assert dxy_check['passed'] == True


class TestHealthEndpoint:
    """Basic health check"""
    
    def test_health_endpoint(self):
        """Health endpoint should return OK"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data['status'] == 'ok'
        assert data['ts_backend']['ok'] == True
