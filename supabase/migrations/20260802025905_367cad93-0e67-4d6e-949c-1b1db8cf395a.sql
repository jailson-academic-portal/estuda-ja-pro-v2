-- Revoke public execution of identified SECURITY DEFINER functions for security hardening
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM public, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM public, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM public, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM public, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM public, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM public, authenticated;

-- Also fix any remaining search_path or authenticated execution issues from linter
-- Standard has_role function should be SEC DEF but safe.
ALTER FUNCTION public.has_role(uuid, app_role) SET search_path = public;
-- Ensure current_institution_id is safe
ALTER FUNCTION public.current_institution_id() SET search_path = public;
