create or replace function public.teacher_has_paid_plan(_user_id uuid, _env text default 'live')
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    public.has_role(_user_id, 'admin')
    -- Assinatura paga do próprio professor no ambiente informado
    or exists (
      select 1 from public.subscriptions
      where subscriber_id = _user_id
        and subscriber_kind = 'teacher'
        and environment = _env
        and plan_code <> 'free'
        and (
          (status in ('active','trialing','past_due')
            and (current_period_end is null or current_period_end > now()))
          or (status = 'canceled' and current_period_end is not null and current_period_end > now())
        )
    )
    -- Plano institucional ativo cobre todos os professores da instituição
    or exists (
      select 1
      from public.profiles p
      join public.institutions i on i.id = p.institution_id
      join public.subscriptions s
        on s.subscriber_id = i.owner_user_id
       and s.subscriber_kind = 'institution'
      where p.id = _user_id
        and p.institution_id is not null
        and s.environment = _env
        and s.plan_code <> 'free'
        and (
          (s.status in ('active','trialing','past_due')
            and (s.current_period_end is null or s.current_period_end > now()))
          or (s.status = 'canceled' and s.current_period_end is not null and s.current_period_end > now())
        )
    )
$$;