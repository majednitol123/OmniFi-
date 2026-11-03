use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::{GLOBAL_CONFIG_SEED, POOL_AUTHORITY_SEED, POOL_STATE_SEED};
use crate::errors::ErrorCode;
use crate::state::{GlobalConfig, PoolState};

#[derive(Accounts)]
pub struct CollectProtocolFees<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [
            POOL_STATE_SEED,
            pool_state.token_mint_0.as_ref(),
            pool_state.token_mint_1.as_ref(),
            &pool_state.fee_tier.to_le_bytes()
        ],
        bump = pool_state.bump
    )]
    pub pool_state: Account<'info, PoolState>,

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

    #[account(
        mut,
        token::mint = pool_state.token_mint_0,
        token::authority = config.fee_authority
    )]
    pub recipient_token_0: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = pool_state.token_mint_1,
        token::authority = config.fee_authority
    )]
    pub recipient_token_1: Account<'info, TokenAccount>,

    pub fee_authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn process_collect_protocol_fees(ctx: Context<CollectProtocolFees>) -> Result<()> {
    require!(
        ctx.accounts.fee_authority.key() == ctx.accounts.config.fee_authority,
        ErrorCode::Unauthorized
    );

    let pool = &mut ctx.accounts.pool_state;
    let amount_0 = pool.protocol_fees_0;
    let amount_1 = pool.protocol_fees_1;

    pool.protocol_fees_0 = 0;
    pool.protocol_fees_1 = 0;

    let pool_key = pool.key();
    let authority_seeds: &[&[u8]] = &[
        POOL_AUTHORITY_SEED,
        pool_key.as_ref(),
        &[pool.authority_bump],
    ];

    if amount_0 > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_vault_0.to_account_info(),
                    to: ctx.accounts.recipient_token_0.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                &[authority_seeds],
            ),
            amount_0,
        )?;
    }

    if amount_1 > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_vault_1.to_account_info(),
                    to: ctx.accounts.recipient_token_1.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                &[authority_seeds],
            ),
            amount_1,
        )?;
    }

    Ok(())
}
