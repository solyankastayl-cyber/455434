#!/usr/bin/env python3
"""
Backend Test Suite - TA Engine Dataset v2
Tests the TypeScript backend endpoints for ML dataset functionality
"""

import requests
import sys
import json
from datetime import datetime

class TAEngineDatasetV2Tester:
    def __init__(self, base_url="http://localhost:8002"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.results = []

    def log_result(self, name, success, response_data=None, error_msg=None):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {error_msg}")
        
        self.results.append({
            "test": name,
            "success": success,
            "data": response_data,
            "error": error_msg
        })

    def run_test(self, name, method, endpoint, expected_status=200, data=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            
            success = response.status_code == expected_status
            response_data = None
            error_msg = None
            
            try:
                response_data = response.json()
            except:
                response_data = {"raw_response": response.text}
            
            if not success:
                error_msg = f"Expected {expected_status}, got {response.status_code}"
                if response_data and isinstance(response_data, dict):
                    if 'error' in response_data:
                        error_msg += f" - {response_data['error']}"
                    elif 'message' in response_data:
                        error_msg += f" - {response_data['message']}"

            self.log_result(name, success, response_data, error_msg)
            return success, response_data

        except requests.exceptions.RequestException as e:
            error_msg = f"Request failed: {str(e)}"
            self.log_result(name, False, None, error_msg)
            return False, {}

    def test_health(self):
        """Test server health"""
        return self.run_test("Health Check", "GET", "api/ta/health")

    def test_dataset_v2_status(self):
        """Test dataset v2 status endpoint"""
        return self.run_test("Dataset v2 Status", "GET", "api/ta/ml/dataset_v2/status")

    def test_dataset_v2_schema(self):
        """Test dataset v2 schema endpoint"""
        return self.run_test("Dataset v2 Schema", "GET", "api/ta/ml/dataset_v2/schema")

    def test_dataset_v2_rows(self):
        """Test dataset v2 rows endpoint"""
        return self.run_test("Dataset v2 Rows (limit=2)", "GET", "api/ta/ml/dataset_v2/rows?limit=2")

    def test_dataset_v2_export_csv(self):
        """Test dataset v2 CSV export"""
        return self.run_test("Dataset v2 CSV Export (limit=3)", "GET", "api/ta/ml/dataset_v2/export/csv?limit=3")

    def test_sim_run(self):
        """Test simulation run to generate v2 data"""
        data = {
            "symbol": "BTCUSDT",
            "tf": "1D",
            "fromTs": int(datetime.now().timestamp()) - 86400 * 30,  # 30 days ago
            "toTs": int(datetime.now().timestamp()),
            "warmupBars": 50,
            "seed": 1337
        }
        return self.run_test("Run Simulation (to generate v2 data)", "POST", "api/ta/sim/run", 200, data)

    def run_all_tests(self):
        """Run all dataset v2 tests"""
        print("🚀 Starting TA Engine Dataset v2 Tests")
        print(f"📍 Testing server: {self.base_url}")
        print("=" * 60)

        # Test 1: Health check
        success, _ = self.test_health()
        if not success:
            print("❌ Server not responding. Stopping tests.")
            return False

        # Test 2: Dataset v2 status - should show 30 rows, 80 features
        success, data = self.test_dataset_v2_status()
        if success and data:
            # Check if we have the expected features
            if data.get('featureCount') == 80:
                print(f"   ✓ Confirmed 80 features")
            else:
                print(f"   ⚠️  Expected 80 features, got {data.get('featureCount')}")
            
            if data.get('totalRows', 0) >= 30:
                print(f"   ✓ Has {data.get('totalRows')} rows (≥30 expected)")
            else:
                print(f"   ⚠️  Expected ≥30 rows, got {data.get('totalRows')}")

        # Test 3: Schema info
        success, data = self.test_dataset_v2_schema()
        if success and data:
            features = data.get('features', [])
            if len(features) == 80:
                print(f"   ✓ Schema contains 80 features")
                # Print first few feature groups for verification
                pattern_geom = [f for f in features if 'pattern_' in f and ('type' in f or 'height' in f or 'width' in f)][:3]
                if pattern_geom:
                    print(f"   ✓ Pattern geometry features: {', '.join(pattern_geom)}")

        # Test 4: Get rows
        success, data = self.test_dataset_v2_rows()
        if success and data:
            rows = data.get('rows', [])
            if rows:
                print(f"   ✓ Retrieved {len(rows)} sample rows")
                # Check if rows have expected structure
                first_row = rows[0] if rows else {}
                if 'features' in first_row and 'labels' in first_row:
                    print(f"   ✓ Rows have correct structure (features + labels)")

        # Test 5: CSV export
        success, data = self.test_dataset_v2_export_csv()
        if success:
            print(f"   ✓ CSV export working")

        # Test 6: Run simulation to generate new v2 data
        print("\n📊 Testing simulation run to verify v2 dataset writing...")
        success, data = self.test_sim_run()
        if success and data:
            if data.get('ok'):
                print(f"   ✓ Simulation completed: {data.get('runId')}")
                summary = data.get('summary')
                if summary:
                    print(f"   ✓ Trades: {summary.get('totalTrades')}, Win Rate: {summary.get('winRate')}")
            else:
                print(f"   ⚠️  Simulation may have issues: {data}")

        return True

    def print_summary(self):
        """Print test results summary"""
        print("\n" + "=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed! Dataset v2 is working correctly.")
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed.")
        
        print(f"🔍 Dataset v2 Features: ~80 ML features organized in 10 groups")
        print(f"🧪 Mock market data: Uses seeded RNG for reproducible testing")
        
        # Show failed tests
        failed_tests = [r for r in self.results if not r['success']]
        if failed_tests:
            print("\n❌ Failed Tests:")
            for test in failed_tests:
                print(f"   - {test['test']}: {test.get('error', 'Unknown error')}")

def main():
    """Main test runner"""
    print("TA Engine Dataset Builder v2 - Phase 5 Testing")
    print("Testing ~80 features for ML training")
    print()

    tester = TAEngineDatasetV2Tester()
    
    # Run all tests
    success = tester.run_all_tests()
    
    # Print summary
    tester.print_summary()
    
    # Return appropriate exit code
    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)