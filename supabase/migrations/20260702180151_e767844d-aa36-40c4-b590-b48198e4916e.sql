
-- 1) subscriptions: remove client-facing SELECT so billing provider identifiers
--    (stripe_customer_id, stripe_subscription_id, provider_customer_id, etc.) can
--    never be read from the client. All reads go through the getMySubscription
--    server function (service role, safe columns only).
DROP POLICY IF EXISTS "Owners view own subscription" ON public.subscriptions;
REVOKE SELECT ON public.subscriptions FROM authenticated;
REVOKE SELECT ON public.subscriptions FROM anon;

-- 2) attendance_sessions: stop broadcasting the base table (which contains the
--    one-time check-in "code") over Realtime. Clients refresh via the masked
--    attendance_sessions_view and the still-published attendance_records events.
ALTER PUBLICATION supabase_realtime DROP TABLE public.attendance_sessions;

-- 3) assessment_questions: revoke all direct client access to correct answers /
--    explanations. Teachers/admins operate only through service-role server
--    functions; students never read this table directly.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.assessment_questions FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.assessment_questions FROM anon;

-- 4) discipline_students: scope the teacher-management policy to authenticated
--    instead of the public role to make intent explicit and remove any anon edge case.
DROP POLICY IF EXISTS "Teachers manage enrollments in own disciplines" ON public.discipline_students;
CREATE POLICY "Teachers manage enrollments in own disciplines"
  ON public.discipline_students
  FOR ALL
  TO authenticated
  USING (is_discipline_teacher(discipline_id, auth.uid()))
  WITH CHECK (is_discipline_teacher(discipline_id, auth.uid()));
