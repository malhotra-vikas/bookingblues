import { compactUuid, expandUuid } from './uuid';

const UUID = '9a126dc2-e625-48ea-b8e5-01440d18b98b';
const COMPACT = '9a126dc2e62548eab8e501440d18b98b';

describe('uuid short-link helpers', () => {
  it('compacts a UUID to 32 hex chars with no hyphens', () => {
    expect(compactUuid(UUID)).toBe(COMPACT);
    expect(compactUuid(UUID)).not.toContain('-');
  });

  it('expands the compact form back to a canonical UUID', () => {
    expect(expandUuid(COMPACT)).toBe(UUID);
  });

  it('round-trips', () => {
    expect(expandUuid(compactUuid(UUID))).toBe(UUID);
  });

  it('passes an already-hyphenated UUID through unchanged (old links keep working)', () => {
    expect(expandUuid(UUID)).toBe(UUID);
  });

  it('leaves a non-UUID token untouched (let the DB reject it)', () => {
    expect(expandUuid('not-a-uuid')).toBe('not-a-uuid');
    expect(expandUuid('test')).toBe('test');
  });
});
