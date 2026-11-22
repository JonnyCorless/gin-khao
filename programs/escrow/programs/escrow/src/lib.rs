//! SolanaSmash escrow: holds two equal stakes for a 1v1 match and pays the winner minus a house fee.
//!
//! Trust model
//! -----------
//! * The stake sits in the match PDA itself. Only this program can move it.
//! * A single `authority` key (the game server) reports results, but the program restricts what
//!   that key can do: it can only pay the pot to one of the two players, the fee is computed here
//!   (fee_bps, snapshotted when the match starts, capped at MAX_FEE_BPS), and the fee can only go to
//!   `config.treasury`. A stolen authority key can therefore pick the winner of matches in progress,
//!   but cannot redirect funds anywhere else.
//! * Funds can never be trapped: player A can cancel an un-joined match at any time, and after
//!   SETTLE_TIMEOUT_SECS either player (or anyone) can trigger a full refund of an unsettled match.
//! * Draws / server faults: the authority can `void_match` to refund both stakes in full (no fee).

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("3WPvDvnKhi4gKCJreiGGFDX4XTJSKp6yzrCZmL1itRWd");

/// Hard ceiling on the house fee: 10%.
pub const MAX_FEE_BPS: u16 = 1_000;
/// If the server hasn't settled this long after the match started, anyone can refund both players.
#[cfg(not(feature = "short-timeout"))]
pub const SETTLE_TIMEOUT_SECS: i64 = 20 * 60;
/// TEST BUILDS ONLY (used by apps/server/scripts/onchain-test.sh). Never deploy with this feature.
#[cfg(feature = "short-timeout")]
pub const SETTLE_TIMEOUT_SECS: i64 = 6;
pub const STATUS_OPEN: u8 = 0;
pub const STATUS_ACTIVE: u8 = 1;

#[program]
pub mod escrow {
    use super::*;

    /// One-time setup. `fee_bps` = 330 for the 3.3% house cut.
    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey, treasury: Pubkey, fee_bps: u16, min_stake: u64) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.authority = authority;
        c.treasury = treasury;
        c.fee_bps = fee_bps;
        c.min_stake = min_stake;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Admin can rotate keys and change the fee (affects only matches that START afterwards).
    pub fn update_config(ctx: Context<UpdateConfig>, authority: Pubkey, treasury: Pubkey, fee_bps: u16, min_stake: u64) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        let c = &mut ctx.accounts.config;
        c.authority = authority;
        c.treasury = treasury;
        c.fee_bps = fee_bps;
        c.min_stake = min_stake;
        Ok(())
    }

    /// Player A opens a match against a *designated* opponent and deposits their stake.
    /// Pinning the opponent at creation means nobody watching the chain can front-run B and
    /// hijack the match.
    pub fn create_match(ctx: Context<CreateMatch>, match_id: u64, stake: u64, opponent: Pubkey) -> Result<()> {
        require!(stake >= ctx.accounts.config.min_stake && stake > 0, EscrowError::StakeTooSmall);
        require!(opponent != Pubkey::default() && opponent != ctx.accounts.player_a.key(), EscrowError::SamePlayer);
        let m = &mut ctx.accounts.game_match;
        m.match_id = match_id;
        m.player_a = ctx.accounts.player_a.key();
        m.player_b = opponent;
        m.stake = stake;
        m.status = STATUS_OPEN;
        m.created_at = Clock::get()?.unix_timestamp;
        m.started_at = 0;
        m.fee_bps = 0;
        m.bump = ctx.bumps.game_match;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer { from: ctx.accounts.player_a.to_account_info(), to: ctx.accounts.game_match.to_account_info() },
            ),
            stake,
        )?;
        emit!(MatchCreated { match_id, player_a: ctx.accounts.player_a.key(), player_b: opponent, stake });
        Ok(())
    }

    /// Player B matches the stake; the match becomes Active and the fee rate is locked in.
    pub fn join_match(ctx: Context<JoinMatch>) -> Result<()> {
        let stake = ctx.accounts.game_match.stake;
        require!(ctx.accounts.game_match.status == STATUS_OPEN, EscrowError::BadStatus);

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer { from: ctx.accounts.player_b.to_account_info(), to: ctx.accounts.game_match.to_account_info() },
            ),
            stake,
        )?;

        let fee_bps = ctx.accounts.config.fee_bps;
        let m = &mut ctx.accounts.game_match;
        m.status = STATUS_ACTIVE;
        m.started_at = Clock::get()?.unix_timestamp;
        m.fee_bps = fee_bps;
        emit!(MatchStarted { match_id: m.match_id, player_a: m.player_a, player_b: m.player_b, stake, fee_bps });
        Ok(())
    }

    /// Player A takes their stake back while nobody has joined. Closes the account.
    pub fn cancel_match(ctx: Context<CancelMatch>) -> Result<()> {
        require!(ctx.accounts.game_match.status == STATUS_OPEN, EscrowError::BadStatus);
        emit!(MatchCancelled { match_id: ctx.accounts.game_match.match_id });
        Ok(()) // `close = player_a` returns stake + rent
    }

    /// Server reports the winner. Pays winner (pot - fee), treasury (fee); rent goes back to player A.
    pub fn settle(ctx: Context<Settle>, winner: Pubkey) -> Result<()> {
        let (a, b, stake, fee_bps, match_id) = {
            let m = &ctx.accounts.game_match;
            require!(m.status == STATUS_ACTIVE, EscrowError::BadStatus);
            (m.player_a, m.player_b, m.stake, m.fee_bps, m.match_id)
        };
        require!(winner == a || winner == b, EscrowError::InvalidWinner);

        let pot = stake.checked_mul(2).ok_or(EscrowError::MathOverflow)?;
        let fee = fee_for(pot, fee_bps)?;
        let payout = pot.checked_sub(fee).ok_or(EscrowError::MathOverflow)?;

        let match_ai = ctx.accounts.game_match.to_account_info();
        let winner_ai = if winner == a { ctx.accounts.player_a.to_account_info() } else { ctx.accounts.player_b.to_account_info() };
        move_lamports(&match_ai, &winner_ai, payout)?;
        move_lamports(&match_ai, &ctx.accounts.treasury.to_account_info(), fee)?;

        emit!(MatchSettled { match_id, winner, payout, fee });
        Ok(()) // `close = player_a` returns the remaining rent
    }

    /// Draw or server fault: refund both stakes in full, no fee.
    pub fn void_match(ctx: Context<VoidMatch>) -> Result<()> {
        refund_both(&ctx.accounts.game_match, &ctx.accounts.player_a, &ctx.accounts.player_b)
    }

    /// Anyone can trigger a full refund if the server never settled within SETTLE_TIMEOUT_SECS.
    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let m = &ctx.accounts.game_match;
        require!(m.status == STATUS_ACTIVE, EscrowError::BadStatus);
        require!(now >= m.started_at.checked_add(SETTLE_TIMEOUT_SECS).ok_or(EscrowError::MathOverflow)?, EscrowError::NotExpired);
        refund_both(&ctx.accounts.game_match, &ctx.accounts.player_a, &ctx.accounts.player_b)
    }
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

/// fee = floor(pot * fee_bps / 10_000). 3.3% of a 2 SOL pot at 330 bps = 0.066 SOL.
/// Rounding down favours the winner by < 1 lamport.
pub fn fee_for(pot: u64, fee_bps: u16) -> Result<u64> {
    let fee = (pot as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(EscrowError::MathOverflow)?
        / 10_000u128;
    Ok(u64::try_from(fee).map_err(|_| EscrowError::MathOverflow)?)
}

fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let from_new = from.lamports().checked_sub(amount).ok_or(EscrowError::MathOverflow)?;
    let to_new = to.lamports().checked_add(amount).ok_or(EscrowError::MathOverflow)?;
    **from.try_borrow_mut_lamports()? = from_new;
    **to.try_borrow_mut_lamports()? = to_new;
    Ok(())
}

fn refund_both(m: &Account<GameMatch>, a: &SystemAccount, b: &SystemAccount) -> Result<()> {
    require!(m.status == STATUS_ACTIVE, EscrowError::BadStatus);
    let match_ai = m.to_account_info();
    move_lamports(&match_ai, &a.to_account_info(), m.stake)?;
    move_lamports(&match_ai, &b.to_account_info(), m.stake)?;
    emit!(MatchVoided { match_id: m.match_id });
    Ok(()) // `close = player_a` returns the rent
}

// ---------------------------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------------------------

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub min_stake: u64,
    pub bump: u8,
}
impl Config {
    pub const SPACE: usize = 8 + 32 * 3 + 2 + 8 + 1;
}

#[account]
pub struct GameMatch {
    pub match_id: u64,
    pub player_a: Pubkey,
    pub player_b: Pubkey,
    pub stake: u64,
    pub status: u8,
    pub created_at: i64,
    pub started_at: i64,
    pub fee_bps: u16,
    pub bump: u8,
}
impl GameMatch {
    pub const SPACE: usize = 8 + 8 + 32 + 32 + 8 + 1 + 8 + 8 + 2 + 1;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = Config::SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct CreateMatch<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = player_a, space = GameMatch::SPACE, seeds = [b"match", match_id.to_le_bytes().as_ref()], bump)]
    pub game_match: Account<'info, GameMatch>,
    #[account(mut)]
    pub player_a: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinMatch<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"match", game_match.match_id.to_le_bytes().as_ref()], bump = game_match.bump, has_one = player_b @ EscrowError::WrongOpponent)]
    pub game_match: Account<'info, GameMatch>,
    #[account(mut)]
    pub player_b: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelMatch<'info> {
    #[account(
        mut, close = player_a,
        seeds = [b"match", game_match.match_id.to_le_bytes().as_ref()], bump = game_match.bump,
        has_one = player_a
    )]
    pub game_match: Account<'info, GameMatch>,
    #[account(mut)]
    pub player_a: Signer<'info>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority, has_one = treasury)]
    pub config: Account<'info, Config>,
    #[account(
        mut, close = player_a,
        seeds = [b"match", game_match.match_id.to_le_bytes().as_ref()], bump = game_match.bump,
        has_one = player_a, has_one = player_b
    )]
    pub game_match: Account<'info, GameMatch>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub player_a: SystemAccount<'info>,
    #[account(mut)]
    pub player_b: SystemAccount<'info>,
    /// CHECK: constrained to config.treasury via has_one
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct VoidMatch<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(
        mut, close = player_a,
        seeds = [b"match", game_match.match_id.to_le_bytes().as_ref()], bump = game_match.bump,
        has_one = player_a, has_one = player_b
    )]
    pub game_match: Account<'info, GameMatch>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub player_a: SystemAccount<'info>,
    #[account(mut)]
    pub player_b: SystemAccount<'info>,
}

#[derive(Accounts)]
pub struct RefundExpired<'info> {
    #[account(
        mut, close = player_a,
        seeds = [b"match", game_match.match_id.to_le_bytes().as_ref()], bump = game_match.bump,
        has_one = player_a, has_one = player_b
    )]
    pub game_match: Account<'info, GameMatch>,
    pub caller: Signer<'info>,
    #[account(mut)]
    pub player_a: SystemAccount<'info>,
    #[account(mut)]
    pub player_b: SystemAccount<'info>,
}

// ---------------------------------------------------------------------------------------------
// events / errors
// ---------------------------------------------------------------------------------------------

#[event]
pub struct MatchCreated { pub match_id: u64, pub player_a: Pubkey, pub player_b: Pubkey, pub stake: u64 }
#[event]
pub struct MatchStarted { pub match_id: u64, pub player_a: Pubkey, pub player_b: Pubkey, pub stake: u64, pub fee_bps: u16 }
#[event]
pub struct MatchSettled { pub match_id: u64, pub winner: Pubkey, pub payout: u64, pub fee: u64 }
#[event]
pub struct MatchCancelled { pub match_id: u64 }
#[event]
pub struct MatchVoided { pub match_id: u64 }

#[error_code]
pub enum EscrowError {
    #[msg("Fee exceeds the hard cap")]
    FeeTooHigh,
    #[msg("Stake is below the minimum")]
    StakeTooSmall,
    #[msg("Match is not in the right state for this action")]
    BadStatus,
    #[msg("Opponent must be a valid, different wallet")]
    SamePlayer,
    #[msg("Winner must be one of the two players")]
    InvalidWinner,
    #[msg("Settlement timeout has not elapsed")]
    NotExpired,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Only the designated opponent can join this match")]
    WrongOpponent,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_is_3_3_percent() {
        // 0.01 SOL stake each => pot 0.02 SOL
        let pot = 20_000_000u64;
        let fee = fee_for(pot, 330).unwrap();
        assert_eq!(fee, 660_000); // 3.3% of 0.02 SOL
        assert_eq!(pot - fee, 19_340_000);
    }

    #[test]
    fn fee_never_exceeds_pot_or_overflows() {
        assert_eq!(fee_for(0, 330).unwrap(), 0);
        assert!(fee_for(u64::MAX, MAX_FEE_BPS).unwrap() < u64::MAX);
        for pot in [1u64, 2, 3, 999, 10_001] {
            assert!(fee_for(pot, 330).unwrap() <= pot);
        }
    }

    #[test]
    fn payout_plus_fee_equals_pot() {
        for stake in [1u64, 7, 5_000_000, 123_456_789] {
            let pot = stake * 2;
            let fee = fee_for(pot, 330).unwrap();
            assert_eq!(pot - fee + fee, pot);
        }
    }
}
