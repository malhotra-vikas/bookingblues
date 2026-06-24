import type { ExecutionContext } from '@nestjs/common';

import { ForbiddenError, UnauthorizedError } from '../errors/app-error';

import type { AuthGuard, AuthedRequest } from './auth.guard';
import { SalesGuard } from './sales.guard';

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
  setUser?: { userId: string; email: string | null; isAdmin: boolean; isSales: boolean };
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

describe('SalesGuard', () => {
  it('lets a sales rep through', async () => {
    const guard = new SalesGuard(
      makeAuthGuard({
        shouldAuth: true,
        setUser: { userId: 'u1', email: 'rep@bb.com', isAdmin: false, isSales: true },
      }),
    );
    await expect(guard.canActivate(makeCtx({}))).resolves.toBe(true);
  });

  it('lets an admin through (admins can do everything)', async () => {
    const guard = new SalesGuard(
      makeAuthGuard({
        shouldAuth: true,
        setUser: { userId: 'u2', email: 'staff@bb.com', isAdmin: true, isSales: false },
      }),
    );
    await expect(guard.canActivate(makeCtx({}))).resolves.toBe(true);
  });

  it('throws ForbiddenError for a plain operator (neither sales nor admin)', async () => {
    const guard = new SalesGuard(
      makeAuthGuard({
        shouldAuth: true,
        setUser: { userId: 'u3', email: 'op@bb.com', isAdmin: false, isSales: false },
      }),
    );
    await expect(guard.canActivate(makeCtx({}))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('propagates UnauthorizedError when AuthGuard rejects the token', async () => {
    const guard = new SalesGuard(
      makeAuthGuard({ shouldAuth: false, throws: new UnauthorizedError('bad token') }),
    );
    await expect(guard.canActivate(makeCtx({}))).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
