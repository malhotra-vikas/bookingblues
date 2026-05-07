import { z } from 'zod';

export const PlanSchema = z.enum(['starter', 'pro']);
export type Plan = z.infer<typeof PlanSchema>;

export const CreateCheckoutSessionSchema = z
  .object({
    plan: PlanSchema,
    business_name: z.string().min(1).max(200).optional(),
  })
  .strict();
export type CreateCheckoutSession = z.infer<typeof CreateCheckoutSessionSchema>;

export interface CheckoutSessionResponse {
  readonly url: string;
}

export interface PortalSessionResponse {
  readonly url: string;
}
