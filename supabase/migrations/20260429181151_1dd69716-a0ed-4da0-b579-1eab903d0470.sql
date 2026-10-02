-- Diário pessoal do aluno (privado)
CREATE TABLE public.student_diary_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL,
  discipline_id UUID NOT NULL,
  session_id UUID,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_diary_student_disc ON public.student_diary_entries(student_id, discipline_id);

ALTER TABLE public.student_diary_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students manage own diary"
  ON public.student_diary_entries FOR ALL TO authenticated
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Admins read all diaries"
  ON public.student_diary_entries FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_diary_updated_at
  BEFORE UPDATE ON public.student_diary_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Eventos de calendário da disciplina
CREATE TABLE public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  kind TEXT NOT NULL DEFAULT 'custom',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_calendar_disc ON public.calendar_events(discipline_id, event_date);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all events"
  ON public.calendar_events FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Teachers manage own events"
  ON public.calendar_events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM disciplines d WHERE d.id = calendar_events.discipline_id AND d.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM disciplines d WHERE d.id = calendar_events.discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students see events of enrolled disciplines"
  ON public.calendar_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM discipline_students ds WHERE ds.discipline_id = calendar_events.discipline_id AND ds.student_id = auth.uid()));

CREATE POLICY "Institutions see events"
  ON public.calendar_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM disciplines d WHERE d.id = calendar_events.discipline_id AND d.institution_id = current_institution_id()));

CREATE TRIGGER trg_calendar_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();