use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("HZ1EBuiSJeW2MRS8pvD7r5fTJoCRPgWDyE9Ei2EnPZ5b");

const BPS_DENOM: u64 = 10_000;
const MAX_DISCOUNT_BPS: u16 = 5_000;

#[program]
pub mod flowproof {
    use super::*;

    pub fn create_proof(
        ctx: Context<CreateProof>,
        invoice_hash: [u8; 32],
        amount: u64,
        discount_bps: u16,
        risk_score: u8,
        due_at: i64,
    ) -> Result<()> {
        require!(amount > 0, FlowError::InvalidAmount);
        require!(discount_bps <= MAX_DISCOUNT_BPS, FlowError::InvalidDiscount);
        require!(risk_score <= 100, FlowError::InvalidRisk);

        let now = Clock::get()?.unix_timestamp;
        require!(due_at > now, FlowError::InvalidDueDate);

        let advance = amount
            .checked_mul(BPS_DENOM - discount_bps as u64)
            .ok_or(FlowError::MathOverflow)?
            / BPS_DENOM;
        require!(advance > 0, FlowError::InvalidAmount);

        let proof = &mut ctx.accounts.proof;
        proof.issuer = ctx.accounts.issuer.key();
        proof.payer = ctx.accounts.payer.key();
        proof.mint = ctx.accounts.mint.key();
        proof.investor = Pubkey::default();
        proof.invoice_hash = invoice_hash;
        proof.amount = amount;
        proof.advance = advance;
        proof.discount_bps = discount_bps;
        proof.risk_score = risk_score;
        proof.status = ProofStatus::Open;
        proof.created_at = now;
        proof.due_at = due_at;
        proof.funded_at = 0;
        proof.paid_at = 0;
        proof.bump = ctx.bumps.proof;

        Ok(())
    }

    pub fn fund(ctx: Context<Fund>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let proof = &mut ctx.accounts.proof;

        require!(proof.status == ProofStatus::Open, FlowError::NotOpen);
        require!(now < proof.due_at, FlowError::Expired);
        require_keys_neq!(ctx.accounts.investor.key(), proof.issuer, FlowError::SelfFunding);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.investor_token.to_account_info(),
                    to: ctx.accounts.issuer_token.to_account_info(),
                    authority: ctx.accounts.investor.to_account_info(),
                },
            ),
            proof.advance,
        )?;

        proof.investor = ctx.accounts.investor.key();
        proof.status = ProofStatus::Financed;
        proof.funded_at = now;

        Ok(())
    }

    pub fn pay(ctx: Context<Pay>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let proof = &mut ctx.accounts.proof;

        require!(
            proof.status == ProofStatus::Open || proof.status == ProofStatus::Financed,
            FlowError::NotPayable
        );
        require_keys_eq!(ctx.accounts.payer.key(), proof.payer, FlowError::WrongPayer);

        let holder = if proof.status == ProofStatus::Financed {
            proof.investor
        } else {
            proof.issuer
        };
        require_keys_eq!(ctx.accounts.recipient_token.owner, holder, FlowError::WrongRecipient);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer_token.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            proof.amount,
        )?;

        proof.status = ProofStatus::Paid;
        proof.paid_at = now;

        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let proof = &mut ctx.accounts.proof;
        require!(proof.status == ProofStatus::Open, FlowError::NotOpen);
        proof.status = ProofStatus::Cancelled;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Proof {
    pub issuer: Pubkey,
    pub payer: Pubkey,
    pub mint: Pubkey,
    pub investor: Pubkey,
    pub invoice_hash: [u8; 32],
    pub amount: u64,
    pub advance: u64,
    pub discount_bps: u16,
    pub risk_score: u8,
    pub status: ProofStatus,
    pub created_at: i64,
    pub due_at: i64,
    pub funded_at: i64,
    pub paid_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ProofStatus {
    Open,
    Financed,
    Paid,
    Cancelled,
}

#[derive(Accounts)]
#[instruction(invoice_hash: [u8; 32])]
pub struct CreateProof<'info> {
    #[account(
        init,
        payer = issuer,
        space = 8 + Proof::INIT_SPACE,
        seeds = [b"proof", issuer.key().as_ref(), invoice_hash.as_ref()],
        bump
    )]
    pub proof: Account<'info, Proof>,
    #[account(mut)]
    pub issuer: Signer<'info>,
    /// CHECK: stored only as the wallet allowed to pay this invoice
    pub payer: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(
        mut,
        seeds = [b"proof", proof.issuer.as_ref(), proof.invoice_hash.as_ref()],
        bump = proof.bump
    )]
    pub proof: Account<'info, Proof>,
    pub investor: Signer<'info>,
    #[account(mut, token::mint = proof.mint, token::authority = investor)]
    pub investor_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = proof.mint, token::authority = proof.issuer)]
    pub issuer_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Pay<'info> {
    #[account(
        mut,
        seeds = [b"proof", proof.issuer.as_ref(), proof.invoice_hash.as_ref()],
        bump = proof.bump
    )]
    pub proof: Account<'info, Proof>,
    pub payer: Signer<'info>,
    #[account(mut, token::mint = proof.mint, token::authority = payer)]
    pub payer_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = proof.mint)]
    pub recipient_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(
        mut,
        has_one = issuer,
        seeds = [b"proof", proof.issuer.as_ref(), proof.invoice_hash.as_ref()],
        bump = proof.bump
    )]
    pub proof: Account<'info, Proof>,
    pub issuer: Signer<'info>,
}

#[error_code]
pub enum FlowError {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Discount is above the allowed maximum")]
    InvalidDiscount,
    #[msg("Risk score must be between 0 and 100")]
    InvalidRisk,
    #[msg("Due date must be in the future")]
    InvalidDueDate,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Proof is not open for financing")]
    NotOpen,
    #[msg("Proof has expired")]
    Expired,
    #[msg("Issuer cannot fund their own invoice")]
    SelfFunding,
    #[msg("Proof cannot be paid in its current state")]
    NotPayable,
    #[msg("Only the designated payer can pay this invoice")]
    WrongPayer,
    #[msg("Recipient token account does not belong to the current holder")]
    WrongRecipient,
}
