import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  RescueCipher,
  deserializeLE,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
  getMXEPublicKey,
  x25519,
} from '@arcium-hq/client';

const PORT = Number(process.env.ARCIUM_STAKE_SERVICE_PORT || 8787);
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.ARCIUM_MXE_PROGRAM_ID || '';
const CLUSTER_OFFSET = Number(process.env.ARCIUM_CLUSTER_OFFSET || 456);
const STAKE_INSTRUCTION = process.env.ARCIUM_STAKE_INSTRUCTION || 'submit_private_stake';

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/stake') {
    sendJson(res, 404, { error: 'Route not found. POST /stake is available.' });
    return;
  }

  try {
    if (!PROGRAM_ID) {
      throw new Error('ARCIUM_MXE_PROGRAM_ID is required.');
    }

    const body = await readJson(req);
    const payload = await prepareStakePayload(body);
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Forecast Arcium stake service listening on http://localhost:${PORT}/stake`);
});

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
  const computationOffset = new anchor.BN(bytesToHex(computationOffsetBytes), 16);
  const compDefIndex = readCompDefIndex(getCompDefAccOffset(STAKE_INSTRUCTION));

  return {
    instruction: STAKE_INSTRUCTION,
    programId: PROGRAM_ID,
    clusterOffset: CLUSTER_OFFSET,
    walletAddress: body.walletAddress,
    computationOffset: bytesToHex(computationOffsetBytes),
    nonce: Array.from(nonce),
    nonceValue: deserializeLE(nonce).toString(),
    clientPublicKey: Array.from(clientPublicKey),
    ciphertext: ciphertext.map((chunk) => Array.from(chunk)),
    accountHints: {
      computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset).toString(),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET).toString(),
      mxeAccount: getMXEAccAddress(programId).toString(),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET).toString(),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET).toString(),
      compDefAccount: getCompDefAccAddress(programId, compDefIndex).toString(),
    },
  };
}

function buildStakePlaintext(body) {
  return [
    marketToFieldElement(body.market),
    body.position === 'YES' ? 1n : 0n,
    BigInt(Number(body.amount || 0)),
    BigInt(Number(body.multiplier || 1)),
  ];
}

function marketToFieldElement(market) {
  const seed = `${market?.conditionId || market?.id || ''}:${market?.title || ''}`;
  const hash = createHash('sha256').update(seed).digest();
  const fieldBytes = hash.subarray(0, 31);
  fieldBytes[0] = fieldBytes[0] & 0x0f;
  return BigInt(`0x${bytesToHex(fieldBytes)}`);
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
