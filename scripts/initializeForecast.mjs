import * as anchor from '@coral-xyz/anchor';
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createInitializeAccountInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptAccount,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import fs from 'node:fs';
import path from 'node:path';

const PROGRAM_ID = new PublicKey(process.env.FORECAST_PROGRAM_ID || '6LVKicsAfSF9Ba5gZchdxgtP6hEdsQNqAaVZCqHHHz9L');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const WALLET_PATH = expandHome(process.env.ANCHOR_WALLET || '~/.config/solana/id.json');
const OUT_PATH = path.resolve('devnet-addresses.json');

const walletKeypair = readKeypair(WALLET_PATH);
const wallet = new anchor.Wallet(walletKeypair);
const connection = new anchor.web3.Connection(RPC_URL, 'confirmed');
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
anchor.setProvider(provider);

const idl = JSON.parse(fs.readFileSync(path.resolve('target/idl/forecast.json'), 'utf8'));
idl.address = PROGRAM_ID.toBase58();
idl.metadata = {
  ...(idl.metadata || {}),
  address: PROGRAM_ID.toBase58(),
};
const program = new anchor.Program(idl, provider);

const [forecastConfig] = PublicKey.findProgramAddressSync([Buffer.from('forecast-config')], PROGRAM_ID);
const [mintAuthority] = PublicKey.findProgramAddressSync([Buffer.from('mint-authority')], PROGRAM_ID);
const existing = readExistingAddresses();
const castMint = existing.castMint ? new PublicKey(existing.castMint) : Keypair.generate();
const vaultTokenAccount = existing.vaultTokenAccount ? new PublicKey(existing.vaultTokenAccount) : Keypair.generate();
const userCastAccount = getAssociatedTokenAddressSync(
  castMint.publicKey || castMint,
  wallet.publicKey,
  false,
  TOKEN_PROGRAM_ID,
);

await ensureMint(castMint);
await ensureAssociatedTokenAccount(userCastAccount, castMint.publicKey || castMint);
await ensureVaultTokenAccount(vaultTokenAccount, castMint.publicKey || castMint);
await initializeForecast(castMint.publicKey || castMint, vaultTokenAccount.publicKey || vaultTokenAccount);

const output = {
  network: 'devnet',
  rpcUrl: RPC_URL,
  forecastProgramId: PROGRAM_ID.toBase58(),
  forecastConfig: forecastConfig.toBase58(),
  castMint: (castMint.publicKey || castMint).toBase58(),
  mintAuthority: mintAuthority.toBase58(),
  vaultTokenAccount: (vaultTokenAccount.publicKey || vaultTokenAccount).toBase58(),
  userCastAccount: userCastAccount.toBase58(),
};

fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));

async function ensureMint(mint) {
  const mintPubkey = mint.publicKey || mint;
  const info = await connection.getAccountInfo(mintPubkey);
  if (info) return;

  if (!mint.secretKey) {
    throw new Error(`Configured castMint ${mintPubkey.toBase58()} does not exist.`);
  }

  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mint.publicKey,
      6,
      mintAuthority,
      null,
      TOKEN_PROGRAM_ID,
    ),
  );

  await provider.sendAndConfirm(tx, [mint]);
  console.log(`Created $CAST mint ${mint.publicKey.toBase58()}`);
}

async function ensureAssociatedTokenAccount(ata, mint) {
  const info = await connection.getAccountInfo(ata);
  if (info) return;

  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      ata,
      wallet.publicKey,
      mint,
      TOKEN_PROGRAM_ID,
    ),
  );
  await provider.sendAndConfirm(tx);
  console.log(`Created user $CAST account ${ata.toBase58()}`);
}

async function ensureVaultTokenAccount(vault, mint) {
  const vaultPubkey = vault.publicKey || vault;
  const info = await connection.getAccountInfo(vaultPubkey);
  if (info) return;

  if (!vault.secretKey) {
    throw new Error(`Configured vaultTokenAccount ${vaultPubkey.toBase58()} does not exist.`);
  }

  const lamports = await getMinimumBalanceForRentExemptAccount(connection);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: vault.publicKey,
      space: 165,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      vault.publicKey,
      mint,
      wallet.publicKey,
      TOKEN_PROGRAM_ID,
    ),
  );

  await provider.sendAndConfirm(tx, [vault]);
  console.log(`Created vault token account ${vault.publicKey.toBase58()}`);
}

async function initializeForecast(mint, vault) {
  const account = await connection.getAccountInfo(forecastConfig);
  if (account) {
    console.log(`Forecast config already initialized ${forecastConfig.toBase58()}`);
    return;
  }

  await program.methods
    .initializeForecast()
    .accounts({
      forecastConfig,
      castMint: mint,
      vaultTokenAccount: vault,
      mintAuthority,
      authority: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`Initialized Forecast config ${forecastConfig.toBase58()}`);
}

function readExistingAddresses() {
  if (!fs.existsSync(OUT_PATH)) return {};
  return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
}

function readKeypair(filePath) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(filePath, 'utf8'))));
}

function expandHome(filePath) {
  if (!filePath.startsWith('~')) return filePath;
  return path.join(process.env.HOME, filePath.slice(1));
}
