export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      exercises: {
        Row: {
          created_at: string
          created_by: string | null
          direction: string
          end_angle_max: number
          end_angle_min: number
          id: string
          instructions_text: string | null
          name: string
          primary_joint: string
          primary_side: string
          reference_gif_url: string | null
          secondary_end_max: number | null
          secondary_end_min: number | null
          secondary_joint: string | null
          secondary_start_max: number | null
          secondary_start_min: number | null
          start_angle_max: number
          start_angle_min: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          direction: string
          end_angle_max: number
          end_angle_min: number
          id?: string
          instructions_text?: string | null
          name: string
          primary_joint: string
          primary_side?: string
          reference_gif_url?: string | null
          secondary_end_max?: number | null
          secondary_end_min?: number | null
          secondary_joint?: string | null
          secondary_start_max?: number | null
          secondary_start_min?: number | null
          start_angle_max: number
          start_angle_min: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          direction?: string
          end_angle_max?: number
          end_angle_min?: number
          id?: string
          instructions_text?: string | null
          name?: string
          primary_joint?: string
          primary_side?: string
          reference_gif_url?: string | null
          secondary_end_max?: number | null
          secondary_end_min?: number | null
          secondary_joint?: string | null
          secondary_start_max?: number | null
          secondary_start_min?: number | null
          start_angle_max?: number
          start_angle_min?: number
        }
        Relationships: [
          {
            foreignKeyName: "exercises_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      prescription_items: {
        Row: {
          exercise_id: string
          id: string
          num_sets: number
          override_end_angle_max: number | null
          override_end_angle_min: number | null
          override_start_angle_max: number | null
          override_start_angle_min: number | null
          prescription_id: string
          reps_per_set: number
          rest_seconds: number
          sequence_order: number
        }
        Insert: {
          exercise_id: string
          id?: string
          num_sets: number
          override_end_angle_max?: number | null
          override_end_angle_min?: number | null
          override_start_angle_max?: number | null
          override_start_angle_min?: number | null
          prescription_id: string
          reps_per_set: number
          rest_seconds?: number
          sequence_order: number
        }
        Update: {
          exercise_id?: string
          id?: string
          num_sets?: number
          override_end_angle_max?: number | null
          override_end_angle_min?: number | null
          override_start_angle_max?: number | null
          override_start_angle_min?: number | null
          prescription_id?: string
          reps_per_set?: number
          rest_seconds?: number
          sequence_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          created_at: string
          hr_upper_limit_bpm: number
          id: string
          patient_id: string
          prescribed_by: string
          scheduled_date: string
          status: string
        }
        Insert: {
          created_at?: string
          hr_upper_limit_bpm: number
          id?: string
          patient_id: string
          prescribed_by: string
          scheduled_date: string
          status?: string
        }
        Update: {
          created_at?: string
          hr_upper_limit_bpm?: number
          id?: string
          patient_id?: string
          prescribed_by?: string
          scheduled_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_prescribed_by_fkey"
            columns: ["prescribed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      session_hr_samples: {
        Row: {
          hr_bpm: number
          session_id: string
          timestamp_ms: number
        }
        Insert: {
          hr_bpm: number
          session_id: string
          timestamp_ms: number
        }
        Update: {
          hr_bpm?: number
          session_id?: string
          timestamp_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "session_hr_samples_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_pauses: {
        Row: {
          id: string
          paused_at: string
          reason: string
          resumed_at: string | null
          session_id: string
        }
        Insert: {
          id?: string
          paused_at: string
          reason: string
          resumed_at?: string | null
          session_id: string
        }
        Update: {
          id?: string
          paused_at?: string
          reason?: string
          resumed_at?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_pauses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_pose_frames: {
        Row: {
          frames: Json
          second_offset: number
          session_id: string
        }
        Insert: {
          frames: Json
          second_offset: number
          session_id: string
        }
        Update: {
          frames?: Json
          second_offset?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_pose_frames_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_reps: {
        Row: {
          completed_at: string
          hr_bpm_at_peak: number | null
          id: string
          peak_angle_degrees: number | null
          rep_number: number
          rom_achieved_degrees: number | null
          session_set_id: string
          started_at: string
        }
        Insert: {
          completed_at: string
          hr_bpm_at_peak?: number | null
          id?: string
          peak_angle_degrees?: number | null
          rep_number: number
          rom_achieved_degrees?: number | null
          session_set_id: string
          started_at: string
        }
        Update: {
          completed_at?: string
          hr_bpm_at_peak?: number | null
          id?: string
          peak_angle_degrees?: number | null
          rep_number?: number
          rom_achieved_degrees?: number | null
          session_set_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_reps_session_set_id_fkey"
            columns: ["session_set_id"]
            isOneToOne: false
            referencedRelation: "session_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      session_sets: {
        Row: {
          completed_at: string | null
          ended_reason: string | null
          exercise_id: string
          id: string
          prescription_item_id: string
          reps_completed: number
          reps_target: number
          session_id: string
          set_number: number
          started_at: string
        }
        Insert: {
          completed_at?: string | null
          ended_reason?: string | null
          exercise_id: string
          id?: string
          prescription_item_id: string
          reps_completed?: number
          reps_target: number
          session_id: string
          set_number: number
          started_at: string
        }
        Update: {
          completed_at?: string | null
          ended_reason?: string | null
          exercise_id?: string
          id?: string
          prescription_item_id?: string
          reps_completed?: number
          reps_target?: number
          session_id?: string
          set_number?: number
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_sets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_sets_prescription_item_id_fkey"
            columns: ["prescription_item_id"]
            isOneToOne: false
            referencedRelation: "prescription_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_sets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          clinician_notes: string | null
          completed_at: string | null
          id: string
          patient_id: string
          prescription_id: string
          started_at: string
          status: string
        }
        Insert: {
          clinician_notes?: string | null
          completed_at?: string | null
          id?: string
          patient_id: string
          prescription_id: string
          started_at: string
          status?: string
        }
        Update: {
          clinician_notes?: string | null
          completed_at?: string | null
          id?: string
          patient_id?: string
          prescription_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          display_name: string
          id: string
          role: string
          username: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          role: string
          username: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          role?: string
          username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
