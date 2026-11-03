import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendProblemDetails } from '../errors/problem-details';

export interface TokenMetadata {
  networkId: string;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUri?: string | undefined;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
}

export const DEFAULT_TOKENS: TokenMetadata[] = [
  {
    networkId: 'eip155:1',
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    logoUri: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
    riskTier: 'LOW',
  },
  {
    networkId: 'eip155:1',
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    logoUri: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
    riskTier: 'LOW',
  },
  {
    networkId: 'eip155:1',
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    name: 'Tether USD',
    symbol: 'USDT',
    decimals: 6,
    logoUri: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
    riskTier: 'LOW',
  },
  {
    networkId: 'eip155:8453',
    address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    name: 'USD Coin (Base)',
    symbol: 'USDC',
    decimals: 6,
    riskTier: 'LOW',
  },
  {
    networkId: 'eip155:8453',
    address: '0x4200000000000000000000000000000000000006',
    name: 'Wrapped Ether (Base)',
    symbol: 'WETH',
    decimals: 18,
    riskTier: 'LOW',
  },
  {
    networkId: 'solana:mainnet-beta',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    name: 'USD Coin (Solana)',
    symbol: 'USDC',
    decimals: 6,
    riskTier: 'LOW',
  },
  {
    networkId: 'solana:mainnet-beta',
    address: 'So11111111111111111111111111111111111111112',
    name: 'Wrapped SOL',
    symbol: 'SOL',
    decimals: 9,
    riskTier: 'LOW',
  },
  {
    networkId: 'solana:mainnet-beta',
    address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    name: 'USDT (Solana)',
    symbol: 'USDT',
    decimals: 6,
    riskTier: 'LOW',
  },
];

export function registerTokensRoutes(fastify: FastifyInstance): void {
  const listHandler = async (
    request: FastifyRequest<{
      Querystring: { networkId?: string; symbol?: string; riskTier?: string };
    }>,
  ) => {
    let tokens = DEFAULT_TOKENS;
    const { networkId, symbol, riskTier } = request.query;

    if (networkId) {
      tokens = tokens.filter((t) => t.networkId.toLowerCase() === networkId.toLowerCase());
    }
    if (symbol) {
      tokens = tokens.filter((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
    }
    if (riskTier) {
      tokens = tokens.filter((t) => t.riskTier.toUpperCase() === riskTier.toUpperCase());
    }

    return {
      tokens,
      total: tokens.length,
    };
  };

  fastify.get('/api/v1/tokens', listHandler);
  fastify.get('/tokens', listHandler);

  // Network + Asset route: /api/v1/tokens/:network/:asset
  fastify.get(
    '/api/v1/tokens/:network/:asset',
    async (
      request: FastifyRequest<{
        Params: { network: string; asset: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { network, asset } = request.params;
      const found = DEFAULT_TOKENS.find(
        (t) =>
          t.networkId.toLowerCase() === network.toLowerCase() &&
          t.address.toLowerCase() === asset.toLowerCase(),
      );

      if (!found) {
        return sendProblemDetails(
          reply,
          404,
          'Token Not Found',
          `Token with address ${asset} on network ${network} was not found.`,
          request.url,
        );
      }

      return found;
    },
  );

  // Single assetRef route: /tokens/:assetRef
  fastify.get(
    '/tokens/:assetRef',
    async (
      request: FastifyRequest<{
        Params: { assetRef: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { assetRef } = request.params;
      const decoded = decodeURIComponent(assetRef);
      const found = DEFAULT_TOKENS.find(
        (t) =>
          t.address.toLowerCase() === decoded.toLowerCase() ||
          `${t.networkId}/${t.address}`.toLowerCase() === decoded.toLowerCase(),
      );

      if (!found) {
        return sendProblemDetails(
          reply,
          404,
          'Token Not Found',
          `Token ${decoded} was not found.`,
          request.url,
        );
      }

      return found;
    },
  );
}

