import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { ForecastMxe } from "../target/types/forecast_mxe";
import {
  getArciumAccountBaseSeed,
  getArciumProgram,
  getArciumProgramId,
  getCircuitState,
  getCompDefAccOffset,
  getLookupTableAddress,
  getMXEAccAddress,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

const STAKE_COMPUTATION = "submit_private_stake_v2";

describe("ForecastMxe", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.ForecastMxe as Program<ForecastMxe>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const arciumProgram = getArciumProgram(provider);

  it("initializes the off-chain submit_private_stake_v2 computation definition", async () => {
    const circuitUrl = process.env.CIRCUIT_URL || process.env.CIRCUIT_SOURCE;
    if (!circuitUrl) {
      throw new Error(
        "Missing CIRCUIT_URL. Upload build/submit_private_stake_v2.arcis to public storage, then rerun with CIRCUIT_URL=<public-url>.",
      );
    }

    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    const compDefPDA = getCompDefPda(program.programId, STAKE_COMPUTATION);
    const existingCompDef = await provider.connection.getAccountInfo(compDefPDA);

    if (!existingCompDef) {
      const mxeAccount = getMXEAccAddress(program.programId);
      const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
      const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);
      const circuitHash = readCircuitHash(process.env.CIRCUIT_HASH_PATH || "build/submit_private_stake_v2.hash");

      const sig = await program.methods
        .initSubmitPrivateStakeV2CompDef(circuitUrl, circuitHash)
        .accounts({
          payer: owner.publicKey,
          mxeAccount,
          compDefAccount: compDefPDA,
          addressLookupTable: lutAddress,
        })
        .signers([owner])
        .rpc({
          commitment: "confirmed",
        });

      console.log("Initialized submit_private_stake_v2 off-chain computation definition", sig);
      console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    } else {
      console.log("submit_private_stake_v2 computation definition already exists", compDefPDA.toBase58());
    }

    const compDef = await arciumProgram.account.computationDefinitionAccount.fetch(compDefPDA);
    console.log("final circuit state:", getCircuitState(compDef.circuitSource));
  });
});

function getCompDefPda(programId: PublicKey, computationName: string): PublicKey {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset(computationName);

  return PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, programId.toBuffer(), offset],
    getArciumProgramId(),
  )[0];
}

function readCircuitHash(hashPath: string): number[] {
  const parsed = JSON.parse(fs.readFileSync(hashPath, "utf8"));
  if (!Array.isArray(parsed) || parsed.length !== 32) {
    throw new Error(`Expected ${hashPath} to contain a JSON array with 32 bytes.`);
  }

  return parsed.map((byte) => {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`Invalid hash byte in ${hashPath}: ${byte}`);
    }
    return byte;
  });
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}
