import { toolDefinitionsFor } from '../ai/tool-definitions';

/** OpenAI Realtime tool shape: flat, unlike Chat Completions' `{ function: {...} }`. */
export interface RealtimeTool {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
}

/** Voice-only tools, handled by the bridge itself rather than AdvanceService. */
export const VOICE_ONLY_TOOLS: readonly RealtimeTool[] = [
  {
    type: 'function',
    name: 'record_sms_consent',
    description:
      'Call when the caller says yes to receiving texts (confirmation, payment link) at the number they are calling from.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'end_call',
    description:
      'Hang up after your goodbye has been spoken. Call it when the caller is done or wants to end the call.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/**
 * The same booking tools the SMS bot has (same names, same zod validation on
 * dispatch), converted to the Realtime shape, plus the voice-only tools.
 * `propose_slots` is dropped: it formats slots for a text message.
 */
export function realtimeToolsFor(category: string | null | undefined): RealtimeTool[] {
  const shared: RealtimeTool[] = [];
  for (const t of toolDefinitionsFor(category)) {
    if (t.type !== 'function') continue;
    if (t.function.name === 'propose_slots') continue;
    shared.push({
      type: 'function',
      name: t.function.name,
      description: t.function.description ?? '',
      parameters: t.function.parameters ?? { type: 'object', properties: {} },
    });
  }
  return [...shared, ...VOICE_ONLY_TOOLS];
}
