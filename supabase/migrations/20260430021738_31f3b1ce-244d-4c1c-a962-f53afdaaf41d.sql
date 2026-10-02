-- 1) Drop the old uniqueness that blocks multiple historical rows
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_subscriber_id_subscriber_kind_key;

-- Allow one ACTIVE subscription per (subscriber, kind, environment)
-- but keep historical canceled rows around for audit.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_unique_active_per_env
  ON public.subscriptions (subscriber_id, subscriber_kind, environment)
  WHERE status IN ('active','trialing','past_due','incomplete');

-- 2) Backfill: every existing teacher/institution profile must have a Free row
INSERT INTO public.subscriptions (subscriber_id, subscriber_kind, plan_code, plan_name, status, environment)
SELECT p.id,
       CASE WHEN p.profile_type = 'institution' THEN 'institution'::public.subscriber_kind
            ELSE 'teacher'::public.subscriber_kind END,
       'free', 'Gratuito', 'active', 'sandbox'
FROM public.profiles p
WHERE p.profile_type IN ('teacher','institution')
  AND NOT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.subscriber_id = p.id
      AND s.subscriber_kind = (CASE WHEN p.profile_type = 'institution'
                                    THEN 'institution'::public.subscriber_kind
                                    ELSE 'teacher'::public.subscriber_kind END)
  );

-- 3) Update teacher_has_paid_plan to also recognize the grace period
--    (canceled but current_period_end still in the future)
CREATE OR REPLACE FUNCTION public.teacher_has_paid_plan(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
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
