-- 1. Remove overly permissive invitation read policy
DROP POLICY IF EXISTS "Anyone can read invitation by token" ON public.invitations;

-- 2. Storage: teachers read files from activity_submissions in their disciplines
CREATE POLICY "Teachers read activity submission files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'submissions'
  AND EXISTS (
    SELECT 1
    FROM public.activity_submissions s
    JOIN public.activities a ON a.id = s.activity_id
    JOIN public.disciplines d ON d.id = a.discipline_id
    WHERE d.teacher_id = auth.uid()
      AND s.file_url = storage.objects.name
  )
);

-- 3. Storage: teachers read files from exercise_submissions in their disciplines
-- exercise_submissions stores answers as jsonb; match by uploader folder path
CREATE POLICY "Teachers read exercise submission files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'submissions'
  AND EXISTS (
    SELECT 1
    FROM public.exercise_submissions s
    JOIN public.exercises e ON e.id = s.exercise_id
    JOIN public.disciplines d ON d.id = e.discipline_id
    WHERE d.teacher_id = auth.uid()
      AND (auth.uid())::text <> ''
      AND (s.student_id)::text = (storage.foldername(storage.objects.name))[1]
  )
);

-- 4. Storage: students can update/delete their own submission files
CREATE POLICY "Students update own submissions"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'submissions'
  AND (auth.uid())::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'submissions'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

CREATE POLICY "Students delete own submissions"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'submissions'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- 5. Storage: admins can delete any submission file
CREATE POLICY "Admins delete submission files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'submissions'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);
