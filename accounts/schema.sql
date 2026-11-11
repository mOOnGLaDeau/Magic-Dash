create table if not exists public.magic_dash_accounts (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  revision integer not null check (revision > 0),
  data jsonb not null check (
    jsonb_typeof(data) = 'object'
    and jsonb_typeof(data->'decks') is not distinct from 'array'
    and jsonb_typeof(data->'customEvents') is not distinct from 'array'
    and jsonb_typeof(data->'playEvents') is not distinct from 'array'
    and jsonb_typeof(data->'snapshots') is not distinct from 'object'
    and octet_length(data::text) <= 2000000
  )
);

alter table public.magic_dash_accounts enable row level security;
revoke all on public.magic_dash_accounts from anon, authenticated;
grant select, insert, update on public.magic_dash_accounts to authenticated;

create or replace function public.magic_dash_email_verified()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users where id = (select auth.uid()) and email_confirmed_at is not null);
$$;
revoke all on function public.magic_dash_email_verified() from public;
grant execute on function public.magic_dash_email_verified() to authenticated;

drop policy if exists own_verified_data on public.magic_dash_accounts;
create policy own_verified_data on public.magic_dash_accounts
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and (select public.magic_dash_email_verified())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.magic_dash_email_verified())
  );
