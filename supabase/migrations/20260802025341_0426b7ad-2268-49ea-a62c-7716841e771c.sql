CREATE TYPE public.case_status AS ENUM ('draft', 'published', 'archived');

CREATE TABLE public.clinical_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES public.profiles(id),
    title TEXT NOT NULL,
    description TEXT,
    patient_info JSONB NOT NULL DEFAULT '{}',
    investigation_data JSONB NOT NULL DEFAULT '{}',
    decision_tree JSONB NOT NULL DEFAULT '{}',
    status public.case_status NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.student_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES public.clinical_cases(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.profiles(id),
    answers JSONB NOT NULL DEFAULT '{}',
    score NUMERIC(5,2),
    feedback TEXT,
    status public.submission_status NOT NULL DEFAULT 'submitted',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    graded_at TIMESTAMPTZ,
    teacher_comment TEXT
);

GRANT SELECT ON public.clinical_cases TO authenticated;
GRANT ALL ON public.clinical_cases TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.student_submissions TO authenticated;
GRANT ALL ON public.student_submissions TO service_role;

ALTER TABLE public.clinical_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can select cases"
ON public.clinical_cases FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Teachers can manage their cases"
ON public.clinical_cases FOR ALL
TO authenticated
USING (teacher_id = auth.uid());

CREATE POLICY "Students can see their own submissions"
ON public.student_submissions FOR SELECT
TO authenticated
USING (student_id = auth.uid());

CREATE POLICY "Students can insert their own submissions"
ON public.student_submissions FOR INSERT
TO authenticated
WITH CHECK (student_id = auth.uid());

CREATE POLICY "Teachers can see submissions for their cases"
ON public.student_submissions FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.clinical_cases
        WHERE clinical_cases.id = student_submissions.case_id
        AND clinical_cases.teacher_id = auth.uid()
    )
);

CREATE POLICY "Teachers can update submissions for their cases"
ON public.student_submissions FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.clinical_cases
        WHERE clinical_cases.id = student_submissions.case_id
        AND clinical_cases.teacher_id = auth.uid()
    )
);