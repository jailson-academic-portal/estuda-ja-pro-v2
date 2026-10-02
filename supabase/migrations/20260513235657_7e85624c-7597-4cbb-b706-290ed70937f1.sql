DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'attendance_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_sessions;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'justifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.justifications;
  END IF;
END $$;

ALTER TABLE public.attendance_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.justifications REPLICA IDENTITY FULL;