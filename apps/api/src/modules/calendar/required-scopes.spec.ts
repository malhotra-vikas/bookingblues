import { REQUIRED_CALENDAR_SCOPES, missingCalendarScopes } from './google-oauth.service';

const EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy';
const EMAIL = 'https://www.googleapis.com/auth/userinfo.email';

describe('missingCalendarScopes', () => {
  it('requires both events (to book) and freebusy (to offer times)', () => {
    expect([...REQUIRED_CALENDAR_SCOPES].sort()).toEqual([EVENTS, FREEBUSY].sort());
  });

  it('is empty when everything was granted', () => {
    expect(missingCalendarScopes([EVENTS, FREEBUSY, EMAIL, 'openid'])).toEqual([]);
  });

  it('flags the prod 2026-11-09 grant (create-events box unticked)', () => {
    expect(missingCalendarScopes([EMAIL, FREEBUSY, 'openid'])).toEqual([EVENTS]);
  });

  it('treats a missing scope list as nothing granted', () => {
    expect(missingCalendarScopes(null)).toEqual([...REQUIRED_CALENDAR_SCOPES]);
  });
});
