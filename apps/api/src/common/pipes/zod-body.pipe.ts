import type { PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

import { ValidationError } from '../errors/app-error';

/**
 * Validates a request body against a zod schema and returns the parsed value.
 *
 *   @Patch('me')
 *   update(@Body(new ZodBodyPipe(UpdateMeSchema)) body: UpdateMe) {}
 */
@Injectable()
export class ZodBodyPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError('Invalid request body', {
        issues: result.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
          code: i.code,
        })),
      });
    }
    return result.data;
  }
}
