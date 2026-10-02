-- Add direct_message to notification_kind enum
ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'direct_message';

-- direct_messages table
CREATE TABLE public.direct_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  discipline_id uuid NOT NULL REFERENCES public.disciplines(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_diff_participants CHECK (sender_id <> recipient_id),
  CONSTRAINT dm_body_len CHECK (char_length(body) BETWEEN 1 AND 4000)
);

CREATE INDEX idx_dm_pair ON public.direct_messages (discipline_id, sender_id, recipient_id, created_at);
CREATE INDEX idx_dm_recipient_unread ON public.direct_messages (recipient_id, read_at) WHERE read_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.direct_messages TO authenticated;
GRANT ALL ON public.direct_messages TO service_role;

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- Helper: participant must be teacher or enrolled student of the discipline
CREATE OR REPLACE FUNCTION public.is_discipline_member(_discipline_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_discipline_teacher(_discipline_id, _user_id)
      OR public.is_discipline_student(_discipline_id, _user_id)
$$;

CREATE POLICY "dm_select_participants" ON public.direct_messages
  FOR SELECT TO authenticated
  USING (auth.uid() IN (sender_id, recipient_id));

CREATE POLICY "dm_insert_sender" ON public.direct_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND public.is_discipline_member(discipline_id, sender_id)
    AND public.is_discipline_member(discipline_id, recipient_id)
  );

CREATE POLICY "dm_update_recipient_mark_read" ON public.direct_messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

CREATE POLICY "dm_delete_sender" ON public.direct_messages
  FOR DELETE TO authenticated
  USING (auth.uid() = sender_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
ALTER TABLE public.direct_messages REPLICA IDENTITY FULL;

-- push_subscriptions table
CREATE TABLE public.push_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_user ON public.push_subscriptions (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_own" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);