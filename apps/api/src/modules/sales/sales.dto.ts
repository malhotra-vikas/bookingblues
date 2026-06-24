import { z } from 'zod';

export const SalesImpersonateSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type SalesImpersonate = z.infer<typeof SalesImpersonateSchema>;
