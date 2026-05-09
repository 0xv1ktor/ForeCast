# Forecast Contract

Forecast now uses one Anchor program:

```text
programs/forecast
```

That single smart contract contains:

- Market creation and resolution
- Public aggregate odds updates from Arcium
- $CAST vault deposits
- Private stake commitment records
- Settlement-ready and claimed state
- Initial 1,000 $CAST faucet claim
- 100 $CAST daily refill after the initial claim

The Arcium MXE source remains separate because Arcium confidential computation is compiled/deployed through Arcium tooling:

```text
arcium/forecast-mxe/forecast_mxe
```

So the final architecture is:

- One Solana Anchor program: `forecast`
- One Arcium MXE program for encrypted computation

## Privacy Model

Standard SPL transfers expose transfer amounts publicly. Forecast uses the public token program for faucet and vault deposits, then uses Arcium for market-specific private stake computation.

The Anchor program stores:

- Market metadata
- Aggregate public odds
- Commitment hashes
- Arcium computation account references
- Settlement status

It does not store individual market stake amount, YES/NO position, or conviction multiplier in plaintext.

## Program ID

Current devnet Forecast program ID:

```text
6LVKicsAfSF9Ba5gZchdxgtP6hEdsQNqAaVZCqHHHz9L
```

Current devnet Arcium MXE program ID:

```text
3Ayx79S2apLBQgSVNq3y2mcbsvQeq4ZUVaiYd2xo7WZK
```

Current devnet Arcium cluster offset:

```text
456
```

## Build

Use Rust 1.88 for Anchor's host-side IDL generation and Arcium's circuit build. Solana SBF still uses its bundled compiler internally, which is why the Cargo compatibility pins remain in place.

```bash
RUSTUP_TOOLCHAIN=1.88.0 anchor build
```

Solana platform-tools may still use bundled Cargo `1.84.0` during SBF builds. To avoid Rust 2024 dependency breakage, the workspace pins known problematic crates:

- `blake3 = 1.8.2`
- `constant_time_eq = 0.3.1`
- `base64ct = 1.7.3`
- `indexmap = 2.11.4`
- `proc-macro-crate = 3.4.0`
- `toml_edit = 0.23.10`
- `toml_datetime = 0.7.5`
- `toml_parser = 1.0.6`
- `toml_writer = 1.0.6`
- `serde_spanned = 1.0.4`
- `unicode-segmentation = 1.12.0`
- `winnow = 0.7.14`
- `bytemuck = 1.22.0`
- `bytemuck_derive = 1.8.1`
- `asn1-rs-impl = 0.2.0` is patched locally under `arcium/forecast-mxe/forecast_mxe/patched-crates/asn1-rs-impl` so it uses `proc_macro2::Span::call_site()` directly with current Rust/proc-macro2 behavior

If Cargo has already resolved newer versions, refresh the lockfile with:

```bash
cargo generate-lockfile
cargo update -p blake3 --precise 1.8.2
cargo update -p constant_time_eq --precise 0.3.1
cargo update -p base64ct --precise 1.7.3
cargo update -p indexmap --precise 2.11.4
cargo update -p proc-macro-crate --precise 3.4.0
cargo update -p toml_edit --precise 0.23.10+spec-1.0.0
cargo update -p toml_datetime --precise 0.7.5+spec-1.1.0
cargo update -p toml_parser --precise 1.0.6+spec-1.1.0
cargo update -p toml_writer --precise 1.0.6+spec-1.1.0
cargo update -p serde_spanned --precise 1.0.4
cargo update -p unicode-segmentation --precise 1.12.0
cargo update -p winnow --precise 0.7.14
cargo update -p bytemuck --precise 1.22.0
cargo update -p bytemuck_derive --precise 1.8.1
```

Commit `Cargo.lock` for reproducible program builds.

For Arcium:

```bash
cd arcium/forecast-mxe/forecast_mxe
RUSTUP_TOOLCHAIN=1.88.0 arcium build
```

The active Arcium circuit is `submit_private_stake_v2`. It accepts encrypted stake fields:

- market id
- YES/NO side
- $CAST amount
- conviction multiplier

It computes an encrypted stake receipt containing the market id, side, and weighted amount. This replaces Arcium's generated starter example, `add_together`.

Forecast uses the same off-chain circuit source pattern as CipherVote. Upload:

```text
build/submit_private_stake_v2.arcis
```

to public storage, then initialize the computation definition with `CIRCUIT_URL=<public-url>`. The older `submit_private_stake` computation definition was initialized as on-chain storage during testing, so `submit_private_stake_v2` is used for the off-chain URL-backed definition.

Current public circuit URL:

```text
https://nursxiduxmnvugcrcjwg.supabase.co/storage/v1/object/public/arcium-circuits/forecast%20circuits/submit_private_stake_v2.arcis
```

## Deploy Sequence

1. Build and deploy the single `forecast` Anchor program.
2. Create the `$CAST` mint.
3. Set the `$CAST` mint authority to the `mint-authority` PDA from the `forecast` program.
4. Create the vault token account.
5. Call `initialize_forecast`.
6. Deploy the Arcium MXE program.
7. Add the Forecast program ID, Arcium program ID, and cluster offset to `.env`.

Steps 2-5 are automated by:

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com \
FORECAST_PROGRAM_ID=6LVKicsAfSF9Ba5gZchdxgtP6hEdsQNqAaVZCqHHHz9L \
node scripts/initializeForecast.mjs
```

The script writes `devnet-addresses.json` with the created `$CAST` mint, vault token account, mint authority PDA, and Forecast config PDA.

## Odds Keeper

During local development, Vite mounts the Forecast API middleware, so one command serves both the frontend and local API routes:

```text
POST /stake
POST /odds/update
```

After an encrypted stake confirms, the frontend calls this keeper for real Forecast-native market accounts. The keeper signs `update_public_odds` with `FORECAST_ODDS_KEEPER_KEYPAIR_PATH` and writes the new public YES/NO aggregate to the Forecast program, so refreshes load moved odds from devnet instead of returning to `50/50`.

This is an MVP bridge until the full Arcium aggregate flow is wired end-to-end. The private stake commitment remains separate; the public update only writes aggregate percentages and volume. `node server/arciumStakeService.mjs` still works as an optional standalone fallback, but `npm run dev` is the normal local workflow.

## Resolution Model

For the MVP, each native Forecast market is resolved by the wallet that created it after the resolution date. The creator must use the resolution criteria they wrote when creating the market. This keeps the demo flow simple and lets anyone create and finalize their own market without giving them early-resolution power.

Longer term, creator resolution should be paired with a dispute window, DAO room governance, or an oracle flow before settlement is considered production-grade.
