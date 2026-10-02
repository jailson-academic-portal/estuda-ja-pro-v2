-- Remove the incorrect GLOBAL unique index on control_sequence.
-- control_sequence is per-scope/year, so a global uniqueness rule is wrong and
-- causes "duplicate key value violates unique constraint assessments_control_sequence_key".
DROP INDEX IF EXISTS public.assessments_control_sequence_key;

-- Correct uniqueness: per scope + year + sequence (control_number stays globally unique
-- via the existing assessments_control_number_key index).
CREATE UNIQUE INDEX IF NOT EXISTS assessments_control_scope_year_seq_key
  ON public.assessments (control_scope_key, control_year, control_sequence)
  WHERE control_scope_key IS NOT NULL
    AND control_year IS NOT NULL
    AND control_sequence IS NOT NULL;