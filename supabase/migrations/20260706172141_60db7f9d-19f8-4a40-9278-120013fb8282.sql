ALTER TABLE public.attendance_sessions ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE OR REPLACE VIEW public.attendance_sessions_view AS
SELECT id,
    discipline_id,
    teacher_id,
    session_date,
    starts_at,
    topic,
    window_hours,
    code_window_minutes,
    created_at,
    finalized_at,
    finalized_by,
        CASE
            WHEN teacher_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) THEN code
            ELSE NULL::text
        END AS code,
    s.closed_at
   FROM attendance_sessions s
  WHERE teacher_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR (EXISTS ( SELECT 1
           FROM discipline_students ds
          WHERE ds.discipline_id = s.discipline_id AND ds.student_id = auth.uid())) OR (EXISTS ( SELECT 1
           FROM disciplines d
          WHERE d.id = s.discipline_id AND d.institution_id = current_institution_id()));