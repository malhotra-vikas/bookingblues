import type OpenAI from 'openai';
import { z } from 'zod';

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
        "Returns the operator's free time (busy intervals + business hours) between window_start and window_end so you can offer slots of the operator's visit length (see \"Visit length\" in the operator block). All times — inputs and outputs — are LOCAL wall-clock time in the operator's timezone, format `YYYY-MM-DDTHH:MM`, with NO `Z` and NO offset. Example: `2026-11-03T09:00`. The tool returns slots within the operator's business hours and not already booked.",
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
