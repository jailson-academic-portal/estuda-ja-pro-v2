UPDATE public.exercise_questions
SET correct_answer = to_jsonb(options->((trim(both '"' from correct_answer::text))::int))
WHERE jsonb_typeof(options) = 'array'
  AND correct_answer IS NOT NULL
  AND jsonb_typeof(correct_answer) = 'string'
  AND (trim(both '"' from correct_answer::text)) ~ '^[0-9]+$'
  AND ((trim(both '"' from correct_answer::text))::int) < jsonb_array_length(options);