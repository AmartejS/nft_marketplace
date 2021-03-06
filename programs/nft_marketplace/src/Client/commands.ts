import log from 'loglevel';

import * as anchor from '@project-serum/anchor';
import {
  MintLayout,
  Token,
} from '@solana/spl-token';
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';

import {
  getAtaForMint,
  getCandyMachineCreator,
  getMasterEdition,
  getMetadata,
  getTokenWallet,
  loadCandyProgramV2,
  loadWalletKey,
} from './accounts';
import {
  TOKEN_METADATA_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from './constants';
import { createAssociatedTokenAccountInstruction } from './instructions';
import { sendTransactionWithRetryWithKeypair } from './transactions';

export async function mintV2(
  keypair: string,
  env: string,
  candyMachineAddress: PublicKey,
  rpcUrl: string,
): Promise<string> {
  const mint = Keypair.generate();

  const userKeyPair = loadWalletKey(keypair);
  const anchorProgram = await loadCandyProgramV2(userKeyPair, env, rpcUrl);
  const userTokenAccountAddress = await getTokenWallet(
    userKeyPair.publicKey,
    mint.publicKey,
  );
  log.info('token id :', mint.publicKey.toBase58());
  log.info('usertokenAccountAddress: ', userTokenAccountAddress.toBase58());
  const candyMachine: any = await anchorProgram.account.candyMachine.fetch(
    candyMachineAddress,
  );
// log.info('candyMachine: ', candyMachine);
  const remainingAccounts = [];
  const signers = [mint, userKeyPair];
  const cleanupInstructions = [];
  const instructions = [
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: userKeyPair.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MintLayout.span,
      lamports:
        await anchorProgram.provider.connection.getMinimumBalanceForRentExemption(
          MintLayout.span,
        ),
      programId: TOKEN_PROGRAM_ID,
    }),
    Token.createInitMintInstruction(
      TOKEN_PROGRAM_ID,
      mint.publicKey,
      0,
      userKeyPair.publicKey,
      userKeyPair.publicKey,
    ),
    createAssociatedTokenAccountInstruction(
      userTokenAccountAddress,
      userKeyPair.publicKey,
      userKeyPair.publicKey,
      mint.publicKey,
    ),
    Token.createMintToInstruction(
      TOKEN_PROGRAM_ID,
      mint.publicKey,
      userTokenAccountAddress,
      userKeyPair.publicKey,
      [],
      1,
    ),
  ];

  if (candyMachine.data.whitelistMintSettings) {
    const mint = new anchor.web3.PublicKey(
      candyMachine.data.whitelistMintSettings.mint,
    );

    const whitelistToken = (
      await getAtaForMint(mint, userKeyPair.publicKey)
    )[0];
    remainingAccounts.push({
      pubkey: whitelistToken,
      isWritable: true,
      isSigner: false,
    });

    if (candyMachine.data.whitelistMintSettings.mode.burnEveryTime) {
      const whitelistBurnAuthority = anchor.web3.Keypair.generate();

      remainingAccounts.push({
        pubkey: mint,
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: whitelistBurnAuthority.publicKey,
        isWritable: false,
        isSigner: true,
      });
      signers.push(whitelistBurnAuthority);
      const exists = await anchorProgram.provider.connection.getAccountInfo(
        whitelistToken,
      );
      if (exists) {
        instructions.push(
          Token.createApproveInstruction(
            TOKEN_PROGRAM_ID,
            whitelistToken,
            whitelistBurnAuthority.publicKey,
            userKeyPair.publicKey,
            [],
            1,
          ),
        );
        cleanupInstructions.push(
          Token.createRevokeInstruction(
            TOKEN_PROGRAM_ID,
            whitelistToken,
            userKeyPair.publicKey,
            [],
          ),
        );
      }
    }
  }

  let tokenAccount;
  if (candyMachine.tokenMint) {
    const transferAuthority = anchor.web3.Keypair.generate();

    tokenAccount = await getTokenWallet(
      userKeyPair.publicKey,
      candyMachine.tokenMint,
    );

    remainingAccounts.push({
      pubkey: tokenAccount,
      isWritable: true,
      isSigner: false,
    });
    remainingAccounts.push({
      pubkey: transferAuthority.publicKey,
      isWritable: false,
      isSigner: true,
    });

    instructions.push(
      Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        tokenAccount,
        transferAuthority.publicKey,
        userKeyPair.publicKey,
        [],
        candyMachine.data.price.toNumber(),
      ),
    );
    signers.push(transferAuthority);
    cleanupInstructions.push(
      Token.createRevokeInstruction(
        TOKEN_PROGRAM_ID,
        tokenAccount,
        userKeyPair.publicKey,
        [],
      ),
    );
  }
  const metadataAddress = await getMetadata(mint.publicKey);
  const masterEdition = await getMasterEdition(mint.publicKey);
 log.info('metadataAddress: ', metadataAddress.toBase58());
  const [candyMachineCreator, creatorBump] = await getCandyMachineCreator(
    candyMachineAddress,
  );

  // log.info('candy machine creator', candyMachineCreator.toBase58());
  // log.info('creator bump', creatorBump);
  // let mintnftinst = await anchorProgram.instruction.mintNft(creatorBump, {
  //   accounts: {
  //     candyMachine: candyMachineAddress,
  //     candyMachineCreator,
  //     payer: userKeyPair.publicKey,
  //     //@ts-ignore
  //     wallet: candyMachine.wallet,
  //     mint: mint.publicKey,
  //     metadata: metadataAddress,
  //     masterEdition,
  //     mintAuthority: userKeyPair.publicKey,
  //     updateAuthority: userKeyPair.publicKey,
  //     tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
  //     tokenProgram: TOKEN_PROGRAM_ID,
  //     systemProgram: SystemProgram.programId,
  //     rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  //     clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
  //     recentBlockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
  //     instructionSysvarAccount: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
  //   },
  //   remainingAccounts:
  //     remainingAccounts.length > 0 ? remainingAccounts : undefined,
  // })

  // log.info('mint token id', mint.publicKey.toBase58());

  //log.info("mintnftinstruction: ", mintnftinst.programId.toBase58());
    
  //instructions.push(mintnftinst);
// log.info('mintnft instructions pushed ', instructions);
  const finished = (
    await sendTransactionWithRetryWithKeypair(
      anchorProgram.provider.connection,
      userKeyPair,
      instructions,
      signers,
    )
  ).txid;
  log.info('finished', finished.toString());

// log.info('first sendTransactionWithRetryKepair');
  await sendTransactionWithRetryWithKeypair(
    anchorProgram.provider.connection,
    userKeyPair,
    cleanupInstructions,
    [],
  );
  // log.info('second sendTransactoinWithRetryKeypair');

  return finished;
}
