import { z } from 'zod';

export const ProvisionNumberSchema = z
  .object({
    area_code: z.string().regex(/^\d{3}$/, 'area_code must be a 3-digit US area code').optional(),
    // Operator-picked candidate from GET /candidates. If absent, server
    // auto-picks the first vanity hit (or plain area-code match).
    phone_number_e164: z.string().regex(/^\+[1-9]\d{6,15}$/).optional(),
  })
  .strict();
export type ProvisionNumber = z.infer<typeof ProvisionNumberSchema>;

export interface ProvisionNumberResponse {
  readonly phone_number_e164: string;
  readonly twilio_sid: string;
}

export const CandidatesQuerySchema = z
  .object({
    area_code: z.string().regex(/^\d{3}$/).optional(),
    limit: z.coerce.number().int().min(1).max(8).optional(),
  })
  .strict();
export type CandidatesQuery = z.infer<typeof CandidatesQuerySchema>;

export interface CandidateNumber {
  readonly phone_number_e164: string;
  readonly friendly_name: string;
  /** Slug that produced this hit (e.g. "ZEUS"), or null if no vanity match. */
  readonly vanity_match: string | null;
  readonly locality: string | null;
  readonly region: string | null;
}

export interface CandidatesResponse {
  readonly candidates: ReadonlyArray<CandidateNumber>;
}
