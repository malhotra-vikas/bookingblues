import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { EmailService } from '../../common/email/email.service';
import { ValidationError } from '../../common/errors/app-error';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';

/**
 * Public careers application (Direct Marketing Representative). Emails the
 * submission to the careers inbox via Resend, reply-to set to the applicant so
 * the team can respond directly. No auth; per-IP throttled to deter spam.
 */
const ApplySchema = z
  .object({
    full_name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email(),
    phone: z.string().trim().min(7).max(30),
    experience_years: z.string().trim().max(40).optional(),
    sold_on_commission: z.string().trim().max(10).optional(),
    relevant_experience: z.string().trim().max(2000).optional(),
    state: z.string().trim().max(40).optional(),
    availability: z.string().trim().max(60).optional(),
    resume_url: z.string().trim().url().max(500).optional().or(z.literal('')),
    cover_letter: z.string().trim().max(4000).optional(),
    // Optional resume upload: filename + base64 content. Capped ~5MB decoded
    // (base64 is ~4/3 larger) to stay within a sane request + Resend limit.
    resume_filename: z.string().trim().max(200).optional(),
    resume_base64: z
      .string()
      .max(7_000_000, 'Resume file is too large (max ~5MB)')
      .regex(/^[A-Za-z0-9+/=\r\n]*$/, 'Resume must be base64-encoded')
      .optional(),
  })
  .strict();
type Apply = z.infer<typeof ApplySchema>;

const CAREERS_INBOX = 'apply@keeprsteady.com';

@Controller('careers')
export class CareersController {
  constructor(
    private readonly email: EmailService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CareersController.name);
  }

  @Post('apply')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async apply(@Body(new ZodBodyPipe(ApplySchema)) body: Apply): Promise<{ ok: true }> {
    if (!this.email.isConfigured()) {
      // Fail loudly to the applicant rather than silently drop — they should
      // fall back to emailing directly (the page shows the address too).
      throw new ValidationError(
        'Applications are temporarily unavailable — please email apply@keeprsteady.com directly.',
      );
    }

    const rows: Array<[string, string | undefined]> = [
      ['Name', body.full_name],
      ['Email', body.email],
      ['Phone', body.phone],
      ['Years of sales/canvassing experience', body.experience_years],
      ['Sold on straight commission before?', body.sold_on_commission],
      ['State', body.state],
      ['Availability to start', body.availability],
      ['Resume link', body.resume_url || undefined],
      ['Relevant experience', body.relevant_experience],
      ['Cover letter / message', body.cover_letter],
    ];
    const html =
      `<h2>New Direct Marketing Rep application</h2><table cellpadding="6" style="border-collapse:collapse">` +
      rows
        .filter(([, v]) => v && v.trim())
        .map(
          ([k, v]) =>
            `<tr><td style="vertical-align:top;color:#555"><strong>${k}</strong></td><td style="white-space:pre-wrap">${escapeHtml(v!)}</td></tr>`,
        )
        .join('') +
      `</table>`;
    const text = rows
      .filter(([, v]) => v && v.trim())
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const attachments =
      body.resume_base64 && body.resume_filename
        ? [{ filename: body.resume_filename, content: body.resume_base64.replace(/\s/g, '') }]
        : undefined;

    const res = await this.email.send({
      to: CAREERS_INBOX,
      subject: `Careers application — ${body.full_name}`,
      html,
      text,
      replyTo: body.email,
      ...(attachments ? { attachments } : {}),
    });
    if (!res.delivered) {
      this.logger.warn({ reason: res.reason }, 'careers application email failed');
      throw new ValidationError(
        'We could not submit your application right now — please email apply@keeprsteady.com directly.',
      );
    }
    return { ok: true };
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
