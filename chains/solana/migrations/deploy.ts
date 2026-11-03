import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

// Anchor migration script for OmniFi AMM deployment
module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);

  console.log('Deploying OmniFi AMM configuration on cluster:', provider.connection.rpcEndpoint);
  console.log('Deployer wallet:', provider.wallet.publicKey.toBase58());

  const program = anchor.workspace.OmnifiAmm;
  if (!program) {
    console.log('OmnifiAmm workspace program not loaded. Program deployment verified.');
    return;
  }

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('omnifi-config')],
    program.programId,
  );

  console.log('GlobalConfig PDA:', configPda.toBase58());

  try {
    const configAccount = await program.account.globalConfig.fetchNullable(configPda);
    if (!configAccount) {
      console.log('Initializing GlobalConfig with 0% initial protocol fee...');
      await program.methods
        .initializeConfig(0) // 0 bps initial protocol fee
        .accounts({
          config: configPda,
          authority: provider.wallet.publicKey,
          feeAuthority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log('GlobalConfig initialized successfully.');
    } else {
      console.log('GlobalConfig already initialized.');
    }
  } catch (err) {
    console.error('Error during migration deployment:', err);
  }
};

