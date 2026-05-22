-- Guardrails for mana reward integrity

create unique index if not exists ux_mana_events_user_lesson_event
on public.mana_events (user_id, lesson_id, event_type)
where lesson_id is not null;

create or replace function public.prevent_duplicate_lesson_reward()
returns trigger
language plpgsql
as $$
begin
  if new.lesson_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.mana_events me
    where me.user_id = new.user_id
      and me.lesson_id = new.lesson_id
      and me.event_type = new.event_type
  ) then
    raise exception 'Duplicate mana event blocked for lesson %', new.lesson_id
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_lesson_reward on public.mana_events;
create trigger trg_prevent_duplicate_lesson_reward
before insert on public.mana_events
for each row execute function public.prevent_duplicate_lesson_reward();

create or replace function public.recompute_profile_mana()
returns trigger
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'INSERT' then
    v_user_id := new.user_id;
  elsif tg_op = 'DELETE' then
    v_user_id := old.user_id;
  elsif tg_op = 'UPDATE' then
    v_user_id := new.user_id;
  else
    return coalesce(new, old);
  end if;

  update public.profiles p
  set mana_balance = (
    select coalesce(sum(me.mana_amount), 0)
    from public.mana_events me
    where me.user_id = p.id
  ),
  updated_at = now()
  where p.id = v_user_id;

  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    update public.profiles p
    set mana_balance = (
      select coalesce(sum(me.mana_amount), 0)
      from public.mana_events me
      where me.user_id = p.id
    ),
    updated_at = now()
    where p.id = old.user_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recompute_profile_mana_insert on public.mana_events;
create trigger trg_recompute_profile_mana_insert
after insert on public.mana_events
for each row execute function public.recompute_profile_mana();

drop trigger if exists trg_recompute_profile_mana_delete on public.mana_events;
create trigger trg_recompute_profile_mana_delete
after delete on public.mana_events
for each row execute function public.recompute_profile_mana();

drop trigger if exists trg_recompute_profile_mana_update on public.mana_events;
create trigger trg_recompute_profile_mana_update
after update on public.mana_events
for each row execute function public.recompute_profile_mana();
