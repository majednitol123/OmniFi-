import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { OmniFiSolanaClient } from '../client';
import {
  decodeAmmPoolState,
  decodeClmmPoolState,
  decodePositionAccount,
} from '../serialization';

describe('OmniFiSolanaClient', () => {
  const dummyConnection = new Connection('http://127.0.0.1:8899', 'confirmed');
  const client = new OmniFiSolanaClient({
    connection: dummyConnection,
  });

  const dummyUser = Keypair.generate().publicKey;
  const dummyMint0 = Keypair.generate().publicKey;
  const dummyMint1 = Keypair.generate().publicKey;
  const dummyVault0 = Keypair.generate().publicKey;
  const dummyVault1 = Keypair.generate().publicKey;
  const dummyPool = Keypair.generate().publicKey;
  const dummyConfig = Keypair.generate().publicKey;
  const dummyPosition = Keypair.generate().publicKey;
  const dummyTickArray = Keypair.generate().publicKey;
  const dummyBlockhash = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM';

  it('derives ATA and builds create ATA instruction correctly', () => {
    const ata = client.getAssociatedTokenAddress(dummyMint0, dummyUser);
    expect(ata).toBeInstanceOf(PublicKey);

    const ix = client.buildCreateAtaInstruction(dummyUser, dummyUser, dummyMint0);
    expect(ix.keys[0]?.pubkey.equals(dummyUser)).toBe(true);
    expect(ix.keys[1]?.pubkey.equals(ata)).toBe(true);
  });

  it('builds AMM swap transaction as VersionedTransaction', async () => {
    const userSource = client.getAssociatedTokenAddress(dummyMint0, dummyUser);
    const userDestination = client.getAssociatedTokenAddress(dummyMint1, dummyUser);

    const tx = await client.buildAmmSwapTransaction({
      user: dummyUser,
      poolState: dummyPool,
      tokenVault0: dummyVault0,
      tokenVault1: dummyVault1,
      userSource,
      userDestination,
      amountIn: 1_000_000n,
      minimumAmountOut: 990_000n,
      zeroForOne: true,
      recentBlockhash: dummyBlockhash,
    });

    expect(tx.message.recentBlockhash).toBe(dummyBlockhash);
    expect(tx.message.staticAccountKeys.length).toBeGreaterThan(0);
  });

  it('builds CLMM swap transaction as VersionedTransaction', async () => {
    const userSource = client.getAssociatedTokenAddress(dummyMint0, dummyUser);
    const userDestination = client.getAssociatedTokenAddress(dummyMint1, dummyUser);

    const tx = await client.buildClmmSwapTransaction({
      user: dummyUser,
      config: dummyConfig,
      poolState: dummyPool,
      tokenVault0: dummyVault0,
      tokenVault1: dummyVault1,
      userSource,
      userDestination,
      tickArrays: [dummyTickArray],
      amount: 50_000_000n,
      otherAmountThreshold: 49_000_000n,
      sqrtPriceLimitX64: 0n,
      isExactInput: true,
      zeroForOne: true,
      recentBlockhash: dummyBlockhash,
    });

    expect(tx.message.recentBlockhash).toBe(dummyBlockhash);
    expect(tx.message.staticAccountKeys.length).toBeGreaterThan(0);
  });

  it('builds CLMM position transactions correctly', async () => {
    const openTx = await client.buildOpenPositionTransaction({
      payer: dummyUser,
      owner: dummyUser,
      poolState: dummyPool,
      position: dummyPosition,
      tickLowerIndex: -120,
      tickUpperIndex: 120,
      recentBlockhash: dummyBlockhash,
    });
    expect(openTx.message.recentBlockhash).toBe(dummyBlockhash);

    const increaseTx = await client.buildIncreaseLiquidityTransaction({
      owner: dummyUser,
      poolState: dummyPool,
      position: dummyPosition,
      config: dummyConfig,
      tokenVault0: dummyVault0,
      tokenVault1: dummyVault1,
      userToken0: dummyVault0,
      userToken1: dummyVault1,
      tickArrayLower: dummyTickArray,
      liquidityDelta: 100_000n,
      amount0Max: 10_000n,
      amount1Max: 10_000n,
      recentBlockhash: dummyBlockhash,
    });
    expect(increaseTx.message.recentBlockhash).toBe(dummyBlockhash);

    const collectTx = await client.buildCollectFeesTransaction({
      owner: dummyUser,
      poolState: dummyPool,
      position: dummyPosition,
      tokenVault0: dummyVault0,
      tokenVault1: dummyVault1,
      recipientToken0: dummyVault0,
      recipientToken1: dummyVault1,
      recentBlockhash: dummyBlockhash,
    });
    expect(collectTx.message.recentBlockhash).toBe(dummyBlockhash);
  });

  it('decodes mock serialized AMM pool state buffer', () => {
    const buffer = Buffer.alloc(247);
    // Write 8-byte discriminator
    buffer.fill(0xaa, 0, 8);
    // Pubkeys at offsets:
    dummyConfig.toBuffer().copy(buffer, 8);
    dummyMint0.toBuffer().copy(buffer, 40);
    dummyMint1.toBuffer().copy(buffer, 72);
    dummyVault0.toBuffer().copy(buffer, 104);
    dummyVault1.toBuffer().copy(buffer, 136);
    dummyPool.toBuffer().copy(buffer, 168); // lpMint
    buffer.writeUInt32LE(3000, 200); // feeTier
    buffer.writeBigUInt64LE(1_000_000_000n, 204); // reserve0
    buffer.writeBigUInt64LE(2_000_000_000n, 212); // reserve1
    buffer.writeBigUInt64LE(500_000_000n, 220); // lpSupply
    buffer.writeBigUInt64LE(100n, 228); // protocolFees0
    buffer.writeBigUInt64LE(200n, 236); // protocolFees1
    buffer.writeUInt8(254, 244); // bump
    buffer.writeUInt8(253, 245); // authorityBump
    buffer.writeUInt8(0, 246); // isPaused

    const decoded = decodeAmmPoolState(buffer);
    expect(decoded.config.equals(dummyConfig)).toBe(true);
    expect(decoded.reserve0).toBe(1_000_000_000n);
    expect(decoded.reserve1).toBe(2_000_000_000n);
    expect(decoded.feeTier).toBe(3000);
    expect(decoded.isPaused).toBe(false);
  });

  it('decodes mock serialized CLMM pool state buffer', () => {
    const buffer = Buffer.alloc(261);
    buffer.fill(0xbb, 0, 8);
    dummyConfig.toBuffer().copy(buffer, 8);
    dummyMint0.toBuffer().copy(buffer, 40);
    dummyMint1.toBuffer().copy(buffer, 72);
    dummyVault0.toBuffer().copy(buffer, 104);
    dummyVault1.toBuffer().copy(buffer, 136);
    buffer.writeUInt32LE(500, 168); // feeTier
    buffer.writeUInt16LE(10, 172); // tickSpacing
    // sqrtPriceX64 = 1.0 << 64 (low 0, high 1)
    buffer.writeBigUInt64LE(0n, 174);
    buffer.writeBigUInt64LE(1n, 182);
    buffer.writeInt32LE(20, 190); // currentTick
    // liquidity
    buffer.writeBigUInt64LE(5000000n, 194);
    buffer.writeBigUInt64LE(0n, 202);

    const decoded = decodeClmmPoolState(buffer);
    expect(decoded.feeTier).toBe(500);
    expect(decoded.tickSpacing).toBe(10);
    expect(decoded.sqrtPriceX64).toBe(1n << 64n);
    expect(decoded.currentTick).toBe(20);
    expect(decoded.liquidity).toBe(5000000n);
  });
});
