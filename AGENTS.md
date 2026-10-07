# Architecture decisions

- Reuse `CorrectionDialog` for activity/work and SimulSaúde reviews through adapters, so the five-step correction UI has one source of truth.
- Keep `.env`, `.env.development` and `.env.production` tracked (not in .gitignore): they hold only publishable keys, and the publish build needs them or the live site crashes with missing Supabase variables.
