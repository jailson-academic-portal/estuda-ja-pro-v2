-- ENUMS
CREATE TYPE public.profile_type AS ENUM ('admin', 'institution', 'teacher', 'student');
CREATE TYPE public.app_role AS ENUM ('admin', 'institution', 'teacher', 'student');
CREATE TYPE public.user_status AS ENUM ('active', 'inactive', 'pending');
CREATE TYPE public.discipline_status AS ENUM ('active', 'archived');

-- INSTITUTIONS
CREATE TABLE public.institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  owner_user_id UUID,
  status public.user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  enrollment_number TEXT UNIQUE,
  profile_type public.profile_type NOT NULL DEFAULT 'student',
  institution_id UUID REFERENCES public.institutions(id) ON DELETE SET NULL,
  status public.user_status NOT NULL DEFAULT 'active',
  password_set BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_enrollment ON public.profiles(enrollment_number);
CREATE INDEX idx_profiles_institution ON public.profiles(institution_id);
CREATE INDEX idx_profiles_type ON public.profiles(profile_type);

-- USER ROLES (separate table — never store roles on profiles)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- DISCIPLINES
CREATE TABLE public.disciplines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id UUID REFERENCES public.institutions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  code TEXT,
  semester TEXT NOT NULL,
  year INT NOT NULL,
  syllabus_text TEXT,
  syllabus_file_url TEXT,
  color TEXT NOT NULL DEFAULT 'teal',
  status public.discipline_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_disciplines_teacher ON public.disciplines(teacher_id);
CREATE INDEX idx_disciplines_institution ON public.disciplines(institution_id);

-- DISCIPLINE STUDENTS
CREATE TABLE public.discipline_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id UUID NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status public.user_status NOT NULL DEFAULT 'active',
  UNIQUE (discipline_id, student_id)
);

CREATE INDEX idx_ds_discipline ON public.discipline_students(discipline_id);
CREATE INDEX idx_ds_student ON public.discipline_students(student_id);

-- SECURITY DEFINER ROLE CHECKER
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Helper: get caller institution id
CREATE OR REPLACE FUNCTION public.current_institution_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT institution_id FROM public.profiles WHERE id = auth.uid()
$$;

-- AUTO PROFILE ON SIGNUP
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.profile_type;
  v_name TEXT;
  v_enrollment TEXT;
BEGIN
  v_type := COALESCE((NEW.raw_user_meta_data->>'profile_type')::public.profile_type, 'student');
  v_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.email, '');
  v_enrollment := NEW.raw_user_meta_data->>'enrollment_number';

  INSERT INTO public.profiles (id, name, email, enrollment_number, profile_type, password_set)
  VALUES (NEW.id, v_name, NEW.email, v_enrollment, v_type, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_type::text::public.app_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ENABLE RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_students ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
CREATE POLICY "Users see their own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admins see all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions see profiles in their institution"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'institution') AND institution_id = public.current_institution_id());

CREATE POLICY "Teachers see students in their disciplines"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'teacher') AND EXISTS (
      SELECT 1 FROM public.discipline_students ds
      JOIN public.disciplines d ON d.id = ds.discipline_id
      WHERE ds.student_id = profiles.id AND d.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admins update profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert profiles"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete profiles"
  ON public.profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- USER ROLES POLICIES
CREATE POLICY "Users see own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins manage all roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- INSTITUTIONS POLICIES
CREATE POLICY "Admins manage institutions"
  ON public.institutions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institution sees itself"
  ON public.institutions FOR SELECT TO authenticated
  USING (id = public.current_institution_id());

CREATE POLICY "Teachers see their institution"
  ON public.institutions FOR SELECT TO authenticated
  USING (id = public.current_institution_id());

-- DISCIPLINES POLICIES
CREATE POLICY "Admins manage disciplines"
  ON public.disciplines FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Teachers manage own disciplines"
  ON public.disciplines FOR ALL TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Institutions see their disciplines"
  ON public.disciplines FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'institution') AND institution_id = public.current_institution_id());

CREATE POLICY "Students see enrolled disciplines"
  ON public.disciplines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.discipline_students ds
    WHERE ds.discipline_id = disciplines.id AND ds.student_id = auth.uid()
  ));

-- DISCIPLINE STUDENTS POLICIES
CREATE POLICY "Admins manage enrollments"
  ON public.discipline_students FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Teachers manage enrollments in own disciplines"
  ON public.discipline_students FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid()));

CREATE POLICY "Students see own enrollments"
  ON public.discipline_students FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Institutions see enrollments in their disciplines"
  ON public.discipline_students FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.disciplines d
    WHERE d.id = discipline_id AND d.institution_id = public.current_institution_id()
  ));