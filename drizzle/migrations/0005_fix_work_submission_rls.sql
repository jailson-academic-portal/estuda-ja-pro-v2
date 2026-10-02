-- Storage: permitir que o aluno envie/leia arquivos na sua própria pasta (uid/disciplina/trabalho/arquivo)
DROP POLICY IF EXISTS "work_submissions_student_insert" ON storage.objects;
CREATE POLICY "work_submissions_student_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'submissions'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "work_submissions_student_select" ON storage.objects;
CREATE POLICY "work_submissions_student_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'submissions'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "work_submissions_student_update" ON storage.objects;
CREATE POLICY "work_submissions_student_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'submissions'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'submissions'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Professor/admin: leitura dos arquivos enviados pelos alunos das suas disciplinas
DROP POLICY IF EXISTS "work_submissions_teacher_select" ON storage.objects;
CREATE POLICY "work_submissions_teacher_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'submissions'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.disciplines d
      WHERE d.id::text = (storage.foldername(name))[2]
        AND d.teacher_id = auth.uid()
    )
  )
);

-- Tabela de entregas: garantir INSERT/UPDATE do próprio aluno ou do grupo
DROP POLICY IF EXISTS "work_submissions_student_write" ON public.academic_work_submissions;
CREATE POLICY "work_submissions_student_write"
ON public.academic_work_submissions FOR INSERT TO authenticated
WITH CHECK (
  student_id = auth.uid()
  OR (
    group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.activity_groups g
      WHERE g.id = group_id
        AND (g.leader_id = auth.uid() OR auth.uid() = ANY (g.member_ids))
    )
  )
);

DROP POLICY IF EXISTS "work_submissions_student_update_own" ON public.academic_work_submissions;
CREATE POLICY "work_submissions_student_update_own"
ON public.academic_work_submissions FOR UPDATE TO authenticated
USING (
  student_id = auth.uid()
  OR (
    group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.activity_groups g
      WHERE g.id = group_id
        AND (g.leader_id = auth.uid() OR auth.uid() = ANY (g.member_ids))
    )
  )
)
WITH CHECK (
  student_id = auth.uid()
  OR (
    group_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.activity_groups g
      WHERE g.id = group_id
        AND (g.leader_id = auth.uid() OR auth.uid() = ANY (g.member_ids))
    )
  )
);

GRANT SELECT, INSERT, UPDATE ON public.academic_work_submissions TO authenticated;
GRANT ALL ON public.academic_work_submissions TO service_role;