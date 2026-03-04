"""
BLOCK 76 - Consensus Pulse & Weekly Digest API Tests

Tests for:
- GET /api/fractal/v2.1/consensus-pulse - 7-day consensus pulse data
- GET /api/fractal/v2.1/admin/weekly-digest/preview - Preview weekly digest
- POST /api/fractal/v2.1/admin/weekly-digest/send - Send weekly digest
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestConsensusPulse:
    """Tests for Consensus Pulse endpoint (BLOCK 76.1)"""

    def test_consensus_pulse_returns_200(self):
        """Test consensus-pulse endpoint returns 200"""
        response = requests.get(
            f"{BASE_URL}/api/fractal/v2.1/consensus-pulse",
            params={"symbol": "BTC", "days": "7"}
        )
        assert response.status_code == 200
        print(f"✓ GET /api/fractal/v2.1/consensus-pulse returned 200")

    def test_consensus_pulse_response_structure(self):
        """Test consensus-pulse response has correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/fractal/v2.1/consensus-pulse",
            params={"symbol": "BTC", "days": "7"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Check required fields
        assert "symbol" in data, "Missing 'symbol' field"
        assert data["symbol"] == "BTC"
        assert "days" in data, "Missing 'days' field"
        assert "asof" in data, "Missing 'asof' field"
        assert "series" in data, "Missing 'series' field"
        assert "summary" in data, "Missing 'summary' field"
        print(f"✓ Response structure is valid - symbol: {data['symbol']}, days: {data['days']}")

    def test_consensus_pulse_summary_fields(self):
        """Test summary object contains required fields"""
        response = requests.get(
            f"{BASE_URL}/api/fractal/v2.1/consensus-pulse",
            params={"symbol": "BTC", "days": "7"}
        )
        assert response.status_code == 200
        data = response.json()
        summary = data.get("summary", {})
        
        assert "current" in summary, "Missing 'current' in summary"
        assert "delta7d" in summary, "Missing 'delta7d' in summary"
        assert "avgStructuralWeight" in summary, "Missing 'avgStructuralWeight' in summary"
        assert "lockDays" in summary, "Missing 'lockDays' in summary"
        assert "syncState" in summary, "Missing 'syncState' in summary"
        
        # Validate sync state is one of expected values
        valid_states = ["ALIGNING", "DIVERGING", "NEUTRAL", "STRUCTURAL_DOMINANCE"]
        assert summary["syncState"] in valid_states, f"Invalid syncState: {summary['syncState']}"
        print(f"✓ Summary valid - current: {summary['current']}, syncState: {summary['syncState']}")

    def test_consensus_pulse_series_structure(self):
        """Test series array items have correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/fractal/v2.1/consensus-pulse",
            params={"symbol": "BTC", "days": "7"}
        )
        assert response.status_code == 200
        data = response.json()
        series = data.get("series", [])
        
        if len(series) > 0:
            point = series[0]
            assert "date" in point, "Missing 'date' in series point"
            assert "consensusIndex" in point, "Missing 'consensusIndex' in series point"
            assert "structuralWeight" in point, "Missing 'structuralWeight' in series point"
            assert "divergenceScore" in point, "Missing 'divergenceScore' in series point"
            assert "divergenceGrade" in point, "Missing 'divergenceGrade' in series point"
            print(f"✓ Series structure valid - {len(series)} data points, first: {point['date']}")
        else:
            print("✓ Series is empty (acceptable - may indicate no snapshot data)")

    def test_consensus_pulse_btc_only(self):
        """Test that only BTC symbol is supported"""
        response = requests.get(
            f"{BASE_URL}/api/fractal/v2.1/consensus-pulse",
            params={"symbol": "ETH", "days": "7"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Should return error for non-BTC symbols
        assert data.get("error") == True
        assert data.get("message") == "BTC_ONLY"
        print("✓ BTC_ONLY restriction enforced correctly")


class TestWeeklyDigestPreview:
    """Tests for Weekly Digest Preview endpoint (BLOCK 76.2)"""

    def test_weekly_digest_preview_returns_200(self):
        """Test weekly-digest/preview endpoint returns 200"""
        response = requests.get(
            f"{BASE_URL}/api/fractal/v2.1/admin/weekly-digest/preview",
            params={"symbol": "BTC"}
        )
        assert response.status_code == 200
        print("✓ GET /api/fractal/v2.1/admin/weekly-digest/preview returned 200")

    def test_weekly_digest_preview_structure(self):
        """Test weekly digest preview response structure"""
        response = requests.get(
            f"{BASE_URL}/api/fractal/v2.1/admin/weekly-digest/preview",
            params={"symbol": "BTC"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "digest" in data, "Missing 'digest' field"
        assert "telegramPreview" in data, "Missing 'telegramPreview' field"
        print(f"✓ Preview structure valid - telegramPreview length: {len(data.get('telegramPreview', ''))}")

    def test_weekly_digest_payload_structure(self):
        """Test digest payload has correct structure"""
        response = requests.get(
            f"{BASE_URL}/api/fractal/v2.1/admin/weekly-digest/preview",
            params={"symbol": "BTC"}
        )
        assert response.status_code == 200
        data = response.json()
        digest = data.get("digest", {})
        
        # Check required fields
        assert "period" in digest, "Missing 'period' in digest"
        assert "consensus" in digest, "Missing 'consensus' in digest"
        assert "divergence" in digest, "Missing 'divergence' in digest"
        assert "attribution" in digest, "Missing 'attribution' in digest"
        assert "insights" in digest, "Missing 'insights' in digest"
        
        # Check period
        assert "from" in digest["period"], "Missing 'from' in period"
        assert "to" in digest["period"], "Missing 'to' in period"
        
        # Check consensus
        assert "current" in digest["consensus"], "Missing 'current' in consensus"
        assert "syncState" in digest["consensus"], "Missing 'syncState' in consensus"
        
        print(f"✓ Digest payload valid - period: {digest['period']['from']} to {digest['period']['to']}")

    def test_telegram_preview_contains_html(self):
        """Test telegram preview contains expected HTML formatting"""
        response = requests.get(
            f"{BASE_URL}/api/fractal/v2.1/admin/weekly-digest/preview",
            params={"symbol": "BTC"}
        )
        assert response.status_code == 200
        data = response.json()
        preview = data.get("telegramPreview", "")
        
        # Check for expected HTML tags
        assert "<b>" in preview, "Missing bold formatting in telegram preview"
        assert "Weekly Intelligence Digest" in preview, "Missing title in preview"
        print("✓ Telegram preview contains expected HTML formatting")


class TestWeeklyDigestSend:
    """Tests for Weekly Digest Send endpoint (BLOCK 76.2)"""

    def test_weekly_digest_send_returns_200(self):
        """Test weekly-digest/send endpoint returns 200"""
        response = requests.post(
            f"{BASE_URL}/api/fractal/v2.1/admin/weekly-digest/send",
            params={"symbol": "BTC"}
        )
        assert response.status_code == 200
        print("✓ POST /api/fractal/v2.1/admin/weekly-digest/send returned 200")

    def test_weekly_digest_send_response_structure(self):
        """Test send response has success/message fields"""
        response = requests.post(
            f"{BASE_URL}/api/fractal/v2.1/admin/weekly-digest/send",
            params={"symbol": "BTC"}
        )
        assert response.status_code == 200
        data = response.json()
        
        assert "success" in data, "Missing 'success' field"
        assert "message" in data, "Missing 'message' field"
        
        # Note: FRACTAL_ALERTS_ENABLED may be true or false
        # If true - should send; if false - should return appropriate message
        print(f"✓ Send response valid - success: {data['success']}, message: {data['message']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
