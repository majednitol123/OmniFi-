import { AssetRef } from './asset-ref';

/**
 * Standard Solana Token Program IDs
 */
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * Validates a base58 string format (32-44 characters).
 */
export function isValidBase58Address(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

/**
 * Factory function to create a Solana AssetRef.
 */
export function createSolanaAssetRef(
  cluster: string,
  mintAddress: string,
  tokenProgramId: string = SPL_TOKEN_PROGRAM_ID,
): AssetRef {
  if (!cluster || cluster.trim().length === 0) {
    throw new Error('Solana cluster must not be empty');
  }
  if (!isValidBase58Address(mintAddress)) {
    throw new Error(`Invalid Solana mint address: ${mintAddress}`);
  }
  if (!isValidBase58Address(tokenProgramId)) {
    throw new Error(`Invalid Solana token program ID: ${tokenProgramId}`);
  }

  return {
    namespace: 'solana',
    chainRef: cluster.trim(),
    address: mintAddress,
    tokenProgramId,
  };
}

/**
 * Determines whether a Solana token is a Token-2022 mint.
 */
export function isToken2022(ref: AssetRef): boolean {
  if (ref.namespace !== 'solana') return false;
  return ref.tokenProgramId === TOKEN_2022_PROGRAM_ID;
}

