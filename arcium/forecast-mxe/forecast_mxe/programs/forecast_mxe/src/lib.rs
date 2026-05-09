use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};

const COMP_DEF_OFFSET_SUBMIT_PRIVATE_STAKE: u32 = comp_def_offset("submit_private_stake_v2");

declare_id!("3Ayx79S2apLBQgSVNq3y2mcbsvQeq4ZUVaiYd2xo7WZK");

#[arcium_program]
pub mod forecast_mxe {
    use super::*;

    pub fn init_submit_private_stake_v2_comp_def(
        ctx: Context<InitSubmitPrivateStakeCompDef>,
        circuit_source: String,
        circuit_hash: [u8; 32],
    ) -> Result<()> {
        require!(circuit_source.len() <= 200, ErrorCode::CircuitSourceTooLong);
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: circuit_source,
                hash: circuit_hash,
            })),
            None,
        )?;
        Ok(())
    }

    pub fn submit_private_stake(
        ctx: Context<SubmitPrivateStake>,
        computation_offset: u64,
        market_id: [u8; 32],
        position: [u8; 32],
        amount: [u8; 32],
        multiplier: [u8; 32],
        pubkey: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
        let args = ArgBuilder::new()
            .x25519_pubkey(pubkey)
            .plaintext_u128(nonce)
            .encrypted_u128(market_id)
            .encrypted_u8(position)
            .encrypted_u64(amount)
            .encrypted_u8(multiplier)
            .build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![SubmitPrivateStakeV2Callback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "submit_private_stake_v2")]
    pub fn submit_private_stake_v2_callback(
        ctx: Context<SubmitPrivateStakeV2Callback>,
        output: SignedComputationOutputs<SubmitPrivateStakeV2Output>,
    ) -> Result<()> {
        let _verified_output =
            match output.verify_output(&ctx.accounts.cluster_account, &ctx.accounts.computation_account) {
                Ok(output) => output,
                Err(_) => return Err(ErrorCode::AbortedComputation.into()),
            };

        emit!(PrivateStakeComputed {
            computation: ctx.accounts.computation_account.key(),
        });
        Ok(())
    }
}

#[queue_computation_accounts("submit_private_stake_v2", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct SubmitPrivateStake<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_SUBMIT_PRIVATE_STAKE)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(
        mut,
        address = ARCIUM_CLOCK_ACCOUNT_ADDRESS
    )]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("submit_private_stake_v2")]
#[derive(Accounts)]
pub struct SubmitPrivateStakeV2Callback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_SUBMIT_PRIVATE_STAKE)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by Arcium program via callback context constraints.
    pub computation_account: UncheckedAccount<'info>,
    #[account(
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
}

#[init_computation_definition_accounts("submit_private_stake_v2", payer)]
#[derive(Accounts)]
pub struct InitSubmitPrivateStakeCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by Arcium program.
    /// It cannot be checked here because it is not initialized yet.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot)
    )]
    /// CHECK: address_lookup_table, checked by Arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct PrivateStakeComputed {
    pub computation: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Circuit source URL exceeds 200 characters")]
    CircuitSourceTooLong,
}
