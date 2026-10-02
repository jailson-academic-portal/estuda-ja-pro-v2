-- 1. Create clean policies for material_modules
DROP POLICY IF EXISTS "Teachers manage own material modules" ON public.material_modules;
DROP POLICY IF EXISTS "Students view modules in enrolled disciplines" ON public.material_modules;
DROP POLICY IF EXISTS "Admins manage all material modules" ON public.material_modules;
DROP POLICY IF EXISTS "Institutions see material modules" ON public.material_modules;
DROP POLICY IF EXISTS "Professors can manage their own modules" ON public.material_modules;
DROP POLICY IF EXISTS "Students can see modules of their disciplines" ON public.material_modules;
DROP POLICY IF EXISTS "Teachers can manage own modules" ON public.material_modules;
DROP POLICY IF EXISTS "material_modules_select_policy" ON public.material_modules;

CREATE POLICY "Users read modules of enrolled/owned disciplines" ON public.material_modules
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins/Teachers manage material_modules" ON public.material_modules
FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR 
  EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = material_modules.discipline_id AND d.teacher_id = auth.uid())
);

-- 2. Create clean policies for materials
DROP POLICY IF EXISTS "Teachers manage own materials" ON public.materials;
DROP POLICY IF EXISTS "Students view materials in enrolled disciplines" ON public.materials;
DROP POLICY IF EXISTS "Admins manage all materials" ON public.materials;

CREATE POLICY "Users read module items" ON public.materials
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins/Teachers manage materials" ON public.materials
FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR 
  EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = materials.discipline_id AND d.teacher_id = auth.uid())
);

-- 3. Create clean policies for clinical_cases
DROP POLICY IF EXISTS "Teachers manage own clinical cases" ON public.clinical_cases;
DROP POLICY IF EXISTS "Students read cases in enrolled disciplines" ON public.clinical_cases;

CREATE POLICY "Users read clinical cases" ON public.clinical_cases
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins/Teachers manage clinical_cases" ON public.clinical_cases
FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR 
  EXISTS (SELECT 1 FROM public.disciplines d WHERE d.id = clinical_cases.discipline_id AND d.teacher_id = auth.uid())
);

-- Ensure grants are correct
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_modules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinical_cases TO authenticated;
GRANT ALL ON public.material_modules TO service_role;
GRANT ALL ON public.materials TO service_role;
GRANT ALL ON public.clinical_cases TO service_role;