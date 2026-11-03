use anchor_lang::prelude::*;

declare_id!("GuJFxNNmNpeVw1QrhJZ61MFPkiebKY3vVgtazHTWUsq7");

#[program]
pub mod placeholder {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("OmniFi placeholder program initialized successfully");
        let _ = ctx;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
