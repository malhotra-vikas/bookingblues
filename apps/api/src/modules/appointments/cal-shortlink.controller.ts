import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { expandUuid } from '../../common/util/uuid';
import {
  calendarLandingHtml,
  calendarUnavailableHtml,
  describeWhen,
  googleCalendarUrl,
  opensIcsNatively,
} from './calendar-link';
import { CalendarLinkService } from './calendar-link.service';

/**
 * Short, clean "add to calendar" link for SMS — `${API_URL}/cal/:appointmentId`
 * (no `/v1`, no `.ics` suffix, hyphen-free id) so it stays reliably tappable.
 *
 * - iPhone/iPad: 302 to the .ics, which Safari opens straight into Calendar.
 * - Everything else (Android, desktop): a small page with "Add to Google
 *   Calendar" and the .ics download; Android often just downloads a .ics and
 *   never opens a calendar (prod 2026-11-09: "the link mostly doesn't work").
 * - Cancelled / unknown appointment: a friendly page instead of a raw 404.
 */
@Controller('cal')
@SkipThrottle()
export class CalShortLinkController {
  constructor(
    private readonly calendarLinks: CalendarLinkService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Get(':id')
  async open(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const appointmentId = expandUuid(id);
    const info = await this.calendarLinks.lookup(appointmentId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');

    if (!info.event) {
      res
        .status(404)
        .type('html')
        .send(calendarUnavailableHtml({ businessName: info.businessName, phoneE164: info.businessPhoneE164 }));
      return;
    }

    const icsUrl = `${this.env.API_URL}/v1/appointments/${encodeURIComponent(appointmentId)}.ics`;
    if (opensIcsNatively(req.get('user-agent'))) {
      res.redirect(302, icsUrl);
      return;
    }

    const { event } = info;
    const when = describeWhen(event.startIso, event.endIso, info.timezone ?? 'America/New_York');
    res
      .status(200)
      .type('html')
      .send(
        calendarLandingHtml({
          businessName: info.businessName ?? 'Your appointment',
          when,
          callNote: info.office ? `${info.businessName} will call you anytime in this window.` : null,
          googleUrl: googleCalendarUrl(event),
          icsUrl,
        }),
      );
  }
}
