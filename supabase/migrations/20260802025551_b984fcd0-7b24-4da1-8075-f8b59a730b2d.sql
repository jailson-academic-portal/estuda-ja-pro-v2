-- Relax generic placeholder detection to allow natural Portuguese usage.
-- We still want to catch bare placeholders like "[Disciplina]", "Disciplina:", or "Tema:",
-- but we should allow "conteúdo programático", "matéria orgânica", etc.

CREATE OR REPLACE FUNCTION public.detect_generic_placeholder(prompt text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    GENERIC_PLACEHOLDER_RE text := '(?:^|[\s("])((?:Disciplina|Conte[úu]do|Tema|Assunto|Mat[ée]ria|Apostila|Aula|Material|M[óo]dulo|Unidade)s?)(?=[\s,.;:?!)"]|$)';
    CONCEPT_MARKER_RE text := '\[[^\]]{3,80}\]';
    m text[];
    idx int;
    rest text;
    term text;
BEGIN
    -- 1. Check for manual markers like [Conceito]
    m := regexp_matches(prompt, CONCEPT_MARKER_RE);
    IF m IS NOT NULL THEN
        RETURN m[1];
    END IF;

    -- 2. Check for generic terms
    m := regexp_matches(prompt, GENERIC_PLACEHOLDER_RE, 'i');
    IF m IS NULL THEN
        RETURN NULL;
    END IF;

    term := m[1];
    idx := strpos(prompt, term);
    rest := trim(substring(prompt from idx + length(term)));

    -- 3. Whitelist: If followed by "de/da/do..." and a Capitalized word (Proper Noun), it's specific.
    -- Example: "Disciplina de Farmacologia" -> OK.
    IF rest ~* '^(?:de|da|do|das|dos)\s+\p{Lu}' THEN
        RETURN NULL;
    END IF;

    -- 4. NEW WHITELIST: If followed by a lowercase word (natural flow), it's likely part of a technical term.
    -- Example: "conteúdo programático", "matéria orgânica", "unidade de medida" -> OK.
    -- We only flag it if it's the end of a sentence/phrase or followed by punctuation/spaces only.
    IF rest ~ '^[a-zÀ-ÿ]' THEN
        RETURN NULL;
    END IF;

    RETURN term;
END;
$function$;

-- The server-side regex in JS/TS also needs to be smarter, but the logic in detectGenericPlaceholder
-- already uses the slice whitelist. I will update the server code in the next step.

-- For the storage issue, we verified the "Manage materials files" policy expects 
-- the folder name to match the discipline_id. The evidence says the policy is:
-- ((d.id)::text = (storage.foldername(objects.name))[1])
-- If this is failing, it's possible the (d.id)::text casting or foldername indexing 
-- is sensitive to how the path is constructed (e.g. leading slashes).
-- I'll ensure the backend code in uploads.functions.ts is clean.
