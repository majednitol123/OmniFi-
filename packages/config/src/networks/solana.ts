import { NetworkConfig } from '../types';

export const SOLANA_NETWORKS: readonly NetworkConfig[] = [
  {
    id: 'solana-devnet',
    displayName: 'Solana Devnet',
    namespace: 'solana',
    chainRef: 'devnet',
    isTestnet: true,
    features: {
      v2Amm: true,
      clmm: true,
      permit2: false, // Solana uses native signers / delegate authority
    },
    finality: {
      confirmed: 1, // 'confirmed' commitment
      finalized: 32, // 'finalized' commitment (root bank)
      avgBlockTimeMs: 400,
    },
    explorerUrl: 'https://explorer.solana.com',
    explorerTxPattern: 'https://explorer.solana.com/tx/{tx}?cluster=devnet',
    explorerAddressPattern: 'https://explorer.solana.com/address/{address}?cluster=devnet',
    nativeCurrency: {
      name: 'Solana',
      symbol: 'SOL',
      decimals: 9,
    },
    iconId: 'solana',
  },
  {
    id: 'solana-localnet',
    displayName: 'Solana Localnet',
    namespace: 'solana',
    chainRef: 'localnet',
    isTestnet: true,
    features: {
      v2Amm: true,
      clmm: true,
      permit2: false,
    },
    finality: {
      confirmed: 1,
      finalized: 1,
      avgBlockTimeMs: 400,
    },
    explorerUrl: 'https://explorer.solana.com',
    explorerTxPattern:
      'https://explorer.solana.com/tx/{tx}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899',
    explorerAddressPattern:
      'https://explorer.solana.com/address/{address}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899',
    nativeCurrency: {
      name: 'Solana',
      symbol: 'SOL',
      decimals: 9,
    },
    iconId: 'solana',
  },
];
