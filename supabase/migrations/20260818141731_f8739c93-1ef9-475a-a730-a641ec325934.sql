
-- Chat Reading Receipts and Notifications Enhancements

-- 1. Create chat_message_reads table for group chat tracking
CREATE TABLE IF NOT EXISTS public.chat_message_reads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX idx_chat_msg_reads_msg ON public.chat_message_reads(message_id);
CREATE INDEX idx_chat_msg_reads_user ON public.chat_message_reads(user_id);

GRANT SELECT, INSERT ON public.chat_message_reads TO authenticated;
GRANT ALL ON public.chat_message_reads TO service_role;

ALTER TABLE public.chat_message_reads ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone who can see the message can see its reads
CREATE POLICY "reads_select_members" ON public.chat_message_reads
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_messages m
      WHERE m.id = chat_message_reads.message_id
    )
  );

-- Policy: Users can insert their own reads if they are members of the discipline
CREATE POLICY "reads_insert_self" ON public.chat_message_reads
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.chat_messages m
      WHERE m.id = message_id
      AND (
        EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = m.discipline_id AND d.teacher_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.discipline_students ds WHERE ds.discipline_id = m.discipline_id AND ds.student_id = auth.uid())
      )
    )
  );

-- Add to realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'chat_message_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_reads;
  END IF;
END $$;

-- 2. Ensure REPLICA IDENTITY FULL for direct_messages to track updates in realtime (read receipts)
ALTER TABLE public.direct_messages REPLICA IDENTITY FULL;
