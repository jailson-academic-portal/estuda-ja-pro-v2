
CREATE OR REPLACE FUNCTION public.enforce_free_plan_discipline_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
  v_owner uuid;
BEGIN
  v_owner := COALESCE(NEW.teacher_id, OLD.teacher_id);
  IF v_owner IS NULL THEN RETURN NEW; END IF;

  -- Admins bypass all plan limits
  IF public.has_role(v_owner, 'admin') THEN RETURN NEW; END IF;

  IF public.teacher_has_paid_plan(v_owner) THEN RETURN NEW; END IF;
  IF NEW.institution_id IS NOT NULL THEN RETURN NEW; END IF;

  IF (TG_OP = 'INSERT' AND COALESCE(NEW.status, 'active') = 'active')
     OR (TG_OP = 'UPDATE' AND NEW.status = 'active' AND COALESCE(OLD.status,'') <> 'active') THEN
    SELECT count(*) INTO v_count FROM public.disciplines
      WHERE teacher_id = v_owner AND status = 'active' AND id <> COALESCE(NEW.id, gen_random_uuid());
    IF v_count >= 1 THEN
      RAISE EXCEPTION 'O plano Gratuito permite apenas 1 disciplina ativa. Faça upgrade para o plano Pro para criar disciplinas ilimitadas.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_free_plan_student_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_count int;
BEGIN
  SELECT teacher_id INTO v_owner FROM public.disciplines WHERE id = NEW.discipline_id;
  IF v_owner IS NULL THEN RETURN NEW; END IF;

  -- Admins bypass all plan limits
  IF public.has_role(v_owner, 'admin') THEN RETURN NEW; END IF;

  IF public.teacher_has_paid_plan(v_owner) THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_count FROM public.discipline_students WHERE discipline_id = NEW.discipline_id;
  IF v_count >= 30 THEN
    RAISE EXCEPTION 'O plano Gratuito permite no máximo 30 alunos por disciplina. Faça upgrade para o plano Pro.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- Also bypass paid-plan check in app code: treat admin as paid plan
CREATE OR REPLACE FUNCTION public.teacher_has_paid_plan(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE subscriber_id = _user_id
        AND subscriber_kind = 'teacher'
        AND plan_code <> 'free'
        AND (
          (status IN ('active','trialing','past_due')
            AND (current_period_end IS NULL OR current_period_end > now()))
          OR (status = 'canceled' AND current_period_end IS NOT NULL AND current_period_end > now())
        )
    )
$function$;
