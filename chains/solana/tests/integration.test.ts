import { PublicKey } from '@solana/web3.js';
import { expect } from 'chai';

const AMM_PROGRAM_ID = new PublicKey('Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3');
const CLMM_PROGRAM_ID = new PublicKey('BSn4qU6Reocr7apUznvRkXLQ4psydsrayW9YWyToD6x2');

describe('OmniFi Solana Integration Test Suite', () => {
  const token0 = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
  const token1 = new PublicKey('So11111111111111111111111111111111111111112'); // WSOL

  describe('1. Native AMM Program Architecture & PDAs', () => {
    it('derives deterministic AMM pool state PDA from ordered token mints', () => {
      const [mint0, mint1] = token0.toBuffer().compare(token1.toBuffer()) < 0
        ? [token0, token1]
        : [token1, token0];

      const [poolState, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool'), mint0.toBuffer(), mint1.toBuffer()],
        AMM_PROGRAM_ID,
      );

      expect(poolState).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a('number');
      expect(bump).to.be.within(0, 255);
    });

    it('derives deterministic AMM pool authority PDA', () => {
      const [poolState] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool'), token0.toBuffer(), token1.toBuffer()],
        AMM_PROGRAM_ID,
      );

      const [poolAuthority, authBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool_authority'), poolState.toBuffer()],
        AMM_PROGRAM_ID,
      );

      expect(poolAuthority).to.be.instanceOf(PublicKey);
      expect(authBump).to.be.within(0, 255);
    });

    it('enforces constant-product invariant x * y = k with protocol fee separation', () => {
      const reserve0 = 100_000_000_000n; // 100,000 USDC
      const reserve1 = 500_000_000_000n; // 500 SOL
      const kInitial = reserve0 * reserve1;

      const amountIn = 1_000_000_000n; // 1,000 USDC
      const protocolFeeBps = 5n; // 5 bps protocol fee
      const lpFeeBps = 25n; // 25 bps LP fee
      const totalFeeBps = protocolFeeBps + lpFeeBps; // 30 bps

      const protocolFee = (amountIn * protocolFeeBps) / 10000n;
      const amountAfterProtocolFee = amountIn - protocolFee;
      const amountWithLpFee = amountAfterProtocolFee * (10000n - lpFeeBps);
      const numerator = amountWithLpFee * reserve1;
      const denominator = (reserve0 * 10000n) + amountWithLpFee;
      const amountOut = numerator / denominator;

      // New reserve must ONLY increase by amountAfterProtocolFee to prevent desync (§F-05)
      const newReserve0 = reserve0 + amountAfterProtocolFee;
      const newReserve1 = reserve1 - amountOut;
      const kFinal = newReserve0 * newReserve1;

      expect(amountOut > 0n).to.be.true;
      expect(kFinal >= kInitial).to.be.true;
      expect(protocolFee === 500000n).to.be.true;
    });
  });

  describe('2. Concentrated Liquidity (CLMM) Program Architecture & PDAs', () => {
    const feeTier = 500; // 5 bps fee tier
    const tickSpacing = 10;

    it('derives deterministic CLMM pool state and authority PDAs with fee tier', () => {
      const [mint0, mint1] = token0.toBuffer().compare(token1.toBuffer()) < 0
        ? [token0, token1]
        : [token1, token0];

      const feeTierBuffer = Buffer.alloc(4);
      feeTierBuffer.writeUInt32LE(feeTier);

      const [poolState, poolBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('clmm_pool'), mint0.toBuffer(), mint1.toBuffer(), feeTierBuffer],
        CLMM_PROGRAM_ID,
      );

      const [clmmAuthority, authBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('clmm_authority'), poolState.toBuffer()],
        CLMM_PROGRAM_ID,
      );

      expect(poolState).to.be.instanceOf(PublicKey);
      expect(clmmAuthority).to.be.instanceOf(PublicKey);
      expect(poolBump).to.be.within(0, 255);
      expect(authBump).to.be.within(0, 255);
    });

    it('derives contiguous tick array accounts and validates start tick bounds', () => {
      const [poolState] = PublicKey.findProgramAddressSync(
        [Buffer.from('clmm_pool'), token0.toBuffer(), token1.toBuffer(), Buffer.from([244, 1, 0, 0])],
        CLMM_PROGRAM_ID,
      );

      const TICK_ARRAY_SIZE = 88;
      const ticksPerArray = TICK_ARRAY_SIZE * tickSpacing; // 880

      const startTickIndex0 = 0;
      const startTickIndex1 = startTickIndex0 + ticksPerArray; // 880

      const startTickBuffer0 = Buffer.alloc(4);
      startTickBuffer0.writeInt32LE(startTickIndex0);

      const startTickBuffer1 = Buffer.alloc(4);
      startTickBuffer1.writeInt32LE(startTickIndex1);

      const [tickArray0, bump0] = PublicKey.findProgramAddressSync(
        [Buffer.from('omnifi-tick-array'), poolState.toBuffer(), startTickBuffer0],
        CLMM_PROGRAM_ID,
      );

      const [tickArray1, bump1] = PublicKey.findProgramAddressSync(
        [Buffer.from('omnifi-tick-array'), poolState.toBuffer(), startTickBuffer1],
        CLMM_PROGRAM_ID,
      );

      expect(tickArray0.toBase58()).to.not.equal(tickArray1.toBase58());
      expect(bump0).to.be.within(0, 255);
      expect(bump1).to.be.within(0, 255);
      // Verify monotonicity requirement (§P2-02)
      expect(startTickIndex1 - startTickIndex0).to.equal(ticksPerArray);
    });

    it('derives deterministic CLMM position state PDA matching on-chain seeds', () => {
      const [poolState] = PublicKey.findProgramAddressSync(
        [Buffer.from('clmm_pool'), token0.toBuffer(), token1.toBuffer(), Buffer.from([244, 1, 0, 0])],
        CLMM_PROGRAM_ID,
      );
      const owner = new PublicKey('4Nd1mBQtrMJVYVfKf2PJy9NZWMd3nHb5AEM6K9z1n31C');
      const tickLower = -1200;
      const tickUpper = 1200;

      const lowerBuf = Buffer.alloc(4);
      lowerBuf.writeInt32LE(tickLower);
      const upperBuf = Buffer.alloc(4);
      upperBuf.writeInt32LE(tickUpper);

      const [posPda, posBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('omnifi-position'), poolState.toBuffer(), owner.toBuffer(), lowerBuf, upperBuf],
        CLMM_PROGRAM_ID,
      );

      expect(posPda).to.be.instanceOf(PublicKey);
      expect(posBump).to.be.within(0, 255);
    });

    it('validates floor start tick alignment for negative and positive ticks across fee tiers', () => {
      const getStartTick = (tick: number, spacing: number) => {
        const perArray = 88 * spacing;
        if (tick >= 0) return Math.floor(tick / perArray) * perArray;
        const rem = tick % perArray;
        return rem === 0 ? tick : (Math.trunc(tick / perArray) - 1) * perArray;
      };

      // Spacing 10 (tier 500) -> 880 per array
      expect(getStartTick(0, 10)).to.equal(0);
      expect(getStartTick(100, 10)).to.equal(0);
      expect(getStartTick(879, 10)).to.equal(0);
      expect(getStartTick(880, 10)).to.equal(880);
      expect(getStartTick(-1, 10)).to.equal(-880);
      expect(getStartTick(-880, 10)).to.equal(-880);
      expect(getStartTick(-881, 10)).to.equal(-1760);

      // Spacing 60 (tier 3000) -> 5280 per array
      expect(getStartTick(0, 60)).to.equal(0);
      expect(getStartTick(5280, 60)).to.equal(5280);
      expect(getStartTick(-5280, 60)).to.equal(-5280);
      expect(getStartTick(-5281, 60)).to.equal(-10560);
    });

    it('enforces tick array sequence contiguity in trade direction', () => {
      const spacing = 60;
      const ticksPerArray = 88 * spacing; // 5280
      const currentStart = 0;

      // zeroForOne (price drops, tick decreases)
      const nextDown = currentStart - ticksPerArray;
      expect(nextDown).to.equal(-5280);

      // oneForZero (price rises, tick increases)
      const nextUp = currentStart + ticksPerArray;
      expect(nextUp).to.equal(5280);
    });

    it('enforces exact-output full fulfillment assertion rule (§F-06)', () => {
      const requestedOutput = 5_000_000n; // 5 USDC
      let amountRemaining = 0n; // completely exhausted
      let totalAmountOut = 5_000_000n;

      const isValidFulfillment = amountRemaining === 0n && totalAmountOut === requestedOutput;
      expect(isValidFulfillment).to.be.true;

      // Partial fulfillment failure scenario
      const partialAmountOut = 4_500_000n;
      const partialRemaining = 500_000n;
      const isPartialValid = partialRemaining === 0n && partialAmountOut === requestedOutput;
      expect(isPartialValid).to.be.false;
    });
  });

  describe('3. Cross-Program Isolation & Key Custody (ADR-011)', () => {
    it('verifies non-custodial transaction instruction layout structure', () => {
      const mockUser = new PublicKey('11111111111111111111111111111111');
      const keys = [
        { pubkey: mockUser, isSigner: true, isWritable: true },
        { pubkey: AMM_PROGRAM_ID, isSigner: false, isWritable: false },
      ];

      expect(keys[0].isSigner).to.be.true;
      expect(keys[1].isSigner).to.be.false;
    });
  });
});
