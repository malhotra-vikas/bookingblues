import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { EmailService } from '../../common/email/email.service';
import { ValidationError } from '../../common/errors/app-error';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * One selected option. `code` is the canonical letter (A–G) and is validated
 * against the question's allowed letters below; `label` is the human wording
 * the respondent actually saw, rendered client-side.
 *
 * Why trust the client for the label: the questionnaire wording lives in the
 * web page (apps/web/components/survey/MissedCallsSurvey.tsx). Mirroring all
 * ~30 option strings here would drift silently the first time someone reworded
 * a question — the email would then report wording nobody was shown. So the
 * code is the contract (strictly validated, unforgeable set) and the label
 * rides along as capped, HTML-escaped display text. Worst case a scripted POST
 * puts junk wording in one throttled email to the survey inbox; the code is
 * printed alongside every label so a mismatch is obvious.
 */
const AnswerSchema = z
  .object({
    code: z.string().trim().regex(/^[A-G]$/, 'code must be a single letter A–G'),
    label: z.string().trim().min(1).max(200),
  })
  .strict();
type Answer = z.infer<typeof AnswerSchema>;

/** Letters each question actually offers, so a valid-shaped answer to the wrong question is rejected. */
const ALLOWED_CODES: Readonly<Record<string, ReadonlyArray<string>>> = {
  q1: ['A', 'B', 'C', 'D', 'E'],
  q2: ['A', 'B', 'C', 'D', 'E'],
  q3: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  q4: ['A', 'B', 'C', 'D', 'E', 'F'],
  q5: ['A', 'B', 'C', 'D'],
  q6: ['A', 'B', 'C', 'D', 'E'],
};

/** Question prompts, for the email body. These are the API's own copy of the headline text. */
const QUESTION_TITLES: Readonly<Record<string, string>> = {
  q1: 'Missed calls lost to voicemail / no answer in a typical week',
  q2: 'What happens to most of those missed calls today',
  q3: 'Most valuable features (top 3)',
  q4: 'Software currently used to run the business',
  q5: 'Is integration with current software a dealbreaker',
  q6: 'Monthly price if it converted 2–3 more jobs a month',
};

const oneOf = (q: keyof typeof ALLOWED_CODES) =>
  AnswerSchema.refine((a) => ALLOWED_CODES[q]!.includes(a.code), {
    message: `code must be one of ${ALLOWED_CODES[q]!.join(', ')}`,
  });

export const SubmitSurveySchema = z
  .object({
    q1: oneOf('q1'),
    q2: oneOf('q2'),
    // "Pick your top 3" — at least one, never more than three, no repeats.
    q3: z
      .array(AnswerSchema)
      .min(1)
      .max(3)
      .refine((arr) => arr.every((a) => ALLOWED_CODES.q3!.includes(a.code)), {
        message: `codes must be within ${ALLOWED_CODES.q3!.join(', ')}`,
      })
      .refine((arr) => new Set(arr.map((a) => a.code)).size === arr.length, {
        message: 'duplicate selections',
      }),
    q4: oneOf('q4'),
    q5: oneOf('q5'),
    q6: oneOf('q6'),

    // Contact block — all optional. The emailed link may prefill these via
    // query params, but an anonymous response is still worth collecting.
    full_name: z.string().trim().max(120).optional(),
    email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
    business_name: z.string().trim().max(160).optional(),
    phone: z.string().trim().max(30).optional(),
    comments: z.string().trim().max(2000).optional(),

    /** Campaign/source tag from the lead email link (?src=…), for attribution. */
    source: z.string().trim().max(60).optional(),
  })
  .strict();
type SubmitSurvey = z.infer<typeof SubmitSurveySchema>;

/**
 * Public missed-calls questionnaire, served at missedcalls.keeprsteady.com and
 * linked from the outbound lead email. Emails each submission to the survey
 * inbox via Resend — no persistence (see the delivery decision in
 * docs/PROGRESS.md); reply-to is the respondent when they gave an email, so a
 * rep can answer the thread directly.
 *
 * No auth. Per-IP throttled to keep a scripted POST from flooding the inbox.
 */
@Controller('surveys')
export class SurveysController {
  constructor(
    private readonly email: EmailService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(SurveysController.name);
  }

  @Post('missed-calls')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async submitMissedCalls(
    @Body(new ZodBodyPipe(SubmitSurveySchema)) body: SubmitSurvey,
  ): Promise<{ ok: true }> {
    const inbox = this.env.SURVEY_INBOX_EMAIL;
    // Several recipients may be configured; only ever name the first one to the
    // public (the rest of the distribution list isn't the respondent's business).
    const contactAddress = inbox[0]!;
    if (!this.email.isConfigured()) {
      throw new ValidationError(
        `Survey submissions are temporarily unavailable — please email ${contactAddress} directly.`,
      );
    }

    // PII rule (CLAUDE.md §2): no raw email/phone at info level. We log only
    // that a response landed plus non-identifying shape.
    this.logger.info(
      { hasContact: Boolean(body.email || body.phone), source: body.source ?? null },
      'missed-calls survey response received',
    );

    const who =
      body.business_name?.trim() ||
      body.full_name?.trim() ||
      body.email?.trim() ||
      'Anonymous respondent';

    const { html, text } = renderSubmission(body, who);

    const res = await this.email.send({
      to: inbox,
      subject: `Missed-calls survey — ${who}`,
      html,
      text,
      ...(body.email ? { replyTo: body.email } : {}),
    });
    if (!res.delivered) {
      this.logger.warn({ reason: res.reason }, 'missed-calls survey email failed');
      throw new ValidationError(
        `We could not record your answers right now — please email ${contactAddress} directly.`,
      );
    }
    return { ok: true };
  }
}

function fmt(a: Answer): string {
  return `${a.code}) ${a.label}`;
}

export function renderSubmission(
  body: SubmitSurvey,
  who: string,
): { html: string; text: string } {
  const answers: Array<[string, string]> = [
    [QUESTION_TITLES.q1!, fmt(body.q1)],
    [QUESTION_TITLES.q2!, fmt(body.q2)],
    [QUESTION_TITLES.q3!, body.q3.map(fmt).join('\n')],
    [QUESTION_TITLES.q4!, fmt(body.q4)],
    [QUESTION_TITLES.q5!, fmt(body.q5)],
    [QUESTION_TITLES.q6!, fmt(body.q6)],
  ];

  const contact: Array<[string, string | undefined]> = [
    ['Name', body.full_name],
    ['Business', body.business_name],
    ['Email', body.email || undefined],
    ['Phone', body.phone],
    ['Source', body.source],
    ['Comments', body.comments],
  ];

  const rows = (pairs: Array<[string, string | undefined]>): string =>
    pairs
      .filter(([, v]) => v && v.trim())
      .map(
        ([k, v]) =>
          `<tr><td style="vertical-align:top;color:#555;padding:6px 12px 6px 0"><strong>${escapeHtml(k)}</strong></td>` +
          `<td style="white-space:pre-wrap;padding:6px 0">${escapeHtml(v!)}</td></tr>`,
      )
      .join('');

  const contactRows = rows(contact);
  const html =
    `<h2>Missed-calls survey response</h2>` +
    `<p style="color:#555">From: <strong>${escapeHtml(who)}</strong></p>` +
    `<h3>Answers</h3><table cellpadding="0" style="border-collapse:collapse">${rows(answers)}</table>` +
    (contactRows
      ? `<h3>Respondent</h3><table cellpadding="0" style="border-collapse:collapse">${contactRows}</table>`
      : `<p style="color:#888">Submitted anonymously — no contact details given.</p>`);

  const text = [...answers, ...contact]
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}:\n${v}`)
    .join('\n\n');

  return { html, text };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
