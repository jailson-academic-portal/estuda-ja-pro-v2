# Plan: Fix RLS Policy for `chat_message_reads`

The current `INSERT` policy for `chat_message_reads` relies on `WITH CHECK` to verify if the user belongs to the discipline of the message they are reading. However, `WITH CHECK` runs *after* the insertion attempt, and if the `USING` expression is missing for `INSERT` or doesn't match the new row's visibility for the user, it can cause RLS violations. Additionally, I will simplify the policy to use a standard `USING` clause and ensure it covers the `upsert` case correctly.

## Proposed Changes

### Database Migration
- Modify the `INSERT` policy for `chat_message_reads` to use `USING` (which defaults to being used for `WITH CHECK` if not specified, but providing both or simplifying helps).
- Add an `UPDATE` policy to support the `upsert` operation in `chat.functions.ts`.
- Refine the `SELECT` policy to ensure it's robust.

### Steps
1. Drop the existing `reads_insert_self` policy.
2. Create a new `reads_insert_self` policy that allows authenticated users to insert a record if `user_id` matches their own and they are a member of the discipline associated with the message.
3. Add an `UPDATE` policy `reads_update_self` that allows users to update their own reading records (required for `upsert`).
4. Keep the `SELECT` policy as is, but ensure it's working.

## Technical Details
```sql
DROP POLICY IF EXISTS "reads_insert_self" ON public.chat_message_reads;
DROP POLICY IF EXISTS "reads_update_self" ON public.chat_message_reads;

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

CREATE POLICY "reads_update_self" ON public.chat_message_reads
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```
