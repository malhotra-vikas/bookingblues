import { Inject, Injectable } from '@nestjs/common';
import OpenAI from 'openai';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AppError } from '../errors/app-error';

export const BOOKING_MODEL = 'gpt-4.1';

@Injectable()
export class OpenAIService {
  private readonly client: OpenAI | null;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.client = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
  }

  /**
   * Returns the OpenAI client. Throws `openai.no_credentials` if no API key
   * was configured (deferred-error pattern matching SupabaseService etc.).
   */
  client_(): OpenAI {
    if (!this.client) {
      throw new AppError({
        code: 'openai.no_credentials',
        status: 500,
        detail: 'OpenAIService requires OPENAI_API_KEY.',
      });
    }
    return this.client;
  }
}
