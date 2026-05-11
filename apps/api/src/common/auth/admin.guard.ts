import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';

import { ForbiddenError } from '../errors/app-error';
import { AuthGuard } from './auth.guard';
import type { AuthedRequest } from './auth.guard';

/**
 * Admin-only gate. Runs `AuthGuard` first (validates Bearer + populates
 * `req.user`), then requires `req.user.isAdmin === true`.
 *
 * The admin flag is derived from `auth.users.app_metadata.role === 'admin'`
 * which is server-only-writable in Supabase (operators can't self-promote).
 * See ADR 0009.
 *
 * Every admin write must additionally write to `audit_log` (CLAUDE.md §11.15)
 * via the calling service — the guard is *necessary* but not sufficient for
 * destructive actions.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly authGuard: AuthGuard) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const authed = await this.authGuard.canActivate(ctx);
    if (!authed) return false;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user?.isAdmin) {
      throw new ForbiddenError('Admin role required');
    }
    return true;
  }
}
