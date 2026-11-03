import { InMemoryDatabaseClient } from '@omnifi/database';
import { encodeEventTopics, Hex, parseAbiItem } from 'viem';
import { describe, expect, it } from 'vitest';
import { CLMM_SWAP_ABI_ITEM, EvmEventDecoder, V2_SWAP_ABI_ITEM, V2_SYNC_ABI_ITEM } from '../event-decoder';
import { EvmScanner } from '../scanner';
import { RawLog } from '../types';

describe('EVM Event Indexer & Reorg Recovery (Track P11-B)', () => {
  const dummyPool: `0x${string}` = '0x1111111111111111111111111111111111111111';
  const dummySender: `0x${string}` = '0x2222222222222222222222222222222222222222';
  const dummyRecipient: `0x${string}` = '0x3333333333333333333333333333333333333333';

  it('decodes V2 swap event logs into typed swap structure', () => {
    const decoder = new EvmEventDecoder();

    // V2 Swap: Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
    const topics = encodeEventTopics({
      abi: [V2_SWAP_ABI_ITEM],
      eventName: 'Swap',
      args: {
        sender: dummySender,
        to: dummyRecipient,
      },
    }) as Hex[];

    // Encode data: (uint256, uint256, uint256, uint256) -> amount0In: 1000, amount1In: 0, amount0Out: 0, amount1Out: 500
    const rawData =
      '0x' +
      '00000000000000000000000000000000000000000000000000000000000003e8' + // 1000
      '0000000000000000000000000000000000000000000000000000000000000000' + // 0
      '0000000000000000000000000000000000000000000000000000000000000000' + // 0
      '00000000000000000000000000000000000000000000000000000000000001f4'; // 500

    const log: RawLog = {
      address: dummyPool,
      topics,
      data: rawData as Hex,
      blockNumber: 1000n,
      blockHash: '0xblock1000' as Hex,
      transactionHash: '0xtx1' as Hex,
      logIndex: 0,
    };

    const decoded = decoder.decodeLog(log);
    expect(decoded).toBeDefined();
    expect(decoded?.type).toBe('V2_SWAP');
    if (decoded?.type === 'V2_SWAP') {
      expect(decoded.amount0In).toBe(1000n);
      expect(decoded.amount1Out).toBe(500n);
      expect(decoded.sender.toLowerCase()).toBe(dummySender.toLowerCase());
      expect(decoded.recipient.toLowerCase()).toBe(dummyRecipient.toLowerCase());
    }
  });

  it('scans logs idempotently and recovers from 3-block chain reorg', async () => {
    const db = new InMemoryDatabaseClient();
    const networkId = 'eip155:1';

    await db.insertNetwork({
      networkId,
      name: 'Ethereum Mainnet',
      namespace: 'eip155',
      chainRef: '1',
      nativeAssetSymbol: 'ETH',
      nativeAssetDecimals: 18,
      status: 'active',
      createdAt: new Date(),
    });

    const scanner = new EvmScanner(
      {
        networkId,
        chainId: 1,
        rpcUrl: 'http://127.0.0.1:8545',
      },
      db,
    );

    // Register canonical blocks 100, 101, 102
    scanner.registerBlockHash(100n, '0xhash100' as Hex);
    scanner.registerBlockHash(101n, '0xhash101' as Hex);
    scanner.registerBlockHash(102n, '0xhash102' as Hex);

    const topics = encodeEventTopics({
      abi: [V2_SWAP_ABI_ITEM],
      eventName: 'Swap',
      args: { sender: dummySender, to: dummyRecipient },
    }) as Hex[];

    const rawData =
      '0x' +
      '00000000000000000000000000000000000000000000000000000000000003e8' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000000001f4';

    const log101: RawLog = {
      address: dummyPool,
      topics,
      data: rawData as Hex,
      blockNumber: 101n,
      blockHash: '0xhash101' as Hex,
      transactionHash: '0xtx101' as Hex,
      logIndex: 0,
    };

    const log102: RawLog = {
      address: dummyPool,
      topics,
      data: rawData as Hex,
      blockNumber: 102n,
      blockHash: '0xhash102' as Hex,
      transactionHash: '0xtx102' as Hex,
      logIndex: 0,
    };

    // Process logs: block 100 is finalized, 101 & 102 are unfinalized
    await scanner.processLogs([log101, log102], 100n);

    let swaps = await db.listSwapsByPool(dummyPool.toLowerCase());
    expect(swaps.length).toBe(2);

    // Test Idempotency: Processing identical logs again does not create duplicate entries
    await scanner.processLogs([log101, log102], 100n);
    swaps = await db.listSwapsByPool(dummyPool.toLowerCase());
    expect(swaps.length).toBe(2);

    // Now simulate reorg at block 102: New block 102 reports parentHash != known 101 hash (reorged back to 100)
    const forkDetectedAncestor = scanner.detectReorg(102n, '0xdivergentParentHash' as Hex);
    expect(forkDetectedAncestor).toBeDefined();

    if (forkDetectedAncestor !== undefined) {
      const rolledBack = await scanner.handleReorg(102n, forkDetectedAncestor);
      expect(rolledBack).toBeGreaterThan(0);
    }

    // Verify unfinalized events on orphaned chain were purged
    swaps = await db.listSwapsByPool(dummyPool.toLowerCase());
    expect(swaps.length).toBe(0); // All unfinalized events past ancestor were cleanly rolled back
  });

  it('processes V2 Sync events and updates pool reserves in database', async () => {
    const db = new InMemoryDatabaseClient();
    const networkId = 'eip155:1';

    await db.insertNetwork({
      networkId,
      name: 'Ethereum Mainnet',
      namespace: 'eip155',
      chainRef: '1',
      nativeAssetSymbol: 'ETH',
      nativeAssetDecimals: 18,
      status: 'active',
      createdAt: new Date(),
    });

    await db.insertToken({
      tokenId: 'token0',
      networkId,
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      riskTier: 'LOW',
      createdAt: new Date(),
    });

    await db.insertToken({
      tokenId: 'token1',
      networkId,
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      riskTier: 'LOW',
      createdAt: new Date(),
    });

    const poolId = dummyPool.toLowerCase();
    await db.insertPool({
      poolId,
      networkId,
      protocol: 'v2',
      token0Id: 'token0',
      token1Id: 'token1',
      feeTier: 3000,
      reserve0: 10_000_000_000n,
      reserve1: 5_000_000_000_000_000_000n,
      isPaused: false,
      createdAt: new Date(),
    });

    const scanner = new EvmScanner(
      {
        networkId,
        chainId: 1,
        rpcUrl: 'http://127.0.0.1:8545',
      },
      db,
    );

    // Sync(uint112 reserve0, uint112 reserve1)
    const syncTopics = [
      '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1',
    ] as Hex[];

    // Encode reserves: reserve0 = 20_000_000_000, reserve1 = 10_000_000_000_000_000_000
    const syncData =
      '0x' +
      '00000000000000000000000000000000000000000000000000000004a817c800' + // 20000000000
      '0000000000000000000000000000000000000000000000008ac7230489e80000'; // 10000000000000000000

    const syncLog: RawLog = {
      address: dummyPool,
      topics: syncTopics,
      data: syncData as Hex,
      blockNumber: 150n,
      blockHash: '0xhash150' as Hex,
      transactionHash: '0xtx150' as Hex,
      logIndex: 1,
    };

    const processed = await scanner.processLogs([syncLog], 150n);
    expect(processed).toBe(1);

    // Verify pool reserves updated
    const updatedPool = await db.getPool(poolId);
    expect(updatedPool).toBeDefined();
    expect(updatedPool?.reserve0).toBe(20_000_000_000n);
    expect(updatedPool?.reserve1).toBe(10_000_000_000_000_000_000n);
  });
});

