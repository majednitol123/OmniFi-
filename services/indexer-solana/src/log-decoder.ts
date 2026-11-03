import { DecodedSolanaEvent, SolanaRawTransaction } from './types';

function parseBigIntParam(log: string, paramName: string): bigint | undefined {
  const regex = new RegExp(`${paramName}[=:]\\s*(\\d+)`, 'i');
  const match = log.match(regex);
  return match && match[1] ? BigInt(match[1]) : undefined;
}

function parseBoolParam(log: string, paramName: string): boolean | undefined {
  const regex = new RegExp(`${paramName}[=:]\\s*(true|false)`, 'i');
  const match = log.match(regex);
  return match && match[1] ? match[1].toLowerCase() === 'true' : undefined;
}

function parseNumberParam(log: string, paramName: string): number | undefined {
  const regex = new RegExp(`${paramName}[=:]\\s*(-?\\d+)`, 'i');
  const match = log.match(regex);
  return match && match[1] ? parseInt(match[1], 10) : undefined;
}

function decodeAnchorData(log: string): Buffer | null {
  if (!log.startsWith('Program data: ')) return null;
  try {
    const b64 = log.slice('Program data: '.length).trim();
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

export class SolanaLogDecoder {
  public decodeTransaction(tx: SolanaRawTransaction): DecodedSolanaEvent[] {
    const events: DecodedSolanaEvent[] = [];
    if (tx.err) return events; // Failed transactions are not parsed into state updates

    let logIndex = 0;
    for (const log of tx.logs) {
      const anchorData = decodeAnchorData(log);

      // 1. Detect AMM Swap via Anchor event binary (25 bytes) or parameterized log
      if (anchorData && anchorData.length >= 25 && anchorData.length < 32) {
        const poolAddress = tx.accounts[1] ?? 'unknown_pool';
        const user = tx.accounts[7] ?? tx.accounts[0] ?? 'unknown_user';
        const amountIn = anchorData.readBigUInt64LE(8);
        const amountOut = anchorData.readBigUInt64LE(16);
        const zeroForOne = anchorData.readUInt8(24) === 1;

        events.push({
          type: 'AMM_SWAP',
          poolAddress,
          user,
          amountIn,
          amountOut,
          zeroForOne,
          slot: tx.slot,
          signature: tx.signature,
          logIndex: logIndex++,
        });
      } else if (
        log.includes('AMM_SWAP') ||
        log.includes('Instruction: SwapExactInput') ||
        log.includes('Instruction: SwapExactOutput')
      ) {
        const parsedIn = parseBigIntParam(log, 'amountIn') ?? parseBigIntParam(log, 'amount_in');
        const parsedOut = parseBigIntParam(log, 'amountOut') ?? parseBigIntParam(log, 'amount_out');
        const parsedZero = parseBoolParam(log, 'zeroForOne') ?? parseBoolParam(log, 'zero_for_one');

        // Only emit event if genuine amounts were found; never inject fake fallback numbers
        if (parsedIn !== undefined && parsedOut !== undefined) {
          const poolAddress = tx.accounts[1] ?? 'unknown_pool';
          const user = tx.accounts[7] ?? tx.accounts[0] ?? 'unknown_user';
          events.push({
            type: 'AMM_SWAP',
            poolAddress,
            user,
            amountIn: parsedIn,
            amountOut: parsedOut,
            zeroForOne: parsedZero !== undefined ? parsedZero : true,
            slot: tx.slot,
            signature: tx.signature,
            logIndex: logIndex++,
          });
        }
      }

      // 2. Detect CLMM Swap via Anchor event binary (45 bytes) or parameterized log
      if (anchorData && anchorData.length >= 45) {
        const poolAddress = tx.accounts[1] ?? 'unknown_clmm_pool';
        const user = tx.accounts[7] ?? tx.accounts[0] ?? 'unknown_user';
        const amountIn = anchorData.readBigUInt64LE(8);
        const amountOut = anchorData.readBigUInt64LE(16);
        const sqrtLow = BigInt(anchorData.readBigUInt64LE(24));
        const sqrtHigh = BigInt(anchorData.readBigUInt64LE(32));
        const sqrtPriceAfterX64 = sqrtLow | (sqrtHigh << 64n);
        const tickAfter = anchorData.readInt32LE(40);
        const zeroForOne = anchorData.readUInt8(44) === 1;

        events.push({
          type: 'CLMM_SWAP',
          poolAddress,
          user,
          amountIn,
          amountOut,
          sqrtPriceAfterX64,
          tickAfter,
          zeroForOne,
          slot: tx.slot,
          signature: tx.signature,
          logIndex: logIndex++,
        });
      } else if (
        log.includes('CLMM_SWAP') ||
        (log.includes('Instruction: Swap') && !log.includes('SwapExactInput'))
      ) {
        const parsedIn = parseBigIntParam(log, 'amountIn') ?? parseBigIntParam(log, 'amount_in');
        const parsedOut = parseBigIntParam(log, 'amountOut') ?? parseBigIntParam(log, 'amount_out');
        const parsedSqrt =
          parseBigIntParam(log, 'sqrtPriceAfter') ??
          parseBigIntParam(log, 'sqrt_price_after') ??
          parseBigIntParam(log, 'sqrtPriceX64') ??
          parseBigIntParam(log, 'sqrt_price_x64');
        const parsedTick =
          parseNumberParam(log, 'tickAfter') ??
          parseNumberParam(log, 'tick_after') ??
          parseNumberParam(log, 'tick');
        const parsedZero = parseBoolParam(log, 'zeroForOne') ?? parseBoolParam(log, 'zero_for_one');

        // Only emit if genuine parameters were successfully parsed; never inject fake fallback numbers
        if (
          parsedIn !== undefined &&
          parsedOut !== undefined &&
          parsedSqrt !== undefined &&
          parsedTick !== undefined
        ) {
          const poolAddress = tx.accounts[1] ?? 'unknown_clmm_pool';
          const user = tx.accounts[7] ?? tx.accounts[0] ?? 'unknown_user';
          events.push({
            type: 'CLMM_SWAP',
            poolAddress,
            user,
            amountIn: parsedIn,
            amountOut: parsedOut,
            sqrtPriceAfterX64: parsedSqrt,
            tickAfter: parsedTick,
            zeroForOne: parsedZero !== undefined ? parsedZero : true,
            slot: tx.slot,
            signature: tx.signature,
            logIndex: logIndex++,
          });
        }
      }

      // 3. Detect CLMM Position Updates via Anchor event binary (32 bytes) or parameterized log
      if (anchorData && anchorData.length >= 32 && anchorData.length < 45) {
        const poolAddress = tx.accounts[0] ?? 'unknown_clmm_pool';
        const positionAddress = tx.accounts[1] ?? 'unknown_position';
        const owner = tx.accounts[2] ?? tx.accounts[0] ?? 'unknown_owner';
        const tickLower = anchorData.readInt32LE(8);
        const tickUpper = anchorData.readInt32LE(12);
        const liqLow = BigInt(anchorData.readBigUInt64LE(16));
        const liqHigh = BigInt(anchorData.readBigUInt64LE(24));
        const liquidityDelta = liqLow | (liqHigh << 64n);

        events.push({
          type: 'CLMM_POSITION_UPDATE',
          poolAddress,
          owner,
          positionAddress,
          tickLower,
          tickUpper,
          liquidityDelta,
          slot: tx.slot,
          signature: tx.signature,
          logIndex: logIndex++,
        });
      } else if (
        log.includes('Instruction: OpenPosition') ||
        log.includes('Instruction: IncreaseLiquidity') ||
        log.includes('Instruction: DecreaseLiquidity') ||
        log.includes('CLMM_POSITION')
      ) {
        const parsedTickLower =
          parseNumberParam(log, 'tickLower') ?? parseNumberParam(log, 'tick_lower');
        const parsedTickUpper =
          parseNumberParam(log, 'tickUpper') ?? parseNumberParam(log, 'tick_upper');
        const parsedLiq =
          parseBigIntParam(log, 'liquidityDelta') ??
          parseBigIntParam(log, 'liquidity_delta') ??
          parseBigIntParam(log, 'liquidity');

        // Only emit if genuine parameters were successfully parsed; never inject fake fallback numbers
        if (
          parsedTickLower !== undefined &&
          parsedTickUpper !== undefined &&
          parsedLiq !== undefined
        ) {
          const poolAddress = tx.accounts[0] ?? 'unknown_clmm_pool';
          const positionAddress = tx.accounts[1] ?? 'unknown_position';
          const owner = tx.accounts[2] ?? tx.accounts[0] ?? 'unknown_owner';
          events.push({
            type: 'CLMM_POSITION_UPDATE',
            poolAddress,
            owner,
            positionAddress,
            tickLower: parsedTickLower,
            tickUpper: parsedTickUpper,
            liquidityDelta: parsedLiq,
            slot: tx.slot,
            signature: tx.signature,
            logIndex: logIndex++,
          });
        }
      }
    }

    return events;
  }
}
