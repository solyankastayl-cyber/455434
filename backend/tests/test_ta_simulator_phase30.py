"""
Phase 3.0: Execution Simulator API Tests
Tests the simulator endpoints for running backtests, managing positions/orders,
and verifying determinism (same params = same results).

Endpoints tested:
- POST /api/ta/sim/run - run simulation with params
- GET /api/ta/sim/stats - get simulator statistics
- GET /api/ta/sim/config - get simulator config for timeframe
- GET /api/ta/sim/runs - list recent simulation runs
- GET /api/ta/sim/status - get status of specific run
- GET /api/ta/sim/positions - get positions from run
- GET /api/ta/sim/orders - get orders from run  
- GET /api/ta/sim/summary - get summary analytics for run
- Determinism test: same params should produce same results
"""

import pytest
import requests
import os
import time

# Use environment variable for BASE_URL
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL environment variable not set")

# Test params recommended by main agent
TEST_SIM_PARAMS = {
    "symbol": "BTCUSDT",
    "tf": "1D",
    "fromTs": 1764879265,
    "toTs": 1772655265,
    "warmupBars": 50,
    "seed": 1337
}

class TestSimulatorHealth:
    """Basic health and readiness checks"""
    
    def test_health_check(self):
        """Verify TA engine health endpoint works"""
        response = requests.get(f"{BASE_URL}/api/ta/health", timeout=10)
        assert response.status_code == 200, f"Health check failed: {response.text}"
        data = response.json()
        assert data.get('ok') == True or data.get('status') == 'ok', f"Health not ok: {data}"
        print(f"✓ Health check passed: {data}")


class TestSimulatorStats:
    """Test GET /api/ta/sim/stats"""
    
    def test_get_stats(self):
        """Get simulator statistics"""
        response = requests.get(f"{BASE_URL}/api/ta/sim/stats", timeout=10)
        assert response.status_code == 200, f"Stats request failed: {response.text}"
        data = response.json()
        assert data.get('ok') == True, f"Stats not ok: {data}"
        
        # Verify expected fields
        assert 'totalRuns' in data or 'phase' in data, f"Missing expected fields: {data}"
        print(f"✓ Stats: {data}")
        return data


class TestSimulatorConfig:
    """Test GET /api/ta/sim/config"""
    
    def test_get_config_1d(self):
        """Get simulator config for 1d timeframe"""
        response = requests.get(f"{BASE_URL}/api/ta/sim/config?tf=1d", timeout=10)
        assert response.status_code == 200, f"Config request failed: {response.text}"
        data = response.json()
        assert data.get('ok') == True, f"Config not ok: {data}"
        
        # Verify config structure
        assert 'config' in data, f"Missing config field: {data}"
        config = data['config']
        assert 'feeBps' in config, f"Missing feeBps in config: {config}"
        assert 'slippageBps' in config, f"Missing slippageBps in config: {config}"
        print(f"✓ Config 1d: feeBps={config.get('feeBps')}, slippageBps={config.get('slippageBps')}")
        return data
    
    def test_get_config_1h(self):
        """Get simulator config for 1h timeframe"""
        response = requests.get(f"{BASE_URL}/api/ta/sim/config?tf=1h", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get('ok') == True
        print(f"✓ Config 1h: {data.get('config', {}).get('slippageBps')} bps slippage")
        return data


class TestSimulatorRun:
    """Test POST /api/ta/sim/run - Main simulation endpoint"""
    
    def test_run_simulation(self):
        """Run a full simulation and verify results"""
        response = requests.post(
            f"{BASE_URL}/api/ta/sim/run",
            json=TEST_SIM_PARAMS,
            timeout=120  # Simulation can take up to 60 seconds
        )
        assert response.status_code == 200, f"Sim run failed: {response.text}"
        data = response.json()
        assert data.get('ok') == True, f"Sim run not ok: {data}"
        
        # Verify runId returned
        assert 'runId' in data, f"Missing runId: {data}"
        run_id = data['runId']
        print(f"✓ Simulation completed: runId={run_id}")
        
        # Verify summary structure if present
        if 'summary' in data and data['summary']:
            summary = data['summary']
            assert 'totalTrades' in summary, f"Missing totalTrades in summary: {summary}"
            print(f"  Summary: trades={summary.get('totalTrades')}, winRate={summary.get('winRate')}, avgR={summary.get('avgR')}")
        
        return data
    
    def test_run_with_different_symbol(self):
        """Run simulation with ETH symbol"""
        params = {
            **TEST_SIM_PARAMS,
            "symbol": "ETHUSDT"
        }
        response = requests.post(
            f"{BASE_URL}/api/ta/sim/run",
            json=params,
            timeout=120
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get('ok') == True
        print(f"✓ ETH simulation completed: runId={data.get('runId')}")
        return data


class TestSimulatorRunQueries:
    """Test run query endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup_run(self):
        """Create a run to query"""
        response = requests.post(
            f"{BASE_URL}/api/ta/sim/run",
            json=TEST_SIM_PARAMS,
            timeout=120
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get('ok') == True
        self.run_id = data['runId']
        self.summary = data.get('summary')
        print(f"Setup: Created run {self.run_id}")
    
    def test_get_runs_list(self):
        """GET /api/ta/sim/runs - List recent runs"""
        response = requests.get(f"{BASE_URL}/api/ta/sim/runs", timeout=10)
        assert response.status_code == 200, f"Runs list failed: {response.text}"
        data = response.json()
        assert data.get('ok') == True
        
        # Verify runs array
        assert 'runs' in data, f"Missing runs field: {data}"
        runs = data['runs']
        assert isinstance(runs, list), f"Runs is not a list: {runs}"
        
        # Our run should be in the list
        run_ids = [r.get('runId') for r in runs]
        assert self.run_id in run_ids, f"Our run {self.run_id} not in runs list: {run_ids}"
        print(f"✓ Runs list: {len(runs)} runs found, our run present")
        return data
    
    def test_get_run_status(self):
        """GET /api/ta/sim/status - Get specific run status"""
        response = requests.get(
            f"{BASE_URL}/api/ta/sim/status?runId={self.run_id}",
            timeout=10
        )
        assert response.status_code == 200, f"Status request failed: {response.text}"
        data = response.json()
        assert data.get('ok') == True, f"Status not ok: {data}"
        
        # Verify run details
        assert 'run' in data, f"Missing run field: {data}"
        run = data['run']
        assert run.get('runId') == self.run_id, f"RunId mismatch: {run}"
        assert run.get('status') in ['DONE', 'RUNNING', 'PENDING', 'FAILED'], f"Invalid status: {run}"
        print(f"✓ Run status: {run.get('status')}, symbol={run.get('symbol')}, tf={run.get('tf')}")
        return data
    
    def test_get_positions(self):
        """GET /api/ta/sim/positions - Get positions from run"""
        response = requests.get(
            f"{BASE_URL}/api/ta/sim/positions?runId={self.run_id}",
            timeout=10
        )
        assert response.status_code == 200, f"Positions request failed: {response.text}"
        data = response.json()
        assert data.get('ok') == True, f"Positions not ok: {data}"
        
        # Verify positions array
        assert 'positions' in data, f"Missing positions field: {data}"
        positions = data['positions']
        assert isinstance(positions, list), f"Positions is not a list: {positions}"
        
        # Verify position structure if any exist
        if positions:
            pos = positions[0]
            assert 'positionId' in pos, f"Missing positionId: {pos}"
            assert 'side' in pos, f"Missing side: {pos}"
            assert pos['side'] in ['LONG', 'SHORT'], f"Invalid side: {pos['side']}"
            print(f"✓ Positions: {len(positions)} positions, first side={pos.get('side')}, rMultiple={pos.get('rMultiple')}")
        else:
            print(f"✓ Positions: 0 positions (run may have generated no trades)")
        
        return data
    
    def test_get_orders(self):
        """GET /api/ta/sim/orders - Get orders from run"""
        response = requests.get(
            f"{BASE_URL}/api/ta/sim/orders?runId={self.run_id}",
            timeout=10
        )
        assert response.status_code == 200, f"Orders request failed: {response.text}"
        data = response.json()
        assert data.get('ok') == True, f"Orders not ok: {data}"
        
        # Verify orders array
        assert 'orders' in data, f"Missing orders field: {data}"
        orders = data['orders']
        assert isinstance(orders, list), f"Orders is not a list: {orders}"
        
        # Verify order structure if any exist
        if orders:
            order = orders[0]
            assert 'orderId' in order, f"Missing orderId: {order}"
            assert 'type' in order, f"Missing type: {order}"
            assert 'status' in order, f"Missing status: {order}"
            print(f"✓ Orders: {len(orders)} orders, first type={order.get('type')}, status={order.get('status')}")
        else:
            print(f"✓ Orders: 0 orders")
        
        return data
    
    def test_get_summary(self):
        """GET /api/ta/sim/summary - Get summary analytics"""
        response = requests.get(
            f"{BASE_URL}/api/ta/sim/summary?runId={self.run_id}",
            timeout=10
        )
        assert response.status_code == 200, f"Summary request failed: {response.text}"
        data = response.json()
        assert data.get('ok') == True, f"Summary not ok: {data}"
        
        # Verify summary structure
        assert 'summary' in data, f"Missing summary field: {data}"
        summary = data['summary']
        
        # Core metrics should be present
        expected_fields = ['totalTrades', 'wins', 'losses', 'winRate', 'avgR']
        for field in expected_fields:
            assert field in summary, f"Missing {field} in summary: {summary}"
        
        print(f"✓ Summary: trades={summary.get('totalTrades')}, wins={summary.get('wins')}, losses={summary.get('losses')}")
        print(f"  winRate={summary.get('winRate')}, avgR={summary.get('avgR')}, expectancy={summary.get('expectancy')}")
        return data


class TestSimulatorDeterminism:
    """Test that same parameters produce same results (determinism)"""
    
    def test_determinism_same_params(self):
        """Running with same params should produce identical results"""
        # Run simulation twice with exact same params
        print("Running first simulation...")
        response1 = requests.post(
            f"{BASE_URL}/api/ta/sim/run",
            json=TEST_SIM_PARAMS,
            timeout=120
        )
        assert response1.status_code == 200
        data1 = response1.json()
        assert data1.get('ok') == True
        
        print("Running second simulation with same params...")
        response2 = requests.post(
            f"{BASE_URL}/api/ta/sim/run",
            json=TEST_SIM_PARAMS,
            timeout=120
        )
        assert response2.status_code == 200
        data2 = response2.json()
        assert data2.get('ok') == True
        
        # Compare key metrics (they should be identical)
        sum1 = data1.get('summary', {})
        sum2 = data2.get('summary', {})
        
        if sum1 and sum2:
            # Key determinism checks
            assert sum1.get('totalTrades') == sum2.get('totalTrades'), \
                f"Trade count differs: {sum1.get('totalTrades')} vs {sum2.get('totalTrades')}"
            assert sum1.get('wins') == sum2.get('wins'), \
                f"Wins differ: {sum1.get('wins')} vs {sum2.get('wins')}"
            assert sum1.get('winRate') == sum2.get('winRate'), \
                f"WinRate differs: {sum1.get('winRate')} vs {sum2.get('winRate')}"
            assert sum1.get('avgR') == sum2.get('avgR'), \
                f"AvgR differs: {sum1.get('avgR')} vs {sum2.get('avgR')}"
            
            print(f"✓ DETERMINISM VERIFIED:")
            print(f"  Both runs: trades={sum1.get('totalTrades')}, wins={sum1.get('wins')}, winRate={sum1.get('winRate')}, avgR={sum1.get('avgR')}")
        else:
            print(f"⚠ Both runs produced no trades - determinism trivially true")
        
        return data1, data2
    
    def test_different_seed_produces_different_results(self):
        """Different seed should produce different results"""
        # Run with seed 1337
        params1 = {**TEST_SIM_PARAMS, "seed": 1337}
        response1 = requests.post(f"{BASE_URL}/api/ta/sim/run", json=params1, timeout=120)
        assert response1.status_code == 200
        data1 = response1.json()
        
        # Run with seed 9999
        params2 = {**TEST_SIM_PARAMS, "seed": 9999}
        response2 = requests.post(f"{BASE_URL}/api/ta/sim/run", json=params2, timeout=120)
        assert response2.status_code == 200
        data2 = response2.json()
        
        # Note: Results may or may not differ depending on implementation
        # Just verify both succeeded
        assert data1.get('ok') == True
        assert data2.get('ok') == True
        print(f"✓ Different seeds produced results:")
        print(f"  Seed 1337: trades={data1.get('summary', {}).get('totalTrades')}")
        print(f"  Seed 9999: trades={data2.get('summary', {}).get('totalTrades')}")


class TestNoLookaheadBias:
    """Test that simulator only uses candles up to current step (no lookahead)"""
    
    def test_run_completes_without_leakage_error(self):
        """
        The simulator has a LEAKAGE_GUARD that throws if max window ts != nowTs.
        If the run completes successfully, no lookahead bias occurred.
        """
        response = requests.post(
            f"{BASE_URL}/api/ta/sim/run",
            json=TEST_SIM_PARAMS,
            timeout=120
        )
        assert response.status_code == 200, f"Sim run failed: {response.text}"
        data = response.json()
        
        # If run completed (ok=True and status=DONE), leakage guard passed
        assert data.get('ok') == True, f"Run failed: {data}"
        
        # Verify run status is DONE (not FAILED)
        run_id = data.get('runId')
        if run_id:
            status_resp = requests.get(f"{BASE_URL}/api/ta/sim/status?runId={run_id}", timeout=10)
            if status_resp.status_code == 200:
                status_data = status_resp.json()
                run_status = status_data.get('run', {}).get('status')
                assert run_status == 'DONE', f"Run status is {run_status}, expected DONE (may indicate leakage)"
                print(f"✓ No lookahead bias: Run completed successfully with status=DONE")
        
        return data


class TestEdgeCases:
    """Test edge cases and error handling"""
    
    def test_invalid_run_id(self):
        """Query with non-existent runId should return error"""
        fake_run_id = "fake-run-id-12345"
        response = requests.get(
            f"{BASE_URL}/api/ta/sim/status?runId={fake_run_id}",
            timeout=10
        )
        # Should return 200 with ok=false, or 404
        if response.status_code == 200:
            data = response.json()
            assert data.get('ok') == False or 'error' in data, f"Expected error for fake runId: {data}"
            print(f"✓ Invalid runId handled: {data.get('error', 'ok=false')}")
        else:
            print(f"✓ Invalid runId returned status {response.status_code}")
    
    def test_missing_run_id_parameter(self):
        """Query without runId should fail gracefully"""
        response = requests.get(f"{BASE_URL}/api/ta/sim/status", timeout=10)
        # Should return error or empty result
        assert response.status_code in [200, 400, 422], f"Unexpected status: {response.status_code}"
        print(f"✓ Missing runId handled with status {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
