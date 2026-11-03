import { NetworkConfig } from '../types';

export const EVM_NETWORKS: readonly NetworkConfig[] = [
  {
    id: 'ethereum-sepolia',
    displayName: 'Ethereum Sepolia',
    namespace: 'eip155',
    chainRef: '11155111',
    isTestnet: true,
    features: {
      v2Amm: true,
      clmm: true,
      permit2: true,
    },
    finality: {
      confirmed: 12,
      finalized: 64,
      avgBlockTimeMs: 12000,
    },
    explorerUrl: 'https://sepolia.etherscan.io',
    explorerTxPattern: 'https://sepolia.etherscan.io/tx/{tx}',
    explorerAddressPattern: 'https://sepolia.etherscan.io/address/{address}',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    iconId: 'ethereum',
  },
  {
    id: 'arbitrum-sepolia',
    displayName: 'Arbitrum Sepolia',
    namespace: 'eip155',
    chainRef: '421614',
    isTestnet: true,
    features: {
      v2Amm: true,
      clmm: true,
      permit2: true,
    },
    finality: {
      confirmed: 1,
      finalized: 20,
      avgBlockTimeMs: 250,
    },
    explorerUrl: 'https://sepolia.arbiscan.io',
    explorerTxPattern: 'https://sepolia.arbiscan.io/tx/{tx}',
    explorerAddressPattern: 'https://sepolia.arbiscan.io/address/{address}',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    iconId: 'arbitrum',
  },
  {
    id: 'anvil-local',
    displayName: 'Anvil Localhost',
    namespace: 'eip155',
    chainRef: '31337',
    isTestnet: true,
    features: {
      v2Amm: true,
      clmm: true,
      permit2: true,
    },
    finality: {
      confirmed: 1,
      finalized: 1,
      avgBlockTimeMs: 2000,
    },
    explorerUrl: 'http://localhost:8545',
    explorerTxPattern: 'http://localhost:8545/tx/{tx}',
    explorerAddressPattern: 'http://localhost:8545/address/{address}',
    nativeCurrency: {
      name: 'Anvil Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    iconId: 'ethereum',
  },
];

