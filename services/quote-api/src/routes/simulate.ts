import { TransactionIntent } from '@omnifi/domain';
import { simulateEvmCall, simulateSolanaIntent } from '@omnifi/quote-engine';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendProblemDetails } from '../errors/problem-details';
import { SimulateBodySchema } from '../validation/schemas';

function validateRpcEndpoint(urlStr: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: 'RPC protocol must be HTTP or HTTPS' };
    }
    const host = parsed.hostname.toLowerCase();

    // Critical Cloud Metadata SSRF Protection (forbidden in all environments)
    if (
      host === '169.254.169.254' ||
      host === 'metadata.google.internal' ||
      host === 'instance-data' ||
      host.endsWith('.metadata.google.internal')
    ) {
      return { valid: false, reason: 'Target URL resolves to forbidden cloud instance metadata endpoint' };
    }

    // In production or when explicitly configured, block private/internal CIDRs
    const isLocalDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    if (!isLocalDev) {
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '0.0.0.0' ||
        host.endsWith('.internal') ||
        host.endsWith('.local') ||
        host.endsWith('.lan') ||
        host.endsWith('.corp') ||
        /^10\./.test(host) ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host)
      ) {
        return { valid: false, reason: 'Target URL resolves to forbidden private or loopback address' };
      }
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: 'Malformed RPC URL' };
  }
}

export function registerSimulateRoutes(fastify: FastifyInstance) {
  fastify.post('/api/v1/simulate', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = SimulateBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      const invalidParams = parseResult.error.errors.map((e) => ({
        name: e.path.join('.'),
        reason: e.message,
      }));
      return sendProblemDetails(
        reply,
        400,
        'Invalid Request Body',
        'Transaction intent payload failed schema validation.',
        request.url,
        invalidParams,
      );
    }

    const { intent, rpcUrl } = parseResult.data;

    if (rpcUrl) {
      const validation = validateRpcEndpoint(rpcUrl);
      if (!validation.valid) {
        return sendProblemDetails(
          reply,
          400,
          'SSRF Security Rejection',
          validation.reason || 'Provided RPC URL violates network access security policy',
          request.url,
        );
      }
    }

    if (intent.namespace === 'eip155') {
      const defaultRpc = rpcUrl ?? 'http://127.0.0.1:8545';
      const sender = ((intent as any).from ?? '0x0000000000000000000000000000000000000001') as `0x${string}`;

      const sim = await simulateEvmCall(defaultRpc, sender, intent as unknown as TransactionIntent);
      return reply.status(200).send({
        intentId: intent.intentId,
        namespace: intent.namespace,
        success: sim.success,
        gasUsed: sim.gasUsed ? sim.gasUsed.toString() : (sim.success ? '150000' : undefined),
        error: sim.error,
      });
    }

    if (intent.namespace === 'solana') {
      const defaultRpc = rpcUrl ?? 'http://127.0.0.1:8899';
      const sim = await simulateSolanaIntent(defaultRpc, intent as unknown as TransactionIntent);
      return reply.status(200).send({
        intentId: intent.intentId,
        namespace: intent.namespace,
        success: sim.success,
        unitsConsumed: sim.unitsConsumed ?? 200_000,
        logs: sim.logs ?? [],
        error: sim.error,
      });
    }

    return sendProblemDetails(
      reply,
      400,
      'Unsupported Namespace',
      `Simulation for namespace ${intent.namespace} is not supported.`,
      request.url,
    );
  });
}
