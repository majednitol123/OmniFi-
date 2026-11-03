import { PublicKey } from '@solana/web3.js';
import {
  ClmmPoolState,
  GlobalConfigAccount,
  PoolStateAccount,
  PositionAccount,
  Tick,
  TickArrayAccount,
} from './types';

function readBigUInt128LE(buf: Buffer, offset: number): bigint {
  const low = buf.readBigUInt64LE(offset);
  const high = buf.readBigUInt64LE(offset + 8);
  return (high << 64n) | low;
}

function readBigInt128LE(buf: Buffer, offset: number): bigint {
  const low = buf.readBigUInt64LE(offset);
  const high = buf.readBigInt64LE(offset + 8);
  return (high << 64n) | low;
}

export function decodeAmmPoolState(data: Buffer): PoolStateAccount {
  // 8-byte Anchor discriminator + fields
  const offset = 8;
  const config = new PublicKey(data.subarray(offset, offset + 32));
  const tokenMint0 = new PublicKey(data.subarray(offset + 32, offset + 64));
  const tokenMint1 = new PublicKey(data.subarray(offset + 64, offset + 96));
  const tokenVault0 = new PublicKey(data.subarray(offset + 96, offset + 128));
  const tokenVault1 = new PublicKey(data.subarray(offset + 128, offset + 160));
  const lpMint = new PublicKey(data.subarray(offset + 160, offset + 192));
  const feeTier = data.readUInt32LE(offset + 192) as any;
  const reserve0 = data.readBigUInt64LE(offset + 196);
  const reserve1 = data.readBigUInt64LE(offset + 204);
  const lpSupply = data.readBigUInt64LE(offset + 212);
  const protocolFees0 = data.readBigUInt64LE(offset + 220);
  const protocolFees1 = data.readBigUInt64LE(offset + 228);
  const bump = data.readUInt8(offset + 236);
  const authorityBump = data.readUInt8(offset + 237);
  const isPaused = data.readUInt8(offset + 238) === 1;

  return {
    config,
    tokenMint0,
    tokenMint1,
    tokenVault0,
    tokenVault1,
    lpMint,
    feeTier,
    reserve0,
    reserve1,
    lpSupply,
    protocolFees0,
    protocolFees1,
    bump,
    authorityBump,
    isPaused,
  };
}

export function decodeClmmPoolState(data: Buffer): ClmmPoolState {
  const offset = 8;
  const config = new PublicKey(data.subarray(offset, offset + 32));
  const tokenMint0 = new PublicKey(data.subarray(offset + 32, offset + 64));
  const tokenMint1 = new PublicKey(data.subarray(offset + 64, offset + 96));
  const tokenVault0 = new PublicKey(data.subarray(offset + 96, offset + 128));
  const tokenVault1 = new PublicKey(data.subarray(offset + 128, offset + 160));
  const feeTier = data.readUInt32LE(offset + 160);
  const tickSpacing = data.readUInt16LE(offset + 164);
  const sqrtPriceX64 = readBigUInt128LE(data, offset + 166);
  const currentTick = data.readInt32LE(offset + 182);
  const liquidity = readBigUInt128LE(data, offset + 186);
  const feeGrowthGlobal0X64 = readBigUInt128LE(data, offset + 202);
  const feeGrowthGlobal1X64 = readBigUInt128LE(data, offset + 218);
  const protocolFees0 = data.readBigUInt64LE(offset + 234);
  const protocolFees1 = data.readBigUInt64LE(offset + 242);
  const bump = data.readUInt8(offset + 250);
  const authorityBump = data.readUInt8(offset + 251);
  const isPaused = data.readUInt8(offset + 252) === 1;

  return {
    config,
    tokenMint0,
    tokenMint1,
    tokenVault0,
    tokenVault1,
    feeTier,
    tickSpacing,
    sqrtPriceX64,
    currentTick,
    liquidity,
    feeGrowthGlobal0X64,
    feeGrowthGlobal1X64,
    protocolFees0,
    protocolFees1,
    bump,
    authorityBump,
    isPaused,
  };
}

export function decodePositionAccount(data: Buffer): PositionAccount {
  const offset = 8;
  const pool = new PublicKey(data.subarray(offset, offset + 32));
  const owner = new PublicKey(data.subarray(offset + 32, offset + 64));
  const tickLowerIndex = data.readInt32LE(offset + 64);
  const tickUpperIndex = data.readInt32LE(offset + 68);
  const liquidity = readBigUInt128LE(data, offset + 72);
  const feeGrowthInside0LastX64 = readBigUInt128LE(data, offset + 88);
  const feeGrowthInside1LastX64 = readBigUInt128LE(data, offset + 104);
  const tokensOwed0 = data.readBigUInt64LE(offset + 120);
  const tokensOwed1 = data.readBigUInt64LE(offset + 128);
  const bump = data.readUInt8(offset + 136);

  return {
    pool,
    owner,
    tickLowerIndex,
    tickUpperIndex,
    liquidity,
    feeGrowthInside0LastX64,
    feeGrowthInside1LastX64,
    tokensOwed0,
    tokensOwed1,
    bump,
  };
}

export function decodeTickArrayAccount(data: Buffer): TickArrayAccount {
  const offset = 8;
  const pool = new PublicKey(data.subarray(offset, offset + 32));
  const startTickIndex = data.readInt32LE(offset + 32);
  const bump = data.readUInt8(offset + 36);
  const tickCount = data.readUInt32LE(offset + 37);

  const ticks: Tick[] = [];
  let currentOffset = offset + 41;

  for (let i = 0; i < tickCount; i++) {
    const initialized = data.readUInt8(currentOffset) === 1;
    const liquidityNet = readBigInt128LE(data, currentOffset + 1);
    const liquidityGross = readBigUInt128LE(data, currentOffset + 17);
    const feeGrowthOutside0X64 = readBigUInt128LE(data, currentOffset + 33);
    const feeGrowthOutside1X64 = readBigUInt128LE(data, currentOffset + 49);

    ticks.push({
      initialized,
      liquidityNet,
      liquidityGross,
      feeGrowthOutside0X64,
      feeGrowthOutside1X64,
    });
    currentOffset += 65;
  }

  return {
    pool,
    startTickIndex,
    bump,
    ticks,
  };
}

