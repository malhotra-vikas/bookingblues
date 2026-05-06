import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { UnauthorizedError } from '../errors/app-error';
import type { AuthenticatedUser } from './jwt-verifier.service';
import { JwtVerifierService } from './jwt-verifier.service';

export type AuthedRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtVerifierService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedError('Missing Bearer token');
    }
    const token = header.slice(7).trim();
    if (token === '') throw new UnauthorizedError('Empty Bearer token');

    req.user = await this.jwt.verify(token);
    return true;
  }
}
