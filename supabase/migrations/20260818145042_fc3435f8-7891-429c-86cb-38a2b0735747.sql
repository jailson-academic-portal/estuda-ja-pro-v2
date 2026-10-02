-- Update RLS policies for chat_message_reads to support upsert and fix row violation errors

DROP POLICY IF EXISTS "reads_insert_self" ON public.chat_message_reads;
DROP POLICY IF EXISTS "reads_update_self" ON public.chat_message_reads;

-- Re-create INSERT policy with a robust WITH CHECK
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

-- Add UPDATE policy to support upsert operation
CREATE POLICY "reads_update_self" ON public.chat_message_reads
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.chat_message_reads TO authenticated;