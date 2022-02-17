#!/usr/bin/env ts-node
import { program } from 'commander';
import * as fs from 'fs';
import log from 'loglevel';
import { getType } from 'mime';
import * as path from 'path';

import * as anchor from '@project-serum/anchor';
import { PublicKey } from '@solana/web3.js';

import {
  loadCandyProgramV2,
  loadWalletKey,
} from './accounts';
import {
  loadCache,
  saveCache,
} from './cache';
import { mintV2 } from './commands';
import {
  CACHE_PATH,
  CONFIG_ARRAY_START_V2,
  CONFIG_LINE_SIZE_V2,
  EXTENSION_JSON,
} from './constants';
import { StorageType } from './storagetype';
import { uploadV2 } from './upload';
import {
  chunks,
  fromUTF8Array,
  getCandyMachineV2Config,
} from './various';

//program.version('0.0.2');
const supportedImageTypes = {
  'image/png': 1,
  'image/gif': 1,
  'image/jpeg': 1,
};

if (!fs.existsSync(CACHE_PATH)) {
  fs.mkdirSync(CACHE_PATH);
}
log.setLevel(log.levels.INFO);
programCommand('upload')
  .argument(
    '<directory>',
    'Directory containing images named from 0-n',
    val => {
      return fs.readdirSync(`${val}`).map(file => path.join(val, file));
    },
  )
  .requiredOption(
    '-cp, --config-path <string>',
    'JSON file with candy machine settings',
  )
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .action(async (files: string[], options, cmd) => {
    const { keypair, env, cacheName, configPath, rpcUrl } = cmd.opts();

    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadCandyProgramV2(walletKeyPair, env, rpcUrl);

    const {
      storage,
      nftStorageKey,
      ipfsInfuraProjectId,
      number,
      ipfsInfuraSecret,
      arweaveJwk,
      awsS3Bucket,
      retainAuthority,
      mutable,
      batchSize,
      price,
      splToken,
      treasuryWallet,
      gatekeeper,
      endSettings,
      hiddenSettings,
      whitelistMintSettings,
      goLiveDate,
      uuid,
    } = await getCandyMachineV2Config(walletKeyPair, anchorProgram, configPath);
  //   log.info('getCandy MachineV2Config ------------------ :-');

  //   log.info('storage: ',storage);
  //   log.info('nftstorage: ', nftStorageKey);
  //   log.info('ipfs projectid: ',ipfsInfuraProjectId);
  //   log.info('number: ',number);
  //  // log.info(ipfsInfuraSecret);
  //   log.info('arweave jwk: ', arweaveJwk);
  //   log.info('awsS3Bucket: ', awsS3Bucket );
  //   log.info('retainAuthority: ',retainAuthority);
  //   log.info('mutable: ', mutable);
  //   log.info('batchsize: ', batchSize);
  //   log.info('price: ', price);
  //   log.info('spltoken: ',splToken);
  //   log.info('treasurywallet: ', treasuryWallet.toBase58());
  //   log.info('gatekeeper: ',gatekeeper);
  //   log.info('endsettings: ',endSettings);
  //   log.info('hiddensettings: ',hiddenSettings);
  //   log.info('whitelistmintsettings: ', whitelistMintSettings);
  //   log.info('goLiveDate: ',goLiveDate);
  //   log.info('uuid: ',uuid);
    if (storage === StorageType.ArweaveSol && env !== 'mainnet-beta') {
      throw new Error(
        // 'The arweave-sol storage option only works on mainnet. For devnet, please use either arweave, aws or ipfs\n',

       'Using arweave storage option to upload metadata.'
      );
    }

    if (storage === StorageType.ArweaveBundle && env !== 'mainnet-beta') {
      throw new Error(
        'The arweave-bundle storage option only works on mainnet because it requires spending real AR tokens. For devnet, please set the --storage option to "aws" or "ipfs"\n',
      );
    }

    if (storage === StorageType.Arweave) {
      log.warn(
        // 'WARNING: The "arweave" storage option will be going away soon. Please migrate to arweave-bundle or arweave-sol for mainnet.\n',
      );
    }

    if (storage === StorageType.ArweaveBundle && !arweaveJwk) {
      throw new Error(
        'Path to Arweave JWK wallet file (--arweave-jwk) must be provided when using arweave-bundle',
      );
    }
    if (
      storage === StorageType.Ipfs &&
      (!ipfsInfuraProjectId || !ipfsInfuraSecret)
    ) {
      throw new Error(
        'IPFS selected as storage option but Infura project id or secret key were not provided.',
      );
    }
    if (storage === StorageType.NftStorage && !nftStorageKey) {
      throw new Error(
        'NftStorage selected as storage option but NftStorage project api key were not provided.',
      );
    }
    if (storage === StorageType.Aws && !awsS3Bucket) {
      throw new Error(
        'aws selected as storage option but existing bucket name (--aws-s3-bucket) not provided.',
      );
    }
    if (!Object.values(StorageType).includes(storage)) {
      throw new Error(
        `Storage option must either be ${Object.values(StorageType).join(
          ', ',
        )}. Got: ${storage}`,
      );
    }
    const ipfsCredentials = {
      projectId: ipfsInfuraProjectId,
      secretKey: ipfsInfuraSecret,
    };

    let imageFileCount = 0;
    let jsonFileCount = 0;

    // Filter out any non-supported file types and find the JSON vs Image file count
    const supportedFiles = files.filter(it => {
      if (supportedImageTypes[getType(it)]) {
        imageFileCount++;
      } else if (it.endsWith(EXTENSION_JSON)) {
        jsonFileCount++;
      } else {
        log.warn(`WARNING: Skipping unsupported file type ${it}`);
        return false;
      }

      return true;
    });

    if (imageFileCount !== jsonFileCount) {
      throw new Error(
        `number of img files (${imageFileCount}) is different than the number of json files (${jsonFileCount})`,
      );
    }

    const elemCount = number ? number : imageFileCount;
    if (elemCount < imageFileCount) {
      throw new Error(
        `max number (${elemCount}) cannot be smaller than the number of elements in the source folder (${imageFileCount})`,
      );
    }

   log.info(`Beginning the upload for ${elemCount} (img+json) pairs`);

    const startMs = Date.now();
  log.info('started at: ' + startMs.toString());
    try {
      await uploadV2({
        files: supportedFiles,
        cacheName,
        env,
        totalNFTs: elemCount,
        gatekeeper,
        storage,
        retainAuthority,
        mutable,
        nftStorageKey,
        ipfsCredentials,
        awsS3Bucket,
        batchSize,
        price,
        treasuryWallet,
        anchorProgram,
        walletKeyPair,
        splToken,
        endSettings,
        hiddenSettings,
        whitelistMintSettings,
        goLiveDate,
        uuid,
        arweaveJwk,
      });
    } catch (err) {
     log.warn('upload was not successful, please re-run.', err);
      process.exit(1);
    }

    
    const endMs = Date.now();
    const timeTaken = new Date(endMs - startMs).toISOString().substr(11, 8);
    log.info(
      `ended at: ${new Date(endMs).toISOString()}. time taken: ${timeTaken}`,);
    process.exit(0);
  });





programCommand('verify_upload')
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .action(async (directory, cmd) => {
    const { env, keypair, rpcUrl, cacheName } = cmd.opts();

    const cacheContent = loadCache(cacheName, env);
    const walletKeyPair = loadWalletKey(keypair);
    const anchorProgram = await loadCandyProgramV2(walletKeyPair, env, rpcUrl);

    const candyMachine = await anchorProgram.provider.connection.getAccountInfo(
      new PublicKey(cacheContent.program.candyMachine),
    );

    const candyMachineObj = await anchorProgram.account.candyMachine.fetch(
      new PublicKey(cacheContent.program.candyMachine),
    );
    let allGood = true;

    const keys = Object.keys(cacheContent.items)
      .filter(k => !cacheContent.items[k].verifyRun)
      .sort((a, b) => Number(a) - Number(b));

    console.log('Key size', keys.length);
    await Promise.all(
      chunks(keys, 500).map(async allIndexesInSlice => {
        for (let i = 0; i < allIndexesInSlice.length; i++) {
          // Save frequently.
          if (i % 100 == 0) saveCache(cacheName, env, cacheContent);

          const key = allIndexesInSlice[i];
          log.info('Looking at key ', key);

          const thisSlice = candyMachine.data.slice(
            CONFIG_ARRAY_START_V2 + 4 + CONFIG_LINE_SIZE_V2 * key,
            CONFIG_ARRAY_START_V2 + 4 + CONFIG_LINE_SIZE_V2 * (key + 1),
          );

          const name = fromUTF8Array([...thisSlice.slice(2, 34)]);
          const uri = fromUTF8Array([...thisSlice.slice(40, 240)]);
          const cacheItem = cacheContent.items[key];
          if (!name.match(cacheItem.name) || !uri.match(cacheItem.link)) {
            //leaving here for debugging reasons, but it's pretty useless. if the first upload fails - all others are wrong
            /*log.info(
                `Name (${name}) or uri (${uri}) didnt match cache values of (${cacheItem.name})` +
                  `and (${cacheItem.link}). marking to rerun for image`,
                key,
              );*/
            cacheItem.onChain = false;
            allGood = false;
          } else {
            cacheItem.verifyRun = true;
          }
        }
      }),
    );

    if (!allGood) {
      saveCache(cacheName, env, cacheContent);

      throw new Error(
        `not all NFTs checked out. check out logs above for details`,
      );
    }

    const lineCount = new anchor.BN(
      candyMachine.data.slice(CONFIG_ARRAY_START_V2, CONFIG_ARRAY_START_V2 + 4),
      undefined,
      'le',
    );

    log.info(
      `uploaded (${lineCount.toNumber()}) out of (${
        candyMachineObj.data.itemsAvailable
      })`,
    );
    if (candyMachineObj.data.itemsAvailable > lineCount.toNumber()) {
      throw new Error(
        `predefined number of NFTs (${
          candyMachineObj.data.itemsAvailable
        }) is smaller than the uploaded one (${lineCount.toNumber()})`,
      );
    } else {
      log.info('ready to deploy!');
    }

    saveCache(cacheName, env, cacheContent);
  });


programCommand('mint_one_token')
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .action(async (directory, cmd) => {
    const { keypair, env, cacheName, rpcUrl } = cmd.opts();

    const cacheContent = loadCache(cacheName, env);
    const candyMachine = new PublicKey(cacheContent.program.candyMachine);
    // log.info('candymachin pubkey', candyMachine.toBase58());
    const tx = await mintV2(keypair, env, candyMachine, rpcUrl);

    log.info('mint_one_token finished', tx);
  });

programCommand('mint_multiple_tokens')
  .requiredOption('-n, --number <string>', 'Number of tokens')
  .option(
    '-r, --rpc-url <string>',
    'custom rpc url since this is a heavy command',
  )
  .action(async (_, cmd) => {
    const { keypair, env, cacheName, number, rpcUrl } = cmd.opts();

    const NUMBER_OF_NFTS_TO_MINT = parseInt(number, 10);
    const cacheContent = loadCache(cacheName, env);
    const candyMachine = new PublicKey(cacheContent.program.candyMachine);

    log.info(`Minting ${NUMBER_OF_NFTS_TO_MINT} tokens...`);

    const mintToken = async index => {
      const tx = await mintV2(keypair, env, candyMachine, rpcUrl);
    log.info(`transaction ${index + 1} complete`, tx);

      if (index < NUMBER_OF_NFTS_TO_MINT - 1) {
       log.info('minting another token...');
        await mintToken(index + 1);
      }
    };

    await mintToken(0);

  log.info(`minted ${NUMBER_OF_NFTS_TO_MINT} tokens`);
   log.info('mint_multiple_tokens finished');
  });





function programCommand(name: string) {
  return program
    .command(name)
    .option(
      '-e, --env <string>',
      'Solana cluster env name',
      'devnet', //mainnet-beta, testnet, devnet
    )
    .requiredOption('-k, --keypair <path>', `Solana wallet location`)
    .option('-l, --log-level <string>', 'log level', setLogLevel)
    .option('-c, --cache-name <string>', 'Cache file name', 'temp');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function setLogLevel(value, prev) {
  if (value === undefined || value === null) {
    return;
  }
 log.info('setting the log value to: ' + value);
 log.setLevel(value);
}

program.parse(process.argv);
