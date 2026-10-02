-- Scope SELECT on invitations to the creator only (admins already have full access via existing ALL policy).
-- This guarantees recipient_email and token are never readable by other authenticated users.
CREATE POLICY "Creators read own invitations"
ON public.invitations
FOR SELECT
TO authenticated
USING (created_by = auth.uid());