import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  SQUADS_PROGRAM_ID,
  createSquads2of4Config,
  buildCreateSquads2of4MultisigIx,
  deriveSquadsVaultPda,
  deriveSquadsProposalPda,
  deriveSquadsTransactionPda,
  buildSquadsProposalCreateIx,
  buildSquadsProposalApproveIx,
  buildSquadsProposalRejectIx,
  buildSquadsChangeThresholdIx,
  verifySquadsQuorum,
} from '../governance/squads';

describe('OmniFi Squads Protocol 2-of-4 Governance SDK (@sqds/multisig)', () => {
  const member1 = Keypair.generate().publicKey;
  const member2 = Keypair.generate().publicKey;
  const member3 = Keypair.generate().publicKey;
  const member4 = Keypair.generate().publicKey;
  const nonMember = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;

  it('initializes a 2-of-4 Squads configuration with 4 members and threshold=2', () => {
    const config = createSquads2of4Config({
      members: [member1, member2, member3, member4],
      timeLockSeconds: 86400,
    });

    expect(config.threshold).toBe(2);
    expect(config.members.length).toBe(4);
    expect(config.timeLockSeconds).toBe(86400);
    expect(config.multisigPda).toBeInstanceOf(PublicKey);
  });

  it('rejects invalid member configurations (< 4 or duplicates)', () => {
    expect(() =>
      createSquads2of4Config({
        members: [member1, member2, member3],
      }),
    ).toThrow('Expected exactly 4 members');

    expect(() =>
      createSquads2of4Config({
        members: [member1, member2, member3, member1],
      }),
    ).toThrow('All 4 Squads member addresses must be strictly unique');
  });

  it('builds a multisigCreateV2 instruction matching Squads v4 program ID and account keys', () => {
    const config = createSquads2of4Config({
      members: [member1, member2, member3, member4],
    });

    const ix = buildCreateSquads2of4MultisigIx(config, creator);

    expect(ix.programId.toBase58()).toBe(SQUADS_PROGRAM_ID.toBase58());
    expect(ix.keys.length).toBeGreaterThanOrEqual(4);

    // Creator should be included among signers and writables
    const creatorMetas = ix.keys.filter((k) => k.pubkey?.equals(creator));
    expect(creatorMetas.length).toBeGreaterThanOrEqual(1);
    expect(creatorMetas.some((k) => k.isSigner)).toBe(true);
    expect(creatorMetas.some((k) => k.isWritable)).toBe(true);

    // Multisig PDA should be writable
    const multisigMeta = ix.keys.find((k) => k.pubkey.equals(config.multisigPda));
    expect(multisigMeta).toBeDefined();
    expect(multisigMeta?.isWritable).toBe(true);
  });

  it('derives canonical Squads vault, proposal, and transaction PDAs', () => {
    const config = createSquads2of4Config({
      members: [member1, member2, member3, member4],
    });

    const [vaultPda, vaultBump] = deriveSquadsVaultPda(config.multisigPda, 0);
    expect(vaultPda).toBeInstanceOf(PublicKey);
    expect(vaultBump).toBeGreaterThanOrEqual(0);

    const [proposalPda, proposalBump] = deriveSquadsProposalPda(config.multisigPda, 1n);
    expect(proposalPda).toBeInstanceOf(PublicKey);
    expect(proposalBump).toBeGreaterThanOrEqual(0);

    const [txPda, txBump] = deriveSquadsTransactionPda(config.multisigPda, 1n);
    expect(txPda).toBeInstanceOf(PublicKey);
    expect(txBump).toBeGreaterThanOrEqual(0);
  });

  it('builds proposalCreate and proposalApprove instructions for 2-of-4 voting', () => {
    const config = createSquads2of4Config({
      members: [member1, member2, member3, member4],
    });

    // Create proposal
    const createPropIx = buildSquadsProposalCreateIx({
      multisigPda: config.multisigPda,
      creator: member1,
      transactionIndex: 1n,
    });
    expect(createPropIx.programId.equals(SQUADS_PROGRAM_ID)).toBe(true);

    // Member 1 approves
    const approve1Ix = buildSquadsProposalApproveIx({
      multisigPda: config.multisigPda,
      member: member1,
      transactionIndex: 1n,
      memo: 'Approved by Member 1',
    });
    expect(approve1Ix.programId.equals(SQUADS_PROGRAM_ID)).toBe(true);

    // Member 2 approves
    const approve2Ix = buildSquadsProposalApproveIx({
      multisigPda: config.multisigPda,
      member: member2,
      transactionIndex: 1n,
      memo: 'Approved by Member 2',
    });
    expect(approve2Ix.programId.equals(SQUADS_PROGRAM_ID)).toBe(true);
  });

  it('verifies quorum satisfaction (2 approvals valid, 1 insufficient, duplicates rejected)', () => {
    const config = createSquads2of4Config({
      members: [member1, member2, member3, member4],
    });

    // 2 unique valid approvals -> Satisfied
    const passResult = verifySquadsQuorum(config, [member1, member3]);
    expect(passResult.valid).toBe(true);

    // 1 approval -> Insufficient
    const failResult = verifySquadsQuorum(config, [member1]);
    expect(failResult.valid).toBe(false);
    expect(failResult.reason).toContain('Quorum not met: required 2 approvals');

    // Duplicate approval from same member -> Rejected
    const dupResult = verifySquadsQuorum(config, [member1, member1]);
    expect(dupResult.valid).toBe(false);
    expect(dupResult.reason).toContain('Duplicate approval detected');

    // Approval from non-member -> Rejected
    const nonMemberResult = verifySquadsQuorum(config, [member1, nonMember]);
    expect(nonMemberResult.valid).toBe(false);
    expect(nonMemberResult.reason).toContain('not an authorized Squads multisig member');
  });

  it('builds changeThreshold instruction for governance quorum adjustments', () => {
    const config = createSquads2of4Config({
      members: [member1, member2, member3, member4],
    });

    const changeIx = buildSquadsChangeThresholdIx({
      multisigPda: config.multisigPda,
      configAuthority: config.multisigPda,
      rentPayer: creator,
      newThreshold: 3,
    });

    expect(changeIx.programId.equals(SQUADS_PROGRAM_ID)).toBe(true);
  });
});
