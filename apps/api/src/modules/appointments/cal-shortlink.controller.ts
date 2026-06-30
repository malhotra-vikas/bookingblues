import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { expandUuid } from '../../common/util/uuid';

/**
 * Short, clean "add to calendar" link for SMS — `${API_URL}/cal/:appointmentId`
 * (no `/v1`, no `.ics` suffix) that 302-redirects to the canonical ICS endpoint.
 * The long `/v1/appointments/<uuid>.ics` URL sits mid-message in the
 * confirmation SMS and was breaking link detection on some phones; this keeps
 * it short and reliably tappable (same approach as the `/pay/:id` payment link).
 */
@Controller('cal')
@SkipThrottle()
export class CalShortLinkController {
  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {}

  @Get(':id')
  redirect(@Param('id') id: string, @Res() res: Response): void {
    res.redirect(302, `${this.env.API_URL}/v1/appointments/${encodeURIComponent(expandUuid(id))}.ics`);
  }
}
