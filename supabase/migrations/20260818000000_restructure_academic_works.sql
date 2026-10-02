-- Adicionar coluna de grupo às submissões de trabalhos acadêmicos se não existir
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'academic_work_submissions' AND COLUMN_NAME = 'group_id') THEN
        ALTER TABLE public.academic_work_submissions ADD COLUMN group_id uuid REFERENCES public.activity_groups(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Habilitar Realtime para academic_works
ALTER PUBLICATION supabase_realtime ADD TABLE public.academic_works;

-- Garantir Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_works TO authenticated;
GRANT ALL ON public.academic_works TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_work_submissions TO authenticated;
GRANT ALL ON public.academic_work_submissions TO service_role;

-- Políticas de RLS para academic_works (se não existirem ou para garantir)
ALTER TABLE public.academic_works ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Professores podem gerenciar trabalhos de suas disciplinas" ON public.academic_works;
CREATE POLICY "Professores podem gerenciar trabalhos de suas disciplinas" 
ON public.academic_works
FOR ALL 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.disciplines d 
    WHERE d.id = academic_works.discipline_id 
    AND (d.teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);

DROP POLICY IF EXISTS "Alunos podem ver trabalhos publicados" ON public.academic_works;
CREATE POLICY "Alunos podem ver trabalhos publicados" 
ON public.academic_works
FOR SELECT 
TO authenticated 
USING (
  status = 'published' AND
  EXISTS (
    SELECT 1 FROM public.discipline_students ds 
    WHERE ds.discipline_id = academic_works.discipline_id 
    AND ds.student_id = auth.uid()
  )
);

-- Políticas de RLS para academic_work_submissions
ALTER TABLE public.academic_work_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Alunos podem ver suas próprias submissões ou de seu grupo" ON public.academic_work_submissions;
CREATE POLICY "Alunos podem ver suas próprias submissões ou de seu grupo" 
ON public.academic_work_submissions
FOR SELECT 
TO authenticated 
USING (
  student_id = auth.uid() OR 
  (group_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.activity_group_members gm 
    WHERE gm.group_id = academic_work_submissions.group_id 
    AND gm.student_id = auth.uid()
  ))
);

DROP POLICY IF EXISTS "Professores podem ver todas as submissões" ON public.academic_work_submissions;
CREATE POLICY "Professores podem ver todas as submissões" 
ON public.academic_work_submissions
FOR SELECT 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.academic_works aw
    JOIN public.disciplines d ON d.id = aw.discipline_id
    WHERE aw.id = academic_work_submissions.work_id
    AND (d.teacher_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);
