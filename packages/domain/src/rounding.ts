/**
 * Explicit rounding direction rules per operation.
 * Source: docs/protocol/fee-and-rounding-spec.md §4
 */

export enum RoundingDirection {
  /** Round towards zero (truncate) — favors protocol solvency */
  Down = 'down',
  /** Round away from zero (ceiling) — favors protocol against exploit */
  Up = 'up',
}

export type ProtocolOperation =
  | 'fee_deduction'
  | 'swap_exact_in_amount_out'
  | 'swap_exact_out_amount_in'
  | 'liquidity_mint'
  | 'liquidity_burn_token0'
  | 'liquidity_burn_token1';

/**
 * Canonical protocol rounding table.
 * Every operation must have an explicit, non-ambiguous rounding rule.
 */
export const OPERATION_ROUNDING_POLICY: Record<ProtocolOperation, RoundingDirection> = {
  fee_deduction: RoundingDirection.Up,
  swap_exact_in_amount_out: RoundingDirection.Down,
  swap_exact_out_amount_in: RoundingDirection.Up,
  liquidity_mint: RoundingDirection.Down,
  liquidity_burn_token0: RoundingDirection.Down,
  liquidity_burn_token1: RoundingDirection.Down,
};

