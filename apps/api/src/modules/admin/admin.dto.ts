import { z } from 'zod';

// ── Promote / demote admins ──────────────────────────────────────────────────
export const PromoteAdminSchema = z.object({
  user_email: z.string().email(),
});
export type PromoteAdmin = z.infer<typeof PromoteAdminSchema>;

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
