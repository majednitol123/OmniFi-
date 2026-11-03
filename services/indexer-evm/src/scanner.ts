import { OmniFiDatabaseClient } from '@omnifi/database';
import { Hex } from 'viem';
import { EvmEventDecoder } from './event-decoder';
import { DecodedEvmEvent, EvmIndexerConfig, RawLog } from './types';

export class EvmScanner {
  public readonly config: EvmIndexerConfig;
  public readonly db: OmniFiDatabaseClient;
  public readonly decoder: EvmEventDecoder;

  // Track recent block hashes in memory for quick reorg detection: blockNumber -> blockHash
  private readonly blockHashHistory = new Map<bigint, Hex>();

  constructor(config: EvmIndexerConfig, db: OmniFiDatabaseClient) {
    this.config = config;
    this.db = db;
    this.decoder = new EvmEventDecoder();
  }

  public registerBlockHash(blockNumber: bigint, blockHash: Hex): void {
    this.blockHashHistory.set(blockNumber, blockHash);
  }

  public detectReorg(blockNumber: bigint, parentHash: Hex): bigint | undefined {
    const prevBlock = blockNumber - 1n;
    const knownPrevHash = this.blockHashHistory.get(prevBlock);
    if (knownPrevHash && knownPrevHash.toLowerCase() !== parentHash.toLowerCase()) {
      // Reorg detected! Known previous hash diverges from current block's reported parent hash.
      // Search backwards for common ancestor
      let commonAncestor = prevBlock - 1n;
      while (commonAncestor > 0n) {
        if (this.blockHashHistory.has(commonAncestor)) {
          break;
        }
        commonAncestor -= 1n;
      }
      return commonAncestor > 0n ? commonAncestor : 0n;
    }
    return undefined;
  }

  public async handleReorg(forkBlock: bigint, commonAncestor: bigint): Promise<number> {
    const rolledBack = await this.db.rollbackUnfinalizedEvents(
      this.config.networkId,
      commonAncestor,
    );

    // Prune invalidated block history
    for (const b of Array.from(this.blockHashHistory.keys())) {
      if (b > commonAncestor) {
        this.blockHashHistory.delete(b);
      }
    }

    await this.db.recordReorg({
      reorgId: `reorg-${Date.now()}`,
      networkId: this.config.networkId,
      forkBlockOrSlot: forkBlock,
      commonAncestorBlock: commonAncestor,
      eventsRolledBack: rolledBack,
      detectedAt: new Date(),
    });

    await this.db.logAudit({
      logId: `audit-reorg-${Date.now()}`,
      source: 'indexer-evm',
      action: 'REORG_RECOVERY_EXECUTED',
      details: {
        networkId: this.config.networkId,
        forkBlock: forkBlock.toString(),
        commonAncestor: commonAncestor.toString(),
        eventsRolledBack: rolledBack,
      },
      timestamp: new Date(),
    });

    return rolledBack;
  }

  public async processLogs(logs: RawLog[], currentFinalizedBlock: bigint): Promise<number> {
    let processed = 0;

    for (const log of logs) {
      // 1. Ingest raw immutable chain event
      await this.db.insertChainEvent({
        eventId: `${this.config.networkId}:${log.transactionHash}:${log.logIndex}`,
        networkId: this.config.networkId,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumberOrSlot: log.blockNumber,
        blockHash: log.blockHash,
        eventName: log.topics[0] ?? '0x',
        payload: {
          address: log.address,
          data: log.data,
          topics: log.topics,
        },
        finalized: log.blockNumber <= currentFinalizedBlock,
        createdAt: new Date(),
      });

      // 2. Decode domain event
      const decoded = this.decoder.decodeLog(log);
      if (!decoded) continue;

      if (decoded.type === 'V2_SWAP') {
        await this.db.insertSwap({
          swapId: `${this.config.networkId}:${decoded.txHash}:${decoded.logIndex}`,
          networkId: this.config.networkId,
          poolId: decoded.poolAddress.toLowerCase(),
          txHash: decoded.txHash,
          blockNumberOrSlot: decoded.blockNumber,
          blockTimestamp: new Date(),
          sender: decoded.sender,
          recipient: decoded.recipient,
          amount0In: decoded.amount0In,
          amount1In: decoded.amount1In,
          amount0Out: decoded.amount0Out,
          amount1Out: decoded.amount1Out,
          eventIndex: decoded.logIndex,
          finalized: decoded.blockNumber <= currentFinalizedBlock,
          createdAt: new Date(),
        });
        processed++;
      } else if (decoded.type === 'V2_SYNC') {
        await this.db.insertChainEvent({
          eventId: `${this.config.networkId}:${decoded.txHash}:${decoded.logIndex}:sync`,
          networkId: this.config.networkId,
          txHash: decoded.txHash,
          logIndex: decoded.logIndex,
          blockNumberOrSlot: decoded.blockNumber,
          blockHash: decoded.blockHash,
          eventName: 'Sync',
          payload: {
            poolAddress: decoded.poolAddress,
            reserve0: decoded.reserve0.toString(),
            reserve1: decoded.reserve1.toString(),
          },
          finalized: decoded.blockNumber <= currentFinalizedBlock,
          createdAt: new Date(),
        });

        // Persist reserve update to database pools
        await this.db.updatePoolState(decoded.poolAddress.toLowerCase(), {
          reserve0: decoded.reserve0,
          reserve1: decoded.reserve1,
        });

        processed++;
      } else if (decoded.type === 'CLMM_SWAP') {
        const amount0In = decoded.amount0 > 0n ? decoded.amount0 : 0n;
        const amount1In = decoded.amount1 > 0n ? decoded.amount1 : 0n;
        const amount0Out = decoded.amount0 < 0n ? -decoded.amount0 : 0n;
        const amount1Out = decoded.amount1 < 0n ? -decoded.amount1 : 0n;

        await this.db.insertSwap({
          swapId: `${this.config.networkId}:${decoded.txHash}:${decoded.logIndex}`,
          networkId: this.config.networkId,
          poolId: decoded.poolAddress.toLowerCase(),
          txHash: decoded.txHash,
          blockNumberOrSlot: decoded.blockNumber,
          blockTimestamp: new Date(),
          sender: decoded.sender,
          recipient: decoded.recipient,
          amount0In,
          amount1In,
          amount0Out,
          amount1Out,
          sqrtPriceAfter: decoded.sqrtPriceX96,
          tickAfter: decoded.tick,
          eventIndex: decoded.logIndex,
          finalized: decoded.blockNumber <= currentFinalizedBlock,
          createdAt: new Date(),
        });

        // Persist CLMM state update (price, tick, liquidity)
        await this.db.updatePoolState(decoded.poolAddress.toLowerCase(), {
          sqrtPriceX64: decoded.sqrtPriceX96,
          currentTick: decoded.tick,
          liquidity: decoded.liquidity,
        });

        processed++;
      }
    }

    return processed;
  }
}
