import { Connection, Keypair } from '@solana/web3.js';
import { OmniFiUnifiedClient, UnifiedSwapParams } from '../src';

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const client = new OmniFiUnifiedClient({
    evm: {
      1: { rpcUrl: 'https://eth.llamarpc.com', chainId: 1 },
    },
    solana: {
      connection,
    },
  });

  // 1. Prepare EVM Swap
  const evmParams: UnifiedSwapParams = {
    namespace: 'eip155',
    chainId: 1,
    protocol: 'v2',
    tokenIn: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    tokenOut: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    amountIn: 500_000_000n,
    amountOutMin: 150_000_000_000_000_000n,
    recipient: '0x1111111111111111111111111111111111111111',
    routerAddress: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
    deadline: 1900000000n,
  };

  const evmPrepared = await client.prepareSwap(evmParams);
  console.log('Prepared EVM swap tx:', evmPrepared.namespace, evmPrepared.chainId);

  // 2. Prepare Solana Swap
  const user = Keypair.generate().publicKey;
  const mint0 = Keypair.generate().publicKey;
  const mint1 = Keypair.generate().publicKey;
  const pool = Keypair.generate().publicKey;

  const solanaParams: UnifiedSwapParams = {
    namespace: 'solana',
    cluster: 'devnet',
    protocol: 'amm',
    user,
    tokenIn: mint0,
    tokenOut: mint1,
    poolState: pool,
    tokenVault0: mint0,
    tokenVault1: mint1,
    userSource: client.solana().getAssociatedTokenAddress(mint0, user),
    userDestination: client.solana().getAssociatedTokenAddress(mint1, user),
    amountIn: 1_000_000n,
    minimumAmountOut: 980_000n,
    zeroForOne: true,
    recentBlockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
  };

  const solanaPrepared = await client.prepareSwap(solanaParams);
  console.log('Prepared Solana swap tx:', solanaPrepared.namespace, solanaPrepared.cluster);
}

if (require.main === module) {
  main().catch(console.error);
}

