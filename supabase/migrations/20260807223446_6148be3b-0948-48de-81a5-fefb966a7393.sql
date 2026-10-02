-- Add RLS policies for admin users to ensure full visibility as requested

-- 1. Profiles: Admins can read all profiles
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'profiles' AND policyname = 'Admins read all profiles'
    ) THEN
        CREATE POLICY "Admins read all profiles" ON public.profiles
        FOR SELECT TO authenticated
        USING (
            (SELECT profile_type FROM public.profiles WHERE id = auth.uid()) = 'admin'
        );
    END IF;
END $$;

-- 2. Institutions: Admins can read all institutions
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'institutions' AND policyname = 'Admins read all institutions'
    ) THEN
        CREATE POLICY "Admins read all institutions" ON public.institutions
        FOR SELECT TO authenticated
        USING (
            (SELECT profile_type FROM public.profiles WHERE id = auth.uid()) = 'admin'
        );
    END IF;
END $$;

-- 3. Authorized Students: Admins can read all authorized students
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'authorized_students' AND policyname = 'Admins read all authorized students'
    ) THEN
        CREATE POLICY "Admins read all authorized students" ON public.authorized_students
        FOR SELECT TO authenticated
        USING (
            (SELECT profile_type FROM public.profiles WHERE id = auth.uid()) = 'admin'
        );
    END IF;
END $$;

-- 4. Discipline Enrollments: Admins can read all discipline enrollments
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'discipline_students' AND policyname = 'Admins read all discipline students'
    ) THEN
        CREATE POLICY "Admins read all discipline students" ON public.discipline_students
        FOR SELECT TO authenticated
        USING (
            (SELECT profile_type FROM public.profiles WHERE id = auth.uid()) = 'admin'
        );
    END IF;
END $$;
