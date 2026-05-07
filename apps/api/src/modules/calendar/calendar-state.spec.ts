import { signState, verifyState } from './calendar-state';

describe('OAuth state token', () => {
  const secret = 'test-state-secret';
  const userId = '00000000-0000-0000-0000-000000000001';

  it('round-trips a freshly-signed state', () => {
    const state = signState({ userId, secret });
    const result = verifyState({ state, secret });
    expect(result.userId).toBe(userId);
    expect(result.expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a tampered userId', () => {
    const state = signState({ userId, secret });
    const tampered = state.replace(userId, '00000000-0000-0000-0000-000000000002');
    expect(() => verifyState({ state: tampered, secret })).toThrow();
  });

  it('rejects a state signed with a different secret', () => {
    const state = signState({ userId, secret });
    expect(() => verifyState({ state, secret: 'other-secret' })).toThrow();
  });

  it('rejects an expired state', () => {
    const longAgo = Date.now() - 11 * 60 * 1000;
    const state = signState({ userId, secret, nowMs: longAgo });
    expect(() => verifyState({ state, secret })).toThrow();
  });

  it('rejects a malformed state', () => {
    expect(() => verifyState({ state: 'not.a.real.state', secret })).toThrow();
    expect(() => verifyState({ state: 'a.b.c', secret })).toThrow();
  });
});
