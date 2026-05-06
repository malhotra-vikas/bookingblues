import { z } from 'zod';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const Interval = z
  .object({
    start: z.string().regex(HHMM, 'start must be HH:MM (24h)'),
    end: z.string().regex(HHMM, 'end must be HH:MM (24h)'),
  })
  .refine((i) => i.start < i.end, { message: 'start must be before end' });

const DayKey = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

export const BusinessHoursSchema = z.record(DayKey, z.array(Interval));
export type BusinessHours = z.infer<typeof BusinessHoursSchema>;

function isIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const UpdateOperatorSchema = z
  .object({
    business_name: z.string().min(1).max(200).optional(),
    category: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, 'category must be lowercase snake_case slug')
      .optional(),
    timezone: z.string().refine(isIanaTimezone, 'timezone must be a valid IANA name').optional(),
    business_hours: BusinessHoursSchema.optional(),
    booking_fee_enabled: z.boolean().optional(),
    booking_fee_cents: z.number().int().min(0).optional().nullable(),
  })
  .strict()
  .refine(
    (b) => !(b.booking_fee_enabled === true && b.booking_fee_cents == null),
    {
      message: 'booking_fee_cents is required when booking_fee_enabled is true',
      path: ['booking_fee_cents'],
    },
  );

export type UpdateOperator = z.infer<typeof UpdateOperatorSchema>;
