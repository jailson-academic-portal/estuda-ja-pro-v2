-- Discipline chat: messages exchanged between teacher and enrolled students
CREATE TABLE public.chat_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  discipline_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_discipline_created ON public.chat_messages(discipline_id, created_at DESC);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Read: teacher of the discipline OR enrolled student
CREATE POLICY "Members can read chat"
ON public.chat_messages FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = chat_messages.discipline_id AND ds.student_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Insert: own messages, must be member of the discipline
CREATE POLICY "Members can send chat"
ON public.chat_messages FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND (
    EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = chat_messages.discipline_id AND ds.student_id = auth.uid())
  )
);

-- Sender can delete own message; teacher can moderate
CREATE POLICY "Sender or teacher can delete chat"
ON public.chat_messages FOR DELETE
TO authenticated
USING (
  sender_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = discipline_id AND d.teacher_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- AI generations: store outputs of the 12 teacher AI tools so they can be re-downloaded
CREATE TABLE public.ai_generations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  discipline_id uuid,
  user_id uuid NOT NULL,
  tool text NOT NULL,
  title text NOT NULL,
  prompt jsonb,
  result jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_generations_user_created ON public.ai_generations(user_id, created_at DESC);
CREATE INDEX idx_ai_generations_discipline ON public.ai_generations(discipline_id);

ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own generations"
ON public.ai_generations FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins read all generations"
ON public.ai_generations FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));