"""
SPX Core BLOCK B5.2 - Backend API Tests
Tests for SPX 30d Full Engine - Fractal Analysis for S&P 500

Endpoints:
- GET /api/spx/v2.1/focus-pack?focus=30d — full focus-pack with matches, overlay, forecast, divergence
- GET /api/spx/v2.1/horizons — list of all available horizons
- GET /api/spx/v2.1/quick-scan?focus=30d — lightweight scan
- GET /api/spx/v2.1/core/terminal — terminal data
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSpxCoreBlockB52:
    """SPX Core BLOCK B5.2 API Tests"""
    
    # ═══════════════════════════════════════════════════════════════
    # HORIZONS ENDPOINT
    # ═══════════════════════════════════════════════════════════════
    
    def test_horizons_endpoint_status(self):
        """GET /api/spx/v2.1/horizons - Returns status 200"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/horizons")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
    def test_horizons_endpoint_structure(self):
        """GET /api/spx/v2.1/horizons - Returns correct structure"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/horizons")
        data = response.json()
        
        # Check top level structure
        assert data.get("ok") == True, "Expected ok=true"
        assert data.get("symbol") == "SPX", "Expected symbol=SPX"
        assert "horizons" in data, "Expected horizons array"
        
        # Check horizons array
        horizons = data.get("horizons", [])
        assert len(horizons) >= 6, f"Expected at least 6 horizons, got {len(horizons)}"
        
        # Check expected horizons exist
        horizon_keys = [h["key"] for h in horizons]
        expected_keys = ["7d", "14d", "30d", "90d", "180d", "365d"]
        for key in expected_keys:
            assert key in horizon_keys, f"Expected horizon {key} not found"
            
    def test_horizons_30d_config(self):
        """GET /api/spx/v2.1/horizons - 30d horizon has correct config"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/horizons")
        data = response.json()
        
        horizons = data.get("horizons", [])
        h30d = next((h for h in horizons if h["key"] == "30d"), None)
        
        assert h30d is not None, "30d horizon not found"
        assert h30d.get("tier") == "TACTICAL", f"Expected tier=TACTICAL, got {h30d.get('tier')}"
        assert h30d.get("windowLen") == 30, f"Expected windowLen=30, got {h30d.get('windowLen')}"
        assert h30d.get("aftermathDays") == 30, f"Expected aftermathDays=30, got {h30d.get('aftermathDays')}"
    
    # ═══════════════════════════════════════════════════════════════
    # TERMINAL ENDPOINT
    # ═══════════════════════════════════════════════════════════════
    
    def test_terminal_endpoint_status(self):
        """GET /api/spx/v2.1/core/terminal - Returns status 200"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/core/terminal")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
    def test_terminal_endpoint_structure(self):
        """GET /api/spx/v2.1/core/terminal - Returns correct structure"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/core/terminal")
        data = response.json()
        
        assert data.get("ok") == True, "Expected ok=true"
        assert data.get("symbol") == "SPX", "Expected symbol=SPX"
        assert data.get("status") == "OPERATIONAL", f"Expected status=OPERATIONAL, got {data.get('status')}"
        assert "data" in data, "Expected data object"
        
    def test_terminal_meta_structure(self):
        """GET /api/spx/v2.1/core/terminal - Meta has correct fields"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/core/terminal")
        data = response.json()
        
        meta = data.get("data", {}).get("meta", {})
        assert meta.get("symbol") == "SPX", f"Expected symbol=SPX, got {meta.get('symbol')}"
        assert meta.get("totalCandles") > 19000, f"Expected > 19000 candles, got {meta.get('totalCandles')}"
        assert "latestDate" in meta, "Expected latestDate field"
        assert "version" in meta, "Expected version field"
        
    def test_terminal_price_data(self):
        """GET /api/spx/v2.1/core/terminal - Price data is valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/core/terminal")
        data = response.json()
        
        price = data.get("data", {}).get("price", {})
        assert price.get("current") > 0, f"Expected positive current price, got {price.get('current')}"
        assert price.get("sma50") > 0, f"Expected positive sma50, got {price.get('sma50')}"
        assert price.get("sma200") > 0, f"Expected positive sma200, got {price.get('sma200')}"
        assert "change1d" in price, "Expected change1d field"
        assert "change7d" in price, "Expected change7d field"
        assert "change30d" in price, "Expected change30d field"
        
    def test_terminal_phase_data(self):
        """GET /api/spx/v2.1/core/terminal - Phase data is valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/core/terminal")
        data = response.json()
        
        phase = data.get("data", {}).get("phase", {})
        assert "phase" in phase, "Expected phase field"
        assert phase.get("phase") in ["ACCUMULATION", "MARKUP", "DISTRIBUTION", "MARKDOWN", "NEUTRAL"], \
            f"Unexpected phase: {phase.get('phase')}"
        
    def test_terminal_horizons_list(self):
        """GET /api/spx/v2.1/core/terminal - Horizons list included"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/core/terminal")
        data = response.json()
        
        horizons = data.get("data", {}).get("horizons", [])
        assert len(horizons) >= 6, f"Expected at least 6 horizons, got {len(horizons)}"
        
        # Check that each horizon has endpoint
        for h in horizons:
            assert "endpoint" in h, f"Horizon {h.get('key')} missing endpoint"
            assert "/api/spx/v2.1/focus-pack" in h.get("endpoint", ""), \
                f"Unexpected endpoint format: {h.get('endpoint')}"
    
    # ═══════════════════════════════════════════════════════════════
    # QUICK-SCAN ENDPOINT
    # ═══════════════════════════════════════════════════════════════
    
    def test_quick_scan_status(self):
        """GET /api/spx/v2.1/quick-scan?focus=30d - Returns status 200"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/quick-scan?focus=30d")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
    def test_quick_scan_structure(self):
        """GET /api/spx/v2.1/quick-scan?focus=30d - Returns correct structure"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/quick-scan?focus=30d")
        data = response.json()
        
        assert data.get("ok") == True, "Expected ok=true"
        assert data.get("symbol") == "SPX", "Expected symbol=SPX"
        assert data.get("focus") == "30d", f"Expected focus=30d, got {data.get('focus')}"
        assert "summary" in data, "Expected summary object"
        assert "primaryMatch" in data, "Expected primaryMatch"
        
    def test_quick_scan_summary_fields(self):
        """GET /api/spx/v2.1/quick-scan?focus=30d - Summary has all fields"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/quick-scan?focus=30d")
        data = response.json()
        
        summary = data.get("summary", {})
        required_fields = [
            "matchCount", "topSimilarity", "medianReturn", 
            "hitRate", "phase", "divergenceGrade", "qualityScore"
        ]
        for field in required_fields:
            assert field in summary, f"Summary missing field: {field}"
            
        # Validate values
        assert summary.get("matchCount") > 0, "Expected matchCount > 0"
        assert 0 <= summary.get("topSimilarity", 0) <= 100, "topSimilarity should be 0-100"
        assert 0 <= summary.get("hitRate", 0) <= 1, "hitRate should be 0-1"
        assert summary.get("divergenceGrade") in ["A", "B", "C", "D", "F"], \
            f"Unexpected grade: {summary.get('divergenceGrade')}"
            
    def test_quick_scan_primary_match(self):
        """GET /api/spx/v2.1/quick-scan?focus=30d - Primary match data valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/quick-scan?focus=30d")
        data = response.json()
        
        pm = data.get("primaryMatch")
        assert pm is not None, "Expected primaryMatch object"
        assert "id" in pm, "primaryMatch missing id"
        assert "similarity" in pm, "primaryMatch missing similarity"
        assert "return" in pm, "primaryMatch missing return"
        assert "selectionReason" in pm, "primaryMatch missing selectionReason"
        
        # ID should be YYYY-MM-DD format
        import re
        assert re.match(r"\d{4}-\d{2}-\d{2}", pm.get("id", "")), \
            f"Unexpected id format: {pm.get('id')}"
            
    def test_quick_scan_invalid_horizon(self):
        """GET /api/spx/v2.1/quick-scan?focus=invalid - Returns error 400"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/quick-scan?focus=invalid")
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        
        data = response.json()
        assert data.get("ok") == False, "Expected ok=false for invalid horizon"
    
    # ═══════════════════════════════════════════════════════════════
    # FOCUS-PACK ENDPOINT (MAIN ENDPOINT)
    # ═══════════════════════════════════════════════════════════════
    
    def test_focus_pack_status(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Returns status 200"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
    def test_focus_pack_top_level_structure(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Top level structure correct"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        data = response.json()
        
        assert data.get("ok") == True, "Expected ok=true"
        assert data.get("symbol") == "SPX", "Expected symbol=SPX"
        assert data.get("focus") == "30d", f"Expected focus=30d, got {data.get('focus')}"
        assert "processingTimeMs" in data, "Expected processingTimeMs"
        assert "data" in data, "Expected data object"
        
    def test_focus_pack_data_structure(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Data contains all required sections"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        data = response.json().get("data", {})
        
        required_sections = [
            "meta", "price", "phase", "overlay", "forecast",
            "primarySelection", "normalizedSeries", "divergence", "diagnostics"
        ]
        for section in required_sections:
            assert section in data, f"Data missing section: {section}"
            
    def test_focus_pack_meta(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Meta section valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        meta = response.json().get("data", {}).get("meta", {})
        
        assert meta.get("symbol") == "SPX", f"Expected symbol=SPX, got {meta.get('symbol')}"
        assert meta.get("focus") == "30d", f"Expected focus=30d, got {meta.get('focus')}"
        assert meta.get("windowLen") == 30, f"Expected windowLen=30, got {meta.get('windowLen')}"
        assert meta.get("aftermathDays") == 30, f"Expected aftermathDays=30, got {meta.get('aftermathDays')}"
        assert meta.get("tier") == "TACTICAL", f"Expected tier=TACTICAL, got {meta.get('tier')}"
        assert meta.get("topK") == 25, f"Expected topK=25, got {meta.get('topK')}"
        
    def test_focus_pack_price(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Price section valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        price = response.json().get("data", {}).get("price", {})
        
        assert price.get("current") > 0, f"Expected positive price, got {price.get('current')}"
        assert price.get("sma50") > 0, "sma50 should be positive"
        assert price.get("sma200") > 0, "sma200 should be positive"
        
        # Changes should be reasonable (-50% to +50%)
        for field in ["change1d", "change7d", "change30d"]:
            val = price.get(field)
            assert -50 < val < 50, f"{field} seems unreasonable: {val}"
            
    def test_focus_pack_phase(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Phase section valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        phase = response.json().get("data", {}).get("phase", {})
        
        valid_phases = ["ACCUMULATION", "MARKUP", "DISTRIBUTION", "MARKDOWN", "NEUTRAL"]
        assert phase.get("phase") in valid_phases, f"Unexpected phase: {phase.get('phase')}"
        assert 0 <= phase.get("strength", 0) <= 1, "strength should be 0-1"
        assert -1 <= phase.get("momentum", 0) <= 1, "momentum should be -1 to 1"
        
    def test_focus_pack_overlay_matches(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Overlay.matches valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        overlay = response.json().get("data", {}).get("overlay", {})
        
        matches = overlay.get("matches", [])
        assert len(matches) > 0, "Expected at least 1 match"
        assert len(matches) <= 25, f"Expected max 25 matches (topK), got {len(matches)}"
        
        # Check first match structure
        first = matches[0]
        required_fields = [
            "id", "similarity", "correlation", "phase", "volatilityMatch",
            "stabilityScore", "windowNormalized", "aftermathNormalized",
            "return", "maxDrawdown", "maxExcursion", "cohort"
        ]
        for field in required_fields:
            assert field in first, f"Match missing field: {field}"
            
        # Check values
        assert 0 <= first.get("similarity", 0) <= 100, "similarity should be 0-100"
        assert -1 <= first.get("correlation", 0) <= 1, "correlation should be -1 to 1"
        assert len(first.get("windowNormalized", [])) == 30, "windowNormalized should have 30 elements"
        assert len(first.get("aftermathNormalized", [])) == 30, "aftermathNormalized should have 30 elements"
        
    def test_focus_pack_overlay_stats(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Overlay.stats valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        stats = response.json().get("data", {}).get("overlay", {}).get("stats", {})
        
        required_fields = [
            "medianReturn", "p10Return", "p90Return", 
            "avgMaxDD", "hitRate", "sampleSize"
        ]
        for field in required_fields:
            assert field in stats, f"Stats missing field: {field}"
            
        assert 0 <= stats.get("hitRate", 0) <= 1, "hitRate should be 0-1"
        assert stats.get("sampleSize") > 0, "sampleSize should be positive"
        
    def test_focus_pack_overlay_distribution(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Overlay.distributionSeries valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        dist = response.json().get("data", {}).get("overlay", {}).get("distributionSeries", {})
        
        percentiles = ["p10", "p25", "p50", "p75", "p90"]
        for p in percentiles:
            assert p in dist, f"distributionSeries missing {p}"
            assert len(dist[p]) == 30, f"{p} should have 30 elements, got {len(dist[p])}"
            
    def test_focus_pack_forecast(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Forecast section valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        forecast = response.json().get("data", {}).get("forecast", {})
        
        required_fields = [
            "path", "upperBand", "lowerBand", "confidenceDecay",
            "markers", "tailFloor", "currentPrice", "startTs"
        ]
        for field in required_fields:
            assert field in forecast, f"Forecast missing field: {field}"
            
        # Arrays should have 30 elements (aftermathDays)
        assert len(forecast.get("path", [])) == 30, "path should have 30 elements"
        assert len(forecast.get("upperBand", [])) == 30, "upperBand should have 30 elements"
        assert len(forecast.get("lowerBand", [])) == 30, "lowerBand should have 30 elements"
        
        # Price data should be reasonable (within 50% of current)
        current = forecast.get("currentPrice", 0)
        for p in forecast.get("path", []):
            assert current * 0.5 < p < current * 1.5, f"Path price {p} unreasonable vs current {current}"
            
    def test_focus_pack_primary_selection(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - PrimarySelection valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        ps = response.json().get("data", {}).get("primarySelection", {})
        
        assert "primaryMatch" in ps, "primarySelection missing primaryMatch"
        assert "candidateCount" in ps, "primarySelection missing candidateCount"
        assert "selectionMethod" in ps, "primarySelection missing selectionMethod"
        
        pm = ps.get("primaryMatch")
        assert pm is not None, "primaryMatch should not be null"
        
        # Check primaryMatch specific fields
        assert "selectionScore" in pm, "primaryMatch missing selectionScore"
        assert "selectionRank" in pm, "primaryMatch missing selectionRank"
        assert "scores" in pm, "primaryMatch missing scores"
        assert "selectionReason" in pm, "primaryMatch missing selectionReason"
        
        # Check scores object
        scores = pm.get("scores", {})
        expected_scores = [
            "similarity", "volatilityAlignment", "stabilityScore",
            "outcomeQuality", "recencyBonus"
        ]
        for s in expected_scores:
            assert s in scores, f"scores missing {s}"
            
    def test_focus_pack_divergence(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Divergence section valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        div = response.json().get("data", {}).get("divergence", {})
        
        required_fields = [
            "horizonDays", "mode", "rmse", "mape", "maxAbsDev",
            "terminalDelta", "directionalMismatch", "corr",
            "score", "grade", "flags", "samplePoints"
        ]
        for field in required_fields:
            assert field in div, f"Divergence missing field: {field}"
            
        assert div.get("horizonDays") == 30, f"Expected horizonDays=30, got {div.get('horizonDays')}"
        assert div.get("mode") in ["RAW", "PERCENT"], f"Unexpected mode: {div.get('mode')}"
        assert div.get("grade") in ["A", "B", "C", "D", "F"], f"Unexpected grade: {div.get('grade')}"
        assert 0 <= div.get("score", 0) <= 100, "score should be 0-100"
        
    def test_focus_pack_diagnostics(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Diagnostics section valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        diag = response.json().get("data", {}).get("diagnostics", {})
        
        required_fields = [
            "sampleSize", "effectiveN", "entropy", "reliability",
            "coverageYears", "qualityScore", "scanTimeMs", "totalTimeMs"
        ]
        for field in required_fields:
            assert field in diag, f"Diagnostics missing field: {field}"
            
        assert diag.get("sampleSize") > 0, "sampleSize should be positive"
        assert diag.get("coverageYears") > 70, f"Expected 70+ years coverage, got {diag.get('coverageYears')}"
        assert 0 <= diag.get("qualityScore", 0) <= 1, "qualityScore should be 0-1"
        
    def test_focus_pack_invalid_horizon(self):
        """GET /api/spx/v2.1/focus-pack?focus=invalid - Returns error 400"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=invalid")
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        
        data = response.json()
        assert data.get("ok") == False, "Expected ok=false for invalid horizon"
        assert "error" in data, "Expected error message"
        
    def test_focus_pack_different_horizons(self):
        """GET /api/spx/v2.1/focus-pack - Works for all valid horizons"""
        horizons = ["7d", "14d", "30d", "90d"]
        
        for h in horizons:
            response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus={h}")
            assert response.status_code == 200, f"Horizon {h} failed: status {response.status_code}"
            
            data = response.json()
            assert data.get("ok") == True, f"Horizon {h}: expected ok=true"
            assert data.get("focus") == h, f"Horizon {h}: focus mismatch"
            
    def test_focus_pack_normalized_series(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - NormalizedSeries valid"""
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        ns = response.json().get("data", {}).get("normalizedSeries", {})
        
        required_fields = [
            "mode", "basePrice", "rawPath", "percentPath",
            "rawUpperBand", "rawLowerBand", "percentUpperBand", "percentLowerBand",
            "rawReplay", "percentReplay", "yRange"
        ]
        for field in required_fields:
            assert field in ns, f"NormalizedSeries missing field: {field}"
            
        assert ns.get("mode") in ["RAW", "PERCENT"], f"Unexpected mode: {ns.get('mode')}"
        assert ns.get("basePrice") > 0, "basePrice should be positive"
        
        # yRange should have min/max values
        yr = ns.get("yRange", {})
        assert "minPercent" in yr, "yRange missing minPercent"
        assert "maxPercent" in yr, "yRange missing maxPercent"
        assert "minPrice" in yr, "yRange missing minPrice"
        assert "maxPrice" in yr, "yRange missing maxPrice"


class TestSpxCorePerformance:
    """Performance tests for SPX Core endpoints"""
    
    def test_focus_pack_response_time(self):
        """GET /api/spx/v2.1/focus-pack?focus=30d - Response time under 5 seconds"""
        import time
        
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        elapsed = time.time() - start
        
        assert response.status_code == 200, f"Request failed: {response.status_code}"
        assert elapsed < 5, f"Response too slow: {elapsed:.2f}s (expected < 5s)"
        
    def test_quick_scan_faster_than_focus_pack(self):
        """Quick scan should be faster than full focus-pack"""
        import time
        
        # Quick scan
        start = time.time()
        requests.get(f"{BASE_URL}/api/spx/v2.1/quick-scan?focus=30d")
        quick_time = time.time() - start
        
        # Focus pack
        start = time.time()
        requests.get(f"{BASE_URL}/api/spx/v2.1/focus-pack?focus=30d")
        full_time = time.time() - start
        
        # Quick should be at least somewhat faster (allow some variance)
        assert quick_time <= full_time * 1.1, \
            f"Quick scan ({quick_time:.2f}s) not faster than focus-pack ({full_time:.2f}s)"


# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
