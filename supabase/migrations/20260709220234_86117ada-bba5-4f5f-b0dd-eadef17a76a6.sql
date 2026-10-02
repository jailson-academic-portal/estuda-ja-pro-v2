ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_subscriber_id_kind_key;

DELETE FROM public.subscriptions a
USING public.subscriptions b
WHERE a.id < b.id
  AND a.subscriber_id = b.subscriber_id
  AND a.subscriber_kind = b.subscriber_kind
  AND a.environment = b.environment;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_unique_active_per_env
  ON public.subscriptions (subscriber_id, subscriber_kind, environment)
  WHERE status IN ('active','trialing','past_due','incomplete');