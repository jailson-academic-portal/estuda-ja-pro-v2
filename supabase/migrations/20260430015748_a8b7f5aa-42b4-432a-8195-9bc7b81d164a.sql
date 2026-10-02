-- Subscription enums
DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM ('trialing','active','past_due','canceled','incomplete','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.subscriber_kind AS ENUM ('teacher','institution');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL,
  subscriber_kind public.subscriber_kind NOT NULL,
  plan_code text NOT NULL DEFAULT 'free',
  plan_name text NOT NULL DEFAULT 'Gratuito',
  status public.subscription_status NOT NULL DEFAULT 'active',
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  amount_cents integer,
  currency text DEFAULT 'BRL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscriber_id, subscriber_kind)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_subscriber ON public.subscriptions(subscriber_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners view own subscription" ON public.subscriptions;
CREATE POLICY "Owners view own subscription" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (subscriber_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage all subscriptions" ON public.subscriptions;
CREATE POLICY "Admins manage all subscriptions" ON public.subscriptions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill: free subscription for every existing teacher / institution profile
INSERT INTO public.subscriptions (subscriber_id, subscriber_kind, plan_code, plan_name, status)
SELECT p.id,
       CASE WHEN p.profile_type = 'institution' THEN 'institution'::public.subscriber_kind
            ELSE 'teacher'::public.subscriber_kind END,
       'free', 'Gratuito', 'active'
FROM public.profiles p
WHERE p.profile_type IN ('teacher','institution')
ON CONFLICT (subscriber_id, subscriber_kind) DO NOTHING;

-- Auto-create subscription row for new teacher/institution profiles
CREATE OR REPLACE FUNCTION public.ensure_subscription_for_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.profile_type IN ('teacher','institution') THEN
    INSERT INTO public.subscriptions (subscriber_id, subscriber_kind, plan_code, plan_name, status)
    VALUES (NEW.id,
            CASE WHEN NEW.profile_type = 'institution' THEN 'institution'::public.subscriber_kind
                 ELSE 'teacher'::public.subscriber_kind END,
            'free','Gratuito','active')
    ON CONFLICT (subscriber_id, subscriber_kind) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_subscription ON public.profiles;
CREATE TRIGGER trg_ensure_subscription
AFTER INSERT OR UPDATE OF profile_type ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.ensure_subscription_for_profile();

-- Fix invitations RLS so admins see ALL invitations (not just their own)
-- Existing "Admins manage all invitations" already covers ALL via has_role, good.
-- But the listInvitations server fn relies on it; nothing else needed here.
-- Add explicit SELECT policy for clarity (no-op if admin policy already grants).

-- Allow recipient identification: add recipient_name + recipient_email columns
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS recipient_name text,
  ADD COLUMN IF NOT EXISTS recipient_email text;
