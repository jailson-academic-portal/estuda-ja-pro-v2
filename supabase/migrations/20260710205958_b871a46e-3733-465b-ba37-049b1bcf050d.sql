CREATE OR REPLACE FUNCTION public.ensure_subscription_for_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_kind public.subscriber_kind;
BEGIN
  IF NEW.profile_type IN ('teacher','institution') THEN
    v_kind := CASE WHEN NEW.profile_type = 'institution' THEN 'institution'::public.subscriber_kind
                   ELSE 'teacher'::public.subscriber_kind END;

    -- Only create a default free subscription if none exists yet for this
    -- subscriber/kind (any environment). Avoids ON CONFLICT against the
    -- environment-scoped partial unique index.
    IF NOT EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE subscriber_id = NEW.id AND subscriber_kind = v_kind
    ) THEN
      INSERT INTO public.subscriptions (subscriber_id, subscriber_kind, plan_code, plan_name, status)
      VALUES (NEW.id, v_kind, 'free', 'Gratuito', 'active');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;