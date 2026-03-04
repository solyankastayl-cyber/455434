#!/usr/bin/env bash
# BLOCK 42.5 — Fractal Smoke Test Script
set -e

BASE=${1:-http://localhost:8001}

echo "═══════════════════════════════════════════════════════════════"
echo "  FRACTAL V2.1 SMOKE TEST"
echo "═══════════════════════════════════════════════════════════════"
echo ""

echo "== 1. Health Check"
curl -s "$BASE/api/health" | jq .
echo ""

echo "== 2. Fractal Health"
curl -s "$BASE/api/fractal/health" | jq .
echo ""

echo "== 3. Signal (BTC)"
curl -s "$BASE/api/fractal/signal?symbol=BTC" | jq .
echo ""

echo "== 4. Match (Top 5)"
curl -s "$BASE/api/fractal/match?symbol=BTC&limit=5" | jq '.matches[:3]'
echo ""

echo "== 5. Explain"
curl -s "$BASE/api/fractal/explain?symbol=BTC" | jq .
echo ""

echo "== 6. Certification Replay (10 runs)"
curl -s -X POST "$BASE/api/fractal/v2.1/admin/cert/replay" \
  -H "Content-Type: application/json" \
  -d '{"presetKey":"v2_1_entropy_final","asOf":"2026-02-15","runs":10}' | jq .
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "  SMOKE TEST COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
