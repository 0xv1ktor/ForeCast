use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("6LVKicsAfSF9Ba5gZchdxgtP6hEdsQNqAaVZCqHHHz9L");

pub const INITIAL_FAUCET_AMOUNT: u64 = 1_000_000_000;
pub const DAILY_REFILL_AMOUNT: u64 = 100_000_000;
pub const DAILY_WINDOW_SECONDS: i64 = 86_400;

#[program]
pub mod forecast {
    use super::*;

    pub fn initialize_forecast(ctx: Context<InitializeForecast>) -> Result<()> {
        let config = &mut ctx.accounts.forecast_config;
        config.authority = ctx.accounts.authority.key();
        config.cast_mint = ctx.accounts.cast_mint.key();
        config.vault_token_account = ctx.accounts.vault_token_account.key();
        config.market_count = 0;
        config.total_public_deposits = 0;
        config.total_private_claims = 0;
        config.stake_count = 0;
        config.initial_claim_amount = INITIAL_FAUCET_AMOUNT;
        config.daily_refill_amount = DAILY_REFILL_AMOUNT;
        config.daily_window_seconds = DAILY_WINDOW_SECONDS;
        config.faucet_claim_count = 0;
        config.faucet_refill_count = 0;
        config.bump = ctx.bumps.forecast_config;
        config.mint_authority_bump = ctx.bumps.mint_authority;
        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        question: String,
        category: MarketCategory,
        market_type: MarketType,
        resolution_ts: i64,
        oracle_enabled: bool,
        room: Option<Pubkey>,
        criteria_hash: [u8; 32],
    ) -> Result<()> {
        require!(question.len() <= Market::MAX_QUESTION_LEN, ForecastError::QuestionTooLong);
        require!(resolution_ts > Clock::get()?.unix_timestamp, ForecastError::ResolutionInPast);

        let market = &mut ctx.accounts.market;
        market.market_id = market_id;
        market.creator = ctx.accounts.creator.key();
        market.question = question;
        market.category = category;
        market.market_type = market_type;
        market.resolution_ts = resolution_ts;
        market.criteria_hash = criteria_hash;
        market.room = room;
        market.oracle_enabled = oracle_enabled;
        market.status = MarketStatus::Open;
        market.outcome = None;
        market.public_yes_percent = 50;
        market.public_no_percent = 50;
        market.public_volume = 0;
        market.encrypted_aggregate = [0u8; 64];
        market.arcium_computation = None;
        market.bump = ctx.bumps.market;

        let config = &mut ctx.accounts.forecast_config;
        config.market_count = config
            .market_count
            .checked_add(1)
            .ok_or(ForecastError::MathOverflow)?;

        emit!(MarketCreated {
            market: market.key(),
            market_id,
            creator: market.creator,
            oracle_enabled,
        });

        Ok(())
    }

    pub fn update_public_odds(
        ctx: Context<UpdatePublicOdds>,
        yes_percent: u8,
        no_percent: u8,
        public_volume_delta: u64,
        encrypted_aggregate: [u8; 64],
        arcium_computation: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.forecast_config.authority,
            ctx.accounts.authority.key(),
            ForecastError::Unauthorized
        );
        require!(
            yes_percent <= 100 && no_percent <= 100 && yes_percent + no_percent == 100,
            ForecastError::InvalidOdds
        );

        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, ForecastError::MarketNotOpen);
        market.public_yes_percent = yes_percent;
        market.public_no_percent = no_percent;
        market.public_volume = market
            .public_volume
            .checked_add(public_volume_delta)
            .ok_or(ForecastError::MathOverflow)?;
        market.encrypted_aggregate = encrypted_aggregate;
        market.arcium_computation = Some(arcium_computation);

        emit!(MarketOddsUpdated {
            market: market.key(),
            yes_percent,
            no_percent,
            public_volume: market.public_volume,
        });

        Ok(())
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, outcome: MarketOutcome) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.forecast_config.authority,
            ctx.accounts.authority.key(),
            ForecastError::Unauthorized
        );

        let market = &mut ctx.accounts.market;
        require!(market.status == MarketStatus::Open, ForecastError::MarketNotOpen);
        market.status = MarketStatus::Resolved;
        market.outcome = Some(outcome);

        emit!(MarketResolved {
            market: market.key(),
            outcome,
        });

        Ok(())
    }

    pub fn deposit_cast(ctx: Context<DepositCast>, amount: u64) -> Result<()> {
        require!(amount > 0, ForecastError::InvalidAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_cast_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let config = &mut ctx.accounts.forecast_config;
        config.total_public_deposits = config
            .total_public_deposits
            .checked_add(amount)
            .ok_or(ForecastError::MathOverflow)?;

        emit!(CastDeposited {
            user: ctx.accounts.user.key(),
            amount,
        });

        Ok(())
    }

    pub fn record_private_stake(
        ctx: Context<RecordPrivateStake>,
        market: Pubkey,
        stake_commitment_hash: [u8; 32],
        arcium_computation: Pubkey,
        encrypted_payload_hash: [u8; 32],
    ) -> Result<()> {
        let commitment = &mut ctx.accounts.stake_commitment;
        commitment.user = ctx.accounts.user.key();
        commitment.market = market;
        commitment.stake_commitment_hash = stake_commitment_hash;
        commitment.encrypted_payload_hash = encrypted_payload_hash;
        commitment.encrypted_payout_hash = None;
        commitment.arcium_computation = arcium_computation;
        commitment.status = StakeStatus::PendingMpc;
        commitment.created_at = Clock::get()?.unix_timestamp;
        commitment.bump = ctx.bumps.stake_commitment;

        let config = &mut ctx.accounts.forecast_config;
        config.stake_count = config
            .stake_count
            .checked_add(1)
            .ok_or(ForecastError::MathOverflow)?;

        emit!(PrivateStakeRecorded {
            stake_commitment: commitment.key(),
            market,
            arcium_computation,
        });

        Ok(())
    }

    pub fn mark_settlement_ready(
        ctx: Context<MarkSettlementReady>,
        encrypted_payout_hash: [u8; 32],
        arcium_computation: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.forecast_config.authority,
            ctx.accounts.authority.key(),
            ForecastError::Unauthorized
        );

        let commitment = &mut ctx.accounts.stake_commitment;
        commitment.status = StakeStatus::SettlementReady;
        commitment.encrypted_payout_hash = Some(encrypted_payout_hash);
        commitment.arcium_computation = arcium_computation;

        emit!(SettlementReady {
            stake_commitment: commitment.key(),
            arcium_computation,
        });

        Ok(())
    }

    pub fn mark_claimed(ctx: Context<MarkClaimed>, claim_amount: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.forecast_config.authority,
            ctx.accounts.authority.key(),
            ForecastError::Unauthorized
        );

        let commitment = &mut ctx.accounts.stake_commitment;
        require!(
            commitment.status == StakeStatus::SettlementReady,
            ForecastError::SettlementNotReady
        );
        commitment.status = StakeStatus::Claimed;

        let config = &mut ctx.accounts.forecast_config;
        config.total_private_claims = config
            .total_private_claims
            .checked_add(claim_amount)
            .ok_or(ForecastError::MathOverflow)?;

        emit!(PrivatePayoutClaimed {
            stake_commitment: commitment.key(),
            claim_amount,
        });

        Ok(())
    }

    pub fn claim_initial_cast(ctx: Context<ClaimInitialCast>) -> Result<()> {
        let amount = ctx.accounts.forecast_config.initial_claim_amount;
        let mint_authority_bump = ctx.accounts.forecast_config.mint_authority_bump;
        mint_to_user(
            amount,
            mint_authority_bump,
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.cast_mint.to_account_info(),
            ctx.accounts.user_cast_account.to_account_info(),
            ctx.accounts.mint_authority.to_account_info(),
        )?;

        let now = Clock::get()?.unix_timestamp;
        let claim = &mut ctx.accounts.faucet_claim;
        claim.user = ctx.accounts.user.key();
        claim.initial_claimed = true;
        claim.initial_claimed_at = now;
        claim.last_refill_at = now;
        claim.total_claimed = amount;
        claim.bump = ctx.bumps.faucet_claim;

        let config = &mut ctx.accounts.forecast_config;
        config.faucet_claim_count = config
            .faucet_claim_count
            .checked_add(1)
            .ok_or(ForecastError::MathOverflow)?;

        emit!(FaucetClaimed {
            user: ctx.accounts.user.key(),
            amount,
            kind: FaucetClaimKind::Initial,
        });

        Ok(())
    }

    pub fn request_daily_refill(ctx: Context<RequestDailyRefill>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let claim = &mut ctx.accounts.faucet_claim;
        require!(claim.initial_claimed, ForecastError::InitialClaimRequired);
        require!(
            now >= claim
                .last_refill_at
                .checked_add(ctx.accounts.forecast_config.daily_window_seconds)
                .ok_or(ForecastError::MathOverflow)?,
            ForecastError::DailyLimitActive
        );

        let amount = ctx.accounts.forecast_config.daily_refill_amount;
        let mint_authority_bump = ctx.accounts.forecast_config.mint_authority_bump;
        mint_to_user(
            amount,
            mint_authority_bump,
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.cast_mint.to_account_info(),
            ctx.accounts.user_cast_account.to_account_info(),
            ctx.accounts.mint_authority.to_account_info(),
        )?;

        claim.last_refill_at = now;
        claim.total_claimed = claim
            .total_claimed
            .checked_add(amount)
            .ok_or(ForecastError::MathOverflow)?;

        let config = &mut ctx.accounts.forecast_config;
        config.faucet_refill_count = config
            .faucet_refill_count
            .checked_add(1)
            .ok_or(ForecastError::MathOverflow)?;

        emit!(FaucetClaimed {
            user: ctx.accounts.user.key(),
            amount,
            kind: FaucetClaimKind::DailyRefill,
        });

        Ok(())
    }
}

fn mint_to_user<'info>(
    amount: u64,
    mint_authority_bump: u8,
    token_program: AccountInfo<'info>,
    cast_mint: AccountInfo<'info>,
    user_cast_account: AccountInfo<'info>,
    mint_authority: AccountInfo<'info>,
) -> Result<()> {
    let signer_seeds: &[&[u8]] = &[b"mint-authority", &[mint_authority_bump]];

    token::mint_to(
        CpiContext::new_with_signer(
            token_program,
            MintTo {
                mint: cast_mint,
                to: user_cast_account,
                authority: mint_authority,
            },
            &[signer_seeds],
        ),
        amount,
    )
}

#[derive(Accounts)]
pub struct InitializeForecast<'info> {
    #[account(
        init,
        payer = authority,
        seeds = [b"forecast-config"],
        bump,
        space = 8 + ForecastConfig::SPACE
    )]
    pub forecast_config: Account<'info, ForecastConfig>,
    pub cast_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = vault_token_account.mint == cast_mint.key(),
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    /// CHECK: PDA mint authority. The $CAST mint authority must be set to this PDA.
    #[account(seeds = [b"mint-authority"], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut, seeds = [b"forecast-config"], bump = forecast_config.bump)]
    pub forecast_config: Account<'info, ForecastConfig>,
    #[account(
        init,
        payer = creator,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
        bump,
        space = 8 + Market::SPACE
    )]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePublicOdds<'info> {
    #[account(seeds = [b"forecast-config"], bump = forecast_config.bump)]
    pub forecast_config: Account<'info, ForecastConfig>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(seeds = [b"forecast-config"], bump = forecast_config.bump)]
    pub forecast_config: Account<'info, ForecastConfig>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositCast<'info> {
    #[account(mut, seeds = [b"forecast-config"], bump = forecast_config.bump)]
    pub forecast_config: Account<'info, ForecastConfig>,
    #[account(mut)]
    pub user_cast_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = forecast_config.vault_token_account,
        constraint = vault_token_account.mint == forecast_config.cast_mint,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(market: Pubkey, stake_commitment_hash: [u8; 32])]
pub struct RecordPrivateStake<'info> {
    #[account(mut, seeds = [b"forecast-config"], bump = forecast_config.bump)]
    pub forecast_config: Account<'info, ForecastConfig>,
    #[account(
        init,
        payer = user,
        seeds = [
            b"stake",
            user.key().as_ref(),
            market.as_ref(),
            stake_commitment_hash.as_ref()
        ],
        bump,
        space = 8 + StakeCommitment::SPACE
    )]
    pub stake_commitment: Account<'info, StakeCommitment>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MarkSettlementReady<'info> {
    #[account(seeds = [b"forecast-config"], bump = forecast_config.bump)]
    pub forecast_config: Account<'info, ForecastConfig>,
    #[account(mut)]
    pub stake_commitment: Account<'info, StakeCommitment>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct MarkClaimed<'info> {
    #[account(mut, seeds = [b"forecast-config"], bump = forecast_config.bump)]
    pub forecast_config: Account<'info, ForecastConfig>,
    #[account(mut)]
    pub stake_commitment: Account<'info, StakeCommitment>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimInitialCast<'info> {
    #[account(mut, seeds = [b"forecast-config"], bump = forecast_config.bump)]
    pub forecast_config: Account<'info, ForecastConfig>,
    #[account(
        init,
        payer = user,
        seeds = [b"faucet-claim", user.key().as_ref()],
        bump,
        space = 8 + FaucetClaim::SPACE
    )]
    pub faucet_claim: Account<'info, FaucetClaim>,
    #[account(
        mut,
        address = forecast_config.cast_mint,
    )]
    pub cast_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = user_cast_account.owner == user.key(),
        constraint = user_cast_account.mint == forecast_config.cast_mint,
    )]
    pub user_cast_account: Account<'info, TokenAccount>,
    /// CHECK: PDA mint authority. The $CAST mint authority must be set to this PDA.
    #[account(seeds = [b"mint-authority"], bump = forecast_config.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestDailyRefill<'info> {
    #[account(mut, seeds = [b"forecast-config"], bump = forecast_config.bump)]
    pub forecast_config: Account<'info, ForecastConfig>,
    #[account(
        mut,
        seeds = [b"faucet-claim", user.key().as_ref()],
        bump = faucet_claim.bump,
        has_one = user
    )]
    pub faucet_claim: Account<'info, FaucetClaim>,
    #[account(
        mut,
        address = forecast_config.cast_mint,
    )]
    pub cast_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = user_cast_account.owner == user.key(),
        constraint = user_cast_account.mint == forecast_config.cast_mint,
    )]
    pub user_cast_account: Account<'info, TokenAccount>,
    /// CHECK: PDA mint authority. The $CAST mint authority must be set to this PDA.
    #[account(seeds = [b"mint-authority"], bump = forecast_config.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct ForecastConfig {
    pub authority: Pubkey,
    pub cast_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub market_count: u64,
    pub total_public_deposits: u64,
    pub total_private_claims: u64,
    pub stake_count: u64,
    pub initial_claim_amount: u64,
    pub daily_refill_amount: u64,
    pub daily_window_seconds: i64,
    pub faucet_claim_count: u64,
    pub faucet_refill_count: u64,
    pub bump: u8,
    pub mint_authority_bump: u8,
}

impl ForecastConfig {
    pub const SPACE: usize = 256;
}

#[account]
pub struct Market {
    pub market_id: u64,
    pub creator: Pubkey,
    pub question: String,
    pub category: MarketCategory,
    pub market_type: MarketType,
    pub resolution_ts: i64,
    pub criteria_hash: [u8; 32],
    pub room: Option<Pubkey>,
    pub oracle_enabled: bool,
    pub status: MarketStatus,
    pub outcome: Option<MarketOutcome>,
    pub public_yes_percent: u8,
    pub public_no_percent: u8,
    pub public_volume: u64,
    pub encrypted_aggregate: [u8; 64],
    pub arcium_computation: Option<Pubkey>,
    pub bump: u8,
}

impl Market {
    pub const MAX_QUESTION_LEN: usize = 180;
    pub const SPACE: usize = 512;
}

#[account]
pub struct StakeCommitment {
    pub user: Pubkey,
    pub market: Pubkey,
    pub stake_commitment_hash: [u8; 32],
    pub encrypted_payload_hash: [u8; 32],
    pub encrypted_payout_hash: Option<[u8; 32]>,
    pub arcium_computation: Pubkey,
    pub status: StakeStatus,
    pub created_at: i64,
    pub bump: u8,
}

impl StakeCommitment {
    pub const SPACE: usize = 256;
}

#[account]
pub struct FaucetClaim {
    pub user: Pubkey,
    pub initial_claimed: bool,
    pub initial_claimed_at: i64,
    pub last_refill_at: i64,
    pub total_claimed: u64,
    pub bump: u8,
}

impl FaucetClaim {
    pub const SPACE: usize = 64;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketCategory {
    Crypto,
    Politics,
    Sports,
    Science,
    Technology,
    Finance,
    WorldEvents,
    Other,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketType {
    Public,
    DaoRoom,
    PolymarketMirror,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Resolved,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketOutcome {
    Yes,
    No,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum StakeStatus {
    PendingMpc,
    SettlementReady,
    Claimed,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum FaucetClaimKind {
    Initial,
    DailyRefill,
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub market_id: u64,
    pub creator: Pubkey,
    pub oracle_enabled: bool,
}

#[event]
pub struct MarketOddsUpdated {
    pub market: Pubkey,
    pub yes_percent: u8,
    pub no_percent: u8,
    pub public_volume: u64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub outcome: MarketOutcome,
}

#[event]
pub struct CastDeposited {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PrivateStakeRecorded {
    pub stake_commitment: Pubkey,
    pub market: Pubkey,
    pub arcium_computation: Pubkey,
}

#[event]
pub struct SettlementReady {
    pub stake_commitment: Pubkey,
    pub arcium_computation: Pubkey,
}

#[event]
pub struct PrivatePayoutClaimed {
    pub stake_commitment: Pubkey,
    pub claim_amount: u64,
}

#[event]
pub struct FaucetClaimed {
    pub user: Pubkey,
    pub amount: u64,
    pub kind: FaucetClaimKind,
}

#[error_code]
pub enum ForecastError {
    #[msg("Only the Forecast authority can perform this action")]
    Unauthorized,
    #[msg("Market question is too long")]
    QuestionTooLong,
    #[msg("Resolution date must be in the future")]
    ResolutionInPast,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("YES and NO odds must sum to 100")]
    InvalidOdds,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Settlement is not ready")]
    SettlementNotReady,
    #[msg("Initial faucet claim is required before requesting daily refills")]
    InitialClaimRequired,
    #[msg("Daily refill limit is still active")]
    DailyLimitActive,
    #[msg("Math overflow")]
    MathOverflow,
}
