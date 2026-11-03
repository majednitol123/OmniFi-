import { Pool, PoolConfig } from 'pg';
import { OmniFiDatabaseClient } from './client';
import {
  DbAuditLog,
  DbChainEvent,
  DbIndexerCheckpoint,
  DbIndexerReorg,
  DbLiquidityPosition,
  DbNetwork,
  DbPool,
  DbPositionEvent,
  DbReconciliationRun,
  DbSwap,
  DbToken,
} from './types';

export class PostgresDatabaseClient implements OmniFiDatabaseClient {
  private readonly pool: Pool;

  constructor(configOrUrl?: string | PoolConfig) {
    if (typeof configOrUrl === 'string') {
      this.pool = new Pool({ connectionString: configOrUrl });
    } else if (configOrUrl) {
      this.pool = new Pool(configOrUrl);
    } else {
      this.pool = new Pool({
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://omnifi:omnifi_dev_password@localhost:5432/omnifi_dev',
      });
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public getPgPool(): Pool {
    return this.pool;
  }

  // Networks
  public async insertNetwork(network: DbNetwork): Promise<void> {
    const sql = `
      INSERT INTO networks (
        network_id, name, namespace, chain_ref, native_asset_symbol,
        native_asset_decimals, status, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (network_id) DO UPDATE SET
        name = EXCLUDED.name,
        namespace = EXCLUDED.namespace,
        chain_ref = EXCLUDED.chain_ref,
        native_asset_symbol = EXCLUDED.native_asset_symbol,
        native_asset_decimals = EXCLUDED.native_asset_decimals,
        status = EXCLUDED.status;
    `;
    await this.pool.query(sql, [
      network.networkId,
      network.name,
      network.namespace,
      network.chainRef,
      network.nativeAssetSymbol,
      network.nativeAssetDecimals,
      network.status,
      network.createdAt || new Date(),
    ]);
  }

  public async getNetwork(networkId: string): Promise<DbNetwork | undefined> {
    const res = await this.pool.query('SELECT * FROM networks WHERE network_id = $1;', [
      networkId,
    ]);
    if (res.rows.length === 0) return undefined;
    return this.mapNetwork(res.rows[0]);
  }

  public async listNetworks(): Promise<DbNetwork[]> {
    const res = await this.pool.query(
      'SELECT * FROM networks ORDER BY network_id ASC;',
    );
    return res.rows.map((row) => this.mapNetwork(row));
  }

  // Tokens
  public async insertToken(token: DbToken): Promise<void> {
    const sql = `
      INSERT INTO tokens (
        token_id, network_id, address, symbol, name,
        decimals, risk_tier, logo_uri, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (token_id) DO UPDATE SET
        address = EXCLUDED.address,
        symbol = EXCLUDED.symbol,
        name = EXCLUDED.name,
        decimals = EXCLUDED.decimals,
        risk_tier = EXCLUDED.risk_tier,
        logo_uri = EXCLUDED.logo_uri;
    `;
    await this.pool.query(sql, [
      token.tokenId,
      token.networkId,
      token.address,
      token.symbol,
      token.name,
      token.decimals,
      token.riskTier,
      token.logoUri || null,
      token.createdAt || new Date(),
    ]);
  }

  public async getToken(tokenId: string): Promise<DbToken | undefined> {
    const res = await this.pool.query('SELECT * FROM tokens WHERE token_id = $1;', [
      tokenId,
    ]);
    if (res.rows.length === 0) return undefined;
    return this.mapToken(res.rows[0]);
  }

  public async listTokens(networkId?: string): Promise<DbToken[]> {
    if (networkId) {
      const res = await this.pool.query(
        'SELECT * FROM tokens WHERE network_id = $1 ORDER BY symbol ASC;',
        [networkId],
      );
      return res.rows.map((row) => this.mapToken(row));
    }
    const res = await this.pool.query('SELECT * FROM tokens ORDER BY symbol ASC;');
    return res.rows.map((row) => this.mapToken(row));
  }

  // Pools
  public async insertPool(pool: DbPool): Promise<void> {
    const sql = `
      INSERT INTO pools (
        pool_id, network_id, protocol, token0_id, token1_id,
        fee_tier, tick_spacing, reserve0, reserve1, sqrt_price_x64,
        current_tick, liquidity, protocol_fee_fraction, is_paused, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (pool_id) DO UPDATE SET
        protocol = EXCLUDED.protocol,
        token0_id = EXCLUDED.token0_id,
        token1_id = EXCLUDED.token1_id,
        fee_tier = EXCLUDED.fee_tier,
        tick_spacing = EXCLUDED.tick_spacing,
        reserve0 = EXCLUDED.reserve0,
        reserve1 = EXCLUDED.reserve1,
        sqrt_price_x64 = EXCLUDED.sqrt_price_x64,
        current_tick = EXCLUDED.current_tick,
        liquidity = EXCLUDED.liquidity,
        protocol_fee_fraction = EXCLUDED.protocol_fee_fraction,
        is_paused = EXCLUDED.is_paused;
    `;
    await this.pool.query(sql, [
      pool.poolId,
      pool.networkId,
      pool.protocol,
      pool.token0Id,
      pool.token1Id,
      pool.feeTier,
      pool.tickSpacing != null ? pool.tickSpacing : null,
      pool.reserve0 != null ? pool.reserve0.toString() : '0',
      pool.reserve1 != null ? pool.reserve1.toString() : '0',
      pool.sqrtPriceX64 != null ? pool.sqrtPriceX64.toString() : null,
      pool.currentTick != null ? pool.currentTick : null,
      pool.liquidity != null ? pool.liquidity.toString() : '0',
      pool.protocolFeeFraction != null ? pool.protocolFeeFraction : 0,
      pool.isPaused,
      pool.createdAt || new Date(),
    ]);
  }

  public async updatePoolState(
    poolId: string,
    state: {
      reserve0?: bigint;
      reserve1?: bigint;
      sqrtPriceX64?: bigint;
      currentTick?: number;
      liquidity?: bigint;
      protocolFeeFraction?: number;
    },
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (state.reserve0 !== undefined) {
      updates.push(`reserve0 = $${idx++}`);
      values.push(state.reserve0.toString());
    }
    if (state.reserve1 !== undefined) {
      updates.push(`reserve1 = $${idx++}`);
      values.push(state.reserve1.toString());
    }
    if (state.sqrtPriceX64 !== undefined) {
      updates.push(`sqrt_price_x64 = $${idx++}`);
      values.push(state.sqrtPriceX64.toString());
    }
    if (state.currentTick !== undefined) {
      updates.push(`current_tick = $${idx++}`);
      values.push(state.currentTick);
    }
    if (state.liquidity !== undefined) {
      updates.push(`liquidity = $${idx++}`);
      values.push(state.liquidity.toString());
    }
    if (state.protocolFeeFraction !== undefined) {
      updates.push(`protocol_fee_fraction = $${idx++}`);
      values.push(state.protocolFeeFraction);
    }

    if (updates.length === 0) return;

    values.push(poolId);
    const sql = `UPDATE pools SET ${updates.join(', ')} WHERE pool_id = $${idx};`;
    await this.pool.query(sql, values);
  }

  public async getPool(poolId: string): Promise<DbPool | undefined> {
    const res = await this.pool.query('SELECT * FROM pools WHERE pool_id = $1;', [
      poolId,
    ]);
    if (res.rows.length === 0) return undefined;
    return this.mapPool(res.rows[0]);
  }

  public async listPools(networkId?: string): Promise<DbPool[]> {
    if (networkId) {
      const res = await this.pool.query(
        'SELECT * FROM pools WHERE network_id = $1 ORDER BY pool_id ASC;',
        [networkId],
      );
      return res.rows.map((row) => this.mapPool(row));
    }
    const res = await this.pool.query('SELECT * FROM pools ORDER BY pool_id ASC;');
    return res.rows.map((row) => this.mapPool(row));
  }

  // Swaps (with unique composite constraint (networkId, txHash, eventIndex))
  public async insertSwap(swap: DbSwap): Promise<void> {
    const sql = `
      INSERT INTO swaps (
        swap_id, network_id, pool_id, tx_hash, block_number_or_slot,
        block_timestamp, sender, recipient, amount0_in, amount1_in,
        amount0_out, amount1_out, sqrt_price_after, tick_after,
        event_index, finalized, created_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17
      )
      ON CONFLICT (network_id, tx_hash, event_index) DO NOTHING;
    `;
    await this.pool.query(sql, [
      swap.swapId,
      swap.networkId,
      swap.poolId,
      swap.txHash,
      swap.blockNumberOrSlot.toString(),
      swap.blockTimestamp,
      swap.sender,
      swap.recipient,
      swap.amount0In.toString(),
      swap.amount1In.toString(),
      swap.amount0Out.toString(),
      swap.amount1Out.toString(),
      swap.sqrtPriceAfter != null ? swap.sqrtPriceAfter.toString() : null,
      swap.tickAfter != null ? swap.tickAfter : null,
      swap.eventIndex,
      swap.finalized,
      swap.createdAt || new Date(),
    ]);
  }

  public async listSwapsByPool(poolId: string, limit = 50): Promise<DbSwap[]> {
    const res = await this.pool.query(
      'SELECT * FROM swaps WHERE pool_id = $1 ORDER BY block_number_or_slot DESC LIMIT $2;',
      [poolId, limit],
    );
    return res.rows.map((row) => this.mapSwap(row));
  }

  // Positions
  public async upsertPosition(position: DbLiquidityPosition): Promise<void> {
    const sql = `
      INSERT INTO liquidity_positions (
        position_id, network_id, pool_id, owner, onchain_position_id,
        tick_lower, tick_upper, liquidity, tokens_owed0, tokens_owed1,
        status, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (position_id) DO UPDATE SET
        owner = EXCLUDED.owner,
        tick_lower = EXCLUDED.tick_lower,
        tick_upper = EXCLUDED.tick_upper,
        liquidity = EXCLUDED.liquidity,
        tokens_owed0 = EXCLUDED.tokens_owed0,
        tokens_owed1 = EXCLUDED.tokens_owed1,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at;
    `;
    await this.pool.query(sql, [
      position.positionId,
      position.networkId,
      position.poolId,
      position.owner,
      position.onchainPositionId,
      position.tickLower,
      position.tickUpper,
      position.liquidity.toString(),
      position.tokensOwed0.toString(),
      position.tokensOwed1.toString(),
      position.status,
      position.updatedAt || new Date(),
    ]);
  }

  public async getPosition(positionId: string): Promise<DbLiquidityPosition | undefined> {
    const res = await this.pool.query(
      'SELECT * FROM liquidity_positions WHERE position_id = $1;',
      [positionId],
    );
    if (res.rows.length === 0) return undefined;
    return this.mapPosition(res.rows[0]);
  }

  public async getPositionByOnchain(
    networkId: string,
    onchainPositionId: string,
  ): Promise<DbLiquidityPosition | undefined> {
    const res = await this.pool.query(
      'SELECT * FROM liquidity_positions WHERE network_id = $1 AND onchain_position_id = $2;',
      [networkId, onchainPositionId],
    );
    if (res.rows.length === 0) return undefined;
    return this.mapPosition(res.rows[0]);
  }

  public async listPositionsByOwner(
    owner: string,
    networkId?: string,
  ): Promise<DbLiquidityPosition[]> {
    if (networkId) {
      const res = await this.pool.query(
        'SELECT * FROM liquidity_positions WHERE LOWER(owner) = LOWER($1) AND network_id = $2 ORDER BY updated_at DESC;',
        [owner, networkId],
      );
      return res.rows.map((row) => this.mapPosition(row));
    }
    const res = await this.pool.query(
      'SELECT * FROM liquidity_positions WHERE LOWER(owner) = LOWER($1) ORDER BY updated_at DESC;',
      [owner],
    );
    return res.rows.map((row) => this.mapPosition(row));
  }

  // Position Events
  public async insertPositionEvent(event: DbPositionEvent): Promise<void> {
    const sql = `
      INSERT INTO position_events (
        event_id, position_id, event_type, liquidity_delta,
        amount0, amount1, tx_hash, block_number_or_slot,
        event_index, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (event_id) DO NOTHING;
    `;
    await this.pool.query(sql, [
      event.eventId,
      event.positionId,
      event.eventType,
      event.liquidityDelta.toString(),
      event.amount0.toString(),
      event.amount1.toString(),
      event.txHash,
      event.blockNumberOrSlot.toString(),
      event.eventIndex,
      event.createdAt || new Date(),
    ]);
  }

  public async listPositionEvents(positionId: string): Promise<DbPositionEvent[]> {
    const res = await this.pool.query(
      'SELECT * FROM position_events WHERE position_id = $1 ORDER BY created_at ASC;',
      [positionId],
    );
    return res.rows.map((row) => this.mapPositionEvent(row));
  }

  // Chain Events & Checkpoints
  public async insertChainEvent(event: DbChainEvent): Promise<void> {
    const sql = `
      INSERT INTO chain_events (
        event_id, network_id, tx_hash, log_index, block_number_or_slot,
        block_hash, event_name, payload, finalized, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (network_id, tx_hash, log_index) DO NOTHING;
    `;
    await this.pool.query(sql, [
      event.eventId,
      event.networkId,
      event.txHash,
      event.logIndex,
      event.blockNumberOrSlot.toString(),
      event.blockHash || null,
      event.eventName,
      JSON.stringify(event.payload),
      event.finalized,
      event.createdAt || new Date(),
    ]);
  }

  public async listChainEvents(
    networkId: string,
    fromBlockOrSlot: bigint,
    toBlockOrSlot: bigint,
  ): Promise<DbChainEvent[]> {
    const res = await this.pool.query(
      `SELECT * FROM chain_events 
       WHERE network_id = $1 
         AND block_number_or_slot >= $2 
         AND block_number_or_slot <= $3 
       ORDER BY block_number_or_slot ASC, log_index ASC;`,
      [networkId, fromBlockOrSlot.toString(), toBlockOrSlot.toString()],
    );
    return res.rows.map((row) => this.mapChainEvent(row));
  }

  public async getCheckpoint(networkId: string): Promise<DbIndexerCheckpoint | undefined> {
    const res = await this.pool.query(
      'SELECT * FROM indexer_checkpoints WHERE network_id = $1;',
      [networkId],
    );
    if (res.rows.length === 0) return undefined;
    return this.mapCheckpoint(res.rows[0]);
  }

  public async updateCheckpoint(checkpoint: DbIndexerCheckpoint): Promise<void> {
    const sql = `
      INSERT INTO indexer_checkpoints (
        network_id, last_scanned_block_or_slot, last_finalized_block_or_slot,
        last_block_hash, updated_at
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (network_id) DO UPDATE SET
        last_scanned_block_or_slot = EXCLUDED.last_scanned_block_or_slot,
        last_finalized_block_or_slot = EXCLUDED.last_finalized_block_or_slot,
        last_block_hash = EXCLUDED.last_block_hash,
        updated_at = EXCLUDED.updated_at;
    `;
    await this.pool.query(sql, [
      checkpoint.networkId,
      checkpoint.lastScannedBlockOrSlot.toString(),
      checkpoint.lastFinalizedBlockOrSlot.toString(),
      checkpoint.lastBlockHash || null,
      checkpoint.updatedAt || new Date(),
    ]);
  }

  // Reorg Recovery: Roll back unfinalized events back to commonAncestorBlock
  public async rollbackUnfinalizedEvents(
    networkId: string,
    commonAncestorBlock: bigint,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN;');

      // Delete unfinalized swaps above ancestor
      const swapRes = await client.query(
        `DELETE FROM swaps 
         WHERE network_id = $1 
           AND block_number_or_slot > $2 
           AND finalized = FALSE;`,
        [networkId, commonAncestorBlock.toString()],
      );

      // Delete unfinalized chain events above ancestor
      const eventRes = await client.query(
        `DELETE FROM chain_events 
         WHERE network_id = $1 
           AND block_number_or_slot > $2 
           AND finalized = FALSE;`,
        [networkId, commonAncestorBlock.toString()],
      );

      // Rewind checkpoint
      await client.query(
        `UPDATE indexer_checkpoints 
         SET last_scanned_block_or_slot = $2, updated_at = NOW() 
         WHERE network_id = $1;`,
        [networkId, commonAncestorBlock.toString()],
      );

      await client.query('COMMIT;');
      return (swapRes.rowCount ?? 0) + (eventRes.rowCount ?? 0);
    } catch (err) {
      await client.query('ROLLBACK;');
      throw err;
    } finally {
      client.release();
    }
  }

  public async recordReorg(reorg: DbIndexerReorg): Promise<void> {
    const depth = Number(reorg.forkBlockOrSlot - reorg.commonAncestorBlock);
    const sql = `
      INSERT INTO indexer_reorgs (
        reorg_id, network_id, depth, from_block_or_slot, to_block_or_slot,
        fork_block_or_slot, common_ancestor_block, events_rolled_back, detected_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (reorg_id) DO NOTHING;
    `;
    await this.pool.query(sql, [
      reorg.reorgId,
      reorg.networkId,
      depth,
      reorg.commonAncestorBlock.toString(),
      reorg.forkBlockOrSlot.toString(),
      reorg.forkBlockOrSlot.toString(),
      reorg.commonAncestorBlock.toString(),
      reorg.eventsRolledBack,
      reorg.detectedAt || new Date(),
    ]);
  }

  // Reconciliation Runs
  public async insertReconciliationRun(run: DbReconciliationRun): Promise<void> {
    const sql = `
      INSERT INTO reconciliation_runs (
        run_id, network_id, pool_id, onchain_reserve0, db_reserve0,
        drift0, onchain_reserve1, db_reserve1, drift1, status, audited_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (run_id) DO NOTHING;
    `;
    await this.pool.query(sql, [
      run.runId,
      run.networkId,
      run.poolId,
      run.onchainReserve0.toString(),
      run.dbReserve0.toString(),
      run.drift0.toString(),
      run.onchainReserve1.toString(),
      run.dbReserve1.toString(),
      run.drift1.toString(),
      run.status,
      run.auditedAt || new Date(),
    ]);
  }

  public async listReconciliationRuns(
    poolId?: string,
    limit = 50,
  ): Promise<DbReconciliationRun[]> {
    if (poolId) {
      const res = await this.pool.query(
        'SELECT * FROM reconciliation_runs WHERE pool_id = $1 ORDER BY audited_at DESC LIMIT $2;',
        [poolId, limit],
      );
      return res.rows.map((row) => this.mapReconciliationRun(row));
    }
    const res = await this.pool.query(
      'SELECT * FROM reconciliation_runs ORDER BY audited_at DESC LIMIT $1;',
      [limit],
    );
    return res.rows.map((row) => this.mapReconciliationRun(row));
  }

  // Audit
  public async logAudit(audit: DbAuditLog): Promise<void> {
    const sql = `
      INSERT INTO audit_logs (log_id, source, action, operator, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (log_id) DO NOTHING;
    `;
    await this.pool.query(sql, [
      audit.logId,
      audit.source,
      audit.action,
      audit.source || 'system',
      JSON.stringify(audit.details),
      audit.timestamp || new Date(),
    ]);
  }

  // Mappers
  private mapNetwork(row: any): DbNetwork {
    return {
      networkId: row.network_id,
      name: row.name,
      namespace: row.namespace,
      chainRef: row.chain_ref,
      nativeAssetSymbol: row.native_asset_symbol,
      nativeAssetDecimals: Number(row.native_asset_decimals),
      status: row.status,
      createdAt: new Date(row.created_at),
    };
  }

  private mapToken(row: any): DbToken {
    return {
      tokenId: row.token_id,
      networkId: row.network_id,
      address: row.address,
      symbol: row.symbol,
      name: row.name,
      decimals: Number(row.decimals),
      riskTier: row.risk_tier,
      logoUri: row.logo_uri || undefined,
      createdAt: new Date(row.created_at),
    };
  }

  private mapPool(row: any): DbPool {
    return {
      poolId: row.pool_id,
      networkId: row.network_id,
      protocol: row.protocol,
      token0Id: row.token0_id,
      token1Id: row.token1_id,
      feeTier: Number(row.fee_tier),
      tickSpacing: row.tick_spacing != null ? Number(row.tick_spacing) : undefined,
      reserve0: row.reserve0 != null ? BigInt(row.reserve0) : 0n,
      reserve1: row.reserve1 != null ? BigInt(row.reserve1) : 0n,
      sqrtPriceX64: row.sqrt_price_x64 != null ? BigInt(row.sqrt_price_x64) : undefined,
      currentTick: row.current_tick != null ? Number(row.current_tick) : undefined,
      liquidity: row.liquidity != null ? BigInt(row.liquidity) : 0n,
      protocolFeeFraction: row.protocol_fee_fraction != null ? Number(row.protocol_fee_fraction) : 0,
      isPaused: Boolean(row.is_paused),
      createdAt: new Date(row.created_at),
    };
  }

  private mapSwap(row: any): DbSwap {
    return {
      swapId: row.swap_id,
      networkId: row.network_id,
      poolId: row.pool_id,
      txHash: row.tx_hash,
      blockNumberOrSlot: BigInt(row.block_number_or_slot),
      blockTimestamp: new Date(row.block_timestamp),
      sender: row.sender,
      recipient: row.recipient,
      amount0In: BigInt(row.amount0_in),
      amount1In: BigInt(row.amount1_in),
      amount0Out: BigInt(row.amount0_out),
      amount1Out: BigInt(row.amount1_out),
      sqrtPriceAfter:
        row.sqrt_price_after != null ? BigInt(row.sqrt_price_after) : undefined,
      tickAfter: row.tick_after != null ? Number(row.tick_after) : undefined,
      eventIndex: Number(row.event_index),
      finalized: Boolean(row.finalized),
      createdAt: new Date(row.created_at),
    };
  }

  private mapPosition(row: any): DbLiquidityPosition {
    return {
      positionId: row.position_id,
      networkId: row.network_id,
      poolId: row.pool_id,
      owner: row.owner,
      onchainPositionId: row.onchain_position_id,
      tickLower: Number(row.tick_lower),
      tickUpper: Number(row.tick_upper),
      liquidity: BigInt(row.liquidity),
      tokensOwed0: BigInt(row.tokens_owed0),
      tokensOwed1: BigInt(row.tokens_owed1),
      status: row.status,
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapPositionEvent(row: any): DbPositionEvent {
    return {
      eventId: row.event_id,
      positionId: row.position_id,
      eventType: row.event_type,
      liquidityDelta: BigInt(row.liquidity_delta),
      amount0: BigInt(row.amount0),
      amount1: BigInt(row.amount1),
      txHash: row.tx_hash,
      blockNumberOrSlot: BigInt(row.block_number_or_slot),
      eventIndex: Number(row.event_index),
      createdAt: new Date(row.created_at),
    };
  }

  private mapChainEvent(row: any): DbChainEvent {
    return {
      eventId: row.event_id,
      networkId: row.network_id,
      txHash: row.tx_hash,
      logIndex: Number(row.log_index),
      blockNumberOrSlot: BigInt(row.block_number_or_slot),
      blockHash: row.block_hash || undefined,
      eventName: row.event_name,
      payload:
        typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      finalized: Boolean(row.finalized),
      createdAt: new Date(row.created_at),
    };
  }

  private mapCheckpoint(row: any): DbIndexerCheckpoint {
    return {
      networkId: row.network_id,
      lastScannedBlockOrSlot: BigInt(row.last_scanned_block_or_slot),
      lastFinalizedBlockOrSlot: BigInt(row.last_finalized_block_or_slot),
      lastBlockHash: row.last_block_hash || undefined,
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapReconciliationRun(row: any): DbReconciliationRun {
    return {
      runId: row.run_id,
      networkId: row.network_id,
      poolId: row.pool_id,
      onchainReserve0: BigInt(row.onchain_reserve0),
      dbReserve0: BigInt(row.db_reserve0),
      drift0: BigInt(row.drift0),
      onchainReserve1: BigInt(row.onchain_reserve1),
      dbReserve1: BigInt(row.db_reserve1),
      drift1: BigInt(row.drift1),
      status: row.status,
      auditedAt: new Date(row.audited_at),
    };
  }
}
