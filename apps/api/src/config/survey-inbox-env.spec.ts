import { loadEnv } from './env';

/**
 * SURVEY_INBOX_EMAIL is a comma-separated recipient list. Every address is
 * validated at boot, so a typo fails the deploy loudly rather than silently
 * dropping a recipient (CLAUDE.md §7).
 */
const BASE: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
};

const inbox = (value?: string): ReadonlyArray<string> =>
  loadEnv({ ...BASE, ...(value === undefined ? {} : { SURVEY_INBOX_EMAIL: value }) })
    .SURVEY_INBOX_EMAIL;

describe('SURVEY_INBOX_EMAIL', () => {
  it('defaults to the sales inbox as a single-element list', () => {
    expect(inbox()).toEqual(['sales@keeprsteady.com']);
  });

  it('parses one address', () => {
    expect(inbox('ops@keeprsteady.com')).toEqual(['ops@keeprsteady.com']);
  });

  it('splits a comma-separated list and trims whitespace', () => {
    expect(inbox('sales@keeprsteady.com, vikas@keeprsteady.com ,ops@keeprsteady.com')).toEqual([
      'sales@keeprsteady.com',
      'vikas@keeprsteady.com',
      'ops@keeprsteady.com',
    ]);
  });

  it('ignores empty entries from a stray trailing comma', () => {
    expect(inbox('sales@keeprsteady.com,')).toEqual(['sales@keeprsteady.com']);
  });

  it('refuses to boot when any address in the list is malformed', () => {
    expect(() => inbox('sales@keeprsteady.com,not-an-email')).toThrow();
    expect(() => inbox('not-an-email')).toThrow();
  });

  it('refuses to boot when the list is empty', () => {
    expect(() => inbox('')).toThrow();
    expect(() => inbox('  ,  ')).toThrow();
  });
});
