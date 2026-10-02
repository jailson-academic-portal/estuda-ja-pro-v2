ALTER VIEW public.exercise_questions_student SET (security_invoker = false);
GRANT SELECT ON public.exercise_questions_student TO authenticated;