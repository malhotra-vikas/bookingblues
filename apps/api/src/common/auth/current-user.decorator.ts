import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { UnauthorizedError } from '../errors/app-error';
import type { AuthedRequest } from './auth.guard';
import type { AuthenticatedUser } from './jwt-verifier.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw new UnauthorizedError('No authenticated user on request');
    return req.user;
  },
);
