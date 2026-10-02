CREATE TABLE public.student_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id uuid NOT NULL,
  created_by uuid NOT NULL,
  tool text NOT NULL,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.publish_status NOT NULL DEFAULT 'draft',
  due_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_student_documents_discipline ON public.student_documents(discipline_id);
CREATE INDEX idx_student_documents_tool ON public.student_documents(tool);

ALTER TABLE public.student_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all student documents"
  ON public.student_documents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Teachers manage own student documents"
  ON public.student_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = student_documents.discipline_id AND d.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = student_documents.discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students view published student documents"
  ON public.student_documents FOR SELECT TO authenticated
  USING (status = 'published'::public.publish_status AND EXISTS (
    SELECT 1 FROM public.discipline_students ds
    WHERE ds.discipline_id = student_documents.discipline_id AND ds.student_id = auth.uid()
  ));

CREATE POLICY "Institutions see student documents"
  ON public.student_documents FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.disciplines d
    WHERE d.id = student_documents.discipline_id AND d.institution_id = public.current_institution_id()
  ));

CREATE TRIGGER trg_student_documents_updated_at
  BEFORE UPDATE ON public.student_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();