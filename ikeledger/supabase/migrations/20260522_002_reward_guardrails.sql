-- Guardrails for mana reward integrity

create or replace function public.prevent_duplicate_lesson_reward()
returns trigger
language plpgsql
as $$
begin
  if new.lesson_id is not null and exists (
    select 1
    from public.mana_events me
    where me.user_id = new.user_id
      and me.lesson_id = new.lesson_id
      and me.event_type = new.event_type
  ) then
    raise exception 'Duplicate mana event blocked for lesson %', new.lesson_id;
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
begin
  update public.profiles p
  set mana_balance = (
    select coalesce(sum(me.mana_amount), 0)
    from public.mana_events me
    where me.user_id = p.id
  ),
  updated_at = now()
  where p.id = coalesce(new.user_id, old.user_id);

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
