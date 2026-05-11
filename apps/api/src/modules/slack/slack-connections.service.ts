import { Injectable } from '@nestjs/common';

import { EncryptionService } from '../../common/crypto/encryption.service';
import { NotFoundError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';

export interface SlackConnection {
  readonly operatorId: string;
  readonly teamId: string;
  readonly teamName: string | null;
  readonly defaultChannelId: string | null;
  readonly defaultChannelName: string | null;
  readonly status: 'active' | 'revoked' | 'disabled';
}

@Injectable()
export class SlackConnectionsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
  ) {}

  async upsertInstall(args: {
    operatorId: string;
    installedByUserId: string;
    teamId: string;
    teamName: string | null;
    botToken: string;
    scopes: ReadonlyArray<string>;
    defaultChannelId: string | null;
    defaultChannelName: string | null;
  }): Promise<void> {
    const encrypted = this.encryption.encrypt(args.botToken);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { error } = await client.from('slack_connections').upsert(
      {
        operator_id: args.operatorId,
        team_id: args.teamId,
        team_name: args.teamName,
        encrypted_bot_token: encrypted,
        scopes: [...args.scopes],
        installed_by_user_id: args.installedByUserId,
        default_channel_id: args.defaultChannelId,
        default_channel_name: args.defaultChannelName,
        status: 'active',
        installed_at: new Date().toISOString(),
      },
      { onConflict: 'operator_id' },
    );
    if (error) throw error;
  }

  async getByOperatorId(operatorId: string): Promise<SlackConnection | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data, error } = await client
      .from('slack_connections')
      .select(
        'operator_id, team_id, team_name, default_channel_id, default_channel_name, status',
      )
      .eq('operator_id', operatorId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      operatorId: data.operator_id,
      teamId: data.team_id,
      teamName: data.team_name,
      defaultChannelId: data.default_channel_id,
      defaultChannelName: data.default_channel_name,
      status: data.status,
    };
  }

  /**
   * Returns the decrypted bot token for the operator. Throws if no install or
   * the connection has been revoked/disabled (caller decides whether to fall
   * back to email).
   */
  async getBotToken(operatorId: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data, error } = await client
      .from('slack_connections')
      .select('encrypted_bot_token, status')
      .eq('operator_id', operatorId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.status !== 'active') {
      throw new NotFoundError('No active Slack connection for this operator');
    }
    return this.encryption.decrypt(data.encrypted_bot_token);
  }

  async findByTeamId(teamId: string): Promise<SlackConnection | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data, error } = await client
      .from('slack_connections')
      .select(
        'operator_id, team_id, team_name, default_channel_id, default_channel_name, status',
      )
      .eq('team_id', teamId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      operatorId: data.operator_id,
      teamId: data.team_id,
      teamName: data.team_name,
      defaultChannelId: data.default_channel_id,
      defaultChannelName: data.default_channel_name,
      status: data.status,
    };
  }

  /**
   * Used by the Slack interactivity / event handlers to find an operator from
   * the channel a message arrived in.
   */
  async findByChannelId(
    teamId: string,
    channelId: string,
  ): Promise<SlackConnection | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data, error } = await client
      .from('slack_connections')
      .select(
        'operator_id, team_id, team_name, default_channel_id, default_channel_name, status',
      )
      .eq('team_id', teamId)
      .eq('default_channel_id', channelId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      operatorId: data.operator_id,
      teamId: data.team_id,
      teamName: data.team_name,
      defaultChannelId: data.default_channel_id,
      defaultChannelName: data.default_channel_name,
      status: data.status,
    };
  }

  async markRevoked(operatorId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { error } = await client
      .from('slack_connections')
      .update({ status: 'revoked' })
      .eq('operator_id', operatorId);
    if (error) throw error;
  }
}
