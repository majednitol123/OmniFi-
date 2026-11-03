import { AssetRef, PoolRef, SwapQuote } from '@omnifi/domain';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  buildEvmTransactionIntent,
  encodeEvmClmmSingleSwap,
  encodeEvmV2Swap,
} from '../simulation/evm-intent-builder';
import { buildSolanaClmmSwapIntent } from '../simulation/solana-intent-builder';

describe('Transaction Intent Builders', () => {
  const dummyQuote: SwapQuote = {
    quoteId: 'quote-test-1',
    namespace: 'eip155',
    chainRef: '1',
    tokenIn: { namespace: 'eip155', chainRef: '1', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
    tokenOut: { namespace: 'eip155', chainRef: '1', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
    amountIn: 1_000_000n,
    amountOut: 500_000_000_000_000n,
    executionPrice: '0.0005',
    priceImpact: { bps: 10, percentage: '0.10%', level: 'low' },
    routes: [
      {
        routeId: 'r-1',
        hops: [
          {
            pool: {
              poolId: 'p-1',
              namespace: 'eip155',
              chainRef: '1',
              poolType: 'v2',
              token0: { namespace: 'eip155', chainRef: '1', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
              token1: { namespace: 'eip155', chainRef: '1', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
              feeTier: 3000,
              state: {},
            },
            tokenIn: { namespace: 'eip155', chainRef: '1', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
            tokenOut: { namespace: 'eip155', chainRef: '1', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
            feeTier: 3000,
          },
        ],
        amountIn: 1_000_000n,
        amountOut: 500_000_000_000_000n,
        priceImpact: { bps: 10, percentage: '0.10%', level: 'low' },
        feeBreakdowns: [],
      },
    ],
    expiresAt: Date.now() + 15000,
    ttlMs: 15000,
  };

  it('builds EVM V2 transaction intent with calldata', () => {
    const routerAddress = '0x1111111111111111111111111111111111111111';
    const recipient = '0x2222222222222222222222222222222222222222';

    const intent = buildEvmTransactionIntent({
      quote: dummyQuote,
      routerAddress,
      recipient,
      slippageToleranceBps: 50,
    });

    expect(intent.namespace).toBe('eip155');
    expect(intent.to).toBe(routerAddress);
    expect(intent.data).toBeDefined();
    expect(intent.data?.startsWith('0x38ed1739')).toBe(true); // V2 selector
    expect(intent.simulationSuccess).toBe(true);
  });

  it('builds Solana CLMM transaction intent with 3 tick arrays', () => {
    const user = Keypair.generate().publicKey;
    const pool = Keypair.generate().publicKey;
    const vault0 = Keypair.generate().publicKey;
    const vault1 = Keypair.generate().publicKey;
    const userSrc = Keypair.generate().publicKey;
    const userDst = Keypair.generate().publicKey;

    const solanaQuote: SwapQuote = {
      ...dummyQuote,
      namespace: 'solana',
      chainRef: 'mainnet-beta',
    };

    const intent = buildSolanaClmmSwapIntent({
      quote: solanaQuote,
      user,
      poolState: pool,
      tokenVault0: vault0,
      tokenVault1: vault1,
      userSource: userSrc,
      userDestination: userDst,
      currentTick: 0,
      tickSpacing: 60,
      zeroForOne: true,
      slippageToleranceBps: 50,
    });

    expect(intent.namespace).toBe('solana');
    expect(intent.instructions).toHaveLength(1);
    const ix = intent.instructions![0]!;
    // 9 accounts base + 3 tick array accounts = 12 accounts
    expect(ix.keys).toHaveLength(12);
    expect(intent.estimatedComputeUnits).toBe(200_000);
  });
});

