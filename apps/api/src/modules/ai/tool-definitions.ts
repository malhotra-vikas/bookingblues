import type OpenAI from 'openai';
import { z } from 'zod';

import { collectsIntakeAnswers, isOfficeAppointmentCategory } from './category-profile';

export { SaveIntakeAnswersArgs } from '../appointments/intake-answers';

/**
 * Operator-local wall-clock datetime, `YYYY-MM-DDTHH:MM[:SS]`, no zone. The
 * server converts to UTC in the operator's timezone (calendar/zoned-time.ts)
 * so the model never does DST math. A `Z`/offset the model adds anyway is
 * stripped — the wall-clock digits are what the caller agreed to.
 */
const LocalDateTime = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().replace(/(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})$/, '') : v),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Expected local date-time YYYY-MM-DDTHH:MM'),
);

export const CheckAvailabilityArgs = z.object({
  window_start: LocalDateTime,
  window_end: LocalDateTime,
});
export type CheckAvailabilityArgs = z.infer<typeof CheckAvailabilityArgs>;

export const ProposeSlotsArgs = z.object({
  slots: z.array(z.object({ start: LocalDateTime, end: LocalDateTime })).min(1).max(5),
});
export type ProposeSlotsArgs = z.infer<typeof ProposeSlotsArgs>;

export const CheckServiceAreaArgs = z.object({
  zip: z.string().min(3).max(10),
});
export type CheckServiceAreaArgs = z.infer<typeof CheckServiceAreaArgs>;

export const BookAppointmentArgs = z.object({
  start: LocalDateTime,
  end: LocalDateTime,
  caller_name: z.string().min(1).max(120),
  caller_email: z.string().email().optional(),
  job_summary: z.string().min(1).max(500),
  urgency: z.enum(['low', 'normal', 'high', 'emergency']).default('normal'),
  /**
   * True only for life-safety emergencies (gas/CO smell, sparks/exposed wires,
   * active major flooding, structural collapse). When the operator allows it,
   * such a booking is made WITHOUT taking payment first (tech rushes out, collects
   * on site). Otherwise treated like a normal emergency (charge deposit+emergency fee).
   */
  immediate_danger: z.boolean().optional(),
});
export type BookAppointmentArgs = z.infer<typeof BookAppointmentArgs>;

/** Office categories: move the caller's existing upcoming appointment (never a second booking). */
export const RescheduleAppointmentArgs = z.object({
  appointment_id: z.string().uuid(),
  start: LocalDateTime,
  end: LocalDateTime,
});
export type RescheduleAppointmentArgs = z.infer<typeof RescheduleAppointmentArgs>;

export const RequestPaymentLinkArgs = z.object({
  appointment_id: z.string().uuid(),
});
export type RequestPaymentLinkArgs = z.infer<typeof RequestPaymentLinkArgs>;

export const CollectServiceAddressArgs = z.object({
  address: z.string().min(5).max(300),
});
export type CollectServiceAddressArgs = z.infer<typeof CollectServiceAddressArgs>;

export const MarkOutOfScopeArgs = z.object({
  reason: z.string().min(1).max(300),
});
export type MarkOutOfScopeArgs = z.infer<typeof MarkOutOfScopeArgs>;

export const MarkSpamArgs = z.object({
  reason: z.string().min(1).max(300),
});
export type MarkSpamArgs = z.infer<typeof MarkSpamArgs>;

export const EscalateToHumanArgs = z.object({
  reason: z.string().min(1).max(300),
});
export type EscalateToHumanArgs = z.infer<typeof EscalateToHumanArgs>;

export const TOOL_DEFINITIONS: ReadonlyArray<OpenAI.Chat.Completions.ChatCompletionTool> = [
  {
    type: 'function',
    function: {
      name: 'check_service_area',
      description:
        "Authoritatively check whether a caller's 5-digit ZIP is within the operator's service area (explicit ZIPs + radius zones). ALWAYS call this to decide service area — never guess from a ZIP list. Returns { in_area, configured }. Only call mark_out_of_scope for area reasons when this returns in_area=false.",
      parameters: {
        type: 'object',
        properties: { zip: { type: 'string' } },
        required: ['zip'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description:
        "Returns the operator's free time (busy intervals + business hours) between window_start and window_end so you can offer slots of the operator's visit length (see \"Visit length\" in the operator block). All times — inputs and outputs — are LOCAL wall-clock time in the operator's timezone, format `YYYY-MM-DDTHH:MM`, with NO `Z` and NO offset. Example: `2026-11-03T09:00`. The tool returns slots within the operator's business hours and not already booked. Never offer a start earlier than `earliest_bookable` in the result (minimum notice); booking an earlier time is refused.",
      parameters: {
        type: 'object',
        properties: {
          window_start: { type: 'string', description: 'Local wall-clock time YYYY-MM-DDTHH:MM, no offset' },
          window_end: { type: 'string', description: 'Local wall-clock time YYYY-MM-DDTHH:MM, no offset' },
        },
        required: ['window_start', 'window_end'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_slots',
      description:
        'Format candidate slots into a human-friendly SMS proposal. Use after check_availability to draft an offer to the caller.',
      parameters: {
        type: 'object',
        properties: {
          slots: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            items: {
              type: 'object',
              properties: {
                start: { type: 'string', description: 'Local wall-clock time YYYY-MM-DDTHH:MM, no offset' },
                end: { type: 'string', description: 'Local wall-clock time YYYY-MM-DDTHH:MM, no offset' },
              },
              required: ['start', 'end'],
              additionalProperties: false,
            },
          },
        },
        required: ['slots'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description:
        'Book or hold the appointment for an agreed slot. `start`/`end` are LOCAL wall-clock time in the operator\'s timezone, `YYYY-MM-DDTHH:MM`, no offset. The slot MUST be within the operator\'s business hours (never a closed day or out-of-hours time). If a booking fee applies, this holds the slot and the system automatically texts the caller a secure payment link — the appointment is confirmed only after payment, so do not tell the caller it is confirmed yet. If no fee applies, it confirms immediately and creates the Google Calendar event. Only call after the caller has agreed to a specific slot and provided their name and the job summary. On error "slot_unavailable", propose other open slots instead of retrying.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'Local wall-clock time YYYY-MM-DDTHH:MM, no offset' },
          end: { type: 'string', description: 'Local wall-clock time YYYY-MM-DDTHH:MM, no offset' },
          caller_name: { type: 'string' },
          caller_email: { type: 'string', format: 'email' },
          job_summary: { type: 'string' },
          urgency: { type: 'string', enum: ['low', 'normal', 'high', 'emergency'] },
          immediate_danger: { type: 'boolean' },
        },
        required: ['start', 'end', 'caller_name', 'job_summary'],
        additionalProperties: false,
      },
    },
  },
  // NOTE: `request_payment_link` is intentionally NOT exposed to the model.
  // book_appointment now reserves the slot AND sends the payment link itself
  // (Reserve→Pay→Confirm), so a separate model-driven tool would double-send.
  // The handler + schema are retained for the manual/legacy path.
  {
    type: 'function',
    function: {
      name: 'collect_service_address',
      description:
        "Save the caller's full property/service address AFTER the booking is confirmed and add it to the calendar event so the tech can find the job. Call this only once the appointment is confirmed and the caller has given a complete street address (street + unit if any + city + ZIP). Ends the conversation.",
      parameters: {
        type: 'object',
        properties: { address: { type: 'string' } },
        required: ['address'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_out_of_scope',
      description:
        "Used when the caller's request falls outside the operator's trade category. Sends a polite handoff and ends the conversation.",
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_spam',
      description:
        'Used when the inbound traffic is spam or abuse. Silently ends the conversation without further messages.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalate_to_human',
      description:
        "Hand off to the operator. Use when the caller asks for a human, when you've made multiple failed attempts, or when the situation is sensitive.",
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  },
];

const SAVE_INTAKE_ANSWERS_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'save_intake_answers',
    description:
      "Save the caller's intake answers so they're attached to their appointment for the agent. Call it RIGHT AFTER the caller gives a date of birth (with first_name and date_of_birth) so the date is checked before you ask anything else; call it again with the other answers, and whenever the caller corrects something (send just the changed fields, earlier answers are kept). Must be done BEFORE booking. If the result has an error or a dob_check, deal with it before your next question. Record ONLY what the caller actually said: never guess, complete or reword a value, and leave a field out if it wasn't given. If the appointment is for someone else (e.g. a parent), the name, date of birth, doctor and prescriptions are THAT person's. Never include a Medicare number (MBI), SSN, or payment details.",
    parameters: {
      type: 'object',
      properties: {
        first_name: { type: 'string' },
        last_name: {
          type: 'string',
          description:
            "Only if the caller gave it. Omit — never invent — if they gave just a first name or an initial. When booking for someone else, never reuse the caller's own last name for them.",
        },
        date_of_birth: {
          type: 'string',
          description:
            'Exactly as precise as the caller said it: YYYY-MM-DD for a full date, YYYY-MM for month and year, YYYY for year only. NEVER fill in a month or day the caller did not say.',
        },
        date_of_birth_declined: {
          type: 'boolean',
          description: 'True if the caller preferred not to give their date of birth.',
        },
        date_of_birth_confirmed: {
          type: 'boolean',
          description: 'True once the caller has confirmed a date of birth you were asked to double-check (dob_check).',
        },
        about_medicare: {
          type: 'boolean',
          description: 'True if the caller wants to talk about Medicare (Advantage, Supplement, Part D, turning 65).',
        },
        for_someone_else: {
          type: 'boolean',
          description: 'True if the appointment is for someone other than the person texting (e.g. their mother).',
        },
        caller_relationship: {
          type: 'string',
          description: 'When for_someone_else: how the caller is related, in their words ("daughter", "son", "spouse").',
        },
        caller_name: {
          type: 'string',
          description: "When for_someone_else: the caller's own name, if given.",
        },
        doctor: {
          type: 'string',
          description: 'Current doctor or doctor\'s office as the caller said it. "None" if they have none. Omit if not given.',
        },
        doctor_declined: {
          type: 'boolean',
          description: 'True if the caller preferred not to name their doctor.',
        },
        prescriptions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Each prescription in the caller\'s own words (name, and strength if given). If they only named what it is for, record that as said, e.g. "for high blood pressure" — never invent a drug name. Empty if none or declined.',
        },
        prescriptions_declined: {
          type: 'boolean',
          description: 'True if the caller preferred not to share their prescriptions.',
        },
      },
      required: ['first_name'],
      additionalProperties: false,
    },
  },
};

const RESCHEDULE_APPOINTMENT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'reschedule_appointment',
    description:
      "Move the caller's EXISTING upcoming appointment (listed under UPCOMING APPOINTMENTS in the prompt) to a new agreed slot. Use this — never book_appointment — whenever the caller wants to change the day or time of an appointment they already have. The same appointment is moved (no duplicate), the operator's calendar updates and the caller is texted the new time. Check availability first. `start`/`end` are LOCAL wall-clock time in the operator's timezone, `YYYY-MM-DDTHH:MM`, no offset, within business hours. On error \"slot_unavailable\", propose other open slots.",
    parameters: {
      type: 'object',
      properties: {
        appointment_id: { type: 'string', description: 'id of the appointment to move, from UPCOMING APPOINTMENTS' },
        start: { type: 'string', description: 'New start, local YYYY-MM-DDTHH:MM' },
        end: { type: 'string', description: 'New end, local YYYY-MM-DDTHH:MM' },
      },
      required: ['appointment_id', 'start', 'end'],
      additionalProperties: false,
    },
  },
};

/** Field-visit-only tools that office-appointment categories never get. */
const FIELD_ONLY_TOOLS: ReadonlySet<string> = new Set(['check_service_area', 'collect_service_address']);

/**
 * The tool list for an operator's category. Trades get TOOL_DEFINITIONS
 * unchanged. Office-appointment categories (Insurance Agencies) drop the
 * address/service-area tools and the emergency fields on book_appointment, and
 * intake categories add `save_intake_answers`.
 */
export function toolDefinitionsFor(
  category: string | null | undefined,
): ReadonlyArray<OpenAI.Chat.Completions.ChatCompletionTool> {
  if (!isOfficeAppointmentCategory(category)) return [...TOOL_DEFINITIONS, RESCHEDULE_APPOINTMENT_TOOL];
  const tools = TOOL_DEFINITIONS.filter(
    (t) => t.type !== 'function' || !FIELD_ONLY_TOOLS.has(t.function.name),
  ).map((t) => {
    if (t.type !== 'function' || t.function.name !== 'book_appointment') return t;
    const params = t.function.parameters as { properties: Record<string, unknown> };
    const properties = Object.fromEntries(
      Object.entries(params.properties).filter(([k]) => k !== 'urgency' && k !== 'immediate_danger'),
    );
    return {
      ...t,
      function: {
        ...t.function,
        description:
          "Book the appointment for an agreed slot. `start`/`end` are LOCAL wall-clock time in the operator's timezone, `YYYY-MM-DDTHH:MM`, no offset, within business hours. Confirms immediately, adds it to the operator's calendar, texts the caller a confirmation and ends the conversation. job_summary must be short and generic (topic only). On error \"slot_unavailable\", propose other open slots instead of retrying.",
        parameters: { ...params, properties },
      },
    };
  });
  const withReschedule = [...tools, RESCHEDULE_APPOINTMENT_TOOL];
  return collectsIntakeAnswers(category) ? [SAVE_INTAKE_ANSWERS_TOOL, ...withReschedule] : withReschedule;
}
