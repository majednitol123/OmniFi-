
-- 1. Networks
CREATE TABLE IF NOT EXISTS networks (
    network_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    namespace VARCHAR(32) NOT NULL CHECK (namespace IN ('eip155', 'solana')),
    chain_ref VARCHAR(64) NOT NULL,
    native_asset_symbol VARCHAR(16) NOT NULL,
    native_asset_decimals SMALLINT NOT NULL CHECK (native_asset_decimals >= 0),
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'degraded', 'maintenance')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tokens
CREATE TABLE IF NOT EXISTS tokens (
    token_id VARCHAR(128) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE RESTRICT,
    address VARCHAR(128) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    decimals SMALLINT NOT NULL CHECK (decimals >= 0 AND decimals <= 36),
    risk_tier VARCHAR(16) NOT NULL DEFAULT 'LOW' CHECK (risk_tier IN ('LOW', 'MEDIUM', 'HIGH')),
    logo_uri TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tokens_network_address UNIQUE (network_id, address)
);

CREATE INDEX IF NOT EXISTS idx_tokens_network_id ON tokens(network_id);
CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);

-- 3. Pools
CREATE TABLE IF NOT EXISTS pools (
    pool_id VARCHAR(128) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE RESTRICT,
    protocol VARCHAR(32) NOT NULL CHECK (protocol IN ('v2', 'clmm', 'v4', 'amm')),
    token0_id VARCHAR(128) NOT NULL REFERENCES tokens(token_id) ON DELETE RESTRICT,
    token1_id VARCHAR(128) NOT NULL REFERENCES tokens(token_id) ON DELETE RESTRICT,
    fee_tier INTEGER NOT NULL CHECK (fee_tier >= 0 AND fee_tier <= 100000), -- in basis points or hundredths of bps
    tick_spacing INTEGER,
    reserve0 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    reserve1 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    sqrt_price_x64 NUMERIC(78, 0),
    current_tick INTEGER,
    liquidity NUMERIC(78, 0) NOT NULL DEFAULT 0,
    protocol_fee_fraction INTEGER NOT NULL DEFAULT 0,
    is_paused BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pools_network_protocol ON pools(network_id, protocol);
CREATE INDEX IF NOT EXISTS idx_pools_tokens ON pools(token0_id, token1_id);

-- 4. Swaps (Idempotent Ledger)
CREATE TABLE IF NOT EXISTS swaps (
    swap_id VARCHAR(128) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE RESTRICT,
    pool_id VARCHAR(128) NOT NULL REFERENCES pools(pool_id) ON DELETE RESTRICT,
    tx_hash VARCHAR(128) NOT NULL,
    block_number_or_slot NUMERIC(32, 0) NOT NULL,
    block_timestamp TIMESTAMPTZ NOT NULL,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_swaps_network_tx_event UNIQUE (network_id, tx_hash, event_index)
);

CREATE INDEX IF NOT EXISTS idx_swaps_pool_block ON swaps(pool_id, block_number_or_slot DESC);
CREATE INDEX IF NOT EXISTS idx_swaps_recipient ON swaps(recipient);
CREATE INDEX IF NOT EXISTS idx_swaps_timestamp ON swaps(block_timestamp DESC);

-- 5. Liquidity Positions
CREATE TABLE IF NOT EXISTS liquidity_positions (
    position_id VARCHAR(128) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE RESTRICT,
    pool_id VARCHAR(128) NOT NULL REFERENCES pools(pool_id) ON DELETE RESTRICT,
    owner VARCHAR(128) NOT NULL,
    onchain_position_id VARCHAR(128) NOT NULL,
    tick_lower INTEGER NOT NULL,
    tick_upper INTEGER NOT NULL,
    liquidity NUMERIC(78, 0) NOT NULL DEFAULT 0,
    tokens_owed0 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    tokens_owed1 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_positions_owner ON liquidity_positions(owner, network_id);
CREATE INDEX IF NOT EXISTS idx_positions_pool ON liquidity_positions(pool_id);

-- 6. Position Lifecycle Events
CREATE TABLE IF NOT EXISTS position_events (
    event_id VARCHAR(128) PRIMARY KEY,
    position_id VARCHAR(128) NOT NULL REFERENCES liquidity_positions(position_id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('MINT', 'INCREASE', 'DECREASE', 'COLLECT', 'BURN')),
    liquidity_delta NUMERIC(78, 0) NOT NULL DEFAULT 0,
    amount0 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    amount1 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    tx_hash VARCHAR(128) NOT NULL,
    block_number_or_slot NUMERIC(32, 0) NOT NULL,
    event_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_position_events_position ON position_events(position_id, created_at DESC);

-- 7. Chain Raw Events & Reorg Resilience
CREATE TABLE IF NOT EXISTS chain_events (
    event_id VARCHAR(128) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE RESTRICT,
    tx_hash VARCHAR(128) NOT NULL,
    log_index INTEGER NOT NULL,
    block_number_or_slot NUMERIC(32, 0) NOT NULL,
    block_hash VARCHAR(128),
    event_name VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    finalized BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_chain_events_network_tx_log UNIQUE (network_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_chain_events_network_block ON chain_events(network_id, block_number_or_slot);

-- 8. Indexer Checkpoints
CREATE TABLE IF NOT EXISTS indexer_checkpoints (
    network_id VARCHAR(64) PRIMARY KEY REFERENCES networks(network_id) ON DELETE RESTRICT,
    last_scanned_block_or_slot NUMERIC(32, 0) NOT NULL DEFAULT 0,
    last_finalized_block_or_slot NUMERIC(32, 0) NOT NULL DEFAULT 0,
    last_block_hash VARCHAR(128),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Reorg Tracking & Rollback Log
CREATE TABLE IF NOT EXISTS indexer_reorgs (
    reorg_id VARCHAR(128) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE RESTRICT,
    depth INTEGER NOT NULL,
    from_block_or_slot NUMERIC(32, 0) NOT NULL,
    to_block_or_slot NUMERIC(32, 0) NOT NULL,
    fork_block_or_slot NUMERIC(32, 0),
    common_ancestor_block NUMERIC(32, 0),
    events_rolled_back INTEGER NOT NULL DEFAULT 0,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. Reconciliation Runs
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    run_id VARCHAR(128) PRIMARY KEY,
    network_id VARCHAR(64) NOT NULL REFERENCES networks(network_id) ON DELETE RESTRICT,
    pool_id VARCHAR(128) NOT NULL REFERENCES pools(pool_id) ON DELETE RESTRICT,
    onchain_reserve0 NUMERIC(78, 0) NOT NULL,
    db_reserve0 NUMERIC(78, 0) NOT NULL,
    drift0 NUMERIC(78, 0) NOT NULL,
    onchain_reserve1 NUMERIC(78, 0) NOT NULL,
    db_reserve1 NUMERIC(78, 0) NOT NULL,
    drift1 NUMERIC(78, 0) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('OK', 'DRIFT_DETECTED')),
    audited_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_pool ON reconciliation_runs(pool_id, audited_at DESC);

-- 11. Audit Logs & System Health
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id VARCHAR(128) PRIMARY KEY,
    source VARCHAR(128),
    action VARCHAR(64) NOT NULL,
    operator VARCHAR(128) NOT NULL DEFAULT 'system',
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

