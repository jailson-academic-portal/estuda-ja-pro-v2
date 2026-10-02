
CREATE TABLE public.custom_rubrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'activity',
  subtype TEXT,
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  grading_formula TEXT NOT NULL DEFAULT 'weighted_average',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.custom_rubrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own rubrics" ON public.custom_rubrics
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Admins manage all rubrics" ON public.custom_rubrics
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_custom_rubrics_updated_at
  BEFORE UPDATE ON public.custom_rubrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_custom_rubrics_owner ON public.custom_rubrics(owner_id);
