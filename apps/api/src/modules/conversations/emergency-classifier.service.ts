import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { CLASSIFIER_MODEL, OpenAIService } from '../../common/openai/openai.service';

/**
 * Plumbing-emergency AI classifier (PROGRESS.md Slice 17 — item 17).
 *
 * Sits BEHIND the keyword pre-filter in `emergency-detection.ts`. The keyword
 * list catches obvious cases ("burst pipe", "gas smell") in zero ms / zero
 * cost; this service is invoked only when the keyword path misses, so it
 * pays the ~1s / ~$0.0005 OpenAI bill only when the message phrasing is
 * non-obvious ("water everywhere in basement", "the kids are scared, can't
 * shut it off"). Returns a structured `{ is_emergency, reason }` that the
 * webhook stuffs into the plumber's alert SMS — the AI-extracted reason
 * tends to be more actionable than the raw keyword.
 *
 * Failure modes (OpenAI down, key missing, rate-limited, JSON parse): all
 * return `null` so the SMS webhook treats it as "not classified as
 * emergency" and the AI advance loop proceeds as normal. Never blocks the
 * advance pipeline.
 */

const ClassificationResponse = z.object({
  is_emergency: z.boolean(),
  // <= 12 words. Used as the body of the plumber's alert SMS.
  reason: z.string().max(200),
});

export interface EmergencyClassification {
  readonly is_emergency: boolean;
  readonly reason: string;
}

@Injectable()
export class EmergencyClassifierService {
  constructor(
    private readonly openai: OpenAIService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EmergencyClassifierService.name);
  }

  /**
   * Classify a single caller SMS. Returns null if classification fails for
   * any reason (no key, network error, malformed model output). Caller
   * should treat null as "not an emergency" — fail-safe toward not paging
   * the plumber on uncertainty.
   */
  async classify(body: string): Promise<EmergencyClassification | null> {
    try {
      const completion = await this.openai.client_().chat.completions.create({
        model: CLASSIFIER_MODEL,
        // Strict, plumber-specific definition of emergency to keep false
        // positives down. A leaky faucet is NOT an emergency; standing
        // water in a basement IS.
        messages: [
          {
            role: 'system',
            content:
              'You classify single inbound SMS messages from homeowners to a plumber. ' +
              'Decide if the situation is a TRUE emergency requiring same-hour response ' +
              'to avoid water/property damage, gas/CO safety risk, or loss of essential ' +
              'service (no water at all in the home).\n\n' +
              'Emergency examples: burst pipe, sewage backup, no water in the house, ' +
              'gas smell, carbon monoxide, active flooding, water heater leaking heavily, ' +
              'main line break.\n' +
              'NOT emergency: slow drain, leaky faucet, dripping showerhead, "needs ' +
              'service soon", routine install, quote requests, scheduling questions.\n\n' +
              'Be conservative — only flag as emergency if delaying response by >2 hours ' +
              'would likely cause damage or safety risk.\n\n' +
              'Respond with valid JSON: ' +
              '{"is_emergency": boolean, "reason": "<=12 words describing the issue if emergency, ' +
              'empty string otherwise"}',
          },
          { role: 'user', content: body },
        ],
        response_format: { type: 'json_object' },
        // Bound latency so we never block the alert pipeline materially.
        // gpt-4.1-mini normally responds in <1s; 5s is a hard ceiling.
        // (Note: OpenAI SDK timeout is per-request via constructor; for
        // per-call we rely on the model's natural latency profile.)
      });

      const raw = completion.choices[0]?.message?.content ?? '';
      if (!raw) return null;
      const parsed = ClassificationResponse.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        this.logger.warn(
          { issues: parsed.error.issues, raw: raw.slice(0, 200) },
          'emergency classifier returned malformed JSON',
        );
        return null;
      }
      return parsed.data;
    } catch (err) {
      // OpenAI down / rate-limited / missing key — log and return null so
      // the SMS webhook treats this as "no emergency detected". Keyword
      // path remains the floor of detection coverage.
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'emergency classifier call failed (non-fatal — caller still gets AI reply)',
      );
      return null;
    }
  }
}
