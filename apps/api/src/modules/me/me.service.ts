import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import type { MeResponse, UpdateMe } from './me.dto';

@Injectable()
export class MeService {
  constructor(private readonly supabase: SupabaseService) {}

  async get(userId: string): Promise<MeResponse> {
    const { data, error } = await this.supabase.db().auth.admin.getUserById(userId);
    if (error) throw error;
    if (!data.user) throw new NotFoundError('User not found');
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      created_at: data.user.created_at,
    };
  }

  async update(userId: string, patch: UpdateMe): Promise<MeResponse> {
    if (patch.email !== undefined) {
      const { error } = await this.supabase
        .db()
        .auth.admin.updateUserById(userId, { email: patch.email });
      if (error) throw error;
    }
    return this.get(userId);
  }
}
