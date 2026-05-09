import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import BN from 'bn.js';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  RescueCipher,
  deserializeLE,
  getArciumProgramId,
  getClockAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
  getMXEPublicKey,
  x25519,
} from '@arcium-hq/client';
import { quoteBinaryTrade } from '../src/lib/marketMaker.js';

loadLocalEnv();

const PORT = Number(process.env.ARCIUM_STAKE_SERVICE_PORT || 8787);
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.ARCIUM_MXE_PROGRAM_ID || '';
const CLUSTER_OFFSET = Number(process.env.ARCIUM_CLUSTER_OFFSET || 456);
const STAKE_INSTRUCTION = process.env.ARCIUM_STAKE_INSTRUCTION || 'submit_private_stake_v2';
const FORECAST_PROGRAM_ID = process.env.FORECAST_PROGRAM_ID || process.env.VITE_FORECAST_PROGRAM_ID || '';
const FORECAST_CONFIG = process.env.FORECAST_CONFIG || process.env.VITE_FORECAST_CONFIG || '';
const ODDS_KEEPER_KEYPAIR_PATH = process.env.FORECAST_ODDS_KEEPER_KEYPAIR_PATH || '~/.config/solana/id.json';
const CAST_DECIMALS = 6n;

export function createForecastApiHandler() {
  return async function forecastApiHandler(req, res, next) {
    const route = req.url?.split('?')[0] || '';
    const handlesRoute = ['/stake', '/odds/update'].includes(route);

    if (!handlesRoute && next) {
      next();
      return;
    }

    setCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST' || !handlesRoute) {
      sendJson(res, 404, { error: 'Route not found. POST /stake and POST /odds/update are available.' });
      return;
    }

    try {
      if (route === '/stake' && !PROGRAM_ID) {
        throw new Error('ARCIUM_MXE_PROGRAM_ID is required.');
      }

      const body = await readJson(req);
      const payload = route === '/stake'
        ? await prepareStakePayload(body)
        : await updatePublicOdds(body);
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  };
}

export function startForecastApiServer(port = PORT) {
  const server = http.createServer(createForecastApiHandler());
  server.listen(port, () => {
    console.log(`Forecast Arcium service listening on http://localhost:${port}/stake and /odds/update`);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startForecastApiServer();
}

async function prepareStakePayload(body) {
  const programId = new PublicKey(PROGRAM_ID);
  const connection = new Connection(RPC_URL, 'confirmed');
  const provider = readonlyAnchorProvider(connection);
  const mxePublicKey = await getMXEPublicKeyWithRetry(provider, programId);
  const clientPrivateKey = x25519.utils.randomSecretKey();
  const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
  const sharedSecret = x25519.getSharedSecret(clientPrivateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  const nonce = randomBytes(16);
  const computationOffsetBytes = randomBytes(8);
  const plaintext = buildStakePlaintext(body);
  const ciphertext = cipher.encrypt(plaintext, nonce);
  const computationOffset = new BN(bytesToHex(computationOffsetBytes), 16);
  const compDefIndex = readCompDefIndex(getCompDefAccOffset(STAKE_INSTRUCTION));
  const signPdaAccount = PublicKey.findProgramAddressSync(
    [Buffer.from('ArciumSignerAccount')],
    programId,
  )[0];
  const ciphertextChunks = ciphertext.map((chunk) => Array.from(chunk));

  return {
    instruction: STAKE_INSTRUCTION,
    programId: PROGRAM_ID,
    clusterOffset: CLUSTER_OFFSET,
    queueable: true,
    walletAddress: body.walletAddress,
    computationOffset: bytesToHex(computationOffsetBytes),
    computationOffsetLe: Array.from(computationOffset.toArrayLike(Buffer, 'le', 8)),
    nonce: Array.from(nonce),
    nonceValue: deserializeLE(nonce).toString(),
    clientPublicKey: Array.from(clientPublicKey),
    ciphertext: ciphertextChunks,
    ciphertextFields: {
      marketId: ciphertextChunks[0],
      position: ciphertextChunks[1],
      amount: ciphertextChunks[2],
      multiplier: ciphertextChunks[3],
    },
    accountHints: {
      signPdaAccount: signPdaAccount.toString(),
      computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset).toString(),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET).toString(),
      mxeAccount: getMXEAccAddress(programId).toString(),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET).toString(),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET).toString(),
      compDefAccount: getCompDefAccAddress(programId, compDefIndex).toString(),
      poolAccount: getFeePoolAccAddress().toString(),
      clockAccount: getClockAccAddress().toString(),
      arciumProgram: getArciumProgramId().toString(),
    },
  };
}

async function updatePublicOdds(body) {
  if (!FORECAST_PROGRAM_ID || !FORECAST_CONFIG) {
    throw new Error('FORECAST_PROGRAM_ID and FORECAST_CONFIG are required for odds updates.');
  }

  const marketAddress = parsePublicKey(body.marketAddress || body.market?.marketAddress || body.market?.id);
  const arciumComputation = parsePublicKey(body.arciumComputation);
  if (!marketAddress) throw new Error('A real Forecast market address is required.');
  if (!arciumComputation) throw new Error('Arcium computation account is required.');

  const connection = new Connection(RPC_URL, 'confirmed');
  const authority = readKeypair(ODDS_KEEPER_KEYPAIR_PATH);
  const forecastProgramId = new PublicKey(FORECAST_PROGRAM_ID);
  const forecastConfig = new PublicKey(FORECAST_CONFIG);
  const marketAccount = await connection.getAccountInfo(marketAddress);
  if (!marketAccount) throw new Error('Forecast market account was not found on devnet.');

  const current = decodeForecastMarket(marketAccount.data);
  const next = computeNextOdds({
    currentYes: current.yes,
    currentNo: current.no,
    currentVolumeRaw: current.publicVolumeRaw,
    position: body.position,
    amount: body.amount,
    multiplier: body.multiplier,
  });
  const encryptedAggregate = makeAggregateCommitment({
    marketAddress,
    arciumComputation,
    yesPercent: next.yes,
    noPercent: next.no,
    publicVolumeDeltaRaw: next.publicVolumeDeltaRaw,
  });

  const tx = new Transaction().add(new TransactionInstruction({
    programId: forecastProgramId,
    keys: [
      { pubkey: forecastConfig, isSigner: false, isWritable: false },
      { pubkey: marketAddress, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator('global:update_public_odds'),
      Buffer.from([next.yes]),
      Buffer.from([next.no]),
      writeU64(next.publicVolumeDeltaRaw),
      encryptedAggregate,
      arciumComputation.toBuffer(),
    ]),
  }));

  const signature = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: 'confirmed',
  });

  return {
    signature,
    marketAddress: marketAddress.toBase58(),
    yes: next.yes,
    no: next.no,
    publicVolumeRaw: next.publicVolumeRaw.toString(),
    publicVolumeDeltaRaw: next.publicVolumeDeltaRaw.toString(),
    volume: Number(next.publicVolumeRaw / 10n ** CAST_DECIMALS),
    volumeDisplay: `${formatCastVolume(next.publicVolumeRaw)} $CAST`,
    aggregateStatus: 'onchain',
  };
}

function buildStakePlaintext(body) {
  return [
    marketToFieldElement(body.market),
    body.position === 'YES' ? 1n : 0n,
    BigInt(Number(body.amount || 0)),
    1n,
  ];
}

function marketToFieldElement(market) {
  const seed = `${market?.conditionId || market?.id || ''}:${market?.title || ''}`;
  const hash = createHash('sha256').update(seed).digest();
  const fieldBytes = hash.subarray(0, 16);
  return BigInt(`0x${bytesToHex(fieldBytes)}`);
}

function decodeForecastMarket(data) {
  const buffer = Buffer.from(data);
  const discriminator = anchorDiscriminator('account:Market');
  if (!buffer.subarray(0, 8).equals(discriminator)) {
    throw new Error('Account is not a Forecast Market account.');
  }

  let offset = 8;
  offset += 8; // market_id
  offset += 32; // creator
  const questionLength = buffer.readUInt32LE(offset);
  offset += 4 + questionLength;
  offset += 1; // category
  offset += 1; // market_type
  offset += 8; // resolution_ts
  offset += 32; // criteria_hash
  const roomPresent = buffer.readUInt8(offset);
  offset += 1 + (roomPresent ? 32 : 0);
  offset += 1; // oracle_enabled
  offset += 1; // status
  const outcomePresent = buffer.readUInt8(offset);
  offset += 1 + (outcomePresent ? 1 : 0);
  const yes = buffer.readUInt8(offset);
  offset += 1;
  const no = buffer.readUInt8(offset);
  offset += 1;
  const publicVolumeRaw = buffer.readBigUInt64LE(offset);

  return { yes, no, publicVolumeRaw };
}

function computeNextOdds({ currentYes, currentVolumeRaw, position, amount }) {
  const amountRaw = castUiAmountToRaw(amount);
  const quote = quoteBinaryTrade({
    yesPercent: currentYes,
    volume: rawCastToNumber(currentVolumeRaw),
    position,
    amount,
  });
  const boundedYes = Math.max(1, Math.min(99, Math.round(quote.yes)));
  const publicVolumeRaw = currentVolumeRaw + amountRaw;

  return {
    yes: boundedYes,
    no: 100 - boundedYes,
    publicVolumeRaw,
    publicVolumeDeltaRaw: amountRaw,
  };
}

function rawCastToNumber(value) {
  return Number(value) / Number(10n ** CAST_DECIMALS);
}

function castUiAmountToRaw(value) {
  const text = String(value ?? '0').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return 0n;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole || '0') * 10n ** CAST_DECIMALS
    + BigInt(fraction.padEnd(Number(CAST_DECIMALS), '0'));
}

function makeAggregateCommitment(value) {
  return createHash('sha512')
    .update(JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)))
    .digest()
    .subarray(0, 64);
}

function parsePublicKey(value) {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function readKeypair(keypairPath) {
  const expandedPath = keypairPath.replace(/^~(?=$|\/)/, homedir());
  const secret = JSON.parse(readFileSync(expandedPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function anchorDiscriminator(name) {
  return createHash('sha256').update(name).digest().subarray(0, 8);
}

function writeU64(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
}

function formatCastVolume(rawAmount) {
  return Number(rawAmount / 10n ** CAST_DECIMALS).toLocaleString('en-US');
}

async function getMXEPublicKeyWithRetry(provider, programId, retries = 20) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const publicKey = await getMXEPublicKey(provider, programId);
    if (publicKey) return publicKey;
    await wait(500);
  }

  throw new Error('Arcium MXE public key was not available. Check program deployment and cluster config.');
}

function readonlyAnchorProvider(connection) {
  const placeholder = PublicKey.default;
  return {
    connection,
    publicKey: placeholder,
    wallet: {
      publicKey: placeholder,
      signTransaction: async () => {
        throw new Error('The stake service only prepares encrypted payloads.');
      },
      signAllTransactions: async () => {
        throw new Error('The stake service only prepares encrypted payloads.');
      },
    },
    opts: { commitment: 'confirmed' },
  };
}

function readCompDefIndex(offsetBytes) {
  return Buffer.from(offsetBytes).readUInt32LE();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadLocalEnv() {
  if (!existsSync('.env')) return;

  const lines = readFileSync('.env', 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
