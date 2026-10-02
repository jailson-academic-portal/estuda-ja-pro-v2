-- Grant select access to authenticated users for materials and modules
-- This ensures students can see the items within the modules.

-- Materials (these are the "items" inside modules)
DROP POLICY IF EXISTS "Users read module items" ON public.materials;
CREATE POLICY "Users read module items" ON public.materials
FOR SELECT TO authenticated USING (true);

-- Material Modules
DROP POLICY IF EXISTS "Users read modules of enrolled/owned disciplines" ON public.material_modules;
CREATE POLICY "Users read modules of enrolled/owned disciplines" ON public.material_modules
FOR SELECT TO authenticated USING (true);

-- Clinical Cases
DROP POLICY IF EXISTS "Users read clinical cases" ON public.clinical_cases;
CREATE POLICY "Users read clinical cases" ON public.clinical_cases
FOR SELECT TO authenticated USING (true);

-- Academic Works (if applicable)
DROP POLICY IF EXISTS "Users read academic works" ON public.academic_works;
CREATE POLICY "Users read academic works" ON public.academic_works
FOR SELECT TO authenticated USING (true);

-- Ensure grants are present
GRANT SELECT ON public.materials TO authenticated;
GRANT SELECT ON public.material_modules TO authenticated;
GRANT SELECT ON public.clinical_cases TO authenticated;
GRANT SELECT ON public.academic_works TO authenticated;
