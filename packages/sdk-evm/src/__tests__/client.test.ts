import { describe, expect, it } from 'vitest';
import { OmniFiEvmClient } from '../client';

describe('OmniFiEvmClient', () => {
  const client = new OmniFiEvmClient({
    rpcUrl: 'http://127.0.0.1:8545',
    chainId: 1,
  });

  const dummyToken: `0x${string}` = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const dummySpender: `0x${string}` = '0x1111111111111111111111111111111111111111';
  const dummyRecipient: `0x${string}` = '0x2222222222222222222222222222222222222222';

  it('builds ERC20 approve transaction with max or custom amount', () => {
    const tx = client.buildApproveTransaction(dummyToken, dummySpender);
    expect(tx.to).toBe(dummyToken);
    expect(tx.data.startsWith('0x095ea7b3')).toBe(true); // approve(address,uint256) selector
    expect(tx.value).toBe(0n);
  });

  it('builds V2 swap transaction correctly', () => {
    const tx = client.buildV2SwapTransaction({
      routerAddress: dummySpender,
      amountIn: 1_000_000n,
      amountOutMin: 990_000n,
      path: [dummyToken, dummyRecipient],
      recipient: dummyRecipient,
      deadline: 1800000000n,
    });

    expect(tx.to).toBe(dummySpender);
    expect(tx.data.startsWith('0x38ed1739')).toBe(true); // swapExactTokensForTokens selector
  });

  it('builds CLMM single swap transaction correctly', () => {
    const tx = client.buildClmmSingleSwapTransaction({
      routerAddress: dummySpender,
      tokenIn: dummyToken,
      tokenOut: dummyRecipient,
      fee: 3000,
      recipient: dummyRecipient,
      deadline: 1800000000n,
      amountIn: 1_000_000n,
      amountOutMinimum: 990_000n,
    });

    expect(tx.to).toBe(dummySpender);
    expect(tx.data.startsWith('0x414bf389')).toBe(true); // exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
  });

  it('builds CLMM mint position transaction correctly', () => {
    const tx = client.buildClmmMintPositionTransaction({
      positionManagerAddress: dummySpender,
      token0: dummyToken,
      token1: dummyRecipient,
      fee: 3000,
      tickLower: -600,
      tickUpper: 600,
      amount0Desired: 10_000_000n,
      amount1Desired: 5_000_000n,
      amount0Min: 9_900_000n,
      amount1Min: 4_900_000n,
      recipient: dummyRecipient,
      deadline: 1800000000n,
    });

    expect(tx.to).toBe(dummySpender);
    expect(tx.data.startsWith('0x88316456')).toBe(true); // mint selector
  });

  it('builds CLMM collect fees transaction correctly', () => {
    const tx = client.buildClmmCollectFeesTransaction({
      positionManagerAddress: dummySpender,
      tokenId: 42n,
      recipient: dummyRecipient,
    });

    expect(tx.to).toBe(dummySpender);
    expect(tx.data.startsWith('0xfc6f7865')).toBe(true); // collect selector
  });
});
