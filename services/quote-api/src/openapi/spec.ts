export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'OmniFi Multi-Chain DEX & Data Platform API',
    version: '1.0.0',
    description:
      'Enterprise-grade RESTful API for multi-chain routing, pool querying, transaction preparation, on-chain state indexing, and risk analytics across EVM and Solana.',
    contact: {
      name: 'OmniFi Protocol Engineering',
      url: 'https://omnifi.finance',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'https://api.omnifi.finance',
      description: 'Production API Gateway',
    },
    {
      url: 'http://localhost:3001',
      description: 'Local Development Server',
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Service Health Check',
        description: 'Returns server operational health status and timestamp.',
        responses: {
          '200': {
            description: 'Healthy response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'healthy' },
                    timestamp: { type: 'integer', example: 1793626719964 },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/networks': {
      get: {
        summary: 'List Supported Networks',
        description:
          'Retrieves supported EVM chains and Solana clusters with status, RPC metadata, and finality boundaries.',
        responses: {
          '200': {
            description: 'Network list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    networks: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/NetworkInfo' },
                    },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/tokens': {
      get: {
        summary: 'List Supported Tokens',
        description: 'Queries multi-chain token registry with optional filtering by network, symbol, or risk tier.',
        parameters: [
          { name: 'networkId', in: 'query', schema: { type: 'string' } },
          { name: 'riskTier', in: 'query', schema: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] } },
          { name: 'symbol', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Filtered token list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tokens: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/TokenInfo' },
                    },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/tokens/{network}/{asset}': {
      get: {
        summary: 'Get Token Details',
        parameters: [
          { name: 'network', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'asset', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Token details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TokenInfo' },
              },
            },
          },
          '404': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
    '/api/v1/pools': {
      get: {
        summary: 'List Liquidity Pools',
        description: 'Queries liquidity pools with optional filtering by network, protocol, or token, with pagination.',
        parameters: [
          { name: 'networkId', in: 'query', schema: { type: 'string' } },
          { name: 'protocol', in: 'query', schema: { type: 'string', enum: ['v2', 'clmm', 'v4', 'amm'] } },
          { name: 'token', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': {
            description: 'Paginated pools list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    pools: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/PoolInfo' },
                    },
                    total: { type: 'integer' },
                    offset: { type: 'integer' },
                    limit: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/pools/{network}/{poolId}': {
      get: {
        summary: 'Get Pool State',
        parameters: [
          { name: 'network', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'poolId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Pool details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PoolInfo' },
              },
            },
          },
          '404': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
    '/api/v1/positions': {
      get: {
        summary: 'List User Positions',
        description: 'Queries user liquidity positions by owner address from database records.',
        parameters: [
          { name: 'owner', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'networkId', in: 'query', schema: { type: 'string' } },
          { name: 'poolId', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'User positions list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    positions: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/PositionInfo' },
                    },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
    '/api/v1/quotes': {
      get: {
        summary: 'Request Optimal Swap Quote',
        description: 'Discovers optimal execution path and returns pure integer quote calculation with price impact and fee breakdown.',
        parameters: [
          { name: 'tokenIn', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'tokenOut', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'amountIn', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'slippageBps', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          '200': {
            description: 'Computed swap quote',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    quoteId: { type: 'string' },
                    amountIn: { type: 'string' },
                    amountOut: { type: 'string' },
                    executionPrice: { type: 'string' },
                    priceImpact: { type: 'object' },
                    routes: { type: 'array' },
                    splits: { type: 'array' },
                    expiresAt: { type: 'integer' },
                    ttlMs: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
    '/api/v1/routes': {
      get: {
        summary: 'Discover Trading Routes',
        description: 'Searches the routing graph for all feasible single-hop and multi-hop paths between tokenIn and tokenOut.',
        parameters: [
          { name: 'tokenIn', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'tokenOut', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Feasible routes',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tokenIn: { type: 'string' },
                    tokenOut: { type: 'string' },
                    totalRoutesFound: { type: 'integer' },
                    routes: { type: 'array' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
    '/api/v1/analytics/overview': {
      get: {
        summary: 'Protocol Analytics Overview',
        description: 'Returns real TVL, 24h volume, fee collections, and active pool metrics derived from database events.',
        parameters: [
          { name: 'networkId', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Aggregated protocol analytics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    networkId: { type: 'string' },
                    totalTvlUsd: { type: 'string' },
                    totalVolume24hUsd: { type: 'string' },
                    totalFees24hUsd: { type: 'string' },
                    totalPools: { type: 'integer' },
                    totalSwaps24h: { type: 'integer' },
                    updatedAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/analytics/pools/{network}/{poolId}': {
      get: {
        summary: 'Pool Analytics & Volume',
        description: 'Returns individual pool TVL, 24h volume, fees, swap count, and fee APY based on on-chain state and database swaps.',
        parameters: [
          { name: 'network', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'poolId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Pool-specific analytics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    networkId: { type: 'string' },
                    poolId: { type: 'string' },
                    volume24hUsd: { type: 'string' },
                    fees24hUsd: { type: 'string' },
                    tvlUsd: { type: 'string' },
                    swapCount24h: { type: 'integer' },
                    volume7dUsd: { type: 'string' },
                    feeApy: { type: 'string' },
                    updatedAt: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
    '/api/v1/swap/prepare': {
      post: {
        summary: 'Prepare Swap Transaction',
        description:
          'Prepares an unsigned transaction payload (complete ABI calldata for EVM or full 10-account PDA instruction for Solana) for client-side signing without key custody.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SwapPrepareRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Prepared non-custodial transaction payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PreparedTransactionResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
    '/api/v1/liquidity/add/prepare': {
      post: {
        summary: 'Prepare Add Liquidity Transaction',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LiquidityAddPrepareRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Prepared transaction payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PreparedTransactionResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
    '/api/v1/liquidity/remove/prepare': {
      post: {
        summary: 'Prepare Remove Liquidity Transaction',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LiquidityRemovePrepareRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Prepared transaction payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PreparedTransactionResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
    '/api/v1/positions/collect/prepare': {
      post: {
        summary: 'Prepare Fee Collection Transaction',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CollectFeesPrepareRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Prepared fee collection transaction payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PreparedTransactionResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
    '/api/v1/simulate': {
      post: {
        summary: 'Simulate Transaction Against RPC',
        description: 'Simulates transaction execution against genuine EVM or Solana RPC node with strict SSRF validation.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['intent'],
                properties: {
                  intent: { type: 'object' },
                  rpcUrl: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Simulation result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    intentId: { type: 'string' },
                    namespace: { type: 'string' },
                    success: { type: 'boolean' },
                    gasUsed: { type: 'string' },
                    unitsConsumed: { type: 'integer' },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ProblemDetails' },
        },
      },
    },
  },
  components: {
    schemas: {
      NetworkInfo: {
        type: 'object',
        properties: {
          networkId: { type: 'string' },
          name: { type: 'string' },
          namespace: { type: 'string', enum: ['eip155', 'solana'] },
          chainRef: { type: 'string' },
          rpcUrl: { type: 'string' },
          status: { type: 'string' },
        },
      },
      TokenInfo: {
        type: 'object',
        properties: {
          tokenId: { type: 'string' },
          networkId: { type: 'string' },
          address: { type: 'string' },
          name: { type: 'string' },
          symbol: { type: 'string' },
          decimals: { type: 'integer' },
          riskTier: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        },
      },
      PoolInfo: {
        type: 'object',
        properties: {
          poolId: { type: 'string' },
          networkId: { type: 'string' },
          poolType: { type: 'string' },
          token0: { type: 'object' },
          token1: { type: 'object' },
          feeTier: { type: 'integer' },
          state: { type: 'object' },
        },
      },
      PositionInfo: {
        type: 'object',
        properties: {
          positionId: { type: 'string' },
          networkId: { type: 'string' },
          owner: { type: 'string' },
          liquidity: { type: 'string' },
          tokensOwed0: { type: 'string' },
          tokensOwed1: { type: 'string' },
          status: { type: 'string' },
        },
      },
      SwapPrepareRequest: {
        type: 'object',
        required: [
          'namespace',
          'networkId',
          'userAddress',
          'protocol',
          'tokenIn',
          'tokenOut',
          'amountIn',
          'minAmountOut',
        ],
        properties: {
          namespace: { type: 'string', enum: ['eip155', 'solana'] },
          networkId: { type: 'string' },
          userAddress: { type: 'string' },
          protocol: { type: 'string', enum: ['v2', 'clmm', 'v4', 'amm'] },
          tokenIn: { type: 'string' },
          tokenOut: { type: 'string' },
          amountIn: { type: 'string' },
          minAmountOut: { type: 'string' },
        },
      },
      LiquidityAddPrepareRequest: {
        type: 'object',
        required: [
          'namespace',
          'networkId',
          'userAddress',
          'protocol',
          'token0',
          'token1',
          'amount0Desired',
          'amount1Desired',
        ],
        properties: {
          namespace: { type: 'string', enum: ['eip155', 'solana'] },
          networkId: { type: 'string' },
          userAddress: { type: 'string' },
        },
      },
      LiquidityRemovePrepareRequest: {
        type: 'object',
        required: [
          'namespace',
          'networkId',
          'userAddress',
          'protocol',
          'poolId',
          'liquidity',
          'amount0Min',
          'amount1Min',
        ],
        properties: {
          namespace: { type: 'string' },
          poolId: { type: 'string' },
        },
      },
      CollectFeesPrepareRequest: {
        type: 'object',
        required: ['namespace', 'networkId', 'owner', 'poolId', 'positionId'],
        properties: {
          namespace: { type: 'string' },
          positionId: { type: 'string' },
        },
      },
      PreparedTransactionResponse: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          networkId: { type: 'string' },
          preparedTransaction: { type: 'object' },
        },
      },
    },
    responses: {
      ProblemDetails: {
        description: 'RFC 7807 Problem Details Error Response',
        content: {
          'application/problem+json': {
            schema: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                title: { type: 'string' },
                status: { type: 'integer' },
                detail: { type: 'string' },
                instance: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

