import { NetworkConfig } from './types';
import { NetworkConfigSchema } from './schema';
import { EVM_NETWORKS } from './networks/evm';
import { SOLANA_NETWORKS } from './networks/solana';

const ALL_NETWORKS: readonly NetworkConfig[] = [...EVM_NETWORKS, ...SOLANA_NETWORKS];

// Validate all network configurations at startup
for (const net of ALL_NETWORKS) {
  const result = NetworkConfigSchema.safeParse(net);
  if (!result.success) {
    throw new Error(`Invalid network configuration for '${net.id}': ${result.error.message}`);
  }
}

// Build index maps for fast lookup
const BY_ID = new Map<string, NetworkConfig>();
const BY_CAIP = new Map<string, NetworkConfig>();

for (const net of ALL_NETWORKS) {
  if (BY_ID.has(net.id)) {
    throw new Error(`Duplicate network ID detected: ${net.id}`);
  }
  BY_ID.set(net.id, net);

  const caipKey = `${net.namespace}:${net.chainRef}`;
  if (BY_CAIP.has(caipKey)) {
    throw new Error(`Duplicate CAIP network reference detected: ${caipKey}`);
  }
  BY_CAIP.set(caipKey, net);
}

/**
 * Retrieves a network config by unique ID (e.g. 'ethereum-sepolia').
 */
export function getNetwork(id: string): NetworkConfig | undefined {
  return BY_ID.get(id);
}

/**
 * Retrieves a network config by CAIP-2 namespace and chainRef (e.g. 'eip155', '11155111').
 */
export function getNetworkByCaip(
  namespace: 'eip155' | 'solana',
  chainRef: string,
): NetworkConfig | undefined {
  return BY_CAIP.get(`${namespace}:${chainRef}`);
}

/**
 * Checks whether a network ID exists in the registry.
 */
export function hasNetwork(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * Returns all configured networks.
 */
export function listNetworks(): readonly NetworkConfig[] {
  return ALL_NETWORKS;
}

/**
 * Returns all networks matching a namespace.
 */
export function listNetworksByNamespace(namespace: 'eip155' | 'solana'): readonly NetworkConfig[] {
  return ALL_NETWORKS.filter(n => n.namespace === namespace);
}
