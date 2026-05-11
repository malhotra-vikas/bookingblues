import type { ExecutionContext } from '@nestjs/common';

import { ForbiddenError, UnauthorizedError } from '../errors/app-error';

import { AdminGuard } from './admin.guard';
import type { AuthGuard, AuthedRequest } from './auth.guard';

function makeCtx(req: Partial<AuthedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function makeAuthGuard(opts: {
  shouldAuth: boolean;
  setUser?: { userId: string; email: string | null; isAdmin: boolean };
  throws?: Error;
}): AuthGuard {
  return {
    canActivate: async (ctx: ExecutionContext) => {
      if (opts.throws) throw opts.throws;
      if (opts.setUser) {
        const req = ctx.switchToHttp().getRequest() as AuthedRequest;
        req.user = opts.setUser;
      }
      return opts.shouldAuth;
    },
  } as unknown as AuthGuard;
}

describe('AdminGuard', () => {
  it('lets requests through when AuthGuard sets user.isAdmin = true', async () => {
    const guard = new AdminGuard(
      makeAuthGuard({
        shouldAuth: true,
        setUser: { userId: 'u1', email: 'staff@bb.com', isAdmin: true },
      }),
    );
    const req: Partial<AuthedRequest> = {};
    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(true);
  });

  it('throws ForbiddenError when authenticated but isAdmin = false', async () => {
    const guard = new AdminGuard(
      makeAuthGuard({
        shouldAuth: true,
        setUser: { userId: 'u2', email: 'op@bb.com', isAdmin: false },
      }),
    );
    const req: Partial<AuthedRequest> = {};
    await expect(guard.canActivate(makeCtx(req))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('propagates UnauthorizedError when AuthGuard rejects the token', async () => {
    const guard = new AdminGuard(
      makeAuthGuard({
        shouldAuth: false,
        throws: new UnauthorizedError('bad token'),
      }),
    );
    const req: Partial<AuthedRequest> = {};
    await expect(guard.canActivate(makeCtx(req))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns false (instead of throwing) when AuthGuard returns false without user', async () => {
    // Defense in depth — if a future AuthGuard returns false without user but without
    // throwing, the AdminGuard should not 200 the request.
    const guard = new AdminGuard(makeAuthGuard({ shouldAuth: false }));
    const req: Partial<AuthedRequest> = {};
    await expect(guard.canActivate(makeCtx(req))).resolves.toBe(false);
  });
});
