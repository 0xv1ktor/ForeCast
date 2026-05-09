# Forecast MXE

This folder holds the first Forecast confidential instruction slice for Arcium.

The circuit in `encrypted-ixs/forecast_private_market.rs` accepts:

- Market identifier
- YES or NO position
- $CAST amount
- Conviction multiplier
- Existing encrypted market aggregate

It outputs an updated encrypted aggregate and a separate public odds instruction that only releases aggregate percentages and stake count.

## Intended Arcium Flow

1. Create an Arcium project with `arcium init forecast-mxe`.
2. Copy `encrypted-ixs/forecast_private_market.rs` into the generated `encrypted-ixs` source folder.
3. Wire the generated Solana program instruction to `submit_private_stake`.
4. Build and test locally.
5. Deploy to devnet cluster offset `456`.
6. Put the deployed program id and cluster offset into the frontend `.env`.

## Commands For You To Run

```bash
arcium build
arcium test --cluster devnet
arcium deploy --cluster-offset 456 --recovery-set-size 4 --keypair-path ~/.config/solana/id.json --rpc-url YOUR_DEVNET_RPC_URL
```

