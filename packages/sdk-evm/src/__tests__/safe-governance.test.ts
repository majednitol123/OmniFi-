import { describe, expect, it } from 'vitest';
import {
  createSafe2of4Config,
  buildSafeTransaction,
  getSafeTxHash,
  signSafeTransaction,
  assembleSafeSignatures,
  verifySafeQuorum,
  encodeSafeExecTransactionCalldata,
  SAFE_ABI,
} from '../governance/safe';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { decodeFunctionData, type Hex, getAddress } from 'viem';

describe('OmniFi Safe 2-of-4 Governance SDK (@safe-global/protocol-kit)', () => {
  const pk1 = generatePrivateKey();
  const pk2 = generatePrivateKey();
  const pk3 = generatePrivateKey();
  const pk4 = generatePrivateKey();
  const nonOwnerPk = generatePrivateKey();

  const acc1 = privateKeyToAccount(pk1);
  const acc2 = privateKeyToAccount(pk2);
  const acc3 = privateKeyToAccount(pk3);
  const acc4 = privateKeyToAccount(pk4);
  const nonOwnerAcc = privateKeyToAccount(nonOwnerPk);

  const safeAddress = getAddress('0x5afe000000000000000000000000000000000001');
  const chainId = 1n; // Ethereum Mainnet

  it('initializes a 2-of-4 Safe configuration with sorted owners', () => {
    const config = createSafe2of4Config({
      owners: [acc1.address, acc2.address, acc3.address, acc4.address],
      chainId,
      safeAddress,
    });

    expect(config.threshold).toBe(2);
    expect(config.owners.length).toBe(4);
    expect(config.safeAddress).toBe(safeAddress);

    // Verify canonical sorting ascending
    for (let i = 0; i < config.owners.length - 1; i++) {
      const current = config.owners[i]!;
      const next = config.owners[i + 1]!;
      expect(current.toLowerCase() < next.toLowerCase()).toBe(true);
    }
  });

  it('rejects invalid owner configurations (< 4 or duplicates)', () => {
    expect(() =>
      createSafe2of4Config({
        owners: [acc1.address, acc2.address, acc3.address],
        chainId,
      }),
    ).toThrow('Expected exactly 4 owners');

    expect(() =>
      createSafe2of4Config({
        owners: [acc1.address, acc2.address, acc3.address, acc1.address],
        chainId,
      }),
    ).toThrow('All 4 Safe owner addresses must be strictly unique');
  });

  it('builds a Safe transaction and calculates deterministic EIP-712 hash', () => {
    const tx = buildSafeTransaction({
      to: '0x1000000000000000000000000000000000000005',
      value: '1000000000000000000', // 1 ETH
      data: '0x1234',
      nonce: 0,
    });

    const hash = getSafeTxHash(safeAddress, tx, chainId);
    expect(hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('gathers 2-of-4 signatures and satisfies quorum verification', async () => {
    const config = createSafe2of4Config({
      owners: [acc1.address, acc2.address, acc3.address, acc4.address],
      chainId,
      safeAddress,
    });

    const tx = buildSafeTransaction({
      to: '0x1000000000000000000000000000000000000005',
      value: '0',
      data: '0x',
      nonce: 0,
    });

    // Owner 1 and Owner 3 sign
    const sig1 = await signSafeTransaction(safeAddress, tx, chainId, pk1);
    const sig3 = await signSafeTransaction(safeAddress, tx, chainId, pk3);

    const verification = verifySafeQuorum(config, [sig1, sig3]);
    expect(verification.valid).toBe(true);

    const assembledBytes = assembleSafeSignatures([sig1, sig3]);
    // 2 signatures * 65 bytes = 130 bytes = 260 hex characters + "0x" = 262 characters
    expect(assembledBytes.length).toBe(2 + 65 * 2 * 2);
  });

  it('rejects transactions with insufficient signatures (1-of-4)', async () => {
    const config = createSafe2of4Config({
      owners: [acc1.address, acc2.address, acc3.address, acc4.address],
      chainId,
      safeAddress,
    });

    const tx = buildSafeTransaction({
      to: '0x1000000000000000000000000000000000000005',
      nonce: 0,
    });

    const sig1 = await signSafeTransaction(safeAddress, tx, chainId, pk1);

    const verification = verifySafeQuorum(config, [sig1]);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain('Quorum not met: required 2 signatures');
  });

  it('rejects transactions with duplicate signatures from same owner', async () => {
    const config = createSafe2of4Config({
      owners: [acc1.address, acc2.address, acc3.address, acc4.address],
      chainId,
      safeAddress,
    });

    const tx = buildSafeTransaction({
      to: '0x1000000000000000000000000000000000000005',
      nonce: 0,
    });

    const sig1 = await signSafeTransaction(safeAddress, tx, chainId, pk1);

    const verification = verifySafeQuorum(config, [sig1, sig1]);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain('Duplicate signature detected');
  });

  it('rejects signatures from unauthorized non-owners', async () => {
    const config = createSafe2of4Config({
      owners: [acc1.address, acc2.address, acc3.address, acc4.address],
      chainId,
      safeAddress,
    });

    const tx = buildSafeTransaction({
      to: '0x1000000000000000000000000000000000000005',
      nonce: 0,
    });

    const sig1 = await signSafeTransaction(safeAddress, tx, chainId, pk1);
    const rogueSig = await signSafeTransaction(safeAddress, tx, chainId, nonOwnerPk);

    const verification = verifySafeQuorum(config, [sig1, rogueSig]);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain('not an authorized Safe owner');
  });

  it('encodes valid execTransaction calldata decodable by Safe ABI', async () => {
    const tx = buildSafeTransaction({
      to: '0x1000000000000000000000000000000000000005',
      value: '500000',
      data: '0xaabbccdd' as Hex,
      nonce: 3,
    });

    const sig1 = await signSafeTransaction(safeAddress, tx, chainId, pk1);
    const sig2 = await signSafeTransaction(safeAddress, tx, chainId, pk2);
    const signaturesBytes = assembleSafeSignatures([sig1, sig2]);

    const calldata = encodeSafeExecTransactionCalldata(tx, signaturesBytes);
    expect(calldata.startsWith('0x6a761202')).toBe(true); // execTransaction selector

    const decoded = decodeFunctionData({
      abi: SAFE_ABI,
      data: calldata,
    });

    expect(decoded.functionName).toBe('execTransaction');
    expect(decoded.args[0]).toBe(tx.to);
    expect(decoded.args[1]).toBe(500000n);
    expect(decoded.args[2]).toBe(tx.data);
    expect(decoded.args[9]).toBe(signaturesBytes);
  });
});
