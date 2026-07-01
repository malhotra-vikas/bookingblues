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
    emergency_visit_fee_cents: z.number().int().min(0).optional().nullable(),
    allow_unpaid_emergency_booking: z.boolean().optional(),
    visit_duration_min: z.number().int().min(15).max(480).optional(),
    service_zip_codes: z
      .array(z.string().regex(/^\d{5}$/, 'must be a 5-digit US ZIP code'))
      .max(500, 'too many ZIPs — set a smaller list (or contact support if you really cover that many)')
      .optional(),
    service_radius_zones: z
      .array(
        z
          .object({
            center_zip: z.string().regex(/^\d{5}$/, 'center_zip must be a 5-digit US ZIP'),
            radius_miles: z.number().int().min(1).max(500),
          })
          .strict(),
      )
      .max(20, 'too many radius zones — combine or simplify')
      .optional(),
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

export const AcceptTermsSchema = z
  .object({
    // The version string the client displayed and the user accepted. The
    // acceptance timestamp is set server-side, not trusted from the client.
    version: z.string().min(1).max(40),
  })
  .strict();
export type AcceptTerms = z.infer<typeof AcceptTermsSchema>;
