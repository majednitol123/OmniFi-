import { OmniFiUnifiedClient } from '../src';

async function main() {
  const client = new OmniFiUnifiedClient({
    evm: {
      1: {
        rpcUrl: 'https://eth.llamarpc.com',
        chainId: 1,
      },
    },
  });

  const prepared = await client.prepareSwap({
    namespace: 'eip155',
    chainId: 1,
    protocol: 'clmm',
    tokenIn: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    tokenOut: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
    amountIn: 1_000_000_000n, // 1000 USDC
    amountOutMin: 300_000_000_000_000_000n, // 0.3 WETH
    fee: 500,
    recipient: '0x1111111111111111111111111111111111111111',
    routerAddress: '0xe592427a0aece92de3edee1f18e0157c05861564',
    deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
  });

  console.log('Prepared EVM CLMM Swap Transaction:', prepared);
}

if (require.main === module) {
  main().catch(console.error);
}

