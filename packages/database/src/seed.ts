import { PostgresDatabaseClient } from './postgres-db';
import { DbNetwork, DbPool, DbToken, DbIndexerCheckpoint } from './types';

async function seed() {
  const db = new PostgresDatabaseClient(
    process.env.DATABASE_URL ||
      'postgresql://omnifi:omnifi_dev_password@localhost:5432/omnifi_dev',
  );

  console.log('Seeding OmniFi Real Baseline Data into PostgreSQL...');

  // 1. Networks
  const networks: DbNetwork[] = [
    {
      networkId: 'eip155:1',
      name: 'Ethereum Mainnet',
      namespace: 'eip155',
      chainRef: '1',
      nativeAssetSymbol: 'ETH',
      nativeAssetDecimals: 18,
      status: 'active',
      createdAt: new Date(),
    },
    {
      networkId: 'eip155:8453',
      name: 'Base Mainnet',
      namespace: 'eip155',
      chainRef: '8453',
      nativeAssetSymbol: 'ETH',
      nativeAssetDecimals: 18,
      status: 'active',
      createdAt: new Date(),
    },
    {
      networkId: 'solana:mainnet-beta',
      name: 'Solana Mainnet',
      namespace: 'solana',
      chainRef: 'mainnet-beta',
      nativeAssetSymbol: 'SOL',
      nativeAssetDecimals: 9,
      status: 'active',
      createdAt: new Date(),
    },
    {
      networkId: 'solana:devnet',
      name: 'Solana Devnet',
      namespace: 'solana',
      chainRef: 'devnet',
      nativeAssetSymbol: 'SOL',
      nativeAssetDecimals: 9,
      status: 'active',
      createdAt: new Date(),
    },
  ];

  for (const net of networks) {
    await db.insertNetwork(net);
    console.log(`Inserted network: ${net.networkId}`);
  }

  // 2. Tokens
  const tokens: DbToken[] = [
    // Ethereum
    {
      tokenId: 'eip155:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      networkId: 'eip155:1',
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      riskTier: 'LOW',
      logoUri:
        'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
      createdAt: new Date(),
    },
    {
      tokenId: 'eip155:1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      networkId: 'eip155:1',
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      riskTier: 'LOW',
      logoUri:
        'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
      createdAt: new Date(),
    },
    {
      tokenId: 'eip155:1:0xdac17f958d2ee523a2206206994597c13d831ec7',
      networkId: 'eip155:1',
      address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      riskTier: 'LOW',
      createdAt: new Date(),
    },
    // Base
    {
      tokenId: 'eip155:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      networkId: 'eip155:8453',
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      symbol: 'USDC',
      name: 'USD Coin (Base)',
      decimals: 6,
      riskTier: 'LOW',
      createdAt: new Date(),
    },
    {
      tokenId: 'eip155:8453:0x4200000000000000000000000000000000000006',
      networkId: 'eip155:8453',
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: 'Wrapped Ether (Base)',
      decimals: 18,
      riskTier: 'LOW',
      createdAt: new Date(),
    },
    // Solana Mainnet
    {
      tokenId: 'solana:mainnet-beta:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      networkId: 'solana:mainnet-beta',
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      name: 'USD Coin (Solana)',
      decimals: 6,
      riskTier: 'LOW',
      createdAt: new Date(),
    },
    {
      tokenId: 'solana:mainnet-beta:So11111111111111111111111111111111111111112',
      networkId: 'solana:mainnet-beta',
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Wrapped SOL',
      decimals: 9,
      riskTier: 'LOW',
      createdAt: new Date(),
    },
    {
      tokenId: 'solana:mainnet-beta:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      networkId: 'solana:mainnet-beta',
      address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      symbol: 'USDT',
      name: 'USDT (Solana)',
      decimals: 6,
      riskTier: 'LOW',
      createdAt: new Date(),
    },
  ];

  for (const tok of tokens) {
    await db.insertToken(tok);
    console.log(`Inserted token: ${tok.tokenId}`);
  }

  // 3. Pools
  const pools: DbPool[] = [
    {
      poolId: 'evm-v2-usdc-weth',
      networkId: 'eip155:1',
      protocol: 'v2',
      token0Id: 'eip155:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      token1Id: 'eip155:1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      feeTier: 3000,
      reserve0: 50_000_000_000_000n, // 50M USDC
      reserve1: 25_000_000_000_000_000_000_000n, // 25,000 WETH
      isPaused: false,
      createdAt: new Date(),
    },
    {
      poolId: 'evm-v2-weth-usdt',
      networkId: 'eip155:1',
      protocol: 'v2',
      token0Id: 'eip155:1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      token1Id: 'eip155:1:0xdac17f958d2ee523a2206206994597c13d831ec7',
      feeTier: 3000,
      reserve0: 25_000_000_000_000_000_000_000n, // 25,000 WETH
      reserve1: 50_000_000_000_000n, // 50M USDT
      isPaused: false,
      createdAt: new Date(),
    },
    {
      poolId: 'evm-clmm-usdc-weth-500',
      networkId: 'eip155:1',
      protocol: 'clmm',
      token0Id: 'eip155:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      token1Id: 'eip155:1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      feeTier: 500,
      tickSpacing: 10,
      reserve0: 50_000_000_000_000n,
      reserve1: 25_000_000_000_000_000_000_000n,
      sqrtPriceX64: 18446744073709551616n,
      currentTick: 0,
      liquidity: 500_000_000_000_000n,
      isPaused: false,
      createdAt: new Date(),
    },
    {
      poolId: 'solana-amm-usdc-wsol',
      networkId: 'solana:mainnet-beta',
      protocol: 'amm',
      token0Id: 'solana:mainnet-beta:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      token1Id: 'solana:mainnet-beta:So11111111111111111111111111111111111111112',
      feeTier: 2500,
      reserve0: 20_000_000_000_000n, // 20M USDC
      reserve1: 100_000_000_000_000n, // 100k SOL
      protocolFeeFraction: 250_000,
      isPaused: false,
      createdAt: new Date(),
    },
    {
      poolId: 'solana-clmm-usdc-wsol',
      networkId: 'solana:mainnet-beta',
      protocol: 'clmm',
      token0Id: 'solana:mainnet-beta:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      token1Id: 'solana:mainnet-beta:So11111111111111111111111111111111111111112',
      feeTier: 500,
      tickSpacing: 10,
      reserve0: 20_000_000_000_000n,
      reserve1: 100_000_000_000_000n,
      sqrtPriceX64: 18446744073709551616n,
      currentTick: 0,
      liquidity: 500_000_000_000_000n,
      isPaused: false,
      createdAt: new Date(),
    },
    {
      poolId: 'solana-clmm-usdc-wsol-2000',
      networkId: 'solana:mainnet-beta',
      protocol: 'clmm',
      token0Id: 'solana:mainnet-beta:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      token1Id: 'solana:mainnet-beta:So11111111111111111111111111111111111111112',
      feeTier: 2000,
      tickSpacing: 60,
      reserve0: 20_000_000_000_000n,
      reserve1: 100_000_000_000_000n,
      sqrtPriceX64: 18446744073709551616n,
      currentTick: 0,
      liquidity: 200_000_000_000_000n,
      isPaused: false,
      createdAt: new Date(),
    },
    {
      poolId: 'solana-amm-wsol-usdt',
      networkId: 'solana:mainnet-beta',
      protocol: 'amm',
      token0Id: 'solana:mainnet-beta:So11111111111111111111111111111111111111112',
      token1Id: 'solana:mainnet-beta:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      feeTier: 3000,
      reserve0: 50_000_000_000_000n,
      reserve1: 10_000_000_000_000n,
      protocolFeeFraction: 250_000,
      isPaused: false,
      createdAt: new Date(),
    },
  ];

  for (const pool of pools) {
    await db.insertPool(pool);
    console.log(`Inserted pool: ${pool.poolId}`);
  }

  // 4. Indexer Checkpoints
  const checkpoints: DbIndexerCheckpoint[] = [
    {
      networkId: 'eip155:1',
      lastScannedBlockOrSlot: 21000000n,
      lastFinalizedBlockOrSlot: 20999950n,
      updatedAt: new Date(),
    },
    {
      networkId: 'solana:mainnet-beta',
      lastScannedBlockOrSlot: 290000000n,
      lastFinalizedBlockOrSlot: 289999900n,
      updatedAt: new Date(),
    },
  ];

  for (const cp of checkpoints) {
    await db.updateCheckpoint(cp);
    console.log(`Updated checkpoint for: ${cp.networkId}`);
  }

  await db.close();
  console.log('Seeding completed successfully.');
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});

