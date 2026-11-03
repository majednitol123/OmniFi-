import { describe, expect, it } from 'vitest';
import { InMemoryDatabaseClient } from '../in-memory-db';
import { DbNetwork, DbPool, DbSwap, DbToken } from '../types';

describe('OmniFi Relational Database Platform (Track P11-A)', () => {
  it('manages networks, tokens, and pools with relational integrity', async () => {
    const db = new InMemoryDatabaseClient();

    const network: DbNetwork = {
      networkId: 'eip155:1',
      name: 'Ethereum Mainnet',
      namespace: 'eip155',
      chainRef: '1',
      nativeAssetSymbol: 'ETH',
      nativeAssetDecimals: 18,
      status: 'active',
      createdAt: new Date(),
    };
    await db.insertNetwork(network);

    const token0: DbToken = {
      tokenId: 'eip155:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      networkId: 'eip155:1',
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      riskTier: 'LOW',
      createdAt: new Date(),
    };
    const token1: DbToken = {
      tokenId: 'eip155:1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      networkId: 'eip155:1',
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      riskTier: 'LOW',
      createdAt: new Date(),
    };
    await db.insertToken(token0);
    await db.insertToken(token1);

    const pool: DbPool = {
      poolId: 'evm-v2-usdc-weth',
      networkId: 'eip155:1',
      protocol: 'v2',
      token0Id: token0.tokenId,
      token1Id: token1.tokenId,
      feeTier: 3000,
      isPaused: false,
      createdAt: new Date(),
    };
    await db.insertPool(pool);

    const fetchedPool = await db.getPool(pool.poolId);
    expect(fetchedPool).toBeDefined();
    expect(fetchedPool?.poolId).toBe('evm-v2-usdc-weth');
    expect(fetchedPool?.token0Id).toBe(token0.tokenId);
  });

  it('enforces idempotency on swaps by composite key (networkId, txHash, eventIndex)', async () => {
    const db = new InMemoryDatabaseClient();

    const swap: DbSwap = {
      swapId: 'swap-1',
      networkId: 'eip155:1',
      poolId: 'evm-v2-usdc-weth',
      txHash: '0xabc123',
      blockNumberOrSlot: 19000000n,
      blockTimestamp: new Date(),
      sender: '0xuser1',
      recipient: '0xuser1',
      amount0In: 1_000_000_000n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 300_000_000_000_000_000n,
      eventIndex: 2,
      finalized: false,
      createdAt: new Date(),
    };

    // Insert once
    await db.insertSwap(swap);
    let swaps = await db.listSwapsByPool('evm-v2-usdc-weth');
    expect(swaps.length).toBe(1);

    // Duplicate insert with same composite key but different swapId
    const duplicateSwap: DbSwap = {
      ...swap,
      swapId: 'swap-duplicate',
    };
    await db.insertSwap(duplicateSwap);

    // Count must still be 1 (idempotent, no double counting)
    swaps = await db.listSwapsByPool('evm-v2-usdc-weth');
    expect(swaps.length).toBe(1);
    expect(swaps[0]?.swapId).toBe('swap-1');
  });

  it('performs reorg rollback unwinding unfinalized events past common ancestor', async () => {
    const db = new InMemoryDatabaseClient();
    const networkId = 'eip155:1';

    await db.updateCheckpoint({
      networkId,
      lastScannedBlockOrSlot: 105n,
      lastFinalizedBlockOrSlot: 100n,
      updatedAt: new Date(),
    });

    // Ingest events at block 101, 102, 103 (unfinalized)
    await db.insertSwap({
      swapId: 'swap-101',
      networkId,
      poolId: 'pool-1',
      txHash: '0x101',
      blockNumberOrSlot: 101n,
      blockTimestamp: new Date(),
      sender: '0xuser',
      recipient: '0xuser',
      amount0In: 100n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 50n,
      eventIndex: 0,
      finalized: false,
      createdAt: new Date(),
    });

    await db.insertSwap({
      swapId: 'swap-103',
      networkId,
      poolId: 'pool-1',
      txHash: '0x103',
      blockNumberOrSlot: 103n,
      blockTimestamp: new Date(),
      sender: '0xuser',
      recipient: '0xuser',
      amount0In: 200n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 100n,
      eventIndex: 0,
      finalized: false,
      createdAt: new Date(),
    });

    // Reorg detected: fork happened at 103, common ancestor is 101
    const rolledBack = await db.rollbackUnfinalizedEvents(networkId, 101n);
    expect(rolledBack).toBe(1); // swap-103 rolled back, swap-101 retained

    const remainingSwaps = await db.listSwapsByPool('pool-1');
    expect(remainingSwaps.length).toBe(1);
    expect(remainingSwaps[0]?.swapId).toBe('swap-101');

    const cp = await db.getCheckpoint(networkId);
    expect(cp?.lastScannedBlockOrSlot).toBe(101n);
  });
});

