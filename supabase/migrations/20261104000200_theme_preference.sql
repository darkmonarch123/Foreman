-- Foreman: appearance preference (Light / Dark / System) on the account.
--
-- Stored so the choice follows the person to other devices. It is a display
-- preference only; it grants nothing and is readable only by its owner
-- (profiles RLS already limits reads to the caller's own row).

alter table public.profiles
  add column if not exists theme_preference text not null default 'system'
    check (theme_preference in ('system', 'light', 'dark'));

-- Changes only the caller's own row; identity comes from the session.
create or replace function public.set_theme_preference(p_theme text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_theme text;
begin
  if p_theme is null or p_theme not in ('system', 'light', 'dark') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001';
  end if;
  update public.profiles p set theme_preference = p_theme
    where p.id = v_uid and p.status = 'ACTIVE'
    returning p.theme_preference into v_theme;
  if v_theme is null then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  return v_theme;
end;
$$;

revoke all on function public.set_theme_preference(text) from public, anon, authenticated;
grant execute on function public.set_theme_preference(text) to authenticated;
