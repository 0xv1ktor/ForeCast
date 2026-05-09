# Forecast

Forecast is a privacy-enhanced prediction and opinion market demo built for Solana devnet and Arcium MPC.

Tagline: **Stake your belief. Keep your position private.**

This Phase 1 build is a production-style React SPA using mock data and simulated wallet, faucet, staking, and Arcium MPC states. It is designed for hackathon judging and live demo flow.

## Core Idea

Traditional prediction markets expose too much about individual behavior. Forecast keeps individual stakes, positions, conviction multipliers, expert oracle inputs, and reputation history private.

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

## Demo Commands

Install dependencies:

```bash
npm install
```

Run the local demo:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Local app URL:

```text
http://localhost:5173/
```

## Demo Flow

1. Open the landing page and point out the Arcium privacy positioning.
2. Click **Browse Markets** and show Native vs Polymarket Event tabs.
3. Open the Bitcoin market detail page.
4. Choose YES or NO, adjust the conviction slider, enter a $CAST amount, and submit.
5. Show the simulated Arcium flow: preparing stake, encrypted MPC computation, Solana submission, success state.
6. Show recent activity where amounts and wallets are hidden.
7. Open **Rooms** to show DAO private markets and permissioned Arcium clusters.
8. Open **Leaderboard** to show public accuracy rankings with private participation counts.
9. Use **Connect Wallet** to demo the Phantom or Backpack mock flow and 1,000 $CAST faucet.

## Routes

- `/` - Landing page
- `/markets` - Market browser with search, category filters, source tabs, and sorting
- `/markets/:id` - Interactive market detail and conviction staking flow
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
  data/                   # Mock/seed data used by Phase 1 and fallbacks
  integrations/           # Solana, Forecast, Arcium, and Polymarket adapters
  lib/                    # Small shared helpers
  pages/                  # Route-level screens
  styles/                 # Global design system entrypoint and styling
```

The frontend is organized so product screens do not own wallet or API plumbing, and integrations do not own UI.

## Current Phase

Phase 1 UI is complete, and the integration layer has started:

- Injected Phantom or Backpack wallet connection when available
- Real devnet `$CAST` mint and Forecast faucet integration
- Automatic first-time `1,000 $CAST` claim for connected wallets
- Manual `100 $CAST` daily refill action, enforced by the Forecast program
- Live Polymarket Gamma API market discovery with bundled fallback data
- Arcium client SDK stake payload preparation behind environment config
- Mock $CAST faucet balance until the devnet faucet program is deployed
- Faucet contract source supports 1,000 initial $CAST plus 100 $CAST per day refill
- Simulated expert oracle signals until the Arcium oracle circuit is deployed
- Encrypted activity feed UI

## Real Integration Config

Create a local `.env` from `.env.example` after deploying the Forecast MXE program:

```bash
cp .env.example .env
```

Required values:

```text
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_POLYMARKET_GAMMA_URL=https://gamma-api.polymarket.com
VITE_ARCIUM_STAKE_API_URL=http://localhost:8787/stake
VITE_ARCIUM_MXE_PROGRAM_ID=your_forecast_mxe_program_id
VITE_ARCIUM_CLUSTER_OFFSET=your_arcium_cluster_offset
VITE_ARCIUM_STAKE_INSTRUCTION=submit_private_stake
```

The Arcium SDK currently runs in a Node service boundary because the package depends on Node crypto APIs. Start the local stake service with:

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com \
ARCIUM_MXE_PROGRAM_ID=your_forecast_mxe_program_id \
ARCIUM_CLUSTER_OFFSET=456 \
npm run arcium:stake-service
```

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
