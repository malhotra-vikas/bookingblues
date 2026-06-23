import { z } from 'zod';

export const ProvisionNumberSchema = z
  .object({
    area_code: z.string().regex(/^\d{3}$/, 'area_code must be a 3-digit US area code').optional(),
    // Operator-picked candidate from GET /candidates. If absent, server
    // auto-picks the first vanity hit (or plain area-code match).
    phone_number_e164: z.string().regex(/^\+[1-9]\d{6,15}$/).optional(),
    // Provision a toll-free number instead of a local one. Toll-free uses a
    // separate (often faster) Twilio verification path — useful as a parallel
    // A2P 10DLC unblock. Ignores area_code / vanity (toll-free has neither).
    toll_free: z.boolean().optional(),
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
