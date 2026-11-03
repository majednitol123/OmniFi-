import { decodeEventLog, Hex, parseAbiItem } from 'viem';
import { DecodedEvmEvent, RawLog } from './types';

export const V2_SWAP_ABI_ITEM = parseAbiItem(
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
);

export const V2_SYNC_ABI_ITEM = parseAbiItem(
  'event Sync(uint112 reserve0, uint112 reserve1)',
);

export const CLMM_SWAP_ABI_ITEM = parseAbiItem(
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
);

export class EvmEventDecoder {
  public decodeLog(log: RawLog): DecodedEvmEvent | undefined {
    if (!log.topics || log.topics.length === 0) return undefined;
    const topic0 = log.topics[0]?.toLowerCase();

    // V2 Swap: 0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822
    if (topic0 === '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822') {
      try {
        const decoded = decodeEventLog({
          abi: [V2_SWAP_ABI_ITEM],
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });

        const args = decoded.args as any;
        return {
          type: 'V2_SWAP',
          poolAddress: log.address,
          sender: args.sender,
          recipient: args.to,
          amount0In: BigInt(args.amount0In),
          amount1In: BigInt(args.amount1In),
          amount0Out: BigInt(args.amount0Out),
          amount1Out: BigInt(args.amount1Out),
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        };
      } catch {
        return undefined;
      }
    }

    // V2 Sync: 0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1
    if (topic0 === '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1') {
      try {
        const decoded = decodeEventLog({
          abi: [V2_SYNC_ABI_ITEM],
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });

        const args = decoded.args as any;
        return {
          type: 'V2_SYNC',
          poolAddress: log.address,
          reserve0: BigInt(args.reserve0),
          reserve1: BigInt(args.reserve1),
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        };
      } catch {
        return undefined;
      }
    }

    // CLMM Swap: 0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67
    if (topic0 === '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67') {
      try {
        const decoded = decodeEventLog({
          abi: [CLMM_SWAP_ABI_ITEM],
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });

        const args = decoded.args as any;
        return {
          type: 'CLMM_SWAP',
          poolAddress: log.address,
          sender: args.sender,
          recipient: args.recipient,
          amount0: BigInt(args.amount0),
          amount1: BigInt(args.amount1),
          sqrtPriceX96: BigInt(args.sqrtPriceX96),
          liquidity: BigInt(args.liquidity),
          tick: Number(args.tick),
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
        };
      } catch {
        return undefined;
      }
    }

    return undefined;
  }
}

