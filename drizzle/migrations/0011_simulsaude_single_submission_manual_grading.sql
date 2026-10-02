-- Alunos não podem mais alterar/apagar o próprio envio (nem a nota): mantém apenas SELECT e INSERT.
DROP POLICY IF EXISTS "student_sub_student_access" ON public.student_submissions;

-- Envio único + correção manual: o aluno só envia uma vez por caso e nunca grava nota/feedback.
CREATE OR REPLACE FUNCTION public.enforce_single_clinical_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.student_submissions
    WHERE case_id = NEW.case_id AND student_id = NEW.student_id
  ) THEN
    RAISE EXCEPTION 'Você já enviou este caso clínico. Aguarde a correção do professor.'
      USING ERRCODE = '23505';
  END IF;

  -- Nenhuma nota automática: o envio sempre entra como "submitted", sem nota/feedback.
  NEW.status := 'submitted';
  NEW.score := NULL;
  NEW.feedback := NULL;
  NEW.teacher_comment := NULL;
  NEW.graded_at := NULL;
  NEW.diary_assessment_id := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_clinical_submission ON public.student_submissions;
CREATE TRIGGER trg_enforce_single_clinical_submission
BEFORE INSERT ON public.student_submissions
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_clinical_submission();

-- Leitura dos professores para a matrícula do aluno (apenas id, nome e instituição; sem e-mail).
CREATE OR REPLACE FUNCTION public.list_enrollable_teachers()
RETURNS TABLE(id uuid, name text, institution_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.id, COALESCE(p.name, 'Professor(a)') AS name, i.name AS institution_name
  FROM public.profiles p
  LEFT JOIN public.institutions i ON i.id = p.institution_id
  WHERE auth.uid() IS NOT NULL
    AND (p.profile_type = 'teacher'
         OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'teacher'))
  ORDER BY 2;
$$;

REVOKE ALL ON FUNCTION public.list_enrollable_teachers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_enrollable_teachers() TO authenticated;