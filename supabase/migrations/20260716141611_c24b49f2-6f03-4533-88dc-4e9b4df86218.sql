CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_materials_discipline_created ON public.materials (discipline_id, created_at);
CREATE INDEX IF NOT EXISTS idx_materials_discipline_status ON public.materials (discipline_id, status);