import { OmniFiDatabaseClient } from '@omnifi/database';
import { SolanaLogDecoder } from './log-decoder';
import { DecodedSolanaEvent, SolanaIndexerConfig, SolanaRawTransaction } from './types';

export class SolanaScanner {
  public readonly config: SolanaIndexerConfig;
  public readonly db: OmniFiDatabaseClient;
  public readonly decoder: SolanaLogDecoder;

  constructor(config: SolanaIndexerConfig, db: OmniFiDatabaseClient) {
    this.config = config;
    this.db = db;
    this.decoder = new SolanaLogDecoder();
  }

  public async processTransactions(
    txs: SolanaRawTransaction[],
    isFinalized = false,
  ): Promise<number> {
    let processed = 0;

    for (const tx of txs) {
      // 1. Raw Chain Event Ingestion
      await this.db.insertChainEvent({
        eventId: `${this.config.networkId}:${tx.signature}:0`,
        networkId: this.config.networkId,
        txHash: tx.signature,
        logIndex: 0,
        blockNumberOrSlot: tx.slot,
        eventName: 'solana_transaction',
        payload: {
          accounts: tx.accounts,
          logs: tx.logs,
          err: tx.err,
        },
        finalized: isFinalized,
        createdAt: new Date(tx.blockTime ? tx.blockTime * 1000 : Date.now()),
      });

      if (tx.err) continue;

      // 2. Decode Instructions & Logs
      const decodedEvents = this.decoder.decodeTransaction(tx);
      for (const event of decodedEvents) {
        if (event.type === 'AMM_SWAP' || event.type === 'CLMM_SWAP') {
          const amount0In = event.zeroForOne ? event.amountIn : 0n;
          const amount1In = !event.zeroForOne ? event.amountIn : 0n;
          const amount0Out = !event.zeroForOne ? event.amountOut : 0n;
          const amount1Out = event.zeroForOne ? event.amountOut : 0n;

          await this.db.insertSwap({
            swapId: `${this.config.networkId}:${event.signature}:${event.logIndex}`,
            networkId: this.config.networkId,
            poolId: event.poolAddress,
            txHash: event.signature,
            blockNumberOrSlot: event.slot,
            blockTimestamp: new Date(tx.blockTime ? tx.blockTime * 1000 : Date.now()),
            sender: event.user,
            recipient: event.user,
            amount0In,
            amount1In,
            amount0Out,
            amount1Out,
            sqrtPriceAfter: event.type === 'CLMM_SWAP' ? event.sqrtPriceAfterX64 : undefined,
            tickAfter: event.type === 'CLMM_SWAP' ? event.tickAfter : undefined,
            eventIndex: event.logIndex,
            finalized: isFinalized,
            createdAt: new Date(),
          });
          processed++;

          // Synchronize Pool State in Database
          if (event.type === 'CLMM_SWAP' && event.sqrtPriceAfterX64 !== undefined) {
            await this.db.updatePoolState(event.poolAddress, {
              sqrtPriceX64: event.sqrtPriceAfterX64,
              currentTick: event.tickAfter,
            });
          } else if (event.type === 'AMM_SWAP') {
            const pool = await this.db.getPool(event.poolAddress);
            if (pool && pool.reserve0 !== undefined && pool.reserve1 !== undefined) {
              const reserve0 = event.zeroForOne
                ? pool.reserve0 + amount0In
                : pool.reserve0 >= amount0Out
                  ? pool.reserve0 - amount0Out
                  : 0n;
              const reserve1 = event.zeroForOne
                ? pool.reserve1 >= amount1Out
                  ? pool.reserve1 - amount1Out
                  : 0n
                : pool.reserve1 + amount1In;
              await this.db.updatePoolState(event.poolAddress, { reserve0, reserve1 });
            }
          }
        } else if (event.type === 'CLMM_POSITION_UPDATE') {
          await this.db.upsertPosition({
            positionId: `${this.config.networkId}:${event.positionAddress}`,
            networkId: this.config.networkId,
            poolId: event.poolAddress,
            owner: event.owner,
            onchainPositionId: event.positionAddress,
            tickLower: event.tickLower,
            tickUpper: event.tickUpper,
            liquidity: event.liquidityDelta,
            tokensOwed0: 0n,
            tokensOwed1: 0n,
            status: 'OPEN',
            updatedAt: new Date(),
          });
          processed++;
        }
      }

      // Update checkpoint to max slot seen
      const existingCp = await this.db.getCheckpoint(this.config.networkId);
      const currentMax = existingCp?.lastScannedBlockOrSlot ?? 0n;
      if (tx.slot > currentMax) {
        await this.db.updateCheckpoint({
          networkId: this.config.networkId,
          lastScannedBlockOrSlot: tx.slot,
          lastFinalizedBlockOrSlot: isFinalized ? tx.slot : (existingCp?.lastFinalizedBlockOrSlot ?? 0n),
          updatedAt: new Date(),
        });
      }
    }

    return processed;
  }
}
