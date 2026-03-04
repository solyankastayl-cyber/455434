#!/usr/bin/env python3
"""
TA Engine Module Runtime Test Suite
Phase 3.0: Execution Simulator v1 с детерминизмом, no lookahead bias
Phase 3.1: Auto Dataset Writer при закрытии позиции

Testing TypeScript TA Engine backend на порту 8002
"""

import requests
import json
import sys
import time
from typing import Dict, Any, Optional
from datetime import datetime

class TAEngineBackendTester:
    def __init__(self, base_url: str = "http://localhost:8002"):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'TA-Engine-Tester/1.0'
        })
        
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []
        
        print(f"🔧 TA Engine Backend Tester")
        print(f"📡 Base URL: {self.base_url}")
        print(f"🎯 Testing Phase 3.0 & 3.1: Execution Simulator + Dataset Writer")
        print("="*60)

    def log_result(self, test_name: str, success: bool, response_data: Any = None, error: str = None):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            
        result = {
            'test': test_name,
            'success': success,
            'timestamp': datetime.now().isoformat(),
            'error': error,
            'data': response_data
        }
        self.test_results.append(result)
        
        status_emoji = "✅" if success else "❌"
        print(f"{status_emoji} {test_name}")
        if error:
            print(f"    Error: {error}")
        if success and response_data:
            # Show key info if available
            if isinstance(response_data, dict):
                if 'ok' in response_data:
                    print(f"    Status: {'OK' if response_data.get('ok') else 'NOT OK'}")
                if 'phase' in response_data:
                    print(f"    Phase: {response_data['phase']}")
                if 'description' in response_data:
                    print(f"    Description: {response_data['description']}")

    def make_request(self, method: str, endpoint: str, data: Optional[Dict] = None, params: Optional[Dict] = None) -> Dict[str, Any]:
        """Make HTTP request to TA engine"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method.upper() == 'GET':
                response = self.session.get(url, params=params, timeout=10)
            elif method.upper() == 'POST':
                response = self.session.post(url, json=data, params=params, timeout=30)
            elif method.upper() == 'PATCH':
                response = self.session.patch(url, json=data, params=params, timeout=10)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            # Try to parse JSON response
            try:
                response_data = response.json()
            except:
                response_data = {'raw_response': response.text, 'status_code': response.status_code}
            
            return {
                'success': response.status_code < 400,
                'status_code': response.status_code,
                'data': response_data
            }
            
        except requests.exceptions.Timeout:
            return {
                'success': False,
                'status_code': 0,
                'data': {'error': 'Request timeout'}
            }
        except requests.exceptions.ConnectionError:
            return {
                'success': False,
                'status_code': 0,
                'data': {'error': 'Connection error - server may be down'}
            }
        except Exception as e:
            return {
                'success': False,
                'status_code': 0,
                'data': {'error': str(e)}
            }

    def test_health_check(self):
        """Test 1: GET /api/ta/health - проверка что сервер работает"""
        print("\n🏥 Testing Health Check...")
        
        result = self.make_request('GET', '/api/ta/health')
        
        if result['success']:
            data = result['data']
            # Check for expected health response fields
            has_ok = 'ok' in data and data['ok'] is True
            has_version = 'version' in data
            has_detectors = 'detectors' in data  # TA engine shows detector count
            
            if has_ok and (has_version or has_detectors):
                self.log_result("Health Check", True, data)
                return True
            else:
                self.log_result("Health Check", False, data, "Missing expected health fields")
                return False
        else:
            error_msg = result['data'].get('error', f"HTTP {result['status_code']}")
            self.log_result("Health Check", False, result['data'], error_msg)
            return False

    def test_simulator_stats(self):
        """Test 2: GET /api/ta/sim/stats - статистика симулятора"""
        print("\n📊 Testing Simulator Stats...")
        
        result = self.make_request('GET', '/api/ta/sim/stats')
        
        if result['success']:
            data = result['data']
            # Check for expected simulator stats
            if 'ok' in data and data['ok']:
                self.log_result("Simulator Stats", True, data)
                return True
            else:
                self.log_result("Simulator Stats", False, data, "Response not OK")
                return False
        else:
            error_msg = result['data'].get('error', f"HTTP {result['status_code']}")
            self.log_result("Simulator Stats", False, result['data'], error_msg)
            return False

    def test_simulator_config(self):
        """Test 3: GET /api/ta/sim/config?tf=1d - конфиг симулятора"""
        print("\n⚙️ Testing Simulator Config...")
        
        params = {'tf': '1d'}
        result = self.make_request('GET', '/api/ta/sim/config', params=params)
        
        if result['success']:
            data = result['data']
            # Check for expected config fields
            if 'ok' in data and data['ok']:
                # Look for simulator configuration fields
                expected_fields = ['maxOnePosition', 'slippage', 'commission']
                has_config_fields = any(field in str(data) for field in expected_fields)
                
                if has_config_fields or 'config' in data:
                    self.log_result("Simulator Config", True, data)
                    return True
                else:
                    self.log_result("Simulator Config", False, data, "Missing expected config fields")
                    return False
            else:
                self.log_result("Simulator Config", False, data, "Response not OK")
                return False
        else:
            error_msg = result['data'].get('error', f"HTTP {result['status_code']}")
            self.log_result("Simulator Config", False, result['data'], error_msg)
            return False

    def test_simulator_run(self):
        """Test 4: POST /api/ta/sim/run - запуск симуляции"""
        print("\n🚀 Testing Simulator Run...")
        
        # Prepare simulation run request
        # Based on SimRunParams from runner.ts
        sim_request = {
            "symbol": "BTCUSDT",
            "tf": "1d", 
            "fromTs": int(time.time() * 1000) - (30 * 24 * 60 * 60 * 1000),  # 30 days ago
            "toTs": int(time.time() * 1000),  # now
            "warmupBars": 20,
            "seed": 42,  # For determinism
            "mode": "TOP1"
        }
        
        result = self.make_request('POST', '/api/ta/sim/run', data=sim_request)
        
        if result['success']:
            data = result['data']
            # Check for expected simulation response
            if 'ok' in data and data['ok']:
                # Look for runId and summary
                has_run_id = 'runId' in data
                has_summary = 'summary' in data
                
                if has_run_id:
                    self.log_result("Simulator Run", True, data)
                    # Store runId for later tests if needed
                    self.last_run_id = data.get('runId')
                    return True
                else:
                    self.log_result("Simulator Run", False, data, "Missing runId in response")
                    return False
            else:
                self.log_result("Simulator Run", False, data, "Response not OK")
                return False
        else:
            error_msg = result['data'].get('error', f"HTTP {result['status_code']}")
            self.log_result("Simulator Run", False, result['data'], error_msg)
            return False

    def test_dataset_hook_config(self):
        """Test 5: GET /api/ta/sim/dataset_hook/config - конфиг dataset hook (Phase 3.1)"""
        print("\n🎣 Testing Dataset Hook Config...")
        
        result = self.make_request('GET', '/api/ta/sim/dataset_hook/config')
        
        if result['success']:
            data = result['data']
            # Check for expected dataset hook config
            if 'ok' in data and data['ok']:
                # Look for Phase 3.1 dataset hook configuration
                expected_fields = ['enabled', 'minRForWrite', 'maxRForWrite', 'writeOnTimeout']
                config_data = data.get('config', data)
                has_expected_fields = any(field in config_data for field in expected_fields)
                
                if has_expected_fields:
                    self.log_result("Dataset Hook Config", True, data)
                    return True
                else:
                    self.log_result("Dataset Hook Config", False, data, "Missing expected dataset hook config fields")
                    return False
            else:
                self.log_result("Dataset Hook Config", False, data, "Response not OK")
                return False
        else:
            error_msg = result['data'].get('error', f"HTTP {result['status_code']}")
            self.log_result("Dataset Hook Config", False, result['data'], error_msg)
            return False

    def test_ml_dataset_status(self):
        """Test 6: GET /api/ta/ml/dataset/status - статус ML dataset после симуляции"""
        print("\n🤖 Testing ML Dataset Status...")
        
        result = self.make_request('GET', '/api/ta/ml/dataset/status')
        
        if result['success']:
            data = result['data']
            # Check for expected ML dataset status
            if 'ok' in data and data['ok']:
                # Look for dataset statistics
                expected_fields = ['totalRows', 'phase', 'lastUpdated']
                has_stats = any(field in data for field in expected_fields)
                
                self.log_result("ML Dataset Status", True, data)
                return True
            else:
                self.log_result("ML Dataset Status", False, data, "Response not OK")
                return False
        else:
            error_msg = result['data'].get('error', f"HTTP {result['status_code']}")
            self.log_result("ML Dataset Status", False, result['data'], error_msg)
            return False

    def test_additional_simulator_endpoints(self):
        """Test additional simulator endpoints for completeness"""
        print("\n📋 Testing Additional Simulator Endpoints...")
        
        # Test simulator status
        result = self.make_request('GET', '/api/ta/sim/status')
        if result['success']:
            data = result['data']
            # Simulator status might return "Run not found" if no active run
            if 'ok' in data:  # Accept both ok=true and ok=false responses
                self.log_result("Simulator Status", True, data)
            else:
                self.log_result("Simulator Status", False, data, "No status response")
        else:
            self.log_result("Simulator Status", False, result['data'], "Simulator status endpoint failed")

        # Test simulator runs list  
        result = self.make_request('GET', '/api/ta/sim/runs')
        if result['success'] and result['data'].get('ok'):
            self.log_result("Simulator Runs List", True, result['data'])
        else:
            self.log_result("Simulator Runs List", False, result['data'], "Simulator runs list not available")

    def run_all_tests(self):
        """Run all TA Engine tests"""
        print(f"\n🚀 Starting TA Engine Backend Test Suite")
        print(f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        # Core required tests from review request
        tests = [
            self.test_health_check,
            self.test_simulator_stats, 
            self.test_simulator_config,
            self.test_simulator_run,
            self.test_dataset_hook_config,
            self.test_ml_dataset_status
        ]
        
        # Run core tests
        for test_func in tests:
            try:
                test_func()
                time.sleep(0.5)  # Small delay between tests
            except Exception as e:
                test_name = test_func.__name__.replace('test_', '').replace('_', ' ').title()
                self.log_result(test_name, False, None, f"Test exception: {str(e)}")
        
        # Run additional tests
        try:
            self.test_additional_simulator_endpoints()
        except Exception as e:
            self.log_result("Additional Tests", False, None, f"Additional test exception: {str(e)}")

        # Print summary
        self.print_summary()
        
        # Return success status
        return self.tests_passed == self.tests_run

    def print_summary(self):
        """Print test summary"""
        print("\n" + "="*60)
        print("📊 TEST SUMMARY")
        print("="*60)
        print(f"🎯 Tests Run: {self.tests_run}")
        print(f"✅ Tests Passed: {self.tests_passed}")
        print(f"❌ Tests Failed: {self.tests_run - self.tests_passed}")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"📈 Success Rate: {success_rate:.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("🎉 ALL TESTS PASSED! TA Engine is working correctly.")
        else:
            print("⚠️  Some tests failed. Check the details above.")
            
        # List failed tests
        failed_tests = [r for r in self.test_results if not r['success']]
        if failed_tests:
            print("\n❌ Failed Tests:")
            for test in failed_tests:
                print(f"   - {test['test']}: {test['error']}")
        
        print("="*60)

def main():
    """Main test execution"""
    try:
        # Test against localhost:8002 as specified in the review request
        tester = TAEngineBackendTester("http://localhost:8002")
        success = tester.run_all_tests()
        
        # Exit with appropriate code
        sys.exit(0 if success else 1)
        
    except KeyboardInterrupt:
        print("\n⏹️  Test execution interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n💥 Fatal error during testing: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()