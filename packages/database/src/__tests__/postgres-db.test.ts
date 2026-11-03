import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresDatabaseClient } from '../postgres-db';
import { DbNetwork, DbPool, DbSwap, DbToken, DbLiquidityPosition, DbReconciliationRun } from '../types';

describe('OmniFi PostgreSQL Production Database Client (Live Docker)', () => {
  let db: PostgresDatabaseClient;

  beforeAll(() => {
    db = new PostgresDatabaseClient(
      process.env.DATABASE_URL ||
        'postgresql://omnifi:omnifi_dev_password@localhost:5432/omnifi_dev',
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('connects to live postgres and performs CRUD operations on networks, tokens, pools', async () => {
    const network: DbNetwork = {
      networkId: 'eip155:1-test',
      name: 'Ethereum Testnet',
      namespace: 'eip155',
      chainRef: '1',
      nativeAssetSymbol: 'ETH',
      nativeAssetDecimals: 18,
      status: 'active',
      createdAt: new Date(),
    };
    await db.insertNetwork(network);

    const fetchedNetwork = await db.getNetwork('eip155:1-test');
    expect(fetchedNetwork).toBeDefined();
    expect(fetchedNetwork?.name).toBe('Ethereum Testnet');

    const token0: DbToken = {
      tokenId: 'eip155:1-test:usdc',
      networkId: 'eip155:1-test',
      address: '0x0000000000000000000000000000000000000001',
      symbol: 'USDC-T',
      name: 'Test USD Coin',
      decimals: 6,
      riskTier: 'LOW',
      createdAt: new Date(),
    };
    const token1: DbToken = {
      tokenId: 'eip155:1-test:weth',
      networkId: 'eip155:1-test',
      address: '0x0000000000000000000000000000000000000002',
      symbol: 'WETH-T',
      name: 'Test Wrapped Ether',
      decimals: 18,
      riskTier: 'LOW',
      createdAt: new Date(),
    };
    await db.insertToken(token0);
    await db.insertToken(token1);

    const fetchedToken = await db.getToken(token0.tokenId);
    expect(fetchedToken?.symbol).toBe('USDC-T');

    const pool: DbPool = {
      poolId: 'pool-test-v2-usdc-weth',
      networkId: 'eip155:1-test',
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
    expect(fetchedPool?.poolId).toBe('pool-test-v2-usdc-weth');
    expect(fetchedPool?.feeTier).toBe(3000);
  });

  it('guarantees swap idempotency with composite key (network_id, tx_hash, event_index)', async () => {
    const swap: DbSwap = {
      swapId: 'swap-pg-1',
      networkId: 'eip155:1-test',
      poolId: 'pool-test-v2-usdc-weth',
      txHash: '0xpgtx123',
      blockNumberOrSlot: 1000n,
      blockTimestamp: new Date(),
      sender: '0xuser1',
      recipient: '0xuser1',
      amount0In: 5000000n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 2500000000000000n,
      eventIndex: 1,
      finalized: false,
      createdAt: new Date(),
    };

    await db.insertSwap(swap);
    let swaps = await db.listSwapsByPool('pool-test-v2-usdc-weth');
    const initialCount = swaps.length;

    // Re-inserting identical (networkId, txHash, eventIndex) with different swapId
    const dupSwap: DbSwap = {
      ...swap,
      swapId: 'swap-pg-dup',
      amount0In: 99999999n,
    };
    await db.insertSwap(dupSwap);

    swaps = await db.listSwapsByPool('pool-test-v2-usdc-weth');
    expect(swaps.length).toBe(initialCount);
    expect(swaps[0]?.swapId).toBe('swap-pg-1');
  });

  it('handles positions, reorg rollback, and reconciliation runs in postgres', async () => {
    const pos: DbLiquidityPosition = {
      positionId: 'pos-pg-1',
      networkId: 'eip155:1-test',
      poolId: 'pool-test-v2-usdc-weth',
      owner: '0xOwnerA',
      onchainPositionId: 'nft-42',
      tickLower: -100,
      tickUpper: 100,
      liquidity: 1000000000n,
      tokensOwed0: 0n,
      tokensOwed1: 0n,
      status: 'OPEN',
      updatedAt: new Date(),
    };
    await db.upsertPosition(pos);

    const fetchedPos = await db.getPosition('pos-pg-1');
    expect(fetchedPos?.owner).toBe('0xOwnerA');
    expect(fetchedPos?.liquidity).toBe(1000000000n);

    // Rollback unfinalized events past block 500
    await db.updateCheckpoint({
      networkId: 'eip155:1-test',
      lastScannedBlockOrSlot: 1000n,
      lastFinalizedBlockOrSlot: 500n,
      updatedAt: new Date(),
    });

    const rolledBack = await db.rollbackUnfinalizedEvents('eip155:1-test', 500n);
    expect(rolledBack).toBeGreaterThanOrEqual(1);

    // Reconciliation
    const recRun: DbReconciliationRun = {
      runId: 'rec-run-1',
      networkId: 'eip155:1-test',
      poolId: 'pool-test-v2-usdc-weth',
      onchainReserve0: 1000n,
      dbReserve0: 1000n,
      drift0: 0n,
      onchainReserve1: 2000n,
      dbReserve1: 2000n,
      drift1: 0n,
      status: 'OK',
      auditedAt: new Date(),
    };
    await db.insertReconciliationRun(recRun);
    const recs = await db.listReconciliationRuns('pool-test-v2-usdc-weth');
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0]?.status).toBe('OK');
  });
});

