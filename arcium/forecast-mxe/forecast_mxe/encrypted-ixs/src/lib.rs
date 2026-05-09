use arcis::*;

#[encrypted]
mod forecast_private_market {
    use arcis::*;

    pub struct StakeInput {
        market_id: u128,
        position: u8,
        amount: u64,
        multiplier: u8,
    }

    pub struct StakeReceipt {
        market_id: u128,
        position: u8,
        weighted_amount: u64,
    }

    pub struct MarketAggregate {
        market_id: u128,
        yes_weighted: u64,
        no_weighted: u64,
        total_staked: u64,
        stake_count: u32,
    }

    pub struct PublicOdds {
        yes_percent: u8,
        no_percent: u8,
        stake_count: u32,
    }

    pub struct ExpertOpinion {
        market_id: u128,
        position: u8,
        confidence: u8,
    }

    pub struct ExpertAggregate {
        market_id: u128,
        yes_weighted: u64,
        no_weighted: u64,
        expert_count: u32,
    }

    pub struct PublicExpertSignal {
        yes_lean: u8,
        expert_count: u32,
    }

    pub struct ReputationRecord {
        wins: u32,
        losses: u32,
        markets_participated: u32,
        total_volume: u64,
    }

    pub struct PublicReputation {
        win_rate: u8,
        tier: u8,
    }

    pub struct SettlementInput {
        user_position: u8,
        winning_position: u8,
        amount: u64,
        multiplier: u8,
    }

    pub struct SettlementResult {
        payout: u64,
        won: u8,
    }

    #[instruction]
    pub fn submit_private_stake_v2(stake_ctxt: Enc<Shared, StakeInput>) -> Enc<Shared, StakeReceipt> {
        let stake = stake_ctxt.to_arcis();
        let receipt = StakeReceipt {
            market_id: stake.market_id,
            position: stake.position,
            weighted_amount: stake.amount * stake.multiplier as u64,
        };

        stake_ctxt.owner.from_arcis(receipt)
    }

    #[instruction]
    pub fn update_market_aggregate(
        stake_ctxt: Enc<Shared, StakeInput>,
        aggregate_ctxt: Enc<Mxe, MarketAggregate>,
    ) -> Enc<Mxe, MarketAggregate> {
        let stake = stake_ctxt.to_arcis();
        let mut aggregate = aggregate_ctxt.to_arcis();
        let weighted_amount = stake.amount * stake.multiplier as u64;

        aggregate.market_id = stake.market_id;
        aggregate.yes_weighted = if stake.position == 1 {
            aggregate.yes_weighted + weighted_amount
        } else {
            aggregate.yes_weighted
        };
        aggregate.no_weighted = if stake.position == 0 {
            aggregate.no_weighted + weighted_amount
        } else {
            aggregate.no_weighted
        };
        aggregate.total_staked += stake.amount;
        aggregate.stake_count += 1;

        aggregate_ctxt.owner.from_arcis(aggregate)
    }

    #[instruction]
    pub fn compute_public_odds(aggregate_ctxt: Enc<Mxe, MarketAggregate>) -> PublicOdds {
        let aggregate = aggregate_ctxt.to_arcis();
        let weighted_total = aggregate.yes_weighted + aggregate.no_weighted;
        let yes_percent = if weighted_total == 0 {
            50u8
        } else {
            ((aggregate.yes_weighted * 100) / weighted_total) as u8
        };

        PublicOdds {
            yes_percent: yes_percent.reveal(),
            no_percent: (100u8 - yes_percent).reveal(),
            stake_count: aggregate.stake_count.reveal(),
        }
    }

    #[instruction]
    pub fn submit_expert_opinion(
        opinion_ctxt: Enc<Shared, ExpertOpinion>,
        aggregate_ctxt: Enc<Mxe, ExpertAggregate>,
    ) -> Enc<Mxe, ExpertAggregate> {
        let opinion = opinion_ctxt.to_arcis();
        let mut aggregate = aggregate_ctxt.to_arcis();
        let confidence = opinion.confidence as u64;

        aggregate.market_id = opinion.market_id;
        aggregate.yes_weighted = if opinion.position == 1 {
            aggregate.yes_weighted + confidence
        } else {
            aggregate.yes_weighted
        };
        aggregate.no_weighted = if opinion.position == 0 {
            aggregate.no_weighted + confidence
        } else {
            aggregate.no_weighted
        };
        aggregate.expert_count += 1;

        aggregate_ctxt.owner.from_arcis(aggregate)
    }

    #[instruction]
    pub fn compute_public_expert_signal(
        aggregate_ctxt: Enc<Mxe, ExpertAggregate>,
    ) -> PublicExpertSignal {
        let aggregate = aggregate_ctxt.to_arcis();
        let total = aggregate.yes_weighted + aggregate.no_weighted;
        let yes_lean = if total == 0 {
            50u8
        } else {
            ((aggregate.yes_weighted * 100) / total) as u8
        };

        PublicExpertSignal {
            yes_lean: yes_lean.reveal(),
            expert_count: aggregate.expert_count.reveal(),
        }
    }

    #[instruction]
    pub fn update_reputation_after_resolution(
        record_ctxt: Enc<Mxe, ReputationRecord>,
        settlement_ctxt: Enc<Shared, SettlementInput>,
    ) -> Enc<Mxe, ReputationRecord> {
        let mut record = record_ctxt.to_arcis();
        let settlement = settlement_ctxt.to_arcis();
        let won = settlement.user_position == settlement.winning_position;

        record.wins = if won { record.wins + 1 } else { record.wins };
        record.losses = if won { record.losses } else { record.losses + 1 };
        record.markets_participated += 1;
        record.total_volume += settlement.amount;

        record_ctxt.owner.from_arcis(record)
    }

    #[instruction]
    pub fn compute_public_reputation(record_ctxt: Enc<Mxe, ReputationRecord>) -> PublicReputation {
        let record = record_ctxt.to_arcis();
        let total = record.wins + record.losses;
        let win_rate = if total == 0 {
            0u8
        } else {
            ((record.wins * 100) / total) as u8
        };
        let tier = if win_rate >= 90 {
            5u8
        } else if win_rate >= 80 {
            4u8
        } else if win_rate >= 70 {
            3u8
        } else if win_rate >= 60 {
            2u8
        } else {
            1u8
        };

        PublicReputation {
            win_rate: win_rate.reveal(),
            tier: tier.reveal(),
        }
    }

    #[instruction]
    pub fn compute_private_settlement(
        settlement_ctxt: Enc<Shared, SettlementInput>,
    ) -> Enc<Shared, SettlementResult> {
        let settlement = settlement_ctxt.to_arcis();
        let won = settlement.user_position == settlement.winning_position;
        let payout = if won {
            settlement.amount * settlement.multiplier as u64
        } else {
            0u64
        };
        let result = SettlementResult {
            payout,
            won: if won { 1u8 } else { 0u8 },
        };

        settlement_ctxt.owner.from_arcis(result)
    }
}
