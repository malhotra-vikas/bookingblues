import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { EncryptionService } from '../../common/crypto/encryption.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { type IntakeAnswers, mergeIntakeAnswers, parseIntakeAnswers } from './intake-answers';

/**
 * Encrypted storage for intake answers (insurance category). The bot saves them
 * on the conversation (`save_intake_answers`); booking copies the ciphertext onto
 * the appointment. Only decrypted for the operator's own surfaces: calendar
 * event, booking email, dashboard. Never log the plaintext.
 */
@Injectable()
export class IntakeAnswersService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IntakeAnswersService.name);
  }

  /** Saves the answers, merged over any already stored (a correction sends only what changed). */
  async saveForConversation(conversationId: string, answers: IntakeAnswers): Promise<void> {
    const { data, error: readErr } = await this.supabase
      .db()
      .from('conversations')
      .select('intake_answers_enc')
      .eq('id', conversationId)
      .maybeSingle();
    if (readErr) throw readErr;
    const prev = data?.intake_answers_enc ? this.decrypt(data.intake_answers_enc, { conversationId }) : null;
    const merged = mergeIntakeAnswers(prev, answers);
    const { error } = await this.supabase
      .db()
      .from('conversations')
      .update({ intake_answers_enc: this.encryption.encrypt(JSON.stringify(merged)) })
      .eq('id', conversationId);
    if (error) throw error;
  }

  /** Copy the conversation's answers (if any) onto its appointment. Returns them decrypted. */
  async attachToAppointment(appointmentId: string, conversationId: string | null): Promise<IntakeAnswers | null> {
    if (!conversationId) return null;
    const { data, error } = await this.supabase
      .db()
      .from('conversations')
      .select('intake_answers_enc')
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw error;
    const enc = data?.intake_answers_enc;
    if (!enc) return null;
    const { error: updErr } = await this.supabase
      .db()
      .from('appointments')
      .update({ intake_answers_enc: enc })
      .eq('id', appointmentId);
    if (updErr) throw updErr;
    return this.decrypt(enc, { appointmentId });
  }

  async forAppointment(appointmentId: string): Promise<IntakeAnswers | null> {
    const { data, error } = await this.supabase
      .db()
      .from('appointments')
      .select('intake_answers_enc')
      .eq('id', appointmentId)
      .maybeSingle();
    if (error) throw error;
    return data?.intake_answers_enc ? this.decrypt(data.intake_answers_enc, { appointmentId }) : null;
  }

  /** Decrypt + validate. A bad row is logged (ids only) and treated as absent. */
  decrypt(enc: string, ids: Record<string, string>): IntakeAnswers | null {
    try {
      const answers = parseIntakeAnswers(JSON.parse(this.encryption.decrypt(enc)));
      if (!answers) this.logger.error(ids, 'intake answers failed validation after decrypt');
      return answers;
    } catch (err) {
      this.logger.error({ ...ids, err: (err as Error).message }, 'intake answers decrypt failed');
      return null;
    }
  }
}
