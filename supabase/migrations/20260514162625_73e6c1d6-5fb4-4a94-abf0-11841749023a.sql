ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalized_by UUID;

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_finalized_at
  ON public.attendance_sessions(finalized_at);

CREATE OR REPLACE FUNCTION public.prevent_attendance_finalization_before_window_end()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.finalized_at IS NOT NULL AND OLD.finalized_at IS NULL THEN
    IF now() < NEW.starts_at + (NEW.window_hours || ' hours')::interval THEN
      RAISE EXCEPTION 'A chamada só pode ser finalizada após o encerramento da janela de presença/justificativa.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_attendance_finalization_before_window_end ON public.attendance_sessions;
CREATE TRIGGER trg_prevent_attendance_finalization_before_window_end
BEFORE UPDATE ON public.attendance_sessions
FOR EACH ROW
WHEN (NEW.finalized_at IS DISTINCT FROM OLD.finalized_at)
EXECUTE FUNCTION public.prevent_attendance_finalization_before_window_end();