import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_FORECAST_PROGRAM_ID = '6LVKicsAfSF9Ba5gZchdxgtP6hEdsQNqAaVZCqHHHz9L';
const DEFAULT_FORECAST_CONFIG = '3raFV27qUQMDCS1vrdZFV16XPYh3HsN7Tn7hDaoNtxYx';
const DEFAULT_CAST_MINT = 'HW7wUzty3SXUC6WVmvfAkot16XxgW14grakSzaSv1BRy';
const DEFAULT_MINT_AUTHORITY = '4mXVdXXaBaTqEf6gMvg9wifWVoNcKwA71tw1h9pHKHBr';
const DAILY_REFILL_SECONDS = 86_400;
const MAX_MARKET_QUESTION_LENGTH = 180;

const MARKET_CATEGORY_VARIANTS = {
  Crypto: 0,
  Politics: 1,
  Sports: 2,
  Science: 3,
  Technology: 4,
  Finance: 5,
  'World Events': 6,
  Other: 7,
};

const MARKET_TYPE_VARIANTS = {
  'Public Market': 0,
  'DAO Room Market': 1,
};

export function getForecastRuntimeConfig() {
  return {
    rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL || DEFAULT_RPC_URL,
    programId: new PublicKey(import.meta.env.VITE_FORECAST_PROGRAM_ID || DEFAULT_FORECAST_PROGRAM_ID),
    forecastConfig: new PublicKey(import.meta.env.VITE_FORECAST_CONFIG || DEFAULT_FORECAST_CONFIG),
    castMint: new PublicKey(import.meta.env.VITE_CAST_MINT || DEFAULT_CAST_MINT),
    mintAuthority: new PublicKey(import.meta.env.VITE_MINT_AUTHORITY || DEFAULT_MINT_AUTHORITY),
  };
}

export async function syncForecastWallet({ walletProvider, onStatus }) {
  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const owner = walletProvider.publicKey;
  const userCastAccount = getUserCastAccount(config.castMint, owner);
  const faucetClaim = getFaucetClaimAddress(config.programId, owner);

  onStatus?.('Checking $CAST token account...');
  const tx = new Transaction();
  const userCastInfo = await connection.getAccountInfo(userCastAccount);
  if (!userCastInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        owner,
        userCastAccount,
        owner,
        config.castMint,
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  const faucetClaimInfo = await connection.getAccountInfo(faucetClaim);
  let claimedInitial = Boolean(faucetClaimInfo);
  const claimedInitialNow = !claimedInitial;

  if (!claimedInitial) {
    onStatus?.('Claiming initial 1,000 $CAST...');
    tx.add(buildClaimInitialCastInstruction({ config, owner, userCastAccount, faucetClaim }));
  }

  if (tx.instructions.length) {
    await sendWalletTransaction({ connection, walletProvider, tx });
    claimedInitial = true;
  }

  const balance = await readCastBalance(connection, userCastAccount);
  const refill = await readRefillStatus(connection, faucetClaim);

  return {
    balance,
    userCastAccount: userCastAccount.toBase58(),
    faucetClaim: faucetClaim.toBase58(),
    claimedInitial,
    claimedInitialNow,
    refill,
  };
}

export async function requestDailyCastRefill(walletProvider) {
  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const owner = walletProvider.publicKey;
  const userCastAccount = getUserCastAccount(config.castMint, owner);
  const faucetClaim = getFaucetClaimAddress(config.programId, owner);
  const refill = await readRefillStatus(connection, faucetClaim);

  if (!refill.claimedInitial) {
    throw new Error('Claim the initial 1,000 $CAST before requesting a daily refill.');
  }

  if (!refill.canRefill) {
    throw new Error(`Daily refill unlocks in ${formatCountdown(refill.secondsUntilRefill)}.`);
  }

  const tx = new Transaction().add(
    buildDailyRefillInstruction({ config, owner, userCastAccount, faucetClaim }),
  );
  await sendWalletTransaction({ connection, walletProvider, tx });

  return {
    balance: await readCastBalance(connection, userCastAccount),
    refill: await readRefillStatus(connection, faucetClaim),
  };
}

export async function createForecastMarket(walletProvider, marketDraft) {
  if (!walletProvider?.publicKey) {
    throw new Error('Connect Phantom or Backpack before creating a market.');
  }

  const question = marketDraft.question?.trim();
  const resolutionCriteria = marketDraft.resolutionCriteria?.trim();
  const resolutionTs = toResolutionTimestamp(marketDraft.resolutionDate);

  if (!question) throw new Error('Market question is required.');
  if (question.length > MAX_MARKET_QUESTION_LENGTH) {
    throw new Error(`Market question must be ${MAX_MARKET_QUESTION_LENGTH} characters or less.`);
  }
  if (!resolutionCriteria) throw new Error('Resolution criteria is required.');
  if (resolutionTs <= Math.floor(Date.now() / 1000)) {
    throw new Error('Resolution date must be in the future.');
  }

  const config = getForecastRuntimeConfig();
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const marketId = makeMarketId();
  const marketIdBytes = writeU64(marketId);
  const marketAddress = getMarketAddress(config.programId, marketIdBytes);
  const criteriaHash = sha256(new TextEncoder().encode(`${question}\n${resolutionCriteria}`));
  const data = encodeCreateMarketData({
    marketId,
    question,
    category: marketDraft.category,
    marketType: marketDraft.marketType,
    resolutionTs,
    oracleEnabled: Boolean(marketDraft.oracleEnabled),
    room: null,
    criteriaHash,
  });

  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: config.programId,
      keys: [
        { pubkey: config.forecastConfig, isSigner: false, isWritable: true },
        { pubkey: marketAddress, isSigner: false, isWritable: true },
        { pubkey: walletProvider.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
  );

  const signature = await sendWalletTransaction({ connection, walletProvider, tx });

  return {
    signature,
    marketId: marketId.toString(),
    marketAddress: marketAddress.toBase58(),
    creator: walletProvider.publicKey.toBase58(),
    question,
    resolutionTs,
  };
}

export function getInjectedForecastWallet(walletName) {
  if (walletName === 'Backpack') {
    return window.backpack?.solana || window.backpack || null;
  }

  if (walletName === 'Phantom') {
    return window.phantom?.solana || window.solana || null;
  }

  return window.solana || window.backpack?.solana || null;
}

function buildClaimInitialCastInstruction({ config, owner, userCastAccount, faucetClaim }) {
  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: config.forecastConfig, isSigner: false, isWritable: true },
      { pubkey: faucetClaim, isSigner: false, isWritable: true },
      { pubkey: config.castMint, isSigner: false, isWritable: true },
      { pubkey: userCastAccount, isSigner: false, isWritable: true },
      { pubkey: config.mintAuthority, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator('global:claim_initial_cast'),
  });
}

function buildDailyRefillInstruction({ config, owner, userCastAccount, faucetClaim }) {
  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: config.forecastConfig, isSigner: false, isWritable: true },
      { pubkey: faucetClaim, isSigner: false, isWritable: true },
      { pubkey: config.castMint, isSigner: false, isWritable: true },
      { pubkey: userCastAccount, isSigner: false, isWritable: true },
      { pubkey: config.mintAuthority, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator('global:request_daily_refill'),
  });
}

async function sendWalletTransaction({ connection, walletProvider, tx }) {
  tx.feePayer = walletProvider.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  if (walletProvider.signAndSendTransaction) {
    const result = await walletProvider.signAndSendTransaction(tx);
    const signature = typeof result === 'string' ? result : result.signature;
    await connection.confirmTransaction(signature, 'confirmed');
    return signature;
  }

  if (!walletProvider.signTransaction) {
    throw new Error('Connected wallet does not support transaction signing.');
  }

  const signed = await walletProvider.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

async function readCastBalance(connection, userCastAccount) {
  const account = await connection.getAccountInfo(userCastAccount);
  if (!account) return 0;
  const balance = await connection.getTokenAccountBalance(userCastAccount);
  return Number(balance.value.uiAmount || 0);
}

async function readRefillStatus(connection, faucetClaim) {
  const account = await connection.getAccountInfo(faucetClaim);
  if (!account) {
    return {
      claimedInitial: false,
      canRefill: false,
      secondsUntilRefill: 0,
    };
  }

  const lastRefillAt = Number(readI64(account.data, 49));
  const now = Math.floor(Date.now() / 1000);
  const secondsUntilRefill = Math.max(0, lastRefillAt + DAILY_REFILL_SECONDS - now);

  return {
    claimedInitial: true,
    canRefill: secondsUntilRefill === 0,
    secondsUntilRefill,
    lastRefillAt,
  };
}

function getUserCastAccount(castMint, owner) {
  return getAssociatedTokenAddressSync(castMint, owner, false, TOKEN_PROGRAM_ID);
}

function getFaucetClaimAddress(programId, owner) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('faucet-claim'), owner.toBuffer()],
    programId,
  )[0];
}

function getMarketAddress(programId, marketIdBytes) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), marketIdBytes],
    programId,
  )[0];
}

function anchorDiscriminator(name) {
  return syncSha256Discriminator(name);
}

function syncSha256Discriminator(name) {
  const words = sha256(new TextEncoder().encode(name));
  return Buffer.from(words).subarray(0, 8);
}

function readI64(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return view.getBigInt64(0, true);
}

function formatCountdown(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.ceil((totalSeconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function encodeCreateMarketData({
  marketId,
  question,
  category,
  marketType,
  resolutionTs,
  oracleEnabled,
  room,
  criteriaHash,
}) {
  return Buffer.concat([
    anchorDiscriminator('global:create_market'),
    writeU64(marketId),
    writeString(question),
    writeU8(MARKET_CATEGORY_VARIANTS[category] ?? MARKET_CATEGORY_VARIANTS.Other),
    writeU8(MARKET_TYPE_VARIANTS[marketType] ?? MARKET_TYPE_VARIANTS['Public Market']),
    writeI64(BigInt(resolutionTs)),
    writeU8(oracleEnabled ? 1 : 0),
    writeOptionPubkey(room),
    Buffer.from(criteriaHash),
  ]);
}

function makeMarketId() {
  return BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
}

function toResolutionTimestamp(dateValue) {
  if (!dateValue) return 0;
  return Math.floor(new Date(`${dateValue}T23:59:59Z`).getTime() / 1000);
}

function writeString(value) {
  const bytes = new TextEncoder().encode(value);
  return Buffer.concat([writeU32(bytes.length), Buffer.from(bytes)]);
}

function writeOptionPubkey(value) {
  if (!value) return writeU8(0);
  return Buffer.concat([writeU8(1), new PublicKey(value).toBuffer()]);
}

function writeU8(value) {
  return Buffer.from([value]);
}

function writeU32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function writeU64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function writeI64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64LE(BigInt(value));
  return bytes;
}

function sha256(message) {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const l = message.length * 8;
  const withOne = message.length + 1;
  const zeroPad = (64 - ((withOne + 8) % 64)) % 64;
  const bytes = new Uint8Array(withOne + zeroPad + 8);
  bytes.set(message);
  bytes[message.length] = 0x80;
  new DataView(bytes.buffer).setUint32(bytes.length - 4, l, false);

  const w = new Uint32Array(64);
  for (let i = 0; i < bytes.length; i += 64) {
    const view = new DataView(bytes.buffer, i, 64);
    for (let j = 0; j < 16; j += 1) w[j] = view.getUint32(j * 4, false);
    for (let j = 16; j < 64; j += 1) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let j = 0; j < 64; j += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + k[j] + w[j]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  h.forEach((word, index) => view.setUint32(index * 4, word, false));
  return out;
}

function rotr(value, shift) {
  return (value >>> shift) | (value << (32 - shift));
}
