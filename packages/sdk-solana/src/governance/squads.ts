import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

export const SQUADS_PROGRAM_ID: PublicKey = multisig.PROGRAM_ID;

export interface Squads2of4Config {
  multisigPda: PublicKey;
  members: PublicKey[];
  threshold: number;
  createKey: PublicKey;
  timeLockSeconds: number;
}

/**
 * Creates and validates a 2-of-4 Squads Protocol v4 configuration.
 */
export function createSquads2of4Config(params: {
  members: (string | PublicKey)[];
  createKey?: PublicKey;
  timeLockSeconds?: number;
}): Squads2of4Config {
  const { members, createKey = new PublicKey('11111111111111111111111111111111'), timeLockSeconds = 86400 } = params;

  if (members.length !== 4) {
    throw new Error(`Expected exactly 4 members for 2-of-4 Squads multisig, got ${members.length}`);
  }

  const pubkeys = members.map((m) => (typeof m === 'string' ? new PublicKey(m) : m));

  const unique = new Set(pubkeys.map((p) => p.toBase58()));
  if (unique.size !== 4) {
    throw new Error('All 4 Squads member addresses must be strictly unique');
  }

  const [multisigPda] = multisig.getMultisigPda({
    createKey,
    programId: SQUADS_PROGRAM_ID,
  });

  return {
    multisigPda,
    members: pubkeys,
    threshold: 2,
    createKey,
    timeLockSeconds,
  };
}

/**
 * Generates the instruction to initialize a 2-of-4 Squads v4 multisig account.
 */
export function buildCreateSquads2of4MultisigIx(
  config: Squads2of4Config,
  creator: PublicKey,
  rentCollector: PublicKey | null = null,
): TransactionInstruction {
  const membersWithPermissions = config.members.map((pubkey) => ({
    key: pubkey,
    permissions: multisig.types.Permissions.all(),
  }));

  return multisig.instructions.multisigCreateV2({
    treasury: creator,
    creator,
    multisigPda: config.multisigPda,
    configAuthority: null, // Decentralized: config changed only through multisig proposals
    threshold: config.threshold,
    members: membersWithPermissions,
    timeLock: config.timeLockSeconds,
    createKey: config.createKey,
    rentCollector,
    memo: 'OmniFi Protocol 2-of-4 Governance',
    programId: SQUADS_PROGRAM_ID,
  });
}

/**
 * Derives the canonical vault PDA address for a Squads multisig.
 */
export function deriveSquadsVaultPda(multisigPda: PublicKey, vaultIndex = 0): [PublicKey, number] {
  return multisig.getVaultPda({
    multisigPda,
    index: vaultIndex,
    programId: SQUADS_PROGRAM_ID,
  });
}

/**
 * Derives the proposal PDA address for a given transaction index.
 */
export function deriveSquadsProposalPda(
  multisigPda: PublicKey,
  transactionIndex: bigint | number,
): [PublicKey, number] {
  return multisig.getProposalPda({
    multisigPda,
    transactionIndex: BigInt(transactionIndex),
    programId: SQUADS_PROGRAM_ID,
  });
}

/**
 * Derives the transaction PDA address for a given transaction index.
 */
export function deriveSquadsTransactionPda(
  multisigPda: PublicKey,
  transactionIndex: bigint | number,
): [PublicKey, number] {
  return multisig.getTransactionPda({
    multisigPda,
    index: BigInt(transactionIndex),
    programId: SQUADS_PROGRAM_ID,
  });
}

/**
 * Builds the instruction to create a proposal for a transaction in a Squads multisig.
 */
export function buildSquadsProposalCreateIx(params: {
  multisigPda: PublicKey;
  creator: PublicKey;
  transactionIndex: bigint | number;
  isDraft?: boolean;
}): TransactionInstruction {
  return multisig.instructions.proposalCreate({
    multisigPda: params.multisigPda,
    creator: params.creator,
    transactionIndex: BigInt(params.transactionIndex),
    isDraft: params.isDraft ?? false,
    programId: SQUADS_PROGRAM_ID,
  });
}

/**
 * Builds the instruction for an authorized member to approve a proposed transaction.
 */
export function buildSquadsProposalApproveIx(params: {
  multisigPda: PublicKey;
  member: PublicKey;
  transactionIndex: bigint | number;
  memo?: string;
}): TransactionInstruction {
  return multisig.instructions.proposalApprove({
    multisigPda: params.multisigPda,
    member: params.member,
    transactionIndex: BigInt(params.transactionIndex),
    ...(params.memo !== undefined ? { memo: params.memo } : {}),
    programId: SQUADS_PROGRAM_ID,
  });
}

/**
 * Builds the instruction for an authorized member to reject a proposed transaction.
 */
export function buildSquadsProposalRejectIx(params: {
  multisigPda: PublicKey;
  member: PublicKey;
  transactionIndex: bigint | number;
  memo?: string;
}): TransactionInstruction {
  return multisig.instructions.proposalReject({
    multisigPda: params.multisigPda,
    member: params.member,
    transactionIndex: BigInt(params.transactionIndex),
    ...(params.memo !== undefined ? { memo: params.memo } : {}),
    programId: SQUADS_PROGRAM_ID,
  });
}

/**
 * Builds the instruction to modify the multisig threshold (e.g. from 2 to 3).
 */
export function buildSquadsChangeThresholdIx(params: {
  multisigPda: PublicKey;
  configAuthority: PublicKey;
  rentPayer: PublicKey;
  newThreshold: number;
  memo?: string;
}): TransactionInstruction {
  return multisig.instructions.multisigChangeThreshold({
    multisigPda: params.multisigPda,
    configAuthority: params.configAuthority,
    rentPayer: params.rentPayer,
    newThreshold: params.newThreshold,
    ...(params.memo !== undefined ? { memo: params.memo } : {}),
    programId: SQUADS_PROGRAM_ID,
  });
}

/**
 * Verifies that a collection of approving members satisfies the 2-of-4 quorum.
 */
export function verifySquadsQuorum(
  config: Squads2of4Config,
  approvingMembers: PublicKey[],
): { valid: boolean; reason?: string } {
  if (approvingMembers.length < config.threshold) {
    return {
      valid: false,
      reason: `Quorum not met: required ${config.threshold} approvals, received ${approvingMembers.length}`,
    };
  }

  const authorizedSet = new Set(config.members.map((m) => m.toBase58()));
  const seen = new Set<string>();

  for (const member of approvingMembers) {
    const base58 = member.toBase58();
    if (!authorizedSet.has(base58)) {
      return {
        valid: false,
        reason: `Member ${base58} is not an authorized Squads multisig member`,
      };
    }
    if (seen.has(base58)) {
      return {
        valid: false,
        reason: `Duplicate approval detected from member ${base58}`,
      };
    }
    seen.add(base58);
  }

  return { valid: true };
}
