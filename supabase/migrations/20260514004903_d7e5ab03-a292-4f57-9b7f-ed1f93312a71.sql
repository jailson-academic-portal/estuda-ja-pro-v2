-- Expand activity_subtype enum with new extra-activity types
ALTER TYPE public.activity_subtype ADD VALUE IF NOT EXISTS 'redacao';
ALTER TYPE public.activity_subtype ADD VALUE IF NOT EXISTS 'seminario';
ALTER TYPE public.activity_subtype ADD VALUE IF NOT EXISTS 'debate';
ALTER TYPE public.activity_subtype ADD VALUE IF NOT EXISTS 'visita_tecnica';
ALTER TYPE public.activity_subtype ADD VALUE IF NOT EXISTS 'aula_pratica';
ALTER TYPE public.activity_subtype ADD VALUE IF NOT EXISTS 'workshop';

-- Create academic work subtype enum
DO $$ BEGIN
  CREATE TYPE public.academic_work_subtype AS ENUM (
    'tcc',
    'artigo_cientifico',
    'revisao_literatura',
    'estudo_caso_academico',
    'projeto_intervencao',
    'relatorio_pesquisa',
    'resumo_expandido',
    'poster_cientifico',
    'tema_predefinido'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add subtype + grading formula columns to academic_works
ALTER TABLE public.academic_works
  ADD COLUMN IF NOT EXISTS subtype public.academic_work_subtype NOT NULL DEFAULT 'tema_predefinido',
  ADD COLUMN IF NOT EXISTS grading_formula text NOT NULL DEFAULT 'weighted_average';

-- Add grading formula column to activities
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS grading_formula text NOT NULL DEFAULT 'weighted_average';