import { AssetRef } from './asset-ref';

/**
 * Pure TypeScript implementation of Keccak-256 sponge for EIP-55 checksumming.
 * Zero external dependencies, runs universally in Node.js, browsers, and edge runtimes.
 */
const RC = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

const RHO = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

function rotl64(n: bigint, s: number): bigint {
  const sn = BigInt(s);
  return ((n << sn) | (n >> (64n - sn))) & 0xffffffffffffffffn;
}

export function keccak256(data: Uint8Array): Uint8Array {
  const state = new BigUint64Array(25);
  const rate = 136; // 1088 bits = 136 bytes for Keccak-256

  // Pad message with 0x01 ... 0x80 (original Keccak, not NIST SHA3)
  const len = data.length;
  const padLen = rate - (len % rate);
  const padded = new Uint8Array(len + padLen);
  padded.set(data);
  padded[len] = 0x01;
  padded[padded.length - 1]! |= 0x80;

  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let val = 0n;
      for (let b = 0; b < 8; b++) {
        val |= BigInt(padded[offset + i * 8 + b]!) << BigInt(b * 8);
      }
      state[i] = state[i]! ^ val;
    }

    // 24 rounds
    for (let round = 0; round < 24; round++) {
      // Theta
      const C = new BigUint64Array(5);
      for (let x = 0; x < 5; x++) {
        C[x] = state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!;
      }
      for (let x = 0; x < 5; x++) {
        const D = C[(x + 4) % 5]! ^ rotl64(C[(x + 1) % 5]!, 1);
        for (let y = 0; y < 5; y++) {
          state[y * 5 + x] = state[y * 5 + x]! ^ D;
        }
      }

      // Rho and Pi
      const B = new BigUint64Array(25);
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          const idx = y * 5 + x;
          B[((2 * x + 3 * y) % 5) * 5 + y] = rotl64(state[idx]!, RHO[idx]!);
        }
      }

      // Chi
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          const idx = y * 5 + x;
          state[idx] = B[idx]! ^ (~B[y * 5 + ((x + 1) % 5)]! & B[y * 5 + ((x + 2) % 5)]!);
        }
      }

      // Iota
      state[0] = state[0]! ^ RC[round]!;
    }
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    const val = state[i]!;
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number((val >> BigInt(b * 8)) & 0xffn);
    }
  }
  return out;
}

/**
 * Converts an Ethereum address to its EIP-55 checksummed format.
 */
export function toChecksumAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }

  const clean = address.toLowerCase().substring(2);
  const data = new TextEncoder().encode(clean);
  const hash = keccak256(data);

  let checksummed = '0x';
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]!;
    const hashByte = (hash[Math.floor(i / 2)]! >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
    if (hashByte >= 8) {
      checksummed += char.toUpperCase();
    } else {
      checksummed += char;
    }
  }

  return checksummed;
}

/**
 * Validates if an address matches EIP-55 checksum rules.
 */
export function isValidChecksumAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return false;
  }
  const clean = address.substring(2);
  // All lowercase or all uppercase without 0x is not checksummed
  if (clean === clean.toLowerCase() || clean === clean.toUpperCase()) {
    return true; // Valid raw hex address
  }
  try {
    return toChecksumAddress(address) === address;
  } catch {
    return false;
  }
}

/**
 * Creates an EVM AssetRef with validated chainId and address.
 */
export function createEvmAssetRef(chainId: number | string, address: string): AssetRef {
  const chainRef = typeof chainId === 'number' ? chainId.toString() : chainId;
  if (!/^\d+$/.test(chainRef)) {
    throw new Error(`Invalid EVM chainId: ${chainId}`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Invalid EVM address format: ${address}`);
  }

  return {
    namespace: 'eip155',
    chainRef,
    address: toChecksumAddress(address),
  };
}
