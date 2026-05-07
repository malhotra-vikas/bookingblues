import { z } from 'zod';

export const ProvisionNumberSchema = z
  .object({
    area_code: z.string().regex(/^\d{3}$/, 'area_code must be a 3-digit US area code').optional(),
  })
  .strict();
export type ProvisionNumber = z.infer<typeof ProvisionNumberSchema>;

export interface ProvisionNumberResponse {
  readonly phone_number_e164: string;
  readonly twilio_sid: string;
}
