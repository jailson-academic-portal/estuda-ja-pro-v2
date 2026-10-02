
-- 1) Promote super admin
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower('jailsonresende@gmail.com') LIMIT 1;
  IF v_uid IS NOT NULL THEN
    UPDATE public.profiles SET profile_type = 'admin' WHERE id = v_uid;
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 2) Invitations table
CREATE TYPE public.invitation_kind AS ENUM ('institution', 'teacher');

CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  kind public.invitation_kind NOT NULL,
  created_by uuid NOT NULL,
  institution_id uuid,
  max_uses integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitations_token ON public.invitations(token);
CREATE INDEX idx_invitations_created_by ON public.invitations(created_by);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all invitations"
  ON public.invitations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Institutions manage own invitations"
  ON public.invitations FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid() AND kind = 'teacher');

-- Public lookup of token (anon may need to validate before signup)
CREATE POLICY "Anyone can read invitation by token"
  ON public.invitations FOR SELECT TO anon, authenticated
  USING (true);

-- 3) Function to validate + consume invitation token (called by handle_new_user)
CREATE OR REPLACE FUNCTION public.consume_invitation(_token text, _user_id uuid, _name text, _email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.invitations%ROWTYPE;
  v_inst_id uuid;
BEGIN
  SELECT * INTO v_inv FROM public.invitations WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_inv.revoked_at IS NOT NULL THEN RETURN NULL; END IF;
  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN RETURN NULL; END IF;
  IF v_inv.used_count >= v_inv.max_uses THEN RETURN NULL; END IF;

  IF v_inv.kind = 'institution' THEN
    INSERT INTO public.institutions (name, email, owner_user_id)
    VALUES (COALESCE(_name, _email), _email, _user_id)
    RETURNING id INTO v_inst_id;

    UPDATE public.profiles
      SET profile_type = 'institution', institution_id = v_inst_id
      WHERE id = _user_id;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'institution')
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.profiles
      SET profile_type = 'teacher', institution_id = v_inv.institution_id
      WHERE id = _user_id;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'teacher')
    ON CONFLICT DO NOTHING;

    v_inst_id := v_inv.institution_id;
  END IF;

  UPDATE public.invitations
    SET used_count = used_count + 1
    WHERE id = v_inv.id;

  RETURN v_inst_id;
END;
$$;

-- 4) Update handle_new_user to consume invitation if present
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.profile_type;
  v_name TEXT;
  v_enrollment TEXT;
  v_token TEXT;
  v_inst uuid;
BEGIN
  v_type := COALESCE((NEW.raw_user_meta_data->>'profile_type')::public.profile_type, 'student');
  v_name := COALESCE(NEW.raw_user_meta_data->>'name', NEW.email, '');
  v_enrollment := NEW.raw_user_meta_data->>'enrollment_number';
  v_token := NEW.raw_user_meta_data->>'invitation_token';

  INSERT INTO public.profiles (id, name, email, enrollment_number, profile_type, password_set)
  VALUES (NEW.id, v_name, NEW.email, v_enrollment, v_type, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_type::text::public.app_role)
  ON CONFLICT DO NOTHING;

  IF v_token IS NOT NULL AND length(v_token) > 0 THEN
    PERFORM public.consume_invitation(v_token, NEW.id, v_name, NEW.email);
  END IF;

  RETURN NEW;
END;
$$;

-- 5) Allow admins to act as teachers on disciplines (admin already has ALL via existing policy; ensure teacher_id can be admin)
-- Existing "Teachers manage own disciplines" policy already allows teacher_id = auth.uid() for any user, so admin can create disciplines with teacher_id=self.
-- No change needed here, but ensure admin's profile_type allows teacher-side access in app logic.
