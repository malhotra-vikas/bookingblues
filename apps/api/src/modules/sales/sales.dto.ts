import { z } from 'zod';

export const SalesImpersonateSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type SalesImpersonate = z.infer<typeof SalesImpersonateSchema>;

/**
 * A sales rep onboarding a new client on their behalf. Mirrors the fields the
 * public signup collects (business name + mobile) plus the client's email. The
 * lead is auto-tagged to the creating rep. Password + terms are set by the
 * client via the invite email + onboarding, exactly like self-signup.
 */
export const CreateSalesLeadSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  business_name: z.string().trim().min(1).max(200),
  phone_e164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, 'phone must be E.164 (+15551234567)'),
  // The rep sets an initial password so the client can log in right away; the
  // welcome email tells them to change it. Min 8 mirrors the signup form.
  password: z.string().min(8).max(72),
});
export type CreateSalesLead = z.infer<typeof CreateSalesLeadSchema>;
