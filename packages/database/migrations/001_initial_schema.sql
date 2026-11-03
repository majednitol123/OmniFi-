-- OmniFi Relational Data Platform Schema
-- Phase 11 Initial Migration: Complete Indexing, Positions, Reorgs & Reconciliation

-- 1. Networks
CREATE TABLE IF NOT EXISTS networks (
    network_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    namespace VARCHAR(32) NOT NULL,
    chain_ref VARCHAR(64) NOT NULL,
    native_asset_symbol VARCHAR(32) NOT NULL,
    native_asset_decimals SMALLINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 2. Tokens
CREATE TABLE IF NOT EXISTS tokens (
    token_id VARCHAR(128) PRIMARY KEY, -- e.g. "eip155:1:0xa0b86..."
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE CASCADE,
    address VARCHAR(128) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    decimals SMALLINT NOT NULL,
    risk_tier VARCHAR(32) NOT NULL DEFAULT 'LOW',
    logo_uri TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tokens_network_address UNIQUE (network_id, address)
);

-- 3. Liquidity Pools
CREATE TABLE IF NOT EXISTS pools (
    pool_id VARCHAR(128) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE CASCADE,
    protocol VARCHAR(32) NOT NULL, -- 'v2' | 'clmm' | 'v4' | 'amm'
    token0_id VARCHAR(128) NOT NULL REFERENCES tokens(token_id),
    token1_id VARCHAR(128) NOT NULL REFERENCES tokens(token_id),
    fee_tier INTEGER NOT NULL,
    tick_spacing SMALLINT,
    is_paused BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pools_network_tokens_tier UNIQUE (network_id, token0_id, token1_id, fee_tier)
);

-- 4. Swaps
CREATE TABLE IF NOT EXISTS swaps (
    swap_id VARCHAR(64) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE CASCADE,
    pool_id VARCHAR(128) NOT NULL REFERENCES pools(pool_id) ON DELETE CASCADE,
    tx_hash VARCHAR(128) NOT NULL,
    block_number_or_slot BIGINT NOT NULL,
    block_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    sender VARCHAR(128) NOT NULL,
    recipient VARCHAR(128) NOT NULL,
    amount0_in NUMERIC(78, 0) NOT NULL DEFAULT 0,
    amount1_in NUMERIC(78, 0) NOT NULL DEFAULT 0,
    amount0_out NUMERIC(78, 0) NOT NULL DEFAULT 0,
    amount1_out NUMERIC(78, 0) NOT NULL DEFAULT 0,
    sqrt_price_after NUMERIC(78, 0),
    tick_after INTEGER,
    event_index INTEGER NOT NULL,
    finalized BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_swaps_network_tx_event UNIQUE (network_id, tx_hash, event_index)
);

CREATE INDEX IF NOT EXISTS idx_swaps_pool_block ON swaps (pool_id, block_number_or_slot DESC);
CREATE INDEX IF NOT EXISTS idx_swaps_network_sender ON swaps (network_id, sender);

-- 5. Liquidity Positions
CREATE TABLE IF NOT EXISTS liquidity_positions (
    position_id VARCHAR(64) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE CASCADE,
    pool_id VARCHAR(128) NOT NULL REFERENCES pools(pool_id) ON DELETE CASCADE,
    owner VARCHAR(128) NOT NULL,
    onchain_position_id VARCHAR(128) NOT NULL,
    tick_lower INTEGER NOT NULL,
    tick_upper INTEGER NOT NULL,
    liquidity NUMERIC(78, 0) NOT NULL DEFAULT 0,
    tokens_owed0 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    tokens_owed1 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_positions_network_onchain_id UNIQUE (network_id, onchain_position_id)
);

CREATE INDEX IF NOT EXISTS idx_positions_network_owner ON liquidity_positions (network_id, owner);
CREATE INDEX IF NOT EXISTS idx_positions_pool ON liquidity_positions (pool_id);

-- 6. Position Events
CREATE TABLE IF NOT EXISTS position_events (
    event_id VARCHAR(64) PRIMARY KEY,
    position_id VARCHAR(64) NOT NULL REFERENCES liquidity_positions(position_id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL, -- 'MINT' | 'INCREASE' | 'DECREASE' | 'COLLECT' | 'BURN'
    liquidity_delta NUMERIC(78, 0) NOT NULL DEFAULT 0,
    amount0 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    amount1 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    tx_hash VARCHAR(128) NOT NULL,
    block_number_or_slot BIGINT NOT NULL,
    event_index INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_position_events_tx_event UNIQUE (tx_hash, event_index)
);

-- 7. Chain Events (Immutable raw audit log of all scanned on-chain events)
CREATE TABLE IF NOT EXISTS chain_events (
    event_id VARCHAR(64) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE CASCADE,
    tx_hash VARCHAR(128) NOT NULL,
    log_index INTEGER NOT NULL,
    block_number_or_slot BIGINT NOT NULL,
    block_hash VARCHAR(128),
    event_name VARCHAR(128) NOT NULL,
    payload_json JSONB NOT NULL,
    finalized BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chain_events_network_tx_log UNIQUE (network_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_chain_events_scan ON chain_events (network_id, block_number_or_slot DESC);

-- 8. Indexer Checkpoints
CREATE TABLE IF NOT EXISTS indexer_checkpoints (
    network_id VARCHAR(64) PRIMARY KEY REFERENCES networks(network_id) ON DELETE CASCADE,
    last_scanned_block_or_slot BIGINT NOT NULL DEFAULT 0,
    last_finalized_block_or_slot BIGINT NOT NULL DEFAULT 0,
    last_block_hash VARCHAR(128),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 9. Indexer Reorg Events
CREATE TABLE IF NOT EXISTS indexer_reorgs (
    reorg_id VARCHAR(64) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE CASCADE,
    fork_block_or_slot BIGINT NOT NULL,
    common_ancestor_block BIGINT NOT NULL,
    events_rolled_back INTEGER NOT NULL DEFAULT 0,
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 10. Reconciliation Runs
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    run_id VARCHAR(64) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE CASCADE,
    pool_id VARCHAR(128) NOT NULL REFERENCES pools(pool_id) ON DELETE CASCADE,
    onchain_reserve0 NUMERIC(78, 0) NOT NULL,
    db_reserve0 NUMERIC(78, 0) NOT NULL,
    drift0 NUMERIC(78, 0) NOT NULL,
    onchain_reserve1 NUMERIC(78, 0) NOT NULL,
    db_reserve1 NUMERIC(78, 0) NOT NULL,
    drift1 NUMERIC(78, 0) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'OK',
    audited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 11. Security & Operational Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    log_id VARCHAR(64) PRIMARY KEY,
    source VARCHAR(64) NOT NULL,
    action VARCHAR(128) NOT NULL,
    details JSONB NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

