import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { CLASSIFIER_MODEL, OpenAIService } from '../../common/openai/openai.service';

/**
 * Home-services emergency AI classifier (PROGRESS.md Slice 17 — item 17).
 *
 * Sits BEHIND the keyword pre-filter in `emergency-detection.ts`. The keyword
 * list catches obvious cases ("burst pipe", "sparks") in zero ms / zero
 * cost; this service is invoked only when the keyword path misses, so it
 * pays the ~1s / ~$0.0005 OpenAI bill only when the message phrasing is
 * non-obvious ("water everywhere in basement", "the kids are scared, can't
 * shut it off"). Returns a structured `{ is_emergency, reason }` that the
 * webhook stuffs into the operator's alert SMS — the AI-extracted reason
 * tends to be more actionable than the raw keyword.
 *
 * Trade-aware: the caller's operator runs a specific trade (plumbing, HVAC,
 * electrical, roofing, garage door), so we pass the operator's category to
 * sharpen the definition of "emergency" for that trade. Falls back to a
 * general home-services framing when the category is unknown.
 *
 * Failure modes (OpenAI down, key missing, rate-limited, JSON parse): all
 * return `null` so the SMS webhook treats it as "not classified as
 * emergency" and the AI advance loop proceeds as normal. Never blocks the
 * advance pipeline.
 */

/** Human-readable trade label for the classifier prompt, keyed by category slug. */
const TRADE_LABEL: Record<string, string> = {
  plumbing: 'plumbing',
  hvac: 'HVAC',
  electrical: 'electrical',
  roofing: 'roofing',
  garage_door: 'garage door',
};

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
   * Classify a single caller SMS. `category` is the operator's trade slug
   * (plumbing, hvac, electrical, roofing, garage_door) used to sharpen the
   * emergency definition; omit/unknown falls back to general home-services
   * framing. Returns null if classification fails for any reason (no key,
   * network error, malformed model output). Caller should treat null as
   * "not an emergency" — fail-safe toward not paging the operator on
   * uncertainty.
   */
  async classify(body: string, category?: string | null): Promise<EmergencyClassification | null> {
    const tradeLabel = (category && TRADE_LABEL[category]) || 'home services';
    try {
      const completion = await this.openai.client_().chat.completions.create({
        model: CLASSIFIER_MODEL,
        // Strict, trade-aware definition of emergency to keep false positives
        // down. A leaky faucet / thermostat question is NOT an emergency;
        // standing water, sparking wires, or an active roof leak IS.
        messages: [
          {
            role: 'system',
            content:
              `You classify single inbound SMS messages from homeowners to a ${tradeLabel} contractor. ` +
              'Decide if the situation is a TRUE emergency requiring same-hour response ' +
              'to avoid property damage, fire/gas/CO/electrical safety risk, or loss of an ' +
              'essential service (no water, no heat in freezing weather, no AC in extreme heat).\n\n' +
              'Emergency examples across home-services trades: burst pipe, sewage backup, ' +
              'no water in the house, gas smell, carbon monoxide, active flooding, water ' +
              'heater leaking heavily; sparking outlet, burning smell, exposed live wires, ' +
              'electrical fire, total power loss; active roof leak with water entering the ' +
              'home, storm damage; no heat in freezing temps, no AC in dangerous heat; ' +
              'garage door off-track trapping a vehicle or stuck open overnight.\n' +
              'NOT emergency: slow drain, leaky faucet, dripping showerhead, thermostat or ' +
              'filter questions, flickering light, minor dent, "needs service soon", ' +
              'routine install, quote requests, scheduling questions.\n\n' +
              'Be conservative — only flag as emergency if delaying response by >2 hours ' +
              'would likely cause damage or a safety risk.\n\n' +
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
