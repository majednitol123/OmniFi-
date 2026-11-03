import {
  Commitment,
  Connection,
  PublicKey,
  RpcResponseAndContext,
  SignatureStatus,
  SimulatedTransactionResponse,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  buildAmmAddLiquidityIx,
  BuildAmmAddLiquidityParams,
  buildAmmRemoveLiquidityIx,
  BuildAmmRemoveLiquidityParams,
  buildAmmSwapIx,
  BuildAmmSwapParams,
} from './amm';
import {
  buildClosePositionIx,
  BuildClosePositionParams,
  buildCollectFeesIx,
  BuildCollectFeesParams,
  buildDecreaseLiquidityIx,
  BuildDecreaseLiquidityParams,
  buildIncreaseLiquidityIx,
  BuildIncreaseLiquidityParams,
  buildOpenPositionIx,
  BuildOpenPositionParams,
  buildSwapIx,
  BuildSwapParams,
} from './clmm';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  OMNIFI_AMM_PROGRAM_ID,
  OMNIFI_CLMM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from './constants';
import {
  decodeAmmPoolState,
  decodeClmmPoolState,
  decodePositionAccount,
  decodeTickArrayAccount,
} from './serialization';
import {
  ClmmPoolState,
  PoolStateAccount,
  PositionAccount,
  TickArrayAccount,
} from './types';

export interface SolanaClientConfig {
  connection: Connection;
  commitment?: Commitment | undefined;
  ammProgramId?: PublicKey | undefined;
  clmmProgramId?: PublicKey | undefined;
}

export class OmniFiSolanaClient {
  public readonly connection: Connection;
  public readonly commitment: Commitment;
  public readonly ammProgramId: PublicKey;
  public readonly clmmProgramId: PublicKey;

  constructor(config: SolanaClientConfig) {
    this.connection = config.connection;
    this.commitment = config.commitment ?? 'confirmed';
    this.ammProgramId = config.ammProgramId ?? OMNIFI_AMM_PROGRAM_ID;
    this.clmmProgramId = config.clmmProgramId ?? OMNIFI_CLMM_PROGRAM_ID;
  }

  // ---------------------------------------------------------
  // On-Chain Reads
  // ---------------------------------------------------------

  public async getAmmPoolState(pool: PublicKey): Promise<PoolStateAccount> {
    const accountInfo = await this.connection.getAccountInfo(pool, this.commitment);
    if (!accountInfo) {
      throw new Error(`AMM pool account not found: ${pool.toBase58()}`);
    }
    return decodeAmmPoolState(accountInfo.data);
  }

  public async getClmmPoolState(pool: PublicKey): Promise<ClmmPoolState> {
    const accountInfo = await this.connection.getAccountInfo(pool, this.commitment);
    if (!accountInfo) {
      throw new Error(`CLMM pool account not found: ${pool.toBase58()}`);
    }
    return decodeClmmPoolState(accountInfo.data);
  }

  public async getTickArray(tickArray: PublicKey): Promise<TickArrayAccount> {
    const accountInfo = await this.connection.getAccountInfo(tickArray, this.commitment);
    if (!accountInfo) {
      throw new Error(`Tick array account not found: ${tickArray.toBase58()}`);
    }
    return decodeTickArrayAccount(accountInfo.data);
  }

  public async getPosition(position: PublicKey): Promise<PositionAccount> {
    const accountInfo = await this.connection.getAccountInfo(position, this.commitment);
    if (!accountInfo) {
      throw new Error(`Position account not found: ${position.toBase58()}`);
    }
    return decodePositionAccount(accountInfo.data);
  }

  public async getUserPositions(owner: PublicKey): Promise<PositionAccount[]> {
    // Discriminator for PositionState + owner offset filter at offset 40
    const accounts = await this.connection.getProgramAccounts(this.clmmProgramId, {
      commitment: this.commitment,
      filters: [
        {
          memcmp: {
            offset: 40,
            bytes: owner.toBase58(),
          },
        },
      ],
    });

    return accounts.map((acc) => decodePositionAccount(acc.account.data));
  }

  public async getTokenAccountBalance(tokenAccount: PublicKey): Promise<bigint> {
    const balance = await this.connection.getTokenAccountBalance(tokenAccount, this.commitment);
    return BigInt(balance.value.amount);
  }

  // ---------------------------------------------------------
  // Associated Token Account Utilities
  // ---------------------------------------------------------

  public getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
    const [address] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    return address;
  }

  public buildCreateAtaInstruction(
    payer: PublicKey,
    owner: PublicKey,
    mint: PublicKey,
  ): TransactionInstruction {
    const ata = this.getAssociatedTokenAddress(mint, owner);
    return new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.alloc(0),
    });
  }

  // ---------------------------------------------------------
  // Transaction Builders (Unsigned Versioned Transactions)
  // ---------------------------------------------------------

  private async compileTransaction(
    payer: PublicKey,
    instructions: TransactionInstruction[],
    recentBlockhash?: string | undefined,
  ): Promise<VersionedTransaction> {
    let blockhash = recentBlockhash;
    if (!blockhash) {
      const latest = await this.connection.getLatestBlockhash(this.commitment);
      blockhash = latest.blockhash;
    }

    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    return new VersionedTransaction(messageV0);
  }

  public async buildAmmSwapTransaction(
    params: BuildAmmSwapParams & { recentBlockhash?: string | undefined },
  ): Promise<VersionedTransaction> {
    const ix = buildAmmSwapIx({
      ...params,
      programId: params.programId ?? this.ammProgramId,
    });
    return this.compileTransaction(params.user, [ix], params.recentBlockhash);
  }

  public async buildAmmAddLiquidityTransaction(
    params: BuildAmmAddLiquidityParams & { recentBlockhash?: string | undefined },
  ): Promise<VersionedTransaction> {
    const ix = buildAmmAddLiquidityIx({
      ...params,
      programId: params.programId ?? this.ammProgramId,
    });
    return this.compileTransaction(params.user, [ix], params.recentBlockhash);
  }

  public async buildAmmRemoveLiquidityTransaction(
    params: BuildAmmRemoveLiquidityParams & { recentBlockhash?: string | undefined },
  ): Promise<VersionedTransaction> {
    const ix = buildAmmRemoveLiquidityIx({
      ...params,
      programId: params.programId ?? this.ammProgramId,
    });
    return this.compileTransaction(params.user, [ix], params.recentBlockhash);
  }

  public async buildClmmSwapTransaction(
    params: BuildSwapParams & { recentBlockhash?: string | undefined },
  ): Promise<VersionedTransaction> {
    const ix = buildSwapIx({
      ...params,
      programId: params.programId ?? this.clmmProgramId,
    });
    return this.compileTransaction(params.user, [ix], params.recentBlockhash);
  }

  public async buildOpenPositionTransaction(
    params: BuildOpenPositionParams & { recentBlockhash?: string | undefined },
  ): Promise<VersionedTransaction> {
    const ix = buildOpenPositionIx({
      ...params,
      programId: params.programId ?? this.clmmProgramId,
    });
    return this.compileTransaction(params.payer, [ix], params.recentBlockhash);
  }

  public async buildIncreaseLiquidityTransaction(
    params: BuildIncreaseLiquidityParams & { recentBlockhash?: string | undefined },
  ): Promise<VersionedTransaction> {
    const ix = buildIncreaseLiquidityIx({
      ...params,
      programId: params.programId ?? this.clmmProgramId,
    });
    return this.compileTransaction(params.owner, [ix], params.recentBlockhash);
  }

  public async buildDecreaseLiquidityTransaction(
    params: BuildDecreaseLiquidityParams & { recentBlockhash?: string | undefined },
  ): Promise<VersionedTransaction> {
    const ix = buildDecreaseLiquidityIx({
      ...params,
      programId: params.programId ?? this.clmmProgramId,
    });
    return this.compileTransaction(params.owner, [ix], params.recentBlockhash);
  }

  public async buildCollectFeesTransaction(
    params: BuildCollectFeesParams & { recentBlockhash?: string | undefined },
  ): Promise<VersionedTransaction> {
    const ix = buildCollectFeesIx({
      ...params,
      programId: params.programId ?? this.clmmProgramId,
    });
    return this.compileTransaction(params.owner, [ix], params.recentBlockhash);
  }

  public async buildClosePositionTransaction(
    params: BuildClosePositionParams & { recentBlockhash?: string | undefined },
  ): Promise<VersionedTransaction> {
    const ix = buildClosePositionIx({
      ...params,
      programId: params.programId ?? this.clmmProgramId,
    });
    return this.compileTransaction(params.owner, [ix], params.recentBlockhash);
  }

  // ---------------------------------------------------------
  // Simulation & Confirmation
  // ---------------------------------------------------------

  public async simulateTransaction(
    tx: VersionedTransaction,
  ): Promise<SimulatedTransactionResponse> {
    const res = await this.connection.simulateTransaction(tx, {
      commitment: this.commitment,
    });
    return res.value;
  }

  public async confirmTransaction(
    signature: string,
    commitment?: Commitment | undefined,
  ): Promise<RpcResponseAndContext<SignatureStatus>> {
    const targetCommitment = commitment ?? this.commitment;
    const res = await this.connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });

    if (!res.value) {
      throw new Error(`Transaction ${signature} not found`);
    }

    return res as RpcResponseAndContext<SignatureStatus>;
  }
}

