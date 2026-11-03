import { Connection, Keypair } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { OmniFiUnifiedClient } from '../client';
import { UnifiedSwapParams } from '../types';

describe('OmniFiUnifiedClient', () => {
  const dummyConnection = new Connection('http://127.0.0.1:8899', 'confirmed');
  const client = new OmniFiUnifiedClient({
    evm: {
      1: {
        rpcUrl: 'http://127.0.0.1:8545',
        chainId: 1,
      },
      8453: {
        rpcUrl: 'http://127.0.0.1:8545',
        chainId: 8453,
      },
    },
    solana: {
      connection: dummyConnection,
    },
  });

  const dummyEvmToken0 = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const;
  const dummyEvmToken1 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as const;
  const dummyEvmRouter = '0x1111111111111111111111111111111111111111' as const;
  const dummyRecipient = '0x2222222222222222222222222222222222222222' as const;

  const dummySolUser = Keypair.generate().publicKey;
  const dummySolMint0 = Keypair.generate().publicKey;
  const dummySolMint1 = Keypair.generate().publicKey;
  const dummySolPool = Keypair.generate().publicKey;
  const dummySolConfig = Keypair.generate().publicKey;
  const dummyBlockhash = '4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM';

  it('exposes configured subclients and throws for unconfigured chainId', () => {
    expect(client.evm(1)).toBeDefined();
    expect(client.evm(8453)).toBeDefined();
    expect(() => client.evm(10)).toThrow('EVM client not configured for chainId: 10');
    expect(client.solana()).toBeDefined();
  });

  it('prepares EVM V2 swap transaction cleanly', async () => {
    const params: UnifiedSwapParams = {
      namespace: 'eip155',
      chainId: 1,
      protocol: 'v2',
      tokenIn: dummyEvmToken0,
      tokenOut: dummyEvmToken1,
      amountIn: 1_000_000n,
      amountOutMin: 990_000n,
      recipient: dummyRecipient,
      routerAddress: dummyEvmRouter,
      deadline: 1800000000n,
    };

    const prepared = await client.prepareSwap(params);
    expect(prepared.namespace).toBe('eip155');
    if (prepared.namespace === 'eip155') {
      expect(prepared.chainId).toBe(1);
      expect(prepared.transaction.to).toBe(dummyEvmRouter);
      expect(prepared.transaction.data.startsWith('0x38ed1739')).toBe(true);
    }
  });

  it('prepares EVM CLMM swap transaction cleanly', async () => {
    const params: UnifiedSwapParams = {
      namespace: 'eip155',
      chainId: 8453,
      protocol: 'clmm',
      tokenIn: dummyEvmToken0,
      tokenOut: dummyEvmToken1,
      amountIn: 2_000_000n,
      amountOutMin: 1_900_000n,
      fee: 3000,
      recipient: dummyRecipient,
      routerAddress: dummyEvmRouter,
      deadline: 1800000000n,
    };

    const prepared = await client.prepareSwap(params);
    expect(prepared.namespace).toBe('eip155');
    if (prepared.namespace === 'eip155') {
      expect(prepared.chainId).toBe(8453);
      expect(prepared.transaction.to).toBe(dummyEvmRouter);
      expect(prepared.transaction.data.startsWith('0x414bf389')).toBe(true);
    }
  });

  it('prepares Solana AMM swap transaction cleanly', async () => {
    const userSource = client.solana().getAssociatedTokenAddress(dummySolMint0, dummySolUser);
    const userDest = client.solana().getAssociatedTokenAddress(dummySolMint1, dummySolUser);

    const params: UnifiedSwapParams = {
      namespace: 'solana',
      cluster: 'localnet',
      protocol: 'amm',
      user: dummySolUser,
      tokenIn: dummySolMint0,
      tokenOut: dummySolMint1,
      poolState: dummySolPool,
      tokenVault0: dummySolMint0,
      tokenVault1: dummySolMint1,
      userSource,
      userDestination: userDest,
      amountIn: 5_000_000n,
      minimumAmountOut: 4_900_000n,
      zeroForOne: true,
      recentBlockhash: dummyBlockhash,
    };

    const prepared = await client.prepareSwap(params);
    expect(prepared.namespace).toBe('solana');
    if (prepared.namespace === 'solana') {
      expect(prepared.cluster).toBe('localnet');
      expect(prepared.transaction.message.recentBlockhash).toBe(dummyBlockhash);
    }
  });

  it('prepares Solana CLMM swap transaction cleanly', async () => {
    const userSource = client.solana().getAssociatedTokenAddress(dummySolMint0, dummySolUser);
    const userDest = client.solana().getAssociatedTokenAddress(dummySolMint1, dummySolUser);

    const params: UnifiedSwapParams = {
      namespace: 'solana',
      cluster: 'devnet',
      protocol: 'clmm',
      user: dummySolUser,
      config: dummySolConfig,
      tokenIn: dummySolMint0,
      tokenOut: dummySolMint1,
      poolState: dummySolPool,
      tokenVault0: dummySolMint0,
      tokenVault1: dummySolMint1,
      userSource,
      userDestination: userDest,
      amountIn: 10_000_000n,
      minimumAmountOut: 9_800_000n,
      zeroForOne: true,
      recentBlockhash: dummyBlockhash,
    };

    const prepared = await client.prepareSwap(params);
    expect(prepared.namespace).toBe('solana');
    if (prepared.namespace === 'solana') {
      expect(prepared.cluster).toBe('devnet');
      expect(prepared.transaction.message.recentBlockhash).toBe(dummyBlockhash);
    }
  });
});

