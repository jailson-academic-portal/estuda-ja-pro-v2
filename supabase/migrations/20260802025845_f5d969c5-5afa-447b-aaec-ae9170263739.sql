-- Fix "subscriptions_no_owner_read_policy"
CREATE POLICY "Users see own subscriptions" ON public.subscriptions
FOR SELECT TO authenticated USING (subscriber_id = auth.uid());

-- Fix "grade_entries_no_owner_delete_update_restriction_check"
DROP POLICY IF EXISTS "Teachers manage grades in own disciplines" ON public.grade_entries;
CREATE POLICY "Teachers manage grades in own disciplines" ON public.grade_entries
FOR ALL TO authenticated 
USING (
    has_role(auth.uid(), 'admin'::app_role) OR 
    EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = grade_entries.discipline_id AND d.teacher_id = auth.uid())
)
WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR 
    EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = grade_entries.discipline_id AND d.teacher_id = auth.uid())
);

-- Fix "profiles_institution_role_no_select_policy"
DROP POLICY IF EXISTS "Users see their own profile" ON public.profiles;
CREATE POLICY "Users see their own profile" ON public.profiles
FOR SELECT TO authenticated USING (id = auth.uid());

-- Fix "matricula_login_takeover"
DO $$ 
BEGIN 
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'matricula') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_matricula') THEN
      ALTER TABLE public.profiles ADD CONSTRAINT unique_matricula UNIQUE (matricula);
    END IF;
  END IF;
END $$;

-- Fix ERROR 1 & 2: Security Definer Views
DROP VIEW IF EXISTS public.attendance_sessions_view;
CREATE VIEW public.attendance_sessions_view WITH (security_invoker = true) AS
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
            WHEN ((teacher_id = auth.uid()) OR (has_role(auth.uid(), 'admin'::app_role))) THEN code
            ELSE NULL::text
        END AS code,
    closed_at
   FROM public.attendance_sessions s
  WHERE ((teacher_id = auth.uid()) OR (has_role(auth.uid(), 'admin'::app_role)) OR (EXISTS ( SELECT 1
           FROM public.discipline_students ds
          WHERE ((ds.discipline_id = s.discipline_id) AND (ds.student_id = auth.uid())))) OR (EXISTS ( SELECT 1
           FROM public.disciplines d
          WHERE ((d.id = s.discipline_id) AND (d.institution_id = current_institution_id())))));
GRANT SELECT ON public.attendance_sessions_view TO authenticated;

DROP VIEW IF EXISTS public.exercise_questions_student;
CREATE VIEW public.exercise_questions_student WITH (security_invoker = true) AS
 SELECT id,
    exercise_id,
    "position",
    prompt,
    options,
    points
   FROM public.exercise_questions eq
  WHERE (EXISTS ( SELECT 1
           FROM (public.exercises e
             JOIN public.discipline_students ds ON ((ds.discipline_id = e.discipline_id)))
          WHERE ((e.id = eq.exercise_id) AND (e.status = 'published'::publish_status) AND (ds.student_id = auth.uid()))));
GRANT SELECT ON public.exercise_questions_student TO authenticated;

-- Fix Warn 3 & 4: Set search_path for identified functions with corrected signatures
ALTER FUNCTION public.enqueue_email(queue_name text, payload jsonb) SET search_path = public;
ALTER FUNCTION public.delete_email(queue_name text, message_id bigint) SET search_path = public;
ALTER FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) SET search_path = public;
ALTER FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) SET search_path = public;

-- Standardize grants
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
GRANT ALL ON public.profiles TO service_role;
