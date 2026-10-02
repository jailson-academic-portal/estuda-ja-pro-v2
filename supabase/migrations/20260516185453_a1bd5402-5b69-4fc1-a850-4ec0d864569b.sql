-- Fix materials storage policy: original policy used storage.foldername(d.name)
-- (the discipline NAME) instead of storage.foldername(objects.name) so teacher
-- uploads always failed.
DROP POLICY IF EXISTS "Teachers manage materials files" ON storage.objects;

CREATE POLICY "Teachers manage materials files"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'materials'
  AND EXISTS (
    SELECT 1 FROM public.disciplines d
    WHERE d.id::text = (storage.foldername(objects.name))[1]
      AND d.teacher_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'materials'
  AND EXISTS (
    SELECT 1 FROM public.disciplines d
    WHERE d.id::text = (storage.foldername(objects.name))[1]
      AND d.teacher_id = auth.uid()
  )
);

-- Allow students to upload submissions where first folder = their user id
-- (already enforced by existing WITH CHECK). Add teacher read so teachers can
-- download submitted PDFs from their disciplines.
DROP POLICY IF EXISTS "Teachers read submissions in own disciplines" ON storage.objects;

CREATE POLICY "Teachers read submissions in own disciplines"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'submissions'
  AND EXISTS (
    SELECT 1
    FROM public.academic_work_submissions s
    JOIN public.academic_works w ON w.id = s.work_id
    JOIN public.disciplines d ON d.id = w.discipline_id
    WHERE d.teacher_id = auth.uid()
      AND s.file_url = objects.name
  )
);
