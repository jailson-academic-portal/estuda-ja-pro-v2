CREATE TABLE public.authorized_students (
    id uuid primary key default gen_random_uuid(),
    enrollment_number text unique not null,
    name text not null,
    status text default 'pending' check (status in ('pending', 'active')),
    institution_id uuid references public.institutions(id) on delete cascade,
    created_at timestamptz default now()
);

-- Grant access
GRANT SELECT, INSERT, UPDATE, DELETE ON public.authorized_students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.authorized_students TO service_role;
GRANT SELECT ON public.authorized_students TO anon;

-- Enable RLS
ALTER TABLE public.authorized_students ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins and institutions can manage authorized_students"
ON public.authorized_students
FOR ALL
TO authenticated
USING (
    public.has_role(auth.uid(), 'admin') OR 
    (SELECT institution_id FROM public.profiles WHERE id = auth.uid()) = institution_id
);

CREATE POLICY "Anyone can check if enrollment exists"
ON public.authorized_students
FOR SELECT
TO anon, authenticated
USING (true);
