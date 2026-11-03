import { InMemoryDatabaseClient } from '@omnifi/database';
import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { SolanaScanner } from '../scanner';
import { SolanaRawTransaction } from '../types';

describe('Solana Transaction & Account Indexer (Track P11-C)', () => {
  const dummyAmmProgram = new PublicKey('Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3');
  const dummyClmmProgram = new PublicKey('BSn4qU6Reocr7apUznvRkXLQ4psydsrayW9YWyToD6x2');
  const networkId = 'solana:mainnet-beta';

  it('scans and decodes AMM and CLMM transactions from Anchor event data with idempotency', async () => {
    const db = new InMemoryDatabaseClient();
    await db.insertNetwork({
      networkId,
      name: 'Solana Mainnet',
      namespace: 'solana',
      chainRef: 'mainnet-beta',
      nativeAssetSymbol: 'SOL',
      nativeAssetDecimals: 9,
      status: 'active',
      createdAt: new Date(),
    });

    const scanner = new SolanaScanner(
      {
        networkId,
        cluster: 'mainnet-beta',
        rpcUrl: 'http://127.0.0.1:8899',
        ammProgramId: dummyAmmProgram,
        clmmProgramId: dummyClmmProgram,
      },
      db,
    );

    const dummyPool = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const dummyUser = 'So11111111111111111111111111111111111111112';

    // Encode authentic Anchor AMM event binary (25 bytes)
    const ammBuffer = Buffer.alloc(25);
    ammBuffer.writeBigUInt64LE(1_000_000n, 8);
    ammBuffer.writeBigUInt64LE(980_000n, 16);
    ammBuffer.writeUInt8(1, 24); // zeroForOne = true
    const anchorAmmLog = `Program data: ${ammBuffer.toString('base64')}`;

    const rawTx1: SolanaRawTransaction = {
      signature: '5K3dTx1234567890abcdef',
      slot: 250000000n,
      blockTime: Math.floor(Date.now() / 1000),
      err: null,
      accounts: [dummyUser, dummyPool],
      logs: [
        'Program Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3 invoke [1]',
        'Program log: Instruction: SwapExactInput',
        anchorAmmLog,
        'Program Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3 success',
      ],
    };

    // 1. Process AMM Swap
    const count = await scanner.processTransactions([rawTx1], false);
    expect(count).toBe(1);

    let swaps = await db.listSwapsByPool(dummyPool);
    expect(swaps.length).toBe(1);
    expect(swaps[0]?.amount0In).toBe(1_000_000n);
    expect(swaps[0]?.amount1Out).toBe(980_000n);
    expect(swaps[0]?.finalized).toBe(false);

    // 2. Process same transaction again (Idempotency test)
    await scanner.processTransactions([rawTx1], false);
    swaps = await db.listSwapsByPool(dummyPool);
    expect(swaps.length).toBe(1); // No duplicates

    // 3. Process CLMM position update via genuine Anchor position binary (32 bytes)
    const dummyPosition = 'Pos1111111111111111111111111111111111111111';
    const posBuffer = Buffer.alloc(32);
    posBuffer.writeInt32LE(-120, 8);
    posBuffer.writeInt32LE(120, 12);
    posBuffer.writeBigUInt64LE(100_000_000n, 16);
    const anchorPosLog = `Program data: ${posBuffer.toString('base64')}`;

    const rawTx2: SolanaRawTransaction = {
      signature: '5K3dTx9876543210clmm',
      slot: 250000010n,
      blockTime: Math.floor(Date.now() / 1000),
      err: null,
      accounts: [dummyPool, dummyPosition, dummyUser],
      logs: [
        'Program BSn4qU6Reocr7apUznvRkXLQ4psydsrayW9YWyToD6x2 invoke [1]',
        'Program log: Instruction: OpenPosition',
        anchorPosLog,
        'Program BSn4qU6Reocr7apUznvRkXLQ4psydsrayW9YWyToD6x2 success',
      ],
    };

    await scanner.processTransactions([rawTx2], true);
    const pos = await db.getPositionByOnchain(networkId, dummyPosition);
    expect(pos).toBeDefined();
    expect(pos?.owner).toBe(dummyUser);
    expect(pos?.liquidity).toBe(100_000_000n);
    expect(pos?.tickLower).toBe(-120);
    expect(pos?.tickUpper).toBe(120);

    // Verify Checkpoint updated to 250000010
    const cp = await db.getCheckpoint(networkId);
    expect(cp?.lastScannedBlockOrSlot).toBe(250000010n);
    expect(cp?.lastFinalizedBlockOrSlot).toBe(250000010n);
  });

  it('decodes parameterized logs into genuine swap amounts and parameters', async () => {
    const db = new InMemoryDatabaseClient();
    await db.insertNetwork({
      networkId,
      name: 'Solana Mainnet',
      namespace: 'solana',
      chainRef: 'mainnet-beta',
      nativeAssetSymbol: 'SOL',
      nativeAssetDecimals: 9,
      status: 'active',
      createdAt: new Date(),
    });

    const scanner = new SolanaScanner(
      {
        networkId,
        cluster: 'mainnet-beta',
        rpcUrl: 'http://127.0.0.1:8899',
        ammProgramId: dummyAmmProgram,
        clmmProgramId: dummyClmmProgram,
      },
      db,
    );

    const dummyPool = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const dummyUser = 'So11111111111111111111111111111111111111112';

    const rawTx: SolanaRawTransaction = {
      signature: '5K3dTxParameterizedLog123',
      slot: 250000020n,
      blockTime: Math.floor(Date.now() / 1000),
      err: null,
      accounts: [dummyUser, dummyPool],
      logs: [
        'Program Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3 invoke [1]',
        'Program log: AMM_SWAP: amountIn=25000000, amountOut=24800000, zeroForOne=false',
        'Program Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3 success',
      ],
    };

    const count = await scanner.processTransactions([rawTx], true);
    expect(count).toBe(1);

    const swaps = await db.listSwapsByPool(dummyPool);
    expect(swaps.length).toBe(1);
    expect(swaps[0]?.amount1In).toBe(25_000_000n);
    expect(swaps[0]?.amount0Out).toBe(24_800_000n);
  });

  it('ignores unparameterized instruction logs and does not fabricate mock trades (F-11 Remediation)', async () => {
    const db = new InMemoryDatabaseClient();
    const scanner = new SolanaScanner(
      {
        networkId,
        cluster: 'mainnet-beta',
        rpcUrl: 'http://127.0.0.1:8899',
        ammProgramId: dummyAmmProgram,
        clmmProgramId: dummyClmmProgram,
      },
      db,
    );

    const dummyPool = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const dummyUser = 'So11111111111111111111111111111111111111112';

    // Transaction with instruction invocation but without Anchor event data or parameters
    const rawTxWithoutParams: SolanaRawTransaction = {
      signature: '5K3dTxWithoutParams',
      slot: 250000030n,
      blockTime: Math.floor(Date.now() / 1000),
      err: null,
      accounts: [dummyUser, dummyPool],
      logs: [
        'Program Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3 invoke [1]',
        'Program log: Instruction: SwapExactInput',
        'Program Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3 success',
      ],
    };

    const count = await scanner.processTransactions([rawTxWithoutParams], true);
    // Verified: No fake swap is synthesized
    expect(count).toBe(0);

    const swaps = await db.listSwapsByPool(dummyPool);
    expect(swaps.length).toBe(0);
  });

  it('updates pool state in database upon processing swaps', async () => {
    const db = new InMemoryDatabaseClient();
    await db.insertNetwork({
      networkId,
      name: 'Solana Mainnet',
      namespace: 'solana',
      chainRef: 'mainnet-beta',
      nativeAssetSymbol: 'SOL',
      nativeAssetDecimals: 9,
      status: 'active',
      createdAt: new Date(),
    });

    await db.insertToken({
      tokenId: 'token0',
      networkId,
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      riskTier: 'LOW',
      createdAt: new Date(),
    });

    await db.insertToken({
      tokenId: 'token1',
      networkId,
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Wrapped SOL',
      decimals: 9,
      riskTier: 'LOW',
      createdAt: new Date(),
    });

    const dummyPool = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const dummyUser = 'So11111111111111111111111111111111111111112';

    // Seed pool with initial reserves
    await db.insertPool({
      poolId: dummyPool,
      networkId,
      protocol: 'amm',
      token0Id: 'token0',
      token1Id: 'token1',
      feeTier: 2500,
      reserve0: 10_000_000n,
      reserve1: 20_000_000n,
      isPaused: false,
      createdAt: new Date(),
    });

    const scanner = new SolanaScanner(
      {
        networkId,
        cluster: 'mainnet-beta',
        rpcUrl: 'http://127.0.0.1:8899',
        ammProgramId: dummyAmmProgram,
        clmmProgramId: dummyClmmProgram,
      },
      db,
    );

    const rawTx: SolanaRawTransaction = {
      signature: '5K3dTxStateUpdate',
      slot: 250000040n,
      blockTime: Math.floor(Date.now() / 1000),
      err: null,
      accounts: [dummyUser, dummyPool],
      logs: [
        'Program Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3 invoke [1]',
        'Program log: AMM_SWAP: amountIn=2000000, amountOut=1000000, zeroForOne=true',
        'Program Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3 success',
      ],
    };

    const count = await scanner.processTransactions([rawTx], true);
    expect(count).toBe(1);

    const updatedPool = await db.getPool(dummyPool);
    expect(updatedPool).toBeDefined();
    // reserve0 increased by 2_000_000, reserve1 decreased by 1_000_000
    expect(updatedPool?.reserve0).toBe(12_000_000n);
    expect(updatedPool?.reserve1).toBe(19_000_000n);
  });
});
