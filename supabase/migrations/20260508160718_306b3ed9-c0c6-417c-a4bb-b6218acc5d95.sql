-- Remove duplicates first if any
DELETE FROM public.subscriptions a
USING public.subscriptions b
WHERE a.id < b.id
  AND a.subscriber_id = b.subscriber_id
  AND a.subscriber_kind = b.subscriber_kind;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_subscriber_id_kind_key UNIQUE (subscriber_id, subscriber_kind);