import { z } from 'zod';

export const PlanSchema = z.enum(['solo', 'crew', 'fleet']);
export type Plan = z.infer<typeof PlanSchema>;

export const CadenceSchema = z.enum(['monthly', 'annual']);
export type Cadence = z.infer<typeof CadenceSchema>;

export const CreateCheckoutSessionSchema = z
  .object({
    plan: PlanSchema,
    cadence: CadenceSchema.default('monthly'),
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
