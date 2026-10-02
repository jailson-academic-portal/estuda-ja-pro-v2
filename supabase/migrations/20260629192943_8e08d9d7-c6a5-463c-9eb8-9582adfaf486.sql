-- Allow teachers to read assessment submission scan files in the "submissions" bucket
-- for assessments belonging to disciplines they own.
CREATE POLICY "Teachers read assessment submission files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'submissions'
  AND EXISTS (
    SELECT 1
    FROM public.assessment_submissions s
    JOIN public.assessment_assignments asg ON asg.id = s.assignment_id
    JOIN public.assessments a ON a.id = asg.assessment_id
    JOIN public.disciplines d ON d.id = a.discipline_id
    WHERE d.teacher_id = auth.uid()
      AND (auth.uid())::text <> ''
      AND (asg.student_id)::text = (storage.foldername(objects.name))[1]
  )
);

-- Allow teachers to read student justification attachments in the "justifications" bucket
-- for attendance sessions belonging to disciplines they own.
CREATE POLICY "Teachers read justification files in own disciplines"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'justifications'
  AND EXISTS (
    SELECT 1
    FROM public.justifications j
    JOIN public.attendance_sessions ses ON ses.id = j.session_id
    JOIN public.disciplines d ON d.id = ses.discipline_id
    WHERE d.teacher_id = auth.uid()
      AND j.attachment_url = objects.name
  )
);