import client from 'prom-client';

// Global Registry
export const register = new client.Registry();

// Default system metrics (CPU, memory, event loop lag, etc.)
client.collectDefaultMetrics({ register, prefix: 'omnifi_' });

export const httpRequestsTotal = new client.Counter({
  name: 'omnifi_http_requests_total',
  help: 'Total number of HTTP requests processed by OmniFi API',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'omnifi_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const quoteRequestsTotal = new client.Counter({
  name: 'omnifi_quote_requests_total',
  help: 'Total number of swap quote calculations requested',
  labelNames: ['status'] as const,
  registers: [register],
});

export const quoteLatencySeconds = new client.Histogram({
  name: 'omnifi_quote_latency_seconds',
  help: 'Latency of routing graph traversal and quote calculation',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.5],
  registers: [register],
});

export const reconciliationDriftCount = new client.Gauge({
  name: 'omnifi_reconciliation_drift_count',
  help: 'Count of active balance / state accounting reconciliation discrepancies',
  registers: [register],
});

export const reorgDepthBlocks = new client.Gauge({
  name: 'omnifi_reorg_depth_blocks',
  help: 'Observed blockchain reorganization depth in blocks',
  labelNames: ['network'] as const,
  registers: [register],
});

export const rpcProviderStatus = new client.Gauge({
  name: 'omnifi_rpc_provider_status',
  help: 'Operational status of upstream blockchain RPC endpoints (1 = healthy, 0 = degraded/circuit opened)',
  labelNames: ['provider', 'network'] as const,
  registers: [register],
});

// Seed default initial gauges
reconciliationDriftCount.set(0);
rpcProviderStatus.set({ provider: 'alchemy', network: 'eip155:1' }, 1);
rpcProviderStatus.set({ provider: 'infura', network: 'eip155:1' }, 1);
rpcProviderStatus.set({ provider: 'quicknode', network: 'eip155:8453' }, 1);
rpcProviderStatus.set({ provider: 'helius', network: 'solana:mainnet-beta' }, 1);

