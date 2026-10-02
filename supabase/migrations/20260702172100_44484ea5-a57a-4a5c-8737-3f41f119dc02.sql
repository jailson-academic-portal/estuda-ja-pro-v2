-- assessment_assignments: drop student SELECT policy that exposed shuffled answer keys.
-- Students never read this table directly (all access is server-side via service role).
DROP POLICY IF EXISTS "Students see own assignment" ON public.assessment_assignments;
REVOKE SELECT ON public.assessment_assignments FROM anon;

-- attendance_sessions: drop institution SELECT policy that exposed the one-time check-in code.
-- Institution/teacher/student clients read the masked attendance_sessions_view instead.
DROP POLICY IF EXISTS "Institutions see attendance sessions" ON public.attendance_sessions;

-- exercise_questions: remove direct client read of correct_answer/explanation.
-- Students read the exercise_questions_student view (no answers); teachers use service role.
REVOKE SELECT ON public.exercise_questions FROM authenticated;
REVOKE SELECT ON public.exercise_questions FROM anon;

-- subscriptions: column-level security so subscribers cannot read billing provider identifiers
-- (stripe/provider customer & subscription ids). Owners keep read access to plan/status columns.
REVOKE SELECT ON public.subscriptions FROM anon;
REVOKE SELECT ON public.subscriptions FROM authenticated;
GRANT SELECT (
  id, subscriber_id, subscriber_kind, plan_code, plan_name, status,
  current_period_end, cancel_at_period_end, provider, amount_cents,
  currency, created_at, updated_at, environment
) ON public.subscriptions TO authenticated;