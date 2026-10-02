CREATE TABLE public.assessment_header_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  institution_id uuid,
  name text NOT NULL,
  logo_url text,
  banner_color text NOT NULL DEFAULT '#C8D400',
  strip_color text NOT NULL DEFAULT '#E8323C',
  unit_label text,
  shift_label text,
  instructions text,
  show_grade_box boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_header_templates TO authenticated;
GRANT ALL ON public.assessment_header_templates TO service_role;

ALTER TABLE public.assessment_header_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their assessment header templates"
ON public.assessment_header_templates FOR ALL TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Institution members can read institution templates"
ON public.assessment_header_templates FOR SELECT TO authenticated
USING (
  institution_id IS NOT NULL
  AND institution_id = (SELECT p.institution_id FROM public.profiles p WHERE p.id = auth.uid())
);

CREATE INDEX idx_assessment_header_templates_owner ON public.assessment_header_templates (owner_user_id);
CREATE INDEX idx_assessment_header_templates_institution ON public.assessment_header_templates (institution_id);

CREATE TRIGGER update_assessment_header_templates_updated_at
BEFORE UPDATE ON public.assessment_header_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();