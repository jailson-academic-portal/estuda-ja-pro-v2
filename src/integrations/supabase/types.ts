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
      academic_work_submissions: {
        Row: {
          abnt_report: Json | null
          ai_feedback_draft: string | null
          ai_usage_report: Json | null
          content_report: Json | null
          diary_assessment_id: string | null
          file_url: string
          final_feedback: string | null
          final_score: number | null
          group_id: string | null
          id: string
          published_at: string | null
          published_by: string | null
          released_at: string | null
          rubric_scores: Json | null
          rubric_snapshot: Json | null
          status: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submission_text: string | null
          submitted_at: string
          teacher_comment: string | null
          total_score: number | null
          work_id: string
        }
        Insert: {
          abnt_report?: Json | null
          ai_feedback_draft?: string | null
          ai_usage_report?: Json | null
          content_report?: Json | null
          diary_assessment_id?: string | null
          file_url: string
          final_feedback?: string | null
          final_score?: number | null
          group_id?: string | null
          id?: string
          published_at?: string | null
          published_by?: string | null
          released_at?: string | null
          rubric_scores?: Json | null
          rubric_snapshot?: Json | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submission_text?: string | null
          submitted_at?: string
          teacher_comment?: string | null
          total_score?: number | null
          work_id: string
        }
        Update: {
          abnt_report?: Json | null
          ai_feedback_draft?: string | null
          ai_usage_report?: Json | null
          content_report?: Json | null
          diary_assessment_id?: string | null
          file_url?: string
          final_feedback?: string | null
          final_score?: number | null
          group_id?: string | null
          id?: string
          published_at?: string | null
          published_by?: string | null
          released_at?: string | null
          rubric_scores?: Json | null
          rubric_snapshot?: Json | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id?: string
          submission_text?: string | null
          submitted_at?: string
          teacher_comment?: string | null
          total_score?: number | null
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_work_submissions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "activity_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_work_submissions_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "academic_works"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_works: {
        Row: {
          allow_late: boolean
          cover_config: Json | null
          created_at: string
          created_by: string
          delivery_type: string
          diary_assessment_id: string | null
          discipline_id: string
          due_at: string | null
          due_time: string | null
          format_config: Json | null
          grading_formula: string
          id: string
          instructions: string | null
          late_penalty_per_day: number | null
          late_penalty_type: string | null
          late_tolerance_date: string | null
          late_tolerance_time: string | null
          max_group_size: number | null
          rubric: Json
          source_generation_id: string | null
          status: Database["public"]["Enums"]["publish_status"]
          structure_config: Json | null
          subtype: Database["public"]["Enums"]["academic_work_subtype"]
          title: string
          updated_at: string
        }
        Insert: {
          allow_late?: boolean
          cover_config?: Json | null
          created_at?: string
          created_by: string
          delivery_type?: string
          diary_assessment_id?: string | null
          discipline_id: string
          due_at?: string | null
          due_time?: string | null
          format_config?: Json | null
          grading_formula?: string
          id?: string
          instructions?: string | null
          late_penalty_per_day?: number | null
          late_penalty_type?: string | null
          late_tolerance_date?: string | null
          late_tolerance_time?: string | null
          max_group_size?: number | null
          rubric?: Json
          source_generation_id?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          structure_config?: Json | null
          subtype?: Database["public"]["Enums"]["academic_work_subtype"]
          title: string
          updated_at?: string
        }
        Update: {
          allow_late?: boolean
          cover_config?: Json | null
          created_at?: string
          created_by?: string
          delivery_type?: string
          diary_assessment_id?: string | null
          discipline_id?: string
          due_at?: string | null
          due_time?: string | null
          format_config?: Json | null
          grading_formula?: string
          id?: string
          instructions?: string | null
          late_penalty_per_day?: number | null
          late_penalty_type?: string | null
          late_tolerance_date?: string | null
          late_tolerance_time?: string | null
          max_group_size?: number | null
          rubric?: Json
          source_generation_id?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          structure_config?: Json | null
          subtype?: Database["public"]["Enums"]["academic_work_subtype"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_works_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          allow_attachments: boolean
          allow_late: boolean
          cover_config: Json | null
          created_at: string
          created_by: string
          delivery_type: string
          diary_assessment_id: string | null
          discipline_id: string
          due_at: string | null
          due_time: string | null
          format_config: Json | null
          grading_formula: string
          id: string
          instructions: string | null
          late_penalty_per_day: number | null
          late_penalty_type: string | null
          late_tolerance_date: string | null
          late_tolerance_time: string | null
          max_attachments: number
          max_group_size: number | null
          rubric: Json
          sort_order: number | null
          source_generation_id: string | null
          status: Database["public"]["Enums"]["publish_status"]
          structure_config: Json | null
          subtype: Database["public"]["Enums"]["activity_subtype"]
          title: string
          updated_at: string
        }
        Insert: {
          allow_attachments?: boolean
          allow_late?: boolean
          cover_config?: Json | null
          created_at?: string
          created_by: string
          delivery_type?: string
          diary_assessment_id?: string | null
          discipline_id: string
          due_at?: string | null
          due_time?: string | null
          format_config?: Json | null
          grading_formula?: string
          id?: string
          instructions?: string | null
          late_penalty_per_day?: number | null
          late_penalty_type?: string | null
          late_tolerance_date?: string | null
          late_tolerance_time?: string | null
          max_attachments?: number
          max_group_size?: number | null
          rubric?: Json
          sort_order?: number | null
          source_generation_id?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          structure_config?: Json | null
          subtype: Database["public"]["Enums"]["activity_subtype"]
          title: string
          updated_at?: string
        }
        Update: {
          allow_attachments?: boolean
          allow_late?: boolean
          cover_config?: Json | null
          created_at?: string
          created_by?: string
          delivery_type?: string
          diary_assessment_id?: string | null
          discipline_id?: string
          due_at?: string | null
          due_time?: string | null
          format_config?: Json | null
          grading_formula?: string
          id?: string
          instructions?: string | null
          late_penalty_per_day?: number | null
          late_penalty_type?: string | null
          late_tolerance_date?: string | null
          late_tolerance_time?: string | null
          max_attachments?: number
          max_group_size?: number | null
          rubric?: Json
          sort_order?: number | null
          source_generation_id?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          structure_config?: Json | null
          subtype?: Database["public"]["Enums"]["activity_subtype"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_groups: {
        Row: {
          activity_id: string
          activity_kind: Database["public"]["Enums"]["group_activity_kind"]
          created_at: string
          discipline_id: string
          id: string
          leader_id: string
          member_ids: string[]
        }
        Insert: {
          activity_id: string
          activity_kind: Database["public"]["Enums"]["group_activity_kind"]
          created_at?: string
          discipline_id: string
          id?: string
          leader_id: string
          member_ids?: string[]
        }
        Update: {
          activity_id?: string
          activity_kind?: Database["public"]["Enums"]["group_activity_kind"]
          created_at?: string
          discipline_id?: string
          id?: string
          leader_id?: string
          member_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "activity_groups_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_groups_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_submissions: {
        Row: {
          activity_id: string
          ai_feedback_draft: string | null
          ai_report: Json | null
          ai_usage_report: Json | null
          attachments: Json | null
          diary_assessment_id: string | null
          file_url: string
          final_feedback: string | null
          final_score: number | null
          id: string
          published_at: string | null
          published_by: string | null
          released_at: string | null
          rubric_scores: Json | null
          rubric_snapshot: Json | null
          status: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submitted_at: string
          teacher_comment: string | null
          total_score: number | null
        }
        Insert: {
          activity_id: string
          ai_feedback_draft?: string | null
          ai_report?: Json | null
          ai_usage_report?: Json | null
          attachments?: Json | null
          diary_assessment_id?: string | null
          file_url: string
          final_feedback?: string | null
          final_score?: number | null
          id?: string
          published_at?: string | null
          published_by?: string | null
          released_at?: string | null
          rubric_scores?: Json | null
          rubric_snapshot?: Json | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submitted_at?: string
          teacher_comment?: string | null
          total_score?: number | null
        }
        Update: {
          activity_id?: string
          ai_feedback_draft?: string | null
          ai_report?: Json | null
          ai_usage_report?: Json | null
          attachments?: Json | null
          diary_assessment_id?: string | null
          file_url?: string
          final_feedback?: string | null
          final_score?: number | null
          id?: string
          published_at?: string | null
          published_by?: string | null
          released_at?: string | null
          rubric_scores?: Json | null
          rubric_snapshot?: Json | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id?: string
          submitted_at?: string
          teacher_comment?: string | null
          total_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_submissions_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generations: {
        Row: {
          created_at: string
          discipline_id: string | null
          id: string
          prompt: Json | null
          result: Json
          title: string
          tool: string
          user_id: string
        }
        Insert: {
          created_at?: string
          discipline_id?: string | null
          id?: string
          prompt?: Json | null
          result: Json
          title: string
          tool: string
          user_id: string
        }
        Update: {
          created_at?: string
          discipline_id?: string | null
          id?: string
          prompt?: Json | null
          result?: Json
          title?: string
          tool?: string
          user_id?: string
        }
        Relationships: []
      }
      assessment_assignments: {
        Row: {
          answer_key: Json | null
          assessment_id: string
          bubble_layout: Json | null
          copy_index: number
          created_at: string
          group_number: number | null
          id: string
          option_orders: Json | null
          qr_token: string
          question_order: string[] | null
          student_id: string
          version_id: string
        }
        Insert: {
          answer_key?: Json | null
          assessment_id: string
          bubble_layout?: Json | null
          copy_index?: number
          created_at?: string
          group_number?: number | null
          id?: string
          option_orders?: Json | null
          qr_token?: string
          question_order?: string[] | null
          student_id: string
          version_id: string
        }
        Update: {
          answer_key?: Json | null
          assessment_id?: string
          bubble_layout?: Json | null
          copy_index?: number
          created_at?: string
          group_number?: number | null
          id?: string
          option_orders?: Json | null
          qr_token?: string
          question_order?: string[] | null
          student_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_assignments_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_assignments_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "assessment_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_control_counters: {
        Row: {
          control_year: number
          next_sequence: number
          scope_key: string
          updated_at: string
        }
        Insert: {
          control_year: number
          next_sequence?: number
          scope_key: string
          updated_at?: string
        }
        Update: {
          control_year?: number
          next_sequence?: number
          scope_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      assessment_control_reservations: {
        Row: {
          control_number: string
          control_sequence: number
          control_year: number
          reserved_at: string
          scope_key: string
        }
        Insert: {
          control_number: string
          control_sequence: number
          control_year: number
          reserved_at?: string
          scope_key: string
        }
        Update: {
          control_number?: string
          control_sequence?: number
          control_year?: number
          reserved_at?: string
          scope_key?: string
        }
        Relationships: []
      }
      assessment_header_templates: {
        Row: {
          banner_color: string
          compact_questions_header: boolean
          created_at: string
          exclusive_answer_sheet_rules: boolean
          id: string
          institution_id: string | null
          instructions: string | null
          logo_scale: number
          logo_url: string | null
          name: string
          owner_user_id: string
          shift_label: string | null
          show_grade_box: boolean
          strip_color: string
          unit_label: string | null
          updated_at: string
        }
        Insert: {
          banner_color?: string
          compact_questions_header?: boolean
          created_at?: string
          exclusive_answer_sheet_rules?: boolean
          id?: string
          institution_id?: string | null
          instructions?: string | null
          logo_scale?: number
          logo_url?: string | null
          name: string
          owner_user_id: string
          shift_label?: string | null
          show_grade_box?: boolean
          strip_color?: string
          unit_label?: string | null
          updated_at?: string
        }
        Update: {
          banner_color?: string
          compact_questions_header?: boolean
          created_at?: string
          exclusive_answer_sheet_rules?: boolean
          id?: string
          institution_id?: string | null
          instructions?: string | null
          logo_scale?: number
          logo_url?: string | null
          name?: string
          owner_user_id?: string
          shift_label?: string | null
          show_grade_box?: boolean
          strip_color?: string
          unit_label?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      assessment_question_audits: {
        Row: {
          assessment_id: string
          concept: string | null
          concept_options: Json
          created_at: string
          declared_level: string | null
          detected_level: string | null
          id: string
          lesson_tag: string | null
          message: string | null
          position: number
          question_id: string | null
          resolution: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          suggested_prompt: string | null
          version_label: string
        }
        Insert: {
          assessment_id: string
          concept?: string | null
          concept_options?: Json
          created_at?: string
          declared_level?: string | null
          detected_level?: string | null
          id?: string
          lesson_tag?: string | null
          message?: string | null
          position: number
          question_id?: string | null
          resolution?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status: string
          suggested_prompt?: string | null
          version_label: string
        }
        Update: {
          assessment_id?: string
          concept?: string | null
          concept_options?: Json
          created_at?: string
          declared_level?: string | null
          detected_level?: string | null
          id?: string
          lesson_tag?: string | null
          message?: string | null
          position?: number
          question_id?: string | null
          resolution?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          suggested_prompt?: string | null
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_question_audits_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_question_audits_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "assessment_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_questions: {
        Row: {
          assessment_id: string
          correct_answer: Json | null
          created_at: string
          explanation: string | null
          id: string
          options: Json | null
          position: number
          prompt: string
          qtype: Database["public"]["Enums"]["assessment_question_type"]
          rubric: Json | null
          weight: number
        }
        Insert: {
          assessment_id: string
          correct_answer?: Json | null
          created_at?: string
          explanation?: string | null
          id?: string
          options?: Json | null
          position?: number
          prompt: string
          qtype: Database["public"]["Enums"]["assessment_question_type"]
          rubric?: Json | null
          weight?: number
        }
        Update: {
          assessment_id?: string
          correct_answer?: Json | null
          created_at?: string
          explanation?: string | null
          id?: string
          options?: Json | null
          position?: number
          prompt?: string
          qtype?: Database["public"]["Enums"]["assessment_question_type"]
          rubric?: Json | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessment_questions_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_submissions: {
        Row: {
          ai_feedback: Json | null
          assignment_id: string
          created_at: string
          essay_answers: Json
          final_feedback: string | null
          graded_at: string | null
          id: string
          objective_answers: Json
          ocr_raw: Json | null
          per_question_scores: Json
          posted_at: string | null
          posted_diary_entry_id: string | null
          posted_grade_entry_id: string | null
          status: Database["public"]["Enums"]["assessment_submission_status"]
          teacher_comment: string | null
          total_score: number | null
          updated_at: string
        }
        Insert: {
          ai_feedback?: Json | null
          assignment_id: string
          created_at?: string
          essay_answers?: Json
          final_feedback?: string | null
          graded_at?: string | null
          id?: string
          objective_answers?: Json
          ocr_raw?: Json | null
          per_question_scores?: Json
          posted_at?: string | null
          posted_diary_entry_id?: string | null
          posted_grade_entry_id?: string | null
          status?: Database["public"]["Enums"]["assessment_submission_status"]
          teacher_comment?: string | null
          total_score?: number | null
          updated_at?: string
        }
        Update: {
          ai_feedback?: Json | null
          assignment_id?: string
          created_at?: string
          essay_answers?: Json
          final_feedback?: string | null
          graded_at?: string | null
          id?: string
          objective_answers?: Json
          ocr_raw?: Json | null
          per_question_scores?: Json
          posted_at?: string | null
          posted_diary_entry_id?: string | null
          posted_grade_entry_id?: string | null
          status?: Database["public"]["Enums"]["assessment_submission_status"]
          teacher_comment?: string | null
          total_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: true
            referencedRelation: "assessment_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_versions: {
        Row: {
          answer_key: Json
          assessment_id: string
          created_at: string
          id: string
          option_orders: Json
          question_order: Json
          version_label: string
        }
        Insert: {
          answer_key?: Json
          assessment_id: string
          created_at?: string
          id?: string
          option_orders?: Json
          question_order?: Json
          version_label: string
        }
        Update: {
          answer_key?: Json
          assessment_id?: string
          created_at?: string
          id?: string
          option_orders?: Json
          question_order?: Json
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_versions_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          apostila_generation_id: string | null
          application_format: string | null
          assessment_date: string | null
          assessment_schedule: string | null
          config: Json
          control_number: string | null
          control_scope_key: string | null
          control_sequence: number | null
          control_year: number | null
          copies_per_version: number
          created_at: string
          created_by: string
          diary_assessment_id: string | null
          discipline_id: string
          group_dates: Json | null
          id: string
          layout: Database["public"]["Enums"]["assessment_layout"]
          layout_rationale: string | null
          lessons: Json
          max_score: number
          module_name: string | null
          rigor: string
          status: Database["public"]["Enums"]["assessment_status"]
          title: string
          updated_at: string
          version_count: number
        }
        Insert: {
          apostila_generation_id?: string | null
          application_format?: string | null
          assessment_date?: string | null
          assessment_schedule?: string | null
          config?: Json
          control_number?: string | null
          control_scope_key?: string | null
          control_sequence?: number | null
          control_year?: number | null
          copies_per_version?: number
          created_at?: string
          created_by: string
          diary_assessment_id?: string | null
          discipline_id: string
          group_dates?: Json | null
          id?: string
          layout?: Database["public"]["Enums"]["assessment_layout"]
          layout_rationale?: string | null
          lessons?: Json
          max_score?: number
          module_name?: string | null
          rigor?: string
          status?: Database["public"]["Enums"]["assessment_status"]
          title: string
          updated_at?: string
          version_count?: number
        }
        Update: {
          apostila_generation_id?: string | null
          application_format?: string | null
          assessment_date?: string | null
          assessment_schedule?: string | null
          config?: Json
          control_number?: string | null
          control_scope_key?: string | null
          control_sequence?: number | null
          control_year?: number | null
          copies_per_version?: number
          created_at?: string
          created_by?: string
          diary_assessment_id?: string | null
          discipline_id?: string
          group_dates?: Json | null
          id?: string
          layout?: Database["public"]["Enums"]["assessment_layout"]
          layout_rationale?: string | null
          lessons?: Json
          max_score?: number
          module_name?: string | null
          rigor?: string
          status?: Database["public"]["Enums"]["assessment_status"]
          title?: string
          updated_at?: string
          version_count?: number
        }
        Relationships: []
      }
      attendance_records: {
        Row: {
          confirmed_at: string | null
          created_at: string
          id: string
          session_id: string
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          session_id: string
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          id?: string
          session_id?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions_view"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_sessions: {
        Row: {
          closed_at: string | null
          code: string
          code_window_minutes: number
          created_at: string
          discipline_id: string
          finalized_at: string | null
          finalized_by: string | null
          id: string
          pedagogical_observations: string | null
          programmatic_content: string | null
          session_date: string
          starts_at: string
          teacher_id: string
          topic: string | null
          window_hours: number
        }
        Insert: {
          closed_at?: string | null
          code: string
          code_window_minutes?: number
          created_at?: string
          discipline_id: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          pedagogical_observations?: string | null
          programmatic_content?: string | null
          session_date?: string
          starts_at?: string
          teacher_id: string
          topic?: string | null
          window_hours?: number
        }
        Update: {
          closed_at?: string | null
          code?: string
          code_window_minutes?: number
          created_at?: string
          discipline_id?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          pedagogical_observations?: string | null
          programmatic_content?: string | null
          session_date?: string
          starts_at?: string
          teacher_id?: string
          topic?: string | null
          window_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      authorized_students: {
        Row: {
          created_at: string | null
          enrollment_number: string
          id: string
          institution_id: string | null
          name: string
          status: string
        }
        Insert: {
          created_at?: string | null
          enrollment_number: string
          id?: string
          institution_id?: string | null
          name: string
          status?: string
        }
        Update: {
          created_at?: string | null
          enrollment_number?: string
          id?: string
          institution_id?: string | null
          name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "authorized_students_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          discipline_id: string
          end_date: string | null
          event_date: string
          id: string
          kind: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          discipline_id: string
          end_date?: string | null
          event_date: string
          id?: string
          kind?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          discipline_id?: string
          end_date?: string | null
          event_date?: string
          id?: string
          kind?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      catalog_item_grants: {
        Row: {
          catalog_item_id: string
          created_at: string
          id: string
          teacher_id: string
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          id?: string
          teacher_id: string
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_item_grants_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_item_grants_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["catalog_kind"]
          label: string
          prompt_hint: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["catalog_kind"]
          label: string
          prompt_hint?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["catalog_kind"]
          label?: string
          prompt_hint?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chat_message_reads: {
        Row: {
          id: string
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          id?: string
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          id?: string
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          body: string
          created_at: string
          discipline_id: string
          id: string
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          discipline_id: string
          id?: string
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          discipline_id?: string
          id?: string
          sender_id?: string
        }
        Relationships: []
      }
      clinical_cases: {
        Row: {
          allow_late_submission: boolean | null
          created_at: string
          decision_tree: Json
          description: string | null
          discipline_id: string
          due_date: string | null
          due_time: string | null
          id: string
          investigation_data: Json
          late_penalty_per_day: number | null
          late_penalty_type: string | null
          late_tolerance_date: string | null
          late_tolerance_time: string | null
          module_number: number | null
          objectives: string | null
          patient_info: Json
          scenario: string | null
          source_generation_id: string | null
          status: Database["public"]["Enums"]["case_status"]
          teacher_id: string
          title: string
          updated_at: string
        }
        Insert: {
          allow_late_submission?: boolean | null
          created_at?: string
          decision_tree?: Json
          description?: string | null
          discipline_id: string
          due_date?: string | null
          due_time?: string | null
          id?: string
          investigation_data?: Json
          late_penalty_per_day?: number | null
          late_penalty_type?: string | null
          late_tolerance_date?: string | null
          late_tolerance_time?: string | null
          module_number?: number | null
          objectives?: string | null
          patient_info?: Json
          scenario?: string | null
          source_generation_id?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          teacher_id: string
          title: string
          updated_at?: string
        }
        Update: {
          allow_late_submission?: boolean | null
          created_at?: string
          decision_tree?: Json
          description?: string | null
          discipline_id?: string
          due_date?: string | null
          due_time?: string | null
          id?: string
          investigation_data?: Json
          late_penalty_per_day?: number | null
          late_penalty_type?: string | null
          late_tolerance_date?: string | null
          late_tolerance_time?: string | null
          module_number?: number | null
          objectives?: string | null
          patient_info?: Json
          scenario?: string | null
          source_generation_id?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          teacher_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_cases_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_cases_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      custom_rubrics: {
        Row: {
          created_at: string
          criteria: Json
          grading_formula: string
          id: string
          name: string
          owner_id: string
          scope: string
          subtype: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          criteria?: Json
          grading_formula?: string
          id?: string
          name: string
          owner_id: string
          scope?: string
          subtype?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          criteria?: Json
          grading_formula?: string
          id?: string
          name?: string
          owner_id?: string
          scope?: string
          subtype?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      direct_messages: {
        Row: {
          body: string
          created_at: string
          discipline_id: string
          id: string
          read_at: string | null
          recipient_id: string
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          discipline_id: string
          id?: string
          read_at?: string | null
          recipient_id: string
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          discipline_id?: string
          id?: string
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      discipline_lab_config: {
        Row: {
          custom_media: Json | null
          discipline_id: string
          id: string
          is_active: boolean | null
          module_type: Database["public"]["Enums"]["lab_module_type"]
          updated_at: string | null
        }
        Insert: {
          custom_media?: Json | null
          discipline_id: string
          id?: string
          is_active?: boolean | null
          module_type: Database["public"]["Enums"]["lab_module_type"]
          updated_at?: string | null
        }
        Update: {
          custom_media?: Json | null
          discipline_id?: string
          id?: string
          is_active?: boolean | null
          module_type?: Database["public"]["Enums"]["lab_module_type"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discipline_lab_config_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      discipline_lab_simulations: {
        Row: {
          content: string
          created_at: string
          deadline: string | null
          diary_column_id: string | null
          discipline_id: string
          id: string
          image_url: string | null
          is_draft: boolean | null
          late_rule: string | null
          module_type: string
          questions: Json
          teacher_id: string | null
          title: string
        }
        Insert: {
          content: string
          created_at?: string
          deadline?: string | null
          diary_column_id?: string | null
          discipline_id: string
          id?: string
          image_url?: string | null
          is_draft?: boolean | null
          late_rule?: string | null
          module_type: string
          questions?: Json
          teacher_id?: string | null
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          deadline?: string | null
          diary_column_id?: string | null
          discipline_id?: string
          id?: string
          image_url?: string | null
          is_draft?: boolean | null
          late_rule?: string | null
          module_type?: string
          questions?: Json
          teacher_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "discipline_lab_simulations_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      discipline_lab_submissions: {
        Row: {
          answers: Json
          diary_column_id: string | null
          feedback: string | null
          grade: number | null
          id: string
          simulation_id: string
          student_id: string
          submitted_at: string
        }
        Insert: {
          answers?: Json
          diary_column_id?: string | null
          feedback?: string | null
          grade?: number | null
          id?: string
          simulation_id: string
          student_id: string
          submitted_at?: string
        }
        Update: {
          answers?: Json
          diary_column_id?: string | null
          feedback?: string | null
          grade?: number | null
          id?: string
          simulation_id?: string
          student_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discipline_lab_submissions_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "discipline_lab_simulations"
            referencedColumns: ["id"]
          },
        ]
      }
      discipline_settings: {
        Row: {
          attendance_window_hours: number
          created_at: string
          discipline_id: string
          id: string
          justified_counts_as_presence: boolean
          min_attendance_percent: number
          updated_at: string
        }
        Insert: {
          attendance_window_hours?: number
          created_at?: string
          discipline_id: string
          id?: string
          justified_counts_as_presence?: boolean
          min_attendance_percent?: number
          updated_at?: string
        }
        Update: {
          attendance_window_hours?: number
          created_at?: string
          discipline_id?: string
          id?: string
          justified_counts_as_presence?: boolean
          min_attendance_percent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discipline_settings_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: true
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      discipline_students: {
        Row: {
          discipline_id: string
          enrolled_at: string
          id: string
          status: Database["public"]["Enums"]["user_status"]
          student_id: string
        }
        Insert: {
          discipline_id: string
          enrolled_at?: string
          id?: string
          status?: Database["public"]["Enums"]["user_status"]
          student_id: string
        }
        Update: {
          discipline_id?: string
          enrolled_at?: string
          id?: string
          status?: Database["public"]["Enums"]["user_status"]
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discipline_students_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discipline_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      disciplines: {
        Row: {
          class_end_time: string | null
          class_start_time: string | null
          code: string | null
          color: string
          course_id: string | null
          created_at: string
          end_date: string | null
          grading_formula_mf: Json | null
          grading_formula_mp: Json | null
          group_name: string | null
          id: string
          institution_id: string | null
          location: string | null
          min_recovery_grade: number | null
          min_score_for_final: number | null
          name: string
          passing_grade: number | null
          recovery_behavior: string | null
          semester: string
          sort_order: number
          start_date: string | null
          status: string
          syllabus_file_url: string | null
          syllabus_text: string | null
          teacher_id: string
          visible_modules: Json | null
          week_days: string[] | null
          year: number
        }
        Insert: {
          class_end_time?: string | null
          class_start_time?: string | null
          code?: string | null
          color?: string
          course_id?: string | null
          created_at?: string
          end_date?: string | null
          grading_formula_mf?: Json | null
          grading_formula_mp?: Json | null
          group_name?: string | null
          id?: string
          institution_id?: string | null
          location?: string | null
          min_recovery_grade?: number | null
          min_score_for_final?: number | null
          name: string
          passing_grade?: number | null
          recovery_behavior?: string | null
          semester: string
          sort_order?: number
          start_date?: string | null
          status?: string
          syllabus_file_url?: string | null
          syllabus_text?: string | null
          teacher_id: string
          visible_modules?: Json | null
          week_days?: string[] | null
          year: number
        }
        Update: {
          class_end_time?: string | null
          class_start_time?: string | null
          code?: string | null
          color?: string
          course_id?: string | null
          created_at?: string
          end_date?: string | null
          grading_formula_mf?: Json | null
          grading_formula_mp?: Json | null
          group_name?: string | null
          id?: string
          institution_id?: string | null
          location?: string | null
          min_recovery_grade?: number | null
          min_score_for_final?: number | null
          name?: string
          passing_grade?: number | null
          recovery_behavior?: string | null
          semester?: string
          sort_order?: number
          start_date?: string | null
          status?: string
          syllabus_file_url?: string | null
          syllabus_text?: string | null
          teacher_id?: string
          visible_modules?: Json | null
          week_days?: string[] | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "disciplines_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disciplines_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disciplines_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      exercise_attempts: {
        Row: {
          answers: Json
          attempt_number: number
          completed_at: string
          discipline_id: string
          exercise_id: string
          feedback: Json | null
          id: string
          max_score: number
          score: number
          student_id: string
        }
        Insert: {
          answers: Json
          attempt_number: number
          completed_at?: string
          discipline_id: string
          exercise_id: string
          feedback?: Json | null
          id?: string
          max_score: number
          score: number
          student_id: string
        }
        Update: {
          answers?: Json
          attempt_number?: number
          completed_at?: string
          discipline_id?: string
          exercise_id?: string
          feedback?: Json | null
          id?: string
          max_score?: number
          score?: number
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_attempts_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_attempts_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_questions: {
        Row: {
          correct_answer: Json | null
          exercise_id: string
          explanation: string | null
          id: string
          options: Json | null
          points: number
          position: number
          prompt: string
        }
        Insert: {
          correct_answer?: Json | null
          exercise_id: string
          explanation?: string | null
          id?: string
          options?: Json | null
          points?: number
          position?: number
          prompt: string
        }
        Update: {
          correct_answer?: Json | null
          exercise_id?: string
          explanation?: string | null
          id?: string
          options?: Json | null
          points?: number
          position?: number
          prompt?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_questions_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_submissions: {
        Row: {
          answers: Json
          attempt_count: number
          exercise_id: string
          feedback: Json | null
          id: string
          max_score: number | null
          released_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          score: number | null
          status: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submitted_at: string
        }
        Insert: {
          answers?: Json
          attempt_count?: number
          exercise_id: string
          feedback?: Json | null
          id?: string
          max_score?: number | null
          released_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submitted_at?: string
        }
        Update: {
          answers?: Json
          attempt_count?: number
          exercise_id?: string
          feedback?: Json | null
          id?: string
          max_score?: number | null
          released_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercise_submissions_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          allow_late: boolean | null
          created_at: string
          created_by: string
          diary_assessment_id: string | null
          discipline_id: string
          due_at: string | null
          due_time: string | null
          id: string
          late_penalty_per_day: number | null
          late_penalty_type: string | null
          late_tolerance_date: string | null
          late_tolerance_time: string | null
          module_label: string | null
          question_count: number
          rubric: Json | null
          shuffle_options: boolean
          shuffle_questions: boolean
          status: Database["public"]["Enums"]["publish_status"]
          title: string
          topic: string | null
          type: Database["public"]["Enums"]["exercise_type"]
          updated_at: string
        }
        Insert: {
          allow_late?: boolean | null
          created_at?: string
          created_by: string
          diary_assessment_id?: string | null
          discipline_id: string
          due_at?: string | null
          due_time?: string | null
          id?: string
          late_penalty_per_day?: number | null
          late_penalty_type?: string | null
          late_tolerance_date?: string | null
          late_tolerance_time?: string | null
          module_label?: string | null
          question_count?: number
          rubric?: Json | null
          shuffle_options?: boolean
          shuffle_questions?: boolean
          status?: Database["public"]["Enums"]["publish_status"]
          title: string
          topic?: string | null
          type: Database["public"]["Enums"]["exercise_type"]
          updated_at?: string
        }
        Update: {
          allow_late?: boolean | null
          created_at?: string
          created_by?: string
          diary_assessment_id?: string | null
          discipline_id?: string
          due_at?: string | null
          due_time?: string | null
          id?: string
          late_penalty_per_day?: number | null
          late_penalty_type?: string | null
          late_tolerance_date?: string | null
          late_tolerance_time?: string | null
          module_label?: string | null
          question_count?: number
          rubric?: Json | null
          shuffle_options?: boolean
          shuffle_questions?: boolean
          status?: Database["public"]["Enums"]["publish_status"]
          title?: string
          topic?: string | null
          type?: Database["public"]["Enums"]["exercise_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exercises_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      grade_entries: {
        Row: {
          assessment_id: string
          created_at: string
          discipline_id: string
          id: string
          metadata: Json | null
          score: number | null
          student_id: string
          updated_at: string
        }
        Insert: {
          assessment_id: string
          created_at?: string
          discipline_id: string
          id?: string
          metadata?: Json | null
          score?: number | null
          student_id: string
          updated_at?: string
        }
        Update: {
          assessment_id?: string
          created_at?: string
          discipline_id?: string
          id?: string
          metadata?: Json | null
          score?: number | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grade_entries_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      grade_structures: {
        Row: {
          assessments: Json
          created_at: string
          discipline_id: string
          formula: string
          grade_scale: number
          id: string
          passing_average: number
          recovery_average: number | null
          recovery_config: Json | null
          recovery_min: number | null
          updated_at: string
        }
        Insert: {
          assessments?: Json
          created_at?: string
          discipline_id: string
          formula?: string
          grade_scale?: number
          id?: string
          passing_average?: number
          recovery_average?: number | null
          recovery_config?: Json | null
          recovery_min?: number | null
          updated_at?: string
        }
        Update: {
          assessments?: Json
          created_at?: string
          discipline_id?: string
          formula?: string
          grade_scale?: number
          id?: string
          passing_average?: number
          recovery_average?: number | null
          recovery_config?: Json | null
          recovery_min?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grade_structures_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: true
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      institutions: {
        Row: {
          created_at: string
          email: string | null
          id: string
          logo_url: string | null
          name: string
          owner_user_id: string | null
          status: Database["public"]["Enums"]["user_status"]
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          name: string
          owner_user_id?: string | null
          status?: Database["public"]["Enums"]["user_status"]
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          owner_user_id?: string | null
          status?: Database["public"]["Enums"]["user_status"]
        }
        Relationships: []
      }
      invitations: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          institution_id: string | null
          kind: Database["public"]["Enums"]["invitation_kind"]
          max_uses: number
          note: string | null
          recipient_email: string | null
          recipient_name: string | null
          revoked_at: string | null
          token: string
          used_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          institution_id?: string | null
          kind: Database["public"]["Enums"]["invitation_kind"]
          max_uses?: number
          note?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          revoked_at?: string | null
          token?: string
          used_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          institution_id?: string | null
          kind?: Database["public"]["Enums"]["invitation_kind"]
          max_uses?: number
          note?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          revoked_at?: string | null
          token?: string
          used_count?: number
        }
        Relationships: []
      }
      justifications: {
        Row: {
          attachment_url: string | null
          created_at: string
          description: string | null
          id: string
          reason: Database["public"]["Enums"]["justification_reason"]
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          session_id: string
          status: Database["public"]["Enums"]["justification_status"]
          student_id: string
          updated_at: string
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          reason: Database["public"]["Enums"]["justification_reason"]
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id: string
          status?: Database["public"]["Enums"]["justification_status"]
          student_id: string
          updated_at?: string
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          reason?: Database["public"]["Enums"]["justification_reason"]
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_id?: string
          status?: Database["public"]["Enums"]["justification_status"]
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "justifications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "justifications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "attendance_sessions_view"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_plan_items: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          discipline_id: string
          id: string
          kind: string
          metadata: Json
          module_number: number | null
          module_title: string | null
          plan_generation_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          discipline_id: string
          id?: string
          kind: string
          metadata?: Json
          module_number?: number | null
          module_title?: string | null
          plan_generation_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          discipline_id?: string
          id?: string
          kind?: string
          metadata?: Json
          module_number?: number | null
          module_title?: string | null
          plan_generation_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_plan_items_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_plan_items_plan_generation_id_fkey"
            columns: ["plan_generation_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
            referencedColumns: ["id"]
          },
        ]
      }
      material_modules: {
        Row: {
          created_at: string
          discipline_id: string
          id: string
          name: string
          position: number
        }
        Insert: {
          created_at?: string
          discipline_id: string
          id?: string
          name: string
          position?: number
        }
        Update: {
          created_at?: string
          discipline_id?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "material_modules_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          content: string | null
          created_at: string
          created_by: string
          description: string | null
          discipline_id: string
          file_url: string | null
          id: string
          module_id: string
          position: number
          source: string
          source_generation_id: string | null
          status: Database["public"]["Enums"]["publish_status"]
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          discipline_id: string
          file_url?: string | null
          id?: string
          module_id: string
          position?: number
          source?: string
          source_generation_id?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          discipline_id?: string
          file_url?: string | null
          id?: string
          module_id?: string
          position?: number
          source?: string
          source_generation_id?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "materials_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "material_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          enrollment_number: string | null
          id: string
          institution_id: string | null
          logo_url: string | null
          name: string
          password_set: boolean
          profile_type: Database["public"]["Enums"]["profile_type"]
          status: Database["public"]["Enums"]["user_status"]
        }
        Insert: {
          created_at?: string
          email?: string | null
          enrollment_number?: string | null
          id: string
          institution_id?: string | null
          logo_url?: string | null
          name?: string
          password_set?: boolean
          profile_type?: Database["public"]["Enums"]["profile_type"]
          status?: Database["public"]["Enums"]["user_status"]
        }
        Update: {
          created_at?: string
          email?: string | null
          enrollment_number?: string | null
          id?: string
          institution_id?: string | null
          logo_url?: string | null
          name?: string
          password_set?: boolean
          profile_type?: Database["public"]["Enums"]["profile_type"]
          status?: Database["public"]["Enums"]["user_status"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      student_diary_entries: {
        Row: {
          content: string
          created_at: string
          discipline_id: string
          id: string
          session_id: string | null
          student_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          content?: string
          created_at?: string
          discipline_id: string
          id?: string
          session_id?: string | null
          student_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          discipline_id?: string
          id?: string
          session_id?: string | null
          student_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      student_documents: {
        Row: {
          content: string
          created_at: string
          created_by: string
          discipline_id: string
          due_at: string | null
          id: string
          metadata: Json
          released_at: string | null
          status: Database["public"]["Enums"]["publish_status"]
          title: string
          tool: string
          updated_at: string
        }
        Insert: {
          content?: string
          created_at?: string
          created_by: string
          discipline_id: string
          due_at?: string | null
          id?: string
          metadata?: Json
          released_at?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          title: string
          tool: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          discipline_id?: string
          due_at?: string | null
          id?: string
          metadata?: Json
          released_at?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
          title?: string
          tool?: string
          updated_at?: string
        }
        Relationships: []
      }
      student_submissions: {
        Row: {
          answers: Json
          case_id: string
          diary_assessment_id: string | null
          feedback: string | null
          graded_at: string | null
          id: string
          score: number | null
          status: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submitted_at: string
          teacher_comment: string | null
        }
        Insert: {
          answers?: Json
          case_id: string
          diary_assessment_id?: string | null
          feedback?: string | null
          graded_at?: string | null
          id?: string
          score?: number | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submitted_at?: string
          teacher_comment?: string | null
        }
        Update: {
          answers?: Json
          case_id?: string
          diary_assessment_id?: string | null
          feedback?: string | null
          graded_at?: string | null
          id?: string
          score?: number | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id?: string
          submitted_at?: string
          teacher_comment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_submissions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "clinical_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount_cents: number | null
          cancel_at_period_end: boolean
          created_at: string
          currency: string | null
          current_period_end: string | null
          environment: string
          id: string
          plan_code: string
          plan_name: string
          provider: string | null
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          subscriber_id: string
          subscriber_kind: Database["public"]["Enums"]["subscriber_kind"]
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          cancel_at_period_end?: boolean
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          environment?: string
          id?: string
          plan_code?: string
          plan_name?: string
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          subscriber_id: string
          subscriber_kind: Database["public"]["Enums"]["subscriber_kind"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          cancel_at_period_end?: boolean
          created_at?: string
          currency?: string | null
          current_period_end?: string | null
          environment?: string
          id?: string
          plan_code?: string
          plan_name?: string
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          subscriber_id?: string
          subscriber_kind?: Database["public"]["Enums"]["subscriber_kind"]
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      // ==== INICIO: blocos manuais de avaliações online ====
      // Estas 4 tabelas foram criadas direto no SQL Editor e ainda não entram
      // no types.ts gerado. Blocos entre estes marcadores são SOBREPOSTOS
      // quando o types.ts for regenerado a partir do banco.
      exam_answers: {
        Row: {
          answer: Json | null
          answered_at: string | null
          auto_score: number | null
          created_at: string
          flagged: boolean
          grader_comment: string | null
          id: string
          is_blank: boolean
          is_correct: boolean | null
          manual_score: number | null
          max_points: number | null
          points_awarded: number | null
          question_id: string
          session_id: string
          updated_at: string
        }
        Insert: {
          answer?: Json | null
          answered_at?: string | null
          auto_score?: number | null
          created_at?: string
          flagged?: boolean
          grader_comment?: string | null
          id?: string
          is_blank?: boolean
          is_correct?: boolean | null
          manual_score?: number | null
          max_points?: number | null
          points_awarded?: number | null
          question_id: string
          session_id: string
          updated_at?: string
        }
        Update: {
          answer?: Json | null
          answered_at?: string | null
          auto_score?: number | null
          created_at?: string
          flagged?: boolean
          grader_comment?: string | null
          id?: string
          is_blank?: boolean
          is_correct?: boolean | null
          manual_score?: number | null
          max_points?: number | null
          points_awarded?: number | null
          question_id?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      exam_sessions: {
        Row: {
          access_token: string
          attempt_number: number
          biometric_match_score: number | null
          biometric_ref: string | null
          biometric_status: Database["public"]["Enums"]["biometric_verify_result"]
          created_at: string
          exam_id: string
          expires_at: string | null
          final_feedback: string | null
          focus_lost_count: number
          fullscreen_exits: number
          graded_at: string | null
          id: string
          identity_snapshot: Json
          integrity_flags: Json
          last_activity_at: string | null
          score: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["exam_session_status"]
          student_id: string
          submitted_at: string | null
          tab_switches: number
          updated_at: string
        }
        Insert: {
          access_token?: string
          attempt_number?: number
          biometric_match_score?: number | null
          biometric_ref?: string | null
          biometric_status?: Database["public"]["Enums"]["biometric_verify_result"]
          created_at?: string
          exam_id: string
          expires_at?: string | null
          final_feedback?: string | null
          focus_lost_count?: number
          fullscreen_exits?: number
          graded_at?: string | null
          id?: string
          identity_snapshot?: Json
          integrity_flags?: Json
          last_activity_at?: string | null
          score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["exam_session_status"]
          student_id: string
          submitted_at?: string | null
          tab_switches?: number
          updated_at?: string
        }
        Update: {
          access_token?: string
          attempt_number?: number
          biometric_match_score?: number | null
          biometric_ref?: string | null
          biometric_status?: Database["public"]["Enums"]["biometric_verify_result"]
          created_at?: string
          exam_id?: string
          expires_at?: string | null
          final_feedback?: string | null
          focus_lost_count?: number
          fullscreen_exits?: number
          graded_at?: string | null
          id?: string
          identity_snapshot?: Json
          integrity_flags?: Json
          last_activity_at?: string | null
          score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["exam_session_status"]
          student_id?: string
          submitted_at?: string | null
          tab_switches?: number
          updated_at?: string
        }
        Relationships: []
      }
      online_exams: {
        Row: {
          allow_resume: boolean
          assessment_id: string
          biometric_kind_required: Database["public"]["Enums"]["biometric_kind"] | null
          biometric_required: boolean
          closes_at: string | null
          config: Json
          created_at: string
          created_by: string
          discipline_id: string
          id: string
          instructions: string | null
          max_attempts: number
          max_score: number
          opens_at: string | null
          proctoring_enabled: boolean
          randomize_options: boolean
          randomize_questions: boolean
          require_face_match: boolean
          status: Database["public"]["Enums"]["online_exam_status"]
          tab_switch_limit: number | null
          time_limit_minutes: number
          title: string
          updated_at: string
        }
        Insert: {
          allow_resume?: boolean
          assessment_id: string
          biometric_kind_required?: Database["public"]["Enums"]["biometric_kind"] | null
          biometric_required?: boolean
          closes_at?: string | null
          config?: Json
          created_at?: string
          created_by: string
          discipline_id: string
          id?: string
          instructions?: string | null
          max_attempts?: number
          max_score?: number
          opens_at?: string | null
          proctoring_enabled?: boolean
          randomize_options?: boolean
          randomize_questions?: boolean
          require_face_match?: boolean
          status?: Database["public"]["Enums"]["online_exam_status"]
          tab_switch_limit?: number | null
          time_limit_minutes?: number
          title: string
          updated_at?: string
        }
        Update: {
          allow_resume?: boolean
          assessment_id?: string
          biometric_kind_required?: Database["public"]["Enums"]["biometric_kind"] | null
          biometric_required?: boolean
          closes_at?: string | null
          config?: Json
          created_at?: string
          created_by?: string
          discipline_id?: string
          id?: string
          instructions?: string | null
          max_attempts?: number
          max_score?: number
          opens_at?: string | null
          proctoring_enabled?: boolean
          randomize_options?: boolean
          randomize_questions?: boolean
          require_face_match?: boolean
          status?: Database["public"]["Enums"]["online_exam_status"]
          tab_switch_limit?: number | null
          time_limit_minutes?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_biometrics: {
        Row: {
          created_at: string
          device_label: string | null
          enrolled_at: string
          id: string
          is_active: boolean
          is_primary: boolean
          kind: Database["public"]["Enums"]["biometric_kind"]
          last_verified_at: string | null
          provider: string
          provider_ref: string | null
          quality_score: number | null
          template_data: Json
          template_hash: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          enrolled_at?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          kind?: Database["public"]["Enums"]["biometric_kind"]
          last_verified_at?: string | null
          provider?: string
          provider_ref?: string | null
          quality_score?: number | null
          template_data?: Json
          template_hash?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_label?: string | null
          enrolled_at?: string
          id?: string
          is_active?: boolean
          is_primary?: boolean
          kind?: Database["public"]["Enums"]["biometric_kind"]
          last_verified_at?: string | null
          provider?: string
          provider_ref?: string | null
          quality_score?: number | null
          template_data?: Json
          template_hash?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      // ==== FIM: blocos manuais de avaliações online ====
    }
    Views: {
      attendance_sessions_view: {
        Row: {
          closed_at: string | null
          code: string | null
          code_window_minutes: number | null
          created_at: string | null
          discipline_id: string | null
          finalized_at: string | null
          finalized_by: string | null
          id: string | null
          session_date: string | null
          starts_at: string | null
          teacher_id: string | null
          topic: string | null
          window_hours: number | null
        }
        Insert: {
          closed_at?: string | null
          code?: never
          code_window_minutes?: number | null
          created_at?: string | null
          discipline_id?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string | null
          session_date?: string | null
          starts_at?: string | null
          teacher_id?: string | null
          topic?: string | null
          window_hours?: number | null
        }
        Update: {
          closed_at?: string | null
          code?: never
          code_window_minutes?: number | null
          created_at?: string | null
          discipline_id?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string | null
          session_date?: string | null
          starts_at?: string | null
          teacher_id?: string | null
          topic?: string | null
          window_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
        ]
      }
      exercise_questions_student: {
        Row: {
          exercise_id: string | null
          id: string | null
          options: Json | null
          points: number | null
          position: number | null
          prompt: string | null
        }
        Insert: {
          exercise_id?: string | null
          id?: string | null
          options?: Json | null
          points?: number | null
          position?: number | null
          prompt?: string | null
        }
        Update: {
          exercise_id?: string | null
          id?: string | null
          options?: Json | null
          points?: number | null
          position?: number | null
          prompt?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercise_questions_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      student_exercise_summary: {
        Row: {
          best_score: number | null
          discipline_id: string | null
          exercise_id: string | null
          exercise_title: string | null
          is_completed: boolean | null
          last_attempt_at: string | null
          max_score: number | null
          student_id: string | null
          student_name: string | null
          student_registration: string | null
          total_attempts: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exercise_attempts_discipline_id_fkey"
            columns: ["discipline_id"]
            isOneToOne: false
            referencedRelation: "disciplines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_attempts_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      unified_users: {
        Row: {
          created_at: string | null
          email: string | null
          enrollment_number: string | null
          id: string | null
          institution_id: string | null
          name: string | null
          profile_type: string | null
          status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_student_enrollment: {
        Args: { _discipline_id: string; _user_id: string }
        Returns: boolean
      }
      consume_invitation: {
        Args: {
          _email: string
          _name: string
          _token: string
          _user_id: string
        }
        Returns: string
      }
      current_institution_id: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      detect_generic_placeholder: { Args: { prompt: string }; Returns: string }
      discipline_institution_id: {
        Args: { _discipline_id: string }
        Returns: string
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      generate_discipline_alpha_code: { Args: never; Returns: string }
      get_profiles_safe: {
        Args: { _ids: string[] }
        Returns: {
          enrollment_number: string
          id: string
          name: string
          profile_type: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_admin_profile: { Args: { _user_id: string }; Returns: boolean }
      is_discipline_member: {
        Args: { _discipline_id: string; _user_id: string }
        Returns: boolean
      }
      is_discipline_student: {
        Args: { _discipline_id: string; _user_id: string }
        Returns: boolean
      }
      is_discipline_teacher: {
        Args: { _discipline_id: string; _user_id: string }
        Returns: boolean
      }
      list_enrollable_teachers: {
        Args: never
        Returns: {
          id: string
          institution_name: string
          name: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reserve_assessment_control: {
        Args: {
          _discipline_id: string
          _issued_at?: string
          _module_name: string
        }
        Returns: {
          out_control_number: string
          out_control_scope_key: string
          out_control_sequence: number
          out_control_year: number
        }[]
      }
      teacher_has_paid_plan:
        | { Args: { _user_id: string }; Returns: boolean }
        | { Args: { _env?: string; _user_id: string }; Returns: boolean }
    }
    Enums: {
      // ==== INICIO: enums manuais de avaliações online ====
      // Serão substituídos quando o types.ts for regenerado do banco.
      biometric_kind: "face" | "fingerprint" | "iris" | "voice"
      biometric_verify_result: "pending" | "verified" | "failed" | "skipped"
      exam_session_status:
        | "not_started"
        | "in_progress"
        | "submitted"
        | "graded"
        | "invalidated"
      online_exam_status: "draft" | "scheduled" | "open" | "closed" | "archived"
      // ==== FIM: enums manuais ====
      academic_work_subtype:
        | "tcc"
        | "artigo_cientifico"
        | "revisao_literatura"
        | "estudo_caso_academico"
        | "projeto_intervencao"
        | "relatorio_pesquisa"
        | "resumo_expandido"
        | "poster_cientifico"
        | "tema_predefinido"
      activity_subtype:
        | "case_study"
        | "practical_report"
        | "care_plan"
        | "pharmaceutical_plan"
        | "free_activity"
        | "redacao"
        | "seminario"
        | "debate"
        | "visita_tecnica"
        | "aula_pratica"
        | "workshop"
      app_role: "admin" | "institution" | "teacher" | "student" | "gestor"
      assessment_layout: "one_column" | "two_columns" | "mixed"
      assessment_question_type:
        | "multiple_choice"
        | "true_false"
        | "fill_blank"
        | "essay"
      assessment_status: "draft" | "ready" | "archived"
      assessment_submission_status:
        | "pending"
        | "graded_objective"
        | "awaiting_review"
        | "confirmed"
        | "posted"
      attendance_status: "present" | "absent" | "justified" | "no_class"
      case_status: "draft" | "published" | "archived"
      catalog_kind:
        | "activity_subtype"
        | "work_subtype"
        | "question_type"
        | "research_theme"
      discipline_status: "active" | "archived"
      exercise_type:
        | "multiple_choice"
        | "true_false"
        | "fill_blanks"
        | "short_answer"
        | "column_matching"
      group_activity_kind: "activity" | "work"
      invitation_kind: "institution" | "teacher"
      justification_reason:
        | "work_shift"
        | "student_illness"
        | "family_illness"
        | "variable_schedule"
        | "personal_emergency"
      justification_status: "pending" | "approved" | "rejected"
      lab_module_type:
        | "biosseguranca"
        | "pre_analitica"
        | "hematologia"
        | "urinalise_fisica_quimica"
        | "urinalise_microscopica"
        | "microbiologia"
        | "bioquímica"
        | "mega_caso_integrador"
      notification_kind:
        | "justification_decision"
        | "attendance_session_open"
        | "new_material"
        | "new_exercise"
        | "new_activity"
        | "new_work"
        | "feedback_available"
        | "grade_published"
        | "new_submission"
        | "direct_message"
      profile_type: "admin" | "institution" | "teacher" | "student"
      publish_status: "draft" | "published"
      submission_status:
        | "draft"
        | "submitted"
        | "ai_corrected"
        | "teacher_reviewed"
        | "released"
        | "corrected"
      subscriber_kind: "teacher" | "institution"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "incomplete"
        | "expired"
      user_status: "active" | "inactive" | "pending"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      academic_work_subtype: [
        "tcc",
        "artigo_cientifico",
        "revisao_literatura",
        "estudo_caso_academico",
        "projeto_intervencao",
        "relatorio_pesquisa",
        "resumo_expandido",
        "poster_cientifico",
        "tema_predefinido",
      ],
      activity_subtype: [
        "case_study",
        "practical_report",
        "care_plan",
        "pharmaceutical_plan",
        "free_activity",
        "redacao",
        "seminario",
        "debate",
        "visita_tecnica",
        "aula_pratica",
        "workshop",
      ],
      app_role: ["admin", "institution", "teacher", "student", "gestor"],
      assessment_layout: ["one_column", "two_columns", "mixed"],
      assessment_question_type: [
        "multiple_choice",
        "true_false",
        "fill_blank",
        "essay",
      ],
      assessment_status: ["draft", "ready", "archived"],
      assessment_submission_status: [
        "pending",
        "graded_objective",
        "awaiting_review",
        "confirmed",
        "posted",
      ],
      attendance_status: ["present", "absent", "justified", "no_class"],
      case_status: ["draft", "published", "archived"],
      catalog_kind: [
        "activity_subtype",
        "work_subtype",
        "question_type",
        "research_theme",
      ],
      discipline_status: ["active", "archived"],
      exercise_type: [
        "multiple_choice",
        "true_false",
        "fill_blanks",
        "short_answer",
        "column_matching",
      ],
      group_activity_kind: ["activity", "work"],
      invitation_kind: ["institution", "teacher"],
      justification_reason: [
        "work_shift",
        "student_illness",
        "family_illness",
        "variable_schedule",
        "personal_emergency",
      ],
      justification_status: ["pending", "approved", "rejected"],
      lab_module_type: [
        "biosseguranca",
        "pre_analitica",
        "hematologia",
        "urinalise_fisica_quimica",
        "urinalise_microscopica",
        "microbiologia",
        "bioquímica",
        "mega_caso_integrador",
      ],
      notification_kind: [
        "justification_decision",
        "attendance_session_open",
        "new_material",
        "new_exercise",
        "new_activity",
        "new_work",
        "feedback_available",
        "grade_published",
        "new_submission",
        "direct_message",
      ],
      profile_type: ["admin", "institution", "teacher", "student"],
      publish_status: ["draft", "published"],
      submission_status: [
        "draft",
        "submitted",
        "ai_corrected",
        "teacher_reviewed",
        "released",
        "corrected",
      ],
      subscriber_kind: ["teacher", "institution"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "canceled",
        "incomplete",
        "expired",
      ],
      user_status: ["active", "inactive", "pending"],
    },
  },
} as const
