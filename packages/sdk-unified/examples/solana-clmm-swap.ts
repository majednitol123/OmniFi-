import { Connection, Keypair } from '@solana/web3.js';
import { OmniFiUnifiedClient } from '../src';

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const client = new OmniFiUnifiedClient({
    solana: {
      connection,
    },
  });

  const dummyUser = Keypair.generate().publicKey;
  const dummyMint0 = Keypair.generate().publicKey;
  const dummyMint1 = Keypair.generate().publicKey;
  const dummyPool = Keypair.generate().publicKey;
  const dummyConfig = Keypair.generate().publicKey;

  const userSource = client.solana().getAssociatedTokenAddress(dummyMint0, dummyUser);
  const userDestination = client.solana().getAssociatedTokenAddress(dummyMint1, dummyUser);

  const prepared = await client.prepareSwap({
    namespace: 'solana',
    cluster: 'devnet',
    protocol: 'clmm',
    user: dummyUser,
    config: dummyConfig,
    poolState: dummyPool,
    tokenVault0: dummyMint0,
    tokenVault1: dummyMint1,
    userSource,
    userDestination,
    amountIn: 10_000_000n,
    minimumAmountOut: 9_900_000n,
    zeroForOne: true,
    tokenIn: dummyMint0,
    tokenOut: dummyMint1,
    recentBlockhash: '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM',
  });

  console.log('Prepared Solana CLMM Swap Transaction:', prepared);
}

if (require.main === module) {
  main().catch(console.error);
}

