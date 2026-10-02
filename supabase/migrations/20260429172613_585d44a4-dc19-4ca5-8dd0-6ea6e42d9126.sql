-- Add class/group name to disciplines
ALTER TABLE public.disciplines
  ADD COLUMN IF NOT EXISTS group_name TEXT;

-- Auto-generate a discipline code if not provided (e.g. DSC-AB12CD)
CREATE OR REPLACE FUNCTION public.set_discipline_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate TEXT;
  tries INT := 0;
BEGIN
  IF NEW.code IS NULL OR length(trim(NEW.code)) = 0 THEN
    LOOP
      candidate := 'DSC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.disciplines WHERE code = candidate);
      tries := tries + 1;
      EXIT WHEN tries > 5;
    END LOOP;
    NEW.code := candidate;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_discipline_code ON public.disciplines;
CREATE TRIGGER trg_set_discipline_code
BEFORE INSERT ON public.disciplines
FOR EACH ROW EXECUTE FUNCTION public.set_discipline_code();

-- Storage bucket for syllabus files (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('syllabi', 'syllabi', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: teachers manage files under their own user folder (path: {teacher_id}/{discipline_id}/file.pdf)
CREATE POLICY "Teachers upload own syllabi"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Teachers read own syllabi"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Teachers update own syllabi"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Teachers delete own syllabi"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'syllabi' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Students enrolled in a discipline can read its syllabus
CREATE POLICY "Students read enrolled syllabi"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'syllabi' AND EXISTS (
      SELECT 1
      FROM public.disciplines d
      JOIN public.discipline_students ds ON ds.discipline_id = d.id
      WHERE ds.student_id = auth.uid()
        AND d.syllabus_file_url IS NOT NULL
        AND position(name in d.syllabus_file_url) > 0
    )
  );
