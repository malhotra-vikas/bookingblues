import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { Tables } from '@bookingblues/db-types';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { NotFoundError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { BookingsService } from '../appointments/bookings.service';
import type { DashboardMetrics } from './dashboard.service';
import { DashboardService } from './dashboard.service';

const PAGE_LIMIT = 50;

@Controller()
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(
    private readonly service: DashboardService,
    private readonly supabase: SupabaseService,
    private readonly bookings: BookingsService,
  ) {}

  @Get('dashboard/metrics')
  async metrics(@CurrentUser() user: AuthenticatedUser): Promise<DashboardMetrics> {
    return this.service.metrics(user.userId);
  }

  @Get('conversations')
  async listConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ): Promise<{ data: Tables<'conversations'>[] }> {
    const operatorId = await this.requireOperatorId(user.userId);
    let q = this.supabase
      .db()
      .from('conversations')
      .select('*')
      .eq('operator_id', operatorId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(PAGE_LIMIT);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return { data: data ?? [] };
  }

  @Post('conversations/:id/resolve')
  @HttpCode(200)
  async resolveConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() body?: { address?: string },
  ): Promise<{ ok: true }> {
    const operatorId = await this.requireOperatorId(user.userId);
    const { data: convo, error } = await this.supabase
      .db()
      .from('conversations')
      .select('id, operator_id, outcome')
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw error;
    if (!convo || convo.operator_id !== operatorId) {
      throw new NotFoundError('Conversation not found');
    }
    // Find the confirmed appointment (if any) — used to derive the outcome and
    // to attach an operator-entered address.
    const { data: confirmedAppt } = await this.supabase
      .db()
      .from('appointments')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // If the operator gathered the property address by phone, save it + patch
    // the calendar so the tech has it (the critical missing-address case).
    const address = body?.address?.trim();
    if (address && confirmedAppt) {
      await this.bookings.setServiceAddress(confirmedAppt.id, address);
    }

    // Keep an existing meaningful outcome; otherwise derive from the booking.
    const outcome = convo.outcome ?? (confirmedAppt ? 'booked' : null);
    const { error: updErr } = await this.supabase
      .db()
      .from('conversations')
      .update({ status: 'completed', completed_at: new Date().toISOString(), outcome })
      .eq('id', conversationId);
    if (updErr) throw updErr;
    return { ok: true };
  }

  @Get('appointments')
  async listAppointments(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<{ data: Tables<'appointments'>[] }> {
    const operatorId = await this.requireOperatorId(user.userId);
    let q = this.supabase
      .db()
      .from('appointments')
      .select('*')
      .eq('operator_id', operatorId)
      .order('scheduled_for_start', { ascending: true })
      .limit(PAGE_LIMIT);
    if (status) q = q.eq('status', status);
    if (from) q = q.gte('scheduled_for_start', from);
    if (to) q = q.lte('scheduled_for_start', to);
    const { data, error } = await q;
    if (error) throw error;
    return { data: data ?? [] };
  }

  private async requireOperatorId(userId: string): Promise<string> {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundError('Operator not found');
    return data.id;
  }
}
