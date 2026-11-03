import { FastifyInstance } from 'fastify';

export interface NetworkInfo {
  networkId: string;
  name: string;
  namespace: 'eip155' | 'solana';
  chainRef: string;
  nativeAsset: {
    symbol: string;
    decimals: number;
  };
  rpcUrl: string;
  status: 'active' | 'degraded' | 'maintenance';
}

export const SUPPORTED_NETWORKS: NetworkInfo[] = [
  {
    networkId: 'eip155:1',
    name: 'Ethereum Mainnet',
    namespace: 'eip155',
    chainRef: '1',
    nativeAsset: { symbol: 'ETH', decimals: 18 },
    rpcUrl: process.env.RPC_ETH_1 ?? 'https://eth.llamarpc.com',
    status: 'active',
  },
  {
    networkId: 'eip155:8453',
    name: 'Base Mainnet',
    namespace: 'eip155',
    chainRef: '8453',
    nativeAsset: { symbol: 'ETH', decimals: 18 },
    rpcUrl: process.env.RPC_BASE_8453 ?? 'https://mainnet.base.org',
    status: 'active',
  },
  {
    networkId: 'solana:mainnet-beta',
    name: 'Solana Mainnet',
    namespace: 'solana',
    chainRef: 'mainnet-beta',
    nativeAsset: { symbol: 'SOL', decimals: 9 },
    rpcUrl: process.env.RPC_SOLANA_MAINNET ?? 'https://api.mainnet-beta.solana.com',
    status: 'active',
  },
  {
    networkId: 'solana:devnet',
    name: 'Solana Devnet',
    namespace: 'solana',
    chainRef: 'devnet',
    nativeAsset: { symbol: 'SOL', decimals: 9 },
    rpcUrl: process.env.RPC_SOLANA_DEVNET ?? 'https://api.devnet.solana.com',
    status: 'active',
  },
];

export function registerNetworksRoutes(fastify: FastifyInstance): void {
  const handler = async () => {
    return {
      networks: SUPPORTED_NETWORKS,
      total: SUPPORTED_NETWORKS.length,
    };
  };

  fastify.get('/api/v1/networks', handler);
  fastify.get('/networks', handler);
}

