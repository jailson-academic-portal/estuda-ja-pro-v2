-- Alunos matriculados podem ler as sessões de presença da disciplina
CREATE POLICY "Enrolled students can read attendance sessions"
ON public.attendance_sessions
FOR SELECT
TO authenticated
USING (public.is_discipline_student(discipline_id, auth.uid()));

-- Gestores da instituição podem ler as sessões das disciplinas da instituição
CREATE POLICY "Institution managers can read attendance sessions"
ON public.attendance_sessions
FOR SELECT
TO authenticated
USING (
  public.discipline_institution_id(discipline_id) IS NOT NULL
  AND public.discipline_institution_id(discipline_id) = public.current_institution_id()
);