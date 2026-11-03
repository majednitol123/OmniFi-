import {
  calculateSafeTransactionHash,
  buildSignatureBytes,
  encodeSetupCallData,
} from '@safe-global/protocol-kit';
import {
  type Address,
  type Hex,
  encodeFunctionData,
  isAddress,
  getAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface SafeTransactionData {
  to: Address;
  value: string;
  data: Hex;
  operation: number; // 0 = Call, 1 = DelegateCall
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: Address;
  refundReceiver: Address;
  nonce: number;
}

export interface SafeSignature {
  signer: Address;
  data: Hex;
  isContractSignature?: boolean;
}

export interface Safe2of4Config {
  owners: Address[];
  threshold: number;
  chainId: bigint;
  safeAddress?: Address | undefined;
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

export const SAFE_ABI = [
  {
    type: 'function',
    name: 'execTransaction',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getThreshold',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nonce',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Creates and validates a 2-of-4 Gnosis Safe configuration with canonical owner sorting.
 */
export function createSafe2of4Config(params: {
  owners: Address[];
  chainId: bigint;
  safeAddress?: Address;
}): Safe2of4Config {
  const { owners, chainId, safeAddress } = params;

  if (owners.length !== 4) {
    throw new Error(`Expected exactly 4 owners for 2-of-4 Safe, got ${owners.length}`);
  }

  const normalized = owners.map((addr) => {
    if (!isAddress(addr)) {
      throw new Error(`Invalid Ethereum address: ${addr}`);
    }
    return getAddress(addr);
  });

  const unique = new Set(normalized.map((a) => a.toLowerCase()));
  if (unique.size !== 4) {
    throw new Error('All 4 Safe owner addresses must be strictly unique');
  }

  // Canonical sorting ascending
  const sorted = [...normalized].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );

  return {
    owners: sorted,
    threshold: 2,
    chainId,
    safeAddress: safeAddress ? getAddress(safeAddress) : undefined,
  };
}

/**
 * Builds a standardized Safe transaction object with default gas & execution parameters.
 */
export function buildSafeTransaction(
  params: Partial<SafeTransactionData> & { to: Address },
): SafeTransactionData {
  return {
    to: getAddress(params.to),
    value: params.value ?? '0',
    data: params.data ?? '0x',
    operation: params.operation ?? 0,
    safeTxGas: params.safeTxGas ?? '0',
    baseGas: params.baseGas ?? '0',
    gasPrice: params.gasPrice ?? '0',
    gasToken: params.gasToken ? getAddress(params.gasToken) : ZERO_ADDRESS,
    refundReceiver: params.refundReceiver
      ? getAddress(params.refundReceiver)
      : ZERO_ADDRESS,
    nonce: params.nonce ?? 0,
  };
}

/**
 * Calculates EIP-712 Safe transaction hash using @safe-global/protocol-kit.
 */
export function getSafeTxHash(
  safeAddress: Address,
  safeTx: SafeTransactionData,
  chainId: bigint,
  safeVersion = '1.4.1',
): Hex {
  return calculateSafeTransactionHash(
    safeAddress,
    safeTx as any,
    safeVersion,
    chainId,
  ) as Hex;
}

/**
 * Signs a Safe transaction with a private key using EIP-712 hashing.
 */
export async function signSafeTransaction(
  safeAddress: Address,
  safeTx: SafeTransactionData,
  chainId: bigint,
  privateKey: Hex,
  safeVersion = '1.4.1',
): Promise<SafeSignature> {
  const account = privateKeyToAccount(privateKey);
  const txHash = getSafeTxHash(safeAddress, safeTx, chainId, safeVersion);

  const rawSig = await account.sign({
    hash: txHash,
  });

  return {
    signer: account.address,
    data: rawSig,
  };
}

/**
 * Assembles and strictly sorts signatures ascending by signer address using @safe-global/protocol-kit.
 */
export function assembleSafeSignatures(signatures: SafeSignature[]): Hex {
  const formatted = signatures.map((sig) => ({
    signer: getAddress(sig.signer),
    data: sig.data,
    isContractSignature: sig.isContractSignature ?? false,
  }));

  return buildSignatureBytes(formatted as any) as Hex;
}

/**
 * Validates that signatures meet the 2-of-4 quorum requirement.
 */
export function verifySafeQuorum(
  config: Safe2of4Config,
  signatures: SafeSignature[],
): { valid: boolean; reason?: string } {
  if (signatures.length < config.threshold) {
    return {
      valid: false,
      reason: `Quorum not met: required ${config.threshold} signatures, received ${signatures.length}`,
    };
  }

  const seen = new Set<string>();
  const ownerSet = new Set(config.owners.map((o) => o.toLowerCase()));

  for (const sig of signatures) {
    const signerLower = sig.signer.toLowerCase();
    if (!ownerSet.has(signerLower)) {
      return {
        valid: false,
        reason: `Signer ${sig.signer} is not an authorized Safe owner`,
      };
    }
    if (seen.has(signerLower)) {
      return {
        valid: false,
        reason: `Duplicate signature detected from signer ${sig.signer}`,
      };
    }
    seen.add(signerLower);
  }

  return { valid: true };
}

/**
 * Encodes the execTransaction calldata to broadcast to the Safe smart contract.
 */
export function encodeSafeExecTransactionCalldata(
  safeTx: SafeTransactionData,
  signaturesBytes: Hex,
): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'execTransaction',
    args: [
      safeTx.to,
      BigInt(safeTx.value),
      safeTx.data,
      safeTx.operation,
      BigInt(safeTx.safeTxGas),
      BigInt(safeTx.baseGas),
      BigInt(safeTx.gasPrice),
      safeTx.gasToken,
      safeTx.refundReceiver,
      signaturesBytes,
    ],
  });
}
