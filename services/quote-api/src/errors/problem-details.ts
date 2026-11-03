import { FastifyReply } from 'fastify';

/**
 * RFC 7807 Problem Details for HTTP APIs
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string | undefined;
  invalidParams?: { name: string; reason: string }[] | undefined;
}

export function sendProblemDetails(
  reply: FastifyReply,
  status: number,
  title: string,
  detail: string,
  instance?: string,
  invalidParams?: { name: string; reason: string }[],
): FastifyReply {
  const problem: ProblemDetails = {
    type: `https://omnifi.finance/errors/${status}`,
    title,
    status,
    detail,
    instance,
    invalidParams,
  };

  return reply
    .status(status)
    .header('content-type', 'application/problem+json')
    .send(problem);
}

