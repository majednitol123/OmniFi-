use crate::constants::POOL_AUTHORITY_SEED;
use crate::errors::ClmmError;
use crate::state::{PoolState, PositionState};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct CollectFees<'info> {
    pub pool_state: Account<'info, PoolState>,

    #[account(
        mut,
        constraint = position.pool == pool_state.key(),
        has_one = owner
    )]
    pub position: Account<'info, PositionState>,

    /// CHECK: Pool authority PDA for CPI signing
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool_state.key().as_ref()],
        bump = pool_state.authority_bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = pool_state.token_vault_0
    )]
    pub token_vault_0: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = pool_state.token_vault_1
    )]
    pub token_vault_1: Account<'info, TokenAccount>,

    #[account(mut)]
    pub recipient_token_0: Account<'info, TokenAccount>,

    #[account(mut)]
    pub recipient_token_1: Account<'info, TokenAccount>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn process_collect_fees(ctx: Context<CollectFees>) -> Result<()> {
    let position = &mut ctx.accounts.position;

    let amount_0 = position.tokens_owed_0;
    let amount_1 = position.tokens_owed_1;

    require!(amount_0 > 0 || amount_1 > 0, ClmmError::ZeroAmount);

    let pool_key = ctx.accounts.pool_state.key();
    let authority_seeds = &[
        POOL_AUTHORITY_SEED,
        pool_key.as_ref(),
        &[ctx.accounts.pool_state.authority_bump],
    ];
    let signer = &[&authority_seeds[..]];

    if amount_0 > 0 {
        position.tokens_owed_0 = 0;
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault_0.to_account_info(),
            to: ctx.accounts.recipient_token_0.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, amount_0)?;
    }

    if amount_1 > 0 {
        position.tokens_owed_1 = 0;
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault_1.to_account_info(),
            to: ctx.accounts.recipient_token_1.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, amount_1)?;
    }

    Ok(())
}
