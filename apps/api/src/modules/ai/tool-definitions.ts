import type OpenAI from 'openai';
import { z } from 'zod';

const IsoDateTime = z.string().datetime({ offset: true });

export const CheckAvailabilityArgs = z.object({
  window_start: IsoDateTime,
  window_end: IsoDateTime,
});
export type CheckAvailabilityArgs = z.infer<typeof CheckAvailabilityArgs>;

export const ProposeSlotsArgs = z.object({
  slots: z.array(z.object({ start: IsoDateTime, end: IsoDateTime })).min(1).max(5),
});
export type ProposeSlotsArgs = z.infer<typeof ProposeSlotsArgs>;

export const BookAppointmentArgs = z.object({
  start: IsoDateTime,
  end: IsoDateTime,
  caller_name: z.string().min(1).max(120),
  caller_email: z.string().email().optional(),
  job_summary: z.string().min(1).max(500),
  urgency: z.enum(['low', 'normal', 'high', 'emergency']).default('normal'),
});
export type BookAppointmentArgs = z.infer<typeof BookAppointmentArgs>;

export const RequestPaymentLinkArgs = z.object({
  appointment_id: z.string().uuid(),
});
export type RequestPaymentLinkArgs = z.infer<typeof RequestPaymentLinkArgs>;

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
      name: 'check_availability',
      description:
        "Returns the operator's free 60-minute slots between window_start and window_end (ISO 8601 with offset). Use the operator's timezone implicitly; the tool returns slots that are within the operator's business hours and not already booked.",
      parameters: {
        type: 'object',
        properties: {
          window_start: { type: 'string', format: 'date-time' },
          window_end: { type: 'string', format: 'date-time' },
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
                start: { type: 'string', format: 'date-time' },
                end: { type: 'string', format: 'date-time' },
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
        'Create the appointment and the corresponding Google Calendar event. Only call after the caller has agreed to a specific slot and provided their name and the job summary.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', format: 'date-time' },
          end: { type: 'string', format: 'date-time' },
          caller_name: { type: 'string' },
          caller_email: { type: 'string', format: 'email' },
          job_summary: { type: 'string' },
          urgency: { type: 'string', enum: ['low', 'normal', 'high', 'emergency'] },
        },
        required: ['start', 'end', 'caller_name', 'job_summary'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_payment_link',
      description:
        'Generate the secure Stripe Connect Checkout link for the booking fee and send it to the caller. Only call after book_appointment has succeeded.',
      parameters: {
        type: 'object',
        properties: { appointment_id: { type: 'string', format: 'uuid' } },
        required: ['appointment_id'],
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
