# ForeCast

**The market knows.**

ForeCast is a privacy-focused prediction market on Solana devnet. Users trade with `$CAST`, create native markets, import live Polymarket signals, and use Arcium MPC so individual positions stay private while public market signals remain visible.

## What Makes It Different

Most prediction markets expose too much user behavior. ForeCast keeps the sensitive parts private:

- Individual YES/NO positions
- Stake amounts
- Participation history
- Settlement and reputation inputs

Public data still stays useful:

- Market questions
- Aggregate odds
- Volume
- Final outcome
- Explorer links for devnet transactions

## Arcium Privacy Layer

ForeCast uses Arcium MPC for the parts of the market that should stay private.

At stake time, the app sends the user's market id, side, and amount through the `submit_private_stake_v2` Arcium computation. ForeCast then records a public stake commitment on Solana, but the user's actual position is not shown in the UI or exposed as public market activity.

At settlement time, after the market creator posts the final outcome, ForeCast uses the `compute_private_settlement` Arcium computation to calculate the payout reference for each private commitment. The public app can show that a commitment exists and whether it has been settled, but it does not reveal the user's original side or amount.

In short:

- Solana records the market, vault, faucet, commitments, and payout transactions.
- Arcium handles private stake and payout computation.
- ForeCast shows aggregate odds and final results, not individual positions.

## Current Features

- Solana devnet wallet connection with Phantom or Backpack
- Android Mobile Wallet Adapter support
- `$CAST` faucet: 1,000 initial tokens plus 100 daily refill
- Native ForeCast market creation
- Private `$CAST` staking on native markets
- Creator-led market resolution
- Arcium-powered private stake and settlement flow
- Live Polymarket market discovery
- Polymarket-to-native conversion before trading
- Portfolio, rooms, and leaderboard preview surfaces
- Single Vite/Node server for frontend and local API routes

## Tech Stack

- React + Vite
- Solana Web3.js
- Anchor
- SPL Token
- Arcium MPC
- Polymarket Gamma API
- Framer Motion

## Getting Started

Install dependencies:

```bash
npm install
```

Create your local environment file:

```bash
cp .env.example .env
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

Build for production:

```bash
npm run build
```

Serve the built app with the local API routes:

```bash
npm start
```

## Environment

The repo includes `.env.example` with the current devnet configuration.

Important values:

```text
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_FORECAST_PROGRAM_ID=6LVKicsAfSF9Ba5gZchdxgtP6hEdsQNqAaVZCqHHHz9L
VITE_CAST_MINT=HW7wUzty3SXUC6WVmvfAkot16XxgW14grakSzaSv1BRy
VITE_ARCIUM_MXE_PROGRAM_ID=3Ayx79S2apLBQgSVNq3y2mcbsvQeq4ZUVaiYd2xo7WZK
VITE_ARCIUM_CLUSTER_OFFSET=456
```

The Arcium client runs through the local Node/Vite server boundary because the SDK depends on Node crypto APIs.

For Vercel, point the frontend API env vars at the serverless routes:

```text
VITE_ARCIUM_STAKE_API_URL=/api/stake
VITE_ARCIUM_SETTLEMENT_API_URL=/api/settlement
VITE_FORECAST_ODDS_API_URL=/api/odds/update
```

Set `FORECAST_ODDS_KEEPER_SECRET_KEY` to the JSON array from the keeper wallet keypair. To keep settlement inputs durable across serverless cold starts, configure either Supabase or KV storage.

Supabase can be used instead of paid KV. Create this table in the Supabase SQL editor:

```sql
create table if not exists forecast_settlement_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
```

Then add these server-only env vars in Vercel:

```text
SUPABASE_URL=your_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_SETTLEMENT_CACHE_TABLE=forecast_settlement_cache
FORECAST_SETTLEMENT_CACHE_TTL_SECONDS=604800
```

Do not expose the Supabase service role key with a `VITE_` prefix.

## How It Works

1. Connect Phantom or Backpack on Solana devnet.
2. Claim or sync `$CAST` from the ForeCast faucet.
3. Create a native market or convert a live Polymarket market into a native ForeCast market.
4. Place a YES or NO trade with `$CAST`.
5. Arcium handles the private computation path while ForeCast records the public commitment on Solana.
6. After the resolution time, the market creator posts the final outcome.
7. Settlement uses the Arcium computation result to pay the correct side from the ForeCast vault.

## Project Structure

```text
src/
  App.jsx              App shell, routing, wallet state, market orchestration
  components/          Reusable UI primitives and navigation
  data/                Static app metadata and option lists
  integrations/        Solana, ForeCast, Arcium, and Polymarket adapters
  lib/                 Shared helpers
  pages/               Route-level screens
  styles/              Global UI system

programs/
  forecast/            Anchor program for markets, staking, faucet, settlement

server/
  arciumStakeService   Local API bridge for Arcium and Forecast actions

arcium/
  forecast-mxe/        Arcium MXE project and circuit artifacts
```

## Devnet Addresses

```text
ForeCast program: 6LVKicsAfSF9Ba5gZchdxgtP6hEdsQNqAaVZCqHHHz9L
$CAST mint:       HW7wUzty3SXUC6WVmvfAkot16XxgW14grakSzaSv1BRy
Arcium MXE:       3Ayx79S2apLBQgSVNq3y2mcbsvQeq4ZUVaiYd2xo7WZK
```
