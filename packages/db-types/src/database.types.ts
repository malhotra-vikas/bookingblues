export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      lead_claims: {
        Row: {
          claim_note: string | null;
          claimed_at: string;
          claimed_by_slack_user_id: string;
          claimed_by_slack_username: string | null;
          created_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          claim_note?: string | null;
          claimed_at?: string;
          claimed_by_slack_user_id: string;
          claimed_by_slack_username?: string | null;
          created_at?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          claim_note?: string | null;
          claimed_at?: string;
          claimed_by_slack_user_id?: string;
          claimed_by_slack_username?: string | null;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      sales_slack_links: {
        Row: {
          created_at: string;
          slack_user_id: string;
          slack_username: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          slack_user_id: string;
          slack_username?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          slack_user_id?: string;
          slack_username?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      sms_consents: {
        Row: {
          consent_text: string;
          consent_version: string;
          created_at: string;
          id: string;
          ip_address: string | null;
          name: string | null;
          phone_e164: string;
          source: string;
          trade: string | null;
          user_agent: string | null;
        };
        Insert: {
          consent_text: string;
          consent_version: string;
          created_at?: string;
          id?: string;
          ip_address?: string | null;
          name?: string | null;
          phone_e164: string;
          source?: string;
          trade?: string | null;
          user_agent?: string | null;
        };
        Update: {
          consent_text?: string;
          consent_version?: string;
          created_at?: string;
          id?: string;
          ip_address?: string | null;
          name?: string | null;
          phone_e164?: string;
          source?: string;
          trade?: string | null;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      appointments: {
        Row: {
          caller_email: string | null;
          caller_name: string;
          caller_phone_e164: string;
          conversation_id: string | null;
          created_at: string;
          fee_cents: number | null;
          fee_checkout_session_id: string | null;
          fee_payment_intent_id: string | null;
          fee_status: Database["public"]["Enums"]["appointment_fee_status"];
          google_event_id: string | null;
          id: string;
          job_summary: string;
          operator_id: string;
          reminder_sent_at: string | null;
          scheduled_for_end: string;
          scheduled_for_start: string;
          status: Database["public"]["Enums"]["appointment_status"];
          updated_at: string;
        };
        Insert: {
          caller_email?: string | null;
          caller_name: string;
          caller_phone_e164: string;
          conversation_id?: string | null;
          created_at?: string;
          fee_cents?: number | null;
          fee_checkout_session_id?: string | null;
          fee_payment_intent_id?: string | null;
          fee_status?: Database["public"]["Enums"]["appointment_fee_status"];
          google_event_id?: string | null;
          id?: string;
          job_summary: string;
          operator_id: string;
          reminder_sent_at?: string | null;
          scheduled_for_end: string;
          scheduled_for_start: string;
          status?: Database["public"]["Enums"]["appointment_status"];
          updated_at?: string;
        };
        Update: {
          caller_email?: string | null;
          caller_name?: string;
          caller_phone_e164?: string;
          conversation_id?: string | null;
          created_at?: string;
          fee_cents?: number | null;
          fee_checkout_session_id?: string | null;
          fee_payment_intent_id?: string | null;
          fee_status?: Database["public"]["Enums"]["appointment_fee_status"];
          google_event_id?: string | null;
          id?: string;
          job_summary?: string;
          operator_id?: string;
          reminder_sent_at?: string | null;
          scheduled_for_end?: string;
          scheduled_for_start?: string;
          status?: Database["public"]["Enums"]["appointment_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "appointments_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_user_id: string | null;
          created_at: string;
          id: string;
          ip_address: unknown;
          metadata: Json;
          operator_id: string | null;
          resource_id: string | null;
          resource_type: string;
          user_agent: string | null;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          ip_address?: unknown;
          metadata?: Json;
          operator_id?: string | null;
          resource_id?: string | null;
          resource_type: string;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          created_at?: string;
          id?: string;
          ip_address?: unknown;
          metadata?: Json;
          operator_id?: string | null;
          resource_id?: string | null;
          resource_type?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_connections: {
        Row: {
          access_token_cache: string | null;
          access_token_expires_at: string | null;
          connected_email: string | null;
          created_at: string;
          encrypted_refresh_token: string;
          id: string;
          operator_id: string;
          provider: Database["public"]["Enums"]["calendar_provider"];
          scopes: string[];
          status: Database["public"]["Enums"]["calendar_connection_status"];
          updated_at: string;
        };
        Insert: {
          access_token_cache?: string | null;
          access_token_expires_at?: string | null;
          connected_email?: string | null;
          created_at?: string;
          encrypted_refresh_token: string;
          id?: string;
          operator_id: string;
          provider?: Database["public"]["Enums"]["calendar_provider"];
          scopes?: string[];
          status?: Database["public"]["Enums"]["calendar_connection_status"];
          updated_at?: string;
        };
        Update: {
          access_token_cache?: string | null;
          access_token_expires_at?: string | null;
          connected_email?: string | null;
          created_at?: string;
          encrypted_refresh_token?: string;
          id?: string;
          operator_id?: string;
          provider?: Database["public"]["Enums"]["calendar_provider"];
          scopes?: string[];
          status?: Database["public"]["Enums"]["calendar_connection_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_connections_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: true;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          created_at: string;
          display_name: string;
          slug: string;
          system_prompt_template: string;
          updated_at: string;
          vetting_questions: Json;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          slug: string;
          system_prompt_template: string;
          updated_at?: string;
          vetting_questions?: Json;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          slug?: string;
          system_prompt_template?: string;
          updated_at?: string;
          vetting_questions?: Json;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          caller_phone_e164: string;
          completed_at: string | null;
          created_at: string;
          id: string;
          last_message_at: string | null;
          operator_id: string;
          outcome: Database["public"]["Enums"]["conversation_outcome"] | null;
          started_at: string;
          status: Database["public"]["Enums"]["conversation_status"];
          summary: string | null;
          updated_at: string;
        };
        Insert: {
          caller_phone_e164: string;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          operator_id: string;
          outcome?: Database["public"]["Enums"]["conversation_outcome"] | null;
          started_at?: string;
          status?: Database["public"]["Enums"]["conversation_status"];
          summary?: string | null;
          updated_at?: string;
        };
        Update: {
          caller_phone_e164?: string;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          last_message_at?: string | null;
          operator_id?: string;
          outcome?: Database["public"]["Enums"]["conversation_outcome"] | null;
          started_at?: string;
          status?: Database["public"]["Enums"]["conversation_status"];
          summary?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      escalations: {
        Row: {
          caller_phone_e164: string;
          conversation_id: string;
          created_at: string;
          fallback_email_sent_at: string | null;
          id: string;
          opened_by: Database["public"]["Enums"]["escalation_opener"];
          operator_id: string;
          reason: Database["public"]["Enums"]["escalation_reason"];
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by_user_id: string | null;
          slack_channel_id: string | null;
          slack_thread_ts: string | null;
          status: Database["public"]["Enums"]["escalation_status"];
          updated_at: string;
        };
        Insert: {
          caller_phone_e164: string;
          conversation_id: string;
          created_at?: string;
          fallback_email_sent_at?: string | null;
          id?: string;
          opened_by: Database["public"]["Enums"]["escalation_opener"];
          operator_id: string;
          reason: Database["public"]["Enums"]["escalation_reason"];
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by_user_id?: string | null;
          slack_channel_id?: string | null;
          slack_thread_ts?: string | null;
          status?: Database["public"]["Enums"]["escalation_status"];
          updated_at?: string;
        };
        Update: {
          caller_phone_e164?: string;
          conversation_id?: string;
          created_at?: string;
          fallback_email_sent_at?: string | null;
          id?: string;
          opened_by?: Database["public"]["Enums"]["escalation_opener"];
          operator_id?: string;
          reason?: Database["public"]["Enums"]["escalation_reason"];
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by_user_id?: string | null;
          slack_channel_id?: string | null;
          slack_thread_ts?: string | null;
          status?: Database["public"]["Enums"]["escalation_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "escalations_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: true;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "escalations_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          ai_tool_calls: Json | null;
          body: string;
          conversation_id: string;
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["message_role"];
          slack_message_ts: string | null;
          twilio_message_sid: string | null;
          updated_at: string;
        };
        Insert: {
          ai_tool_calls?: Json | null;
          body: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["message_role"];
          slack_message_ts?: string | null;
          twilio_message_sid?: string | null;
          updated_at?: string;
        };
        Update: {
          ai_tool_calls?: Json | null;
          body?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["message_role"];
          slack_message_ts?: string | null;
          twilio_message_sid?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      operators: {
        Row: {
          booking_fee_cents: number | null;
          booking_fee_enabled: boolean;
          business_hours: Json;
          business_name: string;
          category: string | null;
          created_at: string;
          google_calendar_connected_at: string | null;
          google_calendar_id: string | null;
          id: string;
          onboarding_completed_at: string | null;
          personal_phone_e164: string | null;
          plan: string | null;
          plan_cadence: string | null;
          terms_accepted_at: string | null;
          terms_version: string | null;
          service_radius_zones: Json;
          service_zip_codes: string[];
          stripe_connect_account_id: string | null;
          stripe_connect_charges_enabled: boolean;
          stripe_connect_payouts_enabled: boolean;
          stripe_customer_id: string | null;
          stripe_price_id: string | null;
          stripe_subscription_id: string | null;
          subscription_status:
            | Database["public"]["Enums"]["subscription_status"]
            | null;
          timezone: string;
          trade_metadata: Json;
          trial_ends_at: string | null;
          twilio_number_e164: string | null;
          twilio_number_sid: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          booking_fee_cents?: number | null;
          booking_fee_enabled?: boolean;
          business_hours?: Json;
          business_name: string;
          category?: string | null;
          created_at?: string;
          google_calendar_connected_at?: string | null;
          google_calendar_id?: string | null;
          id?: string;
          onboarding_completed_at?: string | null;
          personal_phone_e164?: string | null;
          plan?: string | null;
          plan_cadence?: string | null;
          terms_accepted_at?: string | null;
          terms_version?: string | null;
          service_radius_zones?: Json;
          service_zip_codes?: string[];
          stripe_connect_account_id?: string | null;
          stripe_connect_charges_enabled?: boolean;
          stripe_connect_payouts_enabled?: boolean;
          stripe_customer_id?: string | null;
          stripe_price_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?:
            | Database["public"]["Enums"]["subscription_status"]
            | null;
          timezone?: string;
          trade_metadata?: Json;
          trial_ends_at?: string | null;
          twilio_number_e164?: string | null;
          twilio_number_sid?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          booking_fee_cents?: number | null;
          booking_fee_enabled?: boolean;
          business_hours?: Json;
          business_name?: string;
          category?: string | null;
          created_at?: string;
          google_calendar_connected_at?: string | null;
          google_calendar_id?: string | null;
          id?: string;
          onboarding_completed_at?: string | null;
          personal_phone_e164?: string | null;
          plan?: string | null;
          plan_cadence?: string | null;
          terms_accepted_at?: string | null;
          terms_version?: string | null;
          service_radius_zones?: Json;
          service_zip_codes?: string[];
          stripe_connect_account_id?: string | null;
          stripe_connect_charges_enabled?: boolean;
          stripe_connect_payouts_enabled?: boolean;
          stripe_customer_id?: string | null;
          stripe_price_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?:
            | Database["public"]["Enums"]["subscription_status"]
            | null;
          timezone?: string;
          trade_metadata?: Json;
          trial_ends_at?: string | null;
          twilio_number_e164?: string | null;
          twilio_number_sid?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operators_category_fkey";
            columns: ["category"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["slug"];
          },
        ];
      };
      payments: {
        Row: {
          amount_cents: number;
          application_fee_cents: number;
          appointment_id: string;
          created_at: string;
          currency: string;
          id: string;
          operator_id: string;
          raw_event: Json | null;
          refunded_at: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          stripe_charge_id: string | null;
          stripe_connected_account_id: string;
          stripe_payment_intent_id: string;
          type: Database["public"]["Enums"]["payment_type"];
          updated_at: string;
        };
        Insert: {
          amount_cents: number;
          application_fee_cents: number;
          appointment_id: string;
          created_at?: string;
          currency: string;
          id?: string;
          operator_id: string;
          raw_event?: Json | null;
          refunded_at?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          stripe_charge_id?: string | null;
          stripe_connected_account_id: string;
          stripe_payment_intent_id: string;
          type?: Database["public"]["Enums"]["payment_type"];
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          application_fee_cents?: number;
          appointment_id?: string;
          created_at?: string;
          currency?: string;
          id?: string;
          operator_id?: string;
          raw_event?: Json | null;
          refunded_at?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          stripe_charge_id?: string | null;
          stripe_connected_account_id?: string;
          stripe_payment_intent_id?: string;
          type?: Database["public"]["Enums"]["payment_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: false;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      slack_connections: {
        Row: {
          created_at: string;
          default_channel_id: string | null;
          default_channel_name: string | null;
          encrypted_bot_token: string;
          id: string;
          installed_at: string;
          installed_by_user_id: string | null;
          operator_id: string;
          scopes: string[];
          status: string;
          team_id: string;
          team_name: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          default_channel_id?: string | null;
          default_channel_name?: string | null;
          encrypted_bot_token: string;
          id?: string;
          installed_at?: string;
          installed_by_user_id?: string | null;
          operator_id: string;
          scopes?: string[];
          status?: string;
          team_id: string;
          team_name?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          default_channel_id?: string | null;
          default_channel_name?: string | null;
          encrypted_bot_token?: string;
          id?: string;
          installed_at?: string;
          installed_by_user_id?: string | null;
          operator_id?: string;
          scopes?: string[];
          status?: string;
          team_id?: string;
          team_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "slack_connections_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: true;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      twilio_numbers: {
        Row: {
          created_at: string;
          id: string;
          operator_id: string | null;
          phone_number_e164: string;
          purchased_at: string;
          released_at: string | null;
          status: Database["public"]["Enums"]["twilio_number_status"];
          twilio_sid: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          operator_id?: string | null;
          phone_number_e164: string;
          purchased_at?: string;
          released_at?: string | null;
          status?: Database["public"]["Enums"]["twilio_number_status"];
          twilio_sid: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          operator_id?: string | null;
          phone_number_e164?: string;
          purchased_at?: string;
          released_at?: string | null;
          status?: Database["public"]["Enums"]["twilio_number_status"];
          twilio_sid?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "twilio_numbers_operator_id_fkey";
            columns: ["operator_id"];
            isOneToOne: true;
            referencedRelation: "operators";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_events: {
        Row: {
          created_at: string;
          error: string | null;
          event_id: string;
          id: string;
          payload: Json;
          processed_at: string | null;
          signature_verified: boolean;
          source: Database["public"]["Enums"]["webhook_source"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          event_id: string;
          id?: string;
          payload: Json;
          processed_at?: string | null;
          signature_verified: boolean;
          source: Database["public"]["Enums"]["webhook_source"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          event_id?: string;
          id?: string;
          payload?: Json;
          processed_at?: string | null;
          signature_verified?: boolean;
          source?: Database["public"]["Enums"]["webhook_source"];
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_demote: { Args: { p_user_email: string }; Returns: string };
      admin_promote: { Args: { p_user_email: string }; Returns: string };
      auth_operator_id: { Args: never; Returns: string };
    };
    Enums: {
      appointment_fee_status:
        | "none"
        | "pending"
        | "paid"
        | "refunded"
        | "expired";
      appointment_status:
        | "proposed"
        | "confirmed"
        | "cancelled"
        | "completed"
        | "no_show";
      calendar_connection_status: "active" | "revoked";
      calendar_provider: "google";
      conversation_outcome:
        | "booked"
        | "no_show_intent"
        | "out_of_scope"
        | "spam"
        | "rejected"
        | "timeout";
      conversation_status:
        | "active"
        | "awaiting_caller"
        | "awaiting_bot"
        | "completed"
        | "abandoned"
        | "escalated";
      escalation_opener: "bot" | "caller" | "operator";
      escalation_reason:
        | "bot_stuck"
        | "caller_requested"
        | "operator_forced"
        | "calendar_revoked"
        | "turn_cap";
      escalation_status: "open" | "resolved" | "abandoned";
      message_role: "caller" | "bot" | "system";
      payment_status:
        | "pending"
        | "succeeded"
        | "failed"
        | "refunded"
        | "partially_refunded";
      payment_type: "booking_fee";
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "incomplete"
        | "incomplete_expired";
      twilio_number_status: "available" | "assigned" | "released";
      webhook_source:
        | "twilio"
        | "stripe"
        | "stripe_connect"
        | "google"
        | "slack";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      appointment_fee_status: [
        "none",
        "pending",
        "paid",
        "refunded",
        "expired",
      ],
      appointment_status: [
        "proposed",
        "confirmed",
        "cancelled",
        "completed",
        "no_show",
      ],
      calendar_connection_status: ["active", "revoked"],
      calendar_provider: ["google"],
      conversation_outcome: [
        "booked",
        "no_show_intent",
        "out_of_scope",
        "spam",
        "rejected",
        "timeout",
      ],
      conversation_status: [
        "active",
        "awaiting_caller",
        "awaiting_bot",
        "completed",
        "abandoned",
        "escalated",
      ],
      escalation_opener: ["bot", "caller", "operator"],
      escalation_reason: [
        "bot_stuck",
        "caller_requested",
        "operator_forced",
        "calendar_revoked",
        "turn_cap",
      ],
      escalation_status: ["open", "resolved", "abandoned"],
      message_role: ["caller", "bot", "system"],
      payment_status: [
        "pending",
        "succeeded",
        "failed",
        "refunded",
        "partially_refunded",
      ],
      payment_type: ["booking_fee"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "canceled",
        "incomplete",
        "incomplete_expired",
      ],
      twilio_number_status: ["available", "assigned", "released"],
      webhook_source: ["twilio", "stripe", "stripe_connect", "google", "slack"],
    },
  },
} as const;
