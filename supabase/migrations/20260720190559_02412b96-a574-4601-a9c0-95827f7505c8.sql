
-- Enum for catalog kinds
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'catalog_kind') THEN
    CREATE TYPE public.catalog_kind AS ENUM (
      'activity_subtype',
      'work_subtype',
      'question_type',
      'research_theme'
    );
  END IF;
END $$;

-- catalog_items
CREATE TABLE public.catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.catalog_kind NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  prompt_hint text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_items TO authenticated;
GRANT ALL ON public.catalog_items TO service_role;

ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;

-- Admin can do anything
CREATE POLICY "Admins manage catalog items"
  ON public.catalog_items
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Any authenticated user can read active items that are granted to them
-- (grants are checked in the app via a JOIN; here we just allow reads of active rows,
--  the grants table itself is RLS-protected)
CREATE POLICY "Authenticated read active catalog items"
  ON public.catalog_items
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE TRIGGER update_catalog_items_updated_at
  BEFORE UPDATE ON public.catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- catalog_item_grants
CREATE TABLE public.catalog_item_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_item_id uuid NOT NULL REFERENCES public.catalog_items(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_item_id, teacher_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_item_grants TO authenticated;
GRANT ALL ON public.catalog_item_grants TO service_role;

ALTER TABLE public.catalog_item_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage catalog grants"
  ON public.catalog_item_grants
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Teachers read own grants"
  ON public.catalog_item_grants
  FOR SELECT
  TO authenticated
  USING (teacher_id = auth.uid());

CREATE INDEX idx_catalog_item_grants_teacher ON public.catalog_item_grants(teacher_id);
CREATE INDEX idx_catalog_item_grants_item ON public.catalog_item_grants(catalog_item_id);
CREATE INDEX idx_catalog_items_kind_active ON public.catalog_items(kind, is_active);
