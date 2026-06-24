import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';

import { ForbiddenError } from '../errors/app-error';
import { AuthGuard } from './auth.guard';
import type { AuthedRequest } from './auth.guard';

/**
 * Sales-rep gate for /v1/sales/*. Runs `AuthGuard` first, then requires the
 * caller to be a sales rep (or an admin — admins can see/do everything).
 *
 * Like `AdminGuard`, the role flags come from `auth.users.app_metadata.role`,
 * which is server-only-writable in Supabase (#4 / ADR 0009). Per-lead scoping
 * (a rep can only act on operators behind leads they claimed) is enforced in
 * the sales service, not here — this guard is necessary but not sufficient.
 */
@Injectable()
export class SalesGuard implements CanActivate {
  constructor(private readonly authGuard: AuthGuard) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const authed = await this.authGuard.canActivate(ctx);
    if (!authed) return false;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user?.isSales && !req.user?.isAdmin) {
      throw new ForbiddenError('Sales role required');
    }
    return true;
  }
}
