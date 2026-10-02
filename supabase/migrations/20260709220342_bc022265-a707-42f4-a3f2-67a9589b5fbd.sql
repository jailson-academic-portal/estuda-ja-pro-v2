create or replace function public.teacher_has_paid_plan(_user_id uuid, _env text default 'live')
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    public.has_role(_user_id, 'admin')
    or exists (
      select 1 from public.subscriptions
      where subscriber_id = _user_id
        and subscriber_kind = 'teacher'
        and (_env = 'any' or environment = _env)
        and plan_code <> 'free'
        and (
          (status in ('active','trialing','past_due')
            and (current_period_end is null or current_period_end > now()))
          or (status = 'canceled' and current_period_end is not null and current_period_end > now())
        )
    )
    or exists (
      select 1
      from public.profiles p
      join public.institutions i on i.id = p.institution_id
      join public.subscriptions s
        on s.subscriber_id = i.owner_user_id
       and s.subscriber_kind = 'institution'
      where p.id = _user_id
        and p.institution_id is not null
        and (_env = 'any' or s.environment = _env)
        and s.plan_code <> 'free'
        and (
          (s.status in ('active','trialing','past_due')
            and (s.current_period_end is null or s.current_period_end > now()))
          or (s.status = 'canceled' and s.current_period_end is not null and s.current_period_end > now())
        )
    )
$$;

create or replace function public.enforce_free_plan_discipline_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count int;
  v_owner uuid;
begin
  v_owner := coalesce(NEW.teacher_id, OLD.teacher_id);
  if v_owner is null then return NEW; end if;

  if public.has_role(v_owner, 'admin') then return NEW; end if;
  if public.teacher_has_paid_plan(v_owner, 'any') then return NEW; end if;
  if NEW.institution_id is not null then return NEW; end if;

  if (TG_OP = 'INSERT' and coalesce(NEW.status, 'active') = 'active')
     or (TG_OP = 'UPDATE' and NEW.status = 'active' and coalesce(OLD.status,'') <> 'active') then
    select count(*) into v_count from public.disciplines
      where teacher_id = v_owner and status = 'active' and id <> coalesce(NEW.id, gen_random_uuid());
    if v_count >= 1 then
      raise exception 'O plano Gratuito permite apenas 1 disciplina ativa. Faça upgrade para o plano Pro para criar disciplinas ilimitadas.'
        using errcode = 'check_violation';
    end if;
  end if;
  return NEW;
end;
$$;

create or replace function public.enforce_free_plan_student_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_count int;
begin
  select teacher_id into v_owner from public.disciplines where id = NEW.discipline_id;
  if v_owner is null then return NEW; end if;

  if public.has_role(v_owner, 'admin') then return NEW; end if;
  if public.teacher_has_paid_plan(v_owner, 'any') then return NEW; end if;

  select count(*) into v_count from public.discipline_students where discipline_id = NEW.discipline_id;
  if v_count >= 30 then
    raise exception 'O plano Gratuito permite no máximo 30 alunos por disciplina. Faça upgrade para o plano Pro.'
      using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;