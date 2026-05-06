import { z } from 'zod';

export const UpdateMeSchema = z
  .object({
    email: z.string().email().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'No fields provided');

export type UpdateMe = z.infer<typeof UpdateMeSchema>;

export interface MeResponse {
  readonly id: string;
  readonly email: string | null;
  readonly created_at: string;
}
