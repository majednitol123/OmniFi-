#!/usr/bin/env bash
set -euo pipefail

# OmniFi Docker Stack End-to-End Verification Test
echo "=========================================================="
echo "    OmniFi Docker Full Stack Integration Verification     "
echo "=========================================================="
echo ""

PASSED=0
FAILED=0

assert_http_200() {
    local name="$1"
    local url="$2"
    echo -n ">> Testing $name ($url)... "
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" || echo "000")
    if [ "$status" = "200" ]; then
        echo "[PASS] (HTTP 200)"
        PASSED=$((PASSED + 1))
    else
        echo "[FAIL] (HTTP $status)"
        FAILED=$((FAILED + 1))
    fi
}

# 1. Anvil EVM Node
echo -n ">> Testing Anvil EVM Node (http://127.0.0.1:8545)... "
ANVIL_RES=$(curl -s --max-time 5 -X POST http://127.0.0.1:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' || echo "")
if echo "$ANVIL_RES" | grep -q "0x7a69"; then
    echo "[PASS] (Chain ID 31337)"
    PASSED=$((PASSED + 1))
else
    echo "[FAIL] (Got: $ANVIL_RES)"
    FAILED=$((FAILED + 1))
fi

# 2. Postgres
echo -n ">> Testing PostgreSQL Container (localhost:5432)... "
if docker exec omnifi-postgres pg_isready -U omnifi -d omnifi_dev > /dev/null 2>&1; then
    echo "[PASS] (Accepting Connections)"
    PASSED=$((PASSED + 1))
else
    echo "[FAIL] (Postgres not ready)"
    FAILED=$((FAILED + 1))
fi

# 3. Redis
echo -n ">> Testing Redis Container (localhost:6379)... "
REDIS_PONG=$(docker exec omnifi-redis redis-cli ping 2>/dev/null || echo "")
if [ "$REDIS_PONG" = "PONG" ]; then
    echo "[PASS] (PONG)"
    PASSED=$((PASSED + 1))
else
    echo "[FAIL] (Got: $REDIS_PONG)"
    FAILED=$((FAILED + 1))
fi

# 4. Quote API Endpoints
assert_http_200 "Quote API Health" "http://127.0.0.1:3001/health"
assert_http_200 "Quote API Prometheus Metrics" "http://127.0.0.1:3001/metrics"
assert_http_200 "Quote API Networks" "http://127.0.0.1:3001/api/v1/networks"
assert_http_200 "Quote API Tokens" "http://127.0.0.1:3001/api/v1/tokens"
assert_http_200 "Quote API Pools" "http://127.0.0.1:3001/api/v1/pools"
assert_http_200 "Quote API Analytics Overview" "http://127.0.0.1:3001/api/v1/analytics/overview"

# Test Quote Engine Route Calculation (GET /api/v1/quotes)
echo -n ">> Testing GET Quote Calculation via Quote API... "
GET_QUOTE_RES=$(curl -s --max-time 10 "http://127.0.0.1:3001/api/v1/quotes?tokenIn=eip155:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48&tokenOut=eip155:1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2&amountIn=1000000000" || echo "")
if echo "$GET_QUOTE_RES" | grep -q "amountOut"; then
    echo "[PASS] (Valid Quote Output Returned: $(echo "$GET_QUOTE_RES" | jq -r '.amountOut'))"
    PASSED=$((PASSED + 1))
else
    echo "[FAIL] (GET Quote Failed: $GET_QUOTE_RES)"
    FAILED=$((FAILED + 1))
fi

# Test Quote Engine Trade Route Calculation (POST /api/v1/quote)
echo -n ">> Testing POST Quote Calculation via Quote API... "
POST_QUOTE_RES=$(curl -s --max-time 10 -X POST "http://127.0.0.1:3001/api/v1/quote" \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","tokenOut":"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2","amount":"1000000000"}' || echo "")
if echo "$POST_QUOTE_RES" | grep -q "amountOut"; then
    echo "[PASS] (Valid Quote Output Returned: $(echo "$POST_QUOTE_RES" | jq -r '.amountOut'))"
    PASSED=$((PASSED + 1))
else
    echo "[FAIL] (POST Quote Failed: $POST_QUOTE_RES)"
    FAILED=$((FAILED + 1))
fi

# 5. Prometheus
assert_http_200 "Prometheus Health" "http://127.0.0.1:9090/-/healthy"

# 6. Grafana
assert_http_200 "Grafana Health" "http://127.0.0.1:3002/api/health"

echo ""
echo "=========================================================="
echo "    Verification Results: $PASSED PASSED, $FAILED FAILED  "
echo "=========================================================="

if [ "$FAILED" -eq 0 ]; then
    echo ">> ALL DOCKER SERVICES VERIFIED AND OPERATIONAL!"
    exit 0
else
    echo ">> SOME DOCKER CHECKS FAILED."
    exit 1
fi

