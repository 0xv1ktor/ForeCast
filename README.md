# Forecast

Forecast is a privacy-enhanced prediction and opinion market built for Solana devnet and Arcium MPC.

Tagline: **Stake your belief. Keep your position private.**

The current build uses a real Solana devnet Forecast program, a real devnet `$CAST` mint/faucet, live Polymarket discovery, and an Arcium MXE flow for private stake computation.

## Core Idea

Traditional prediction markets expose too much about individual behavior. Forecast keeps individual stakes, positions, expert oracle inputs, and reputation history private.

Public:
- Market questions and aggregate odds
- Final outcomes
- Aggregate expert signals
- Accuracy tier badges

Private:
- Individual YES/NO positions
- Stake amounts
- Market participation history
- Expert opinions
- Reputation history underneath the public badge

## Commands

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Serve the production build and API routes from one Node process:

```bash
npm start
```

Local app URL:

```text
http://localhost:5173/
```

## Demo Flow

1. Open the landing page and point out the Arcium privacy positioning.
2. Click **Browse Markets** and show Native vs Polymarket Event tabs.
3. Open a live market detail page or create a native Forecast market.
4. Choose YES or NO, enter a $CAST amount, and submit.
5. Show the Arcium flow: preparing stake, encrypted MPC computation, Solana submission, success state, and Explorer links.
6. Show recent activity where amounts and wallets are hidden after a stake is submitted.
7. Open **Rooms** to show DAO private room shells and permissioned Arcium cluster positioning.
8. Open **Leaderboard** to show the pending public reputation aggregate state.
9. Use **Connect Wallet** with Phantom or Backpack to claim/sync the 1,000 $CAST faucet.

## Routes

- `/` - Landing page
- `/markets` - Market browser with search, category filters, source tabs, and sorting
- `/markets/:id` - Interactive market detail and encrypted stake flow
- `/create` - Create market form with expert oracle and seed stake options
- `/profile/:address` - Public profile with private activity and reputation badge
- `/rooms` - DAO rooms list and create room modal
- `/rooms/:id` - Room markets, permissioned cluster badge, and private leaderboard
- `/leaderboard` - Global accuracy leaderboard

## Frontend Structure

```text
src/
  App.jsx                 # App shell: routing, wallet state, live data orchestration
  main.jsx                # React entrypoint and browser polyfills
  components/             # Reusable UI primitives and app chrome
  data/                   # Static options and privacy tier metadata
  integrations/           # Solana, Forecast, Arcium, and Polymarket adapters
  lib/                    # Small shared helpers
  pages/                  # Route-level screens
  styles/                 # Global design system entrypoint and styling
```

The frontend is organized so product screens do not own wallet or API plumbing, and integrations do not own UI.

## Current Phase

The devnet integration layer is active:

- Injected Phantom or Backpack wallet connection when available
- Real devnet `$CAST` mint and Forecast faucet integration
- Automatic first-time `1,000 $CAST` claim for connected wallets
- Manual `100 $CAST` daily refill action, enforced by the Forecast program
- Live Polymarket Gamma API market discovery
- Arcium client SDK stake payload preparation behind environment config
- Faucet contract source supports 1,000 initial $CAST plus 100 $CAST per day refill
- Private stake commitment records and public aggregate odds update bridge
- MVP market resolution by the creator wallet after the selected resolution date/time, against each market's criteria
- Wallet-level settlement status lookup for encrypted stake commitments
- Creator-triggered Arcium settlement queue plus payout transfer from the Forecast vault
- Expert oracle, reputation, and room leaderboards remain future Arcium circuits

## Real Integration Config

Create a local `.env` from `.env.example`:

```bash
cp .env.example .env
```

Required values:

```text
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_POLYMARKET_GAMMA_URL=https://gamma-api.polymarket.com
VITE_ARCIUM_STAKE_API_URL=/stake
VITE_ARCIUM_SETTLEMENT_API_URL=/settlement
VITE_FORECAST_ODDS_API_URL=/odds/update
VITE_ARCIUM_MXE_PROGRAM_ID=3Ayx79S2apLBQgSVNq3y2mcbsvQeq4ZUVaiYd2xo7WZK
VITE_ARCIUM_CLUSTER_OFFSET=456
VITE_ARCIUM_STAKE_INSTRUCTION=submit_private_stake_v2
VITE_ARCIUM_SETTLEMENT_INSTRUCTION=compute_private_settlement
```

The Arcium SDK runs in the Node/Vite server boundary because the package depends on Node crypto APIs. In development, `npm run dev` serves both the frontend and local API routes:

```bash
npm run dev
```

For production-style local serving, build first and then run the single Node server:

```bash
npm run build
npm start
```

`npm start` serves `dist/` plus `POST /stake`, `POST /settlement/register`, `POST /settlement`, and `POST /odds/update` from the same process.

## Integration Targets

- Solana devnet program: `forecast` containing market factory, staking vault, and faucet instructions
- SPL token: `$CAST`
- Arcium MPC SDK at the staking, payout, reputation, expert oracle, and room leaderboard layers
- Supabase tables: `markets`, `rooms`, `room_members`, `market_categories`
- Polymarket Gamma API for market discovery and CLOB API for orderbook/pricing

## Arcium MXE Source

The first confidential instruction slice lives in:

```text
arcium/forecast-mxe/encrypted-ixs/forecast_private_market.rs
```

It is designed to be copied into the Arcium project generated by `arcium init forecast-mxe`, then deployed to devnet cluster offset `456`.

## Arcium Circuits

Forecast uses two core Arcium computation definitions for the hackathon demo:

```text
submit_private_stake_v2
compute_private_settlement
```

`submit_private_stake_v2` encrypts the market id, side, and amount at stake time. `compute_private_settlement` runs after creator resolution and computes whether the encrypted position won and what quoted payout should be attached to that commitment.

Upload both `.arcis` files from the Arcium build folder to public storage, then initialize both computation definitions:

```text
arcium/forecast-mxe/forecast_mxe/build/submit_private_stake_v2.arcis
arcium/forecast-mxe/forecast_mxe/build/compute_private_settlement.arcis
```

## Settlement Model

Forecast records each private stake as a `StakeCommitment` account. After resolution, the app can show whether your wallet has a commitment for that market and whether it is still pending Arcium settlement, marked settlement-ready, or already claim-recorded.

For the MVP, the market creator handles the settlement trigger. The creator loads encrypted stake commitments after resolution, queues Arcium settlement for each commitment, then pays from the settlement result. The Forecast program verifies the signer is the market creator, marks the commitment settlement-ready, and transfers `$CAST` from the Forecast vault to the stake owner's token account.

Before creator payouts can work, the vault token account owner must be the Forecast config PDA. Re-running `scripts/initializeForecast.mjs` will set that authority when the current setup wallet still owns the vault.

The local Forecast server keeps the private settlement input handle in memory when a stake is submitted, then binds it to the onchain `StakeCommitment` through `POST /settlement/register`. For the demo, settle freshly submitted stakes without restarting the server. A production keeper should store this handle in durable encrypted storage or derive it directly from Arcium callback state.
