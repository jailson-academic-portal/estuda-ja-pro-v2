
-- Fix storage policies for 'materials' and 'syllabi' buckets to prevent RLS rejection.

-- 1. Redefine 'materials' policies to ensure teachers, admins, and institution owners can upload.
-- The current policy might fail if the folder segment [1] check is too strict or lacks admin/institution coverage.
DROP POLICY IF EXISTS "Teachers manage materials files" ON storage.objects;

CREATE POLICY "Manage materials files"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'materials'
  AND (
    -- Caller is the teacher of the discipline (folder name is discipline_id)
    EXISTS (
      SELECT 1 FROM public.disciplines d
      WHERE d.id::text = (storage.foldername(objects.name))[1]
        AND d.teacher_id = auth.uid()
    )
    OR
    -- Caller is an admin
    public.has_role(auth.uid(), 'admin')
    OR
    -- Caller is the institution owner
    EXISTS (
      SELECT 1 FROM public.disciplines d
      JOIN public.institutions i ON i.id = d.institution_id
      WHERE d.id::text = (storage.foldername(objects.name))[1]
        AND i.owner_user_id = auth.uid()
    )
  )
)
WITH CHECK (
  bucket_id = 'materials'
  AND (
    EXISTS (
      SELECT 1 FROM public.disciplines d
      WHERE d.id::text = (storage.foldername(objects.name))[1]
        AND d.teacher_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.disciplines d
      JOIN public.institutions i ON i.id = d.institution_id
      WHERE d.id::text = (storage.foldername(objects.name))[1]
        AND i.owner_user_id = auth.uid()
    )
  )
);

-- 2. Ensure students can read published materials files if they are enrolled.
DROP POLICY IF EXISTS "Students read published materials" ON storage.objects;
CREATE POLICY "Students read published materials"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'materials'
  AND EXISTS (
    SELECT 1 FROM public.materials m
    JOIN public.discipline_students ds ON ds.discipline_id = m.discipline_id
    WHERE m.file_url = objects.name
      AND m.status = 'published'
      AND ds.student_id = auth.uid()
  )
);

-- 3. Redefine 'syllabi' policies to ensure teachers, admins, and institution owners can upload.
-- Syllabus path is {user_id}/{folder_id}/{filename}, so segment [1] must match auth.uid().
DROP POLICY IF EXISTS "Teachers upload own syllabi" ON storage.objects;
DROP POLICY IF EXISTS "Teachers read own syllabi" ON storage.objects;
DROP POLICY IF EXISTS "Teachers update own syllabi" ON storage.objects;
DROP POLICY IF EXISTS "Teachers delete own syllabi" ON storage.objects;

CREATE POLICY "Manage own syllabi files"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'syllabi'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin')
  )
)
WITH CHECK (
  bucket_id = 'syllabi'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin')
  )
);
