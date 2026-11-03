import { describe, expect, it } from 'vitest';
import {
  getNetwork,
  getNetworkByCaip,
  hasNetwork,
  listNetworks,
  listNetworksByNamespace,
} from '../registry';
import { NetworkConfigSchema } from '../schema';

describe('Network Registry (ADR-001)', () => {
  it('loads and validates all static network configs against Zod schema', () => {
    const all = listNetworks();
    expect(all.length).toBeGreaterThanOrEqual(4);

    for (const net of all) {
      const parsed = NetworkConfigSchema.safeParse(net);
      expect(parsed.success).toBe(true);
    }
  });

  it('retrieves known networks by ID', () => {
    const sepolia = getNetwork('ethereum-sepolia');
    expect(sepolia).toBeDefined();
    expect(sepolia?.namespace).toBe('eip155');
    expect(sepolia?.chainRef).toBe('11155111');
    expect(sepolia?.nativeCurrency.symbol).toBe('ETH');

    const solanaDevnet = getNetwork('solana-devnet');
    expect(solanaDevnet).toBeDefined();
    expect(solanaDevnet?.namespace).toBe('solana');
    expect(solanaDevnet?.chainRef).toBe('devnet');
    expect(solanaDevnet?.nativeCurrency.symbol).toBe('SOL');
  });

  it('retrieves networks by CAIP namespace and chainRef', () => {
    const arb = getNetworkByCaip('eip155', '421614');
    expect(arb).toBeDefined();
    expect(arb?.id).toBe('arbitrum-sepolia');

    const sol = getNetworkByCaip('solana', 'devnet');
    expect(sol).toBeDefined();
    expect(sol?.id).toBe('solana-devnet');
  });

  it('returns undefined for nonexistent network query', () => {
    expect(getNetwork('nonexistent-network')).toBeUndefined();
    expect(getNetworkByCaip('eip155', '999999999')).toBeUndefined();
    expect(hasNetwork('nonexistent')).toBe(false);
  });

  it('filters networks by namespace', () => {
    const evmNets = listNetworksByNamespace('eip155');
    expect(evmNets.length).toBeGreaterThanOrEqual(3);
    for (const n of evmNets) {
      expect(n.namespace).toBe('eip155');
    }

    const solNets = listNetworksByNamespace('solana');
    expect(solNets.length).toBeGreaterThanOrEqual(2);
    for (const n of solNets) {
      expect(n.namespace).toBe('solana');
    }
  });

  it('rejects invalid network objects in schema validator', () => {
    const badConfig = {
      id: 'bad-network',
      displayName: 'Bad',
      namespace: 'unknown_namespace', // invalid
      chainRef: '1',
      isTestnet: true,
      features: { v2Amm: true, clmm: true, permit2: false },
      finality: { confirmed: 1, finalized: 1, avgBlockTimeMs: 1000 },
      explorerUrl: 'not_a_url',
      explorerTxPattern: 'no_tx_pattern',
      explorerAddressPattern: 'no_address_pattern',
      nativeCurrency: { name: 'Bad', symbol: 'BAD', decimals: 18 },
      iconId: 'bad',
    };

    const res = NetworkConfigSchema.safeParse(badConfig);
    expect(res.success).toBe(false);
  });
});

