import { z } from 'zod';

// ── Promote / demote admins ──────────────────────────────────────────────────
export const PromoteAdminSchema = z.object({
  user_email: z.string().email(),
});
export type PromoteAdmin = z.infer<typeof PromoteAdminSchema>;

// ── Promote / demote sales reps (#4) ─────────────────────────────────────────
// Promote a user to role='sales' AND link their Slack identity in one step, so
// their existing #bb-leads claims (lead_claims.claimed_by_slack_user_id) resolve
// to this BB account for scoped impersonation.
export const PromoteSalesSchema = z.object({
  user_email: z.string().email(),
  slack_user_id: z.string().trim().min(1).max(64),
  slack_username: z.string().trim().max(120).optional(),
});
export type PromoteSales = z.infer<typeof PromoteSalesSchema>;

// Release specific claimed leads from a sales rep back to the #bb-leads pool
// (#4). Selective: pass the lead user-ids to release (one / several / all). This
// is independent of demotion — releasing leads does NOT remove the sales role,
// and demoting does NOT release leads.
export const ReleaseSalesLeadsSchema = z.object({
  lead_user_ids: z.array(z.string().uuid()).min(1).max(500),
});
export type ReleaseSalesLeads = z.infer<typeof ReleaseSalesLeadsSchema>;

// ── Operator-list filters ────────────────────────────────────────────────────
export const ListOperatorsQuerySchema = z.object({
  cursor: z.string().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  status: z
    .enum(['trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired'])
    .optional(),
  has_twilio: z.coerce.boolean().optional(),
  has_calendar: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListOperatorsQuery = z.infer<typeof ListOperatorsQuerySchema>;

// ── Write-action bodies ─────────────────────────────────────────────────────
export const DeactivateOperatorSchema = z.object({
  reason: z.string().min(1).max(500),
  immediate: z.boolean().default(false),
});
export type DeactivateOperator = z.infer<typeof DeactivateOperatorSchema>;

export const RefundPaymentSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type RefundPayment = z.infer<typeof RefundPaymentSchema>;

export const CancelSubscriptionSchema = z.object({
  reason: z.string().min(1).max(500),
  immediate: z.boolean().default(false),
});
export type CancelSubscription = z.infer<typeof CancelSubscriptionSchema>;

export const MarkEmailVerifiedSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type MarkEmailVerified = z.infer<typeof MarkEmailVerifiedSchema>;

export const ForceEndConversationSchema = z.object({
  outcome: z
    .enum(['rejected', 'out_of_scope', 'spam', 'no_show_intent', 'timeout'])
    .default('rejected'),
  reason: z.string().min(1).max(500),
});
export type ForceEndConversation = z.infer<typeof ForceEndConversationSchema>;

export const ImpersonateSchema = z.object({
  reason: z.string().min(1).max(500),
  ttl_seconds: z.coerce.number().int().min(60).max(60 * 60).default(15 * 60),
});
export type Impersonate = z.infer<typeof ImpersonateSchema>;
