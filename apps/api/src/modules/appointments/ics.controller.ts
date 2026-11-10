import { Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { buildIcs } from './calendar-link';
import { CalendarLinkService } from './calendar-link.service';

/**
 * Public ICS file. Reached from the confirmation SMS link (`/cal/:token`),
 * directly on iPhone or via the "Apple Calendar / Outlook" button elsewhere.
 * UUID-only auth is acceptable for MVP — the appointment ID is 122 bits of
 * entropy and the only data exposed (time, business name, the caller's own job
 * summary, the service address they gave) is already known to the caller.
 * Revisit if we ever surface attendee emails or fee amounts in the ICS.
 */
@Controller('appointments')
@SkipThrottle()
export class IcsController {
  constructor(private readonly calendarLinks: CalendarLinkService) {}

  @Get(':id.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="appointment.ics"')
  @Header('Cache-Control', 'no-store')
  async getIcs(@Param('id', new ParseUUIDPipe()) id: string): Promise<string> {
    const { event } = await this.calendarLinks.lookup(id);
    if (!event) throw new NotFoundException('Appointment not found');
    return buildIcs(event);
  }
}
