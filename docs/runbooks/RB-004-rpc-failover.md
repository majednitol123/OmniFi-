# Operational Runbook: RB-004 Multi-Provider RPC Failover & Circuit Breaker Triage

## 1. Overview & Triggers
OmniFi utilizes `@omnifi/rpc-resilience` across all backend services (Quote API, EVM Indexer, Solana Indexer, Reconciliation Worker). When an upstream node provider experiences high latency, rate limits (HTTP 429), or 5xx outages, its circuit breaker trips to `OPEN` and traffic automatically fails over to the next prioritized endpoint.

### Triggers:
- `alert: OmniFiRpcProviderDegraded` (`omnifi_rpc_provider_status == 0`)
- High 5xx error rate on quote/prepare routes (`OmniFiHighHttpErrorRate`)
- Log entries: `onFailover` or `circuit breaker OPEN`.

---

## 2. Diagnostics & Status Check

### Step 2.1: Check Circuit Breaker Status
Inspect endpoint health via API status endpoint or Grafana dashboard:
```bash
curl -s http://localhost:3001/api/v1/networks | jq '.networks[] | {name, status, rpcUrl}'
```
Or query Prometheus directly:
```bash
curl -s http://localhost:3001/metrics | grep omnifi_rpc_provider_status
```

### Step 2.2: Identify Tripped Provider
- If `omnifi_rpc_provider_status{provider="alchemy", network="eip155:1"} == 0`:
  Alchemy has been quarantined by the circuit breaker due to $\ge 3$ consecutive failures.
- Verify whether the fallback provider (e.g., Infura, QuickNode) is successfully serving traffic.

---

## 3. Remediation & Action Procedures

### Case 1: Automatic Failover Functioning (Secondary Endpoint Healthy)
1. Verify secondary endpoint latency and capacity in Grafana.
2. Contact the degraded primary provider or monitor their status page.
3. Once the primary provider stabilizes, the circuit breaker will enter `HALF_OPEN` after its `resetTimeoutMs` (default: 5000ms), probe with 2 test requests, and automatically transition back to `CLOSED`.

### Case 2: All Configured Providers Degraded (`AllRpcEndpointsFailedError`)
1. Provide emergency hot-standby RPC keys (e.g., dedicated private RPC nodes):
   ```bash
   # Update environment variables in docker-compose.env or k8s configmap
   export ETHEREUM_RPC_URL_BACKUP_2="https://lb.drpc.org/ogrpc?network=ethereum&dkey=..."
   ```
2. Trigger rolling restart of service:
   ```bash
   docker-compose up -d --no-deps quote-api
   ```
3. Test endpoint reachability:
   ```bash
   curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' $ETHEREUM_RPC_URL_BACKUP_2
   ```

---

## 4. Post-Incident Review
- Log provider downtime duration and evaluate SLA credits.
- Adjust `failureThreshold` or `resetTimeoutMs` in `@omnifi/rpc-resilience` if rate limits were triggered by burst spikes.

