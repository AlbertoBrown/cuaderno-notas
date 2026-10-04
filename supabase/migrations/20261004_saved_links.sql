-- Cuaderno · enlaces guardados por cuaderno
create table if not exists public.cuaderno_enlaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notebook_id text not null,
  url text not null,
  titulo text not null default '',
  nota text not null default '',
  etiquetas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cuaderno_enlaces enable row level security;

drop policy if exists "cuaderno_enlaces_select" on public.cuaderno_enlaces;
drop policy if exists "cuaderno_enlaces_insert" on public.cuaderno_enlaces;
drop policy if exists "cuaderno_enlaces_update" on public.cuaderno_enlaces;
drop policy if exists "cuaderno_enlaces_delete" on public.cuaderno_enlaces;

create policy "cuaderno_enlaces_select"
on public.cuaderno_enlaces for select to authenticated
using (auth.uid() = user_id);

create policy "cuaderno_enlaces_insert"
on public.cuaderno_enlaces for insert to authenticated
with check (auth.uid() = user_id);

create policy "cuaderno_enlaces_update"
on public.cuaderno_enlaces for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "cuaderno_enlaces_delete"
on public.cuaderno_enlaces for delete to authenticated
using (auth.uid() = user_id);

create index if not exists cuaderno_enlaces_user_notebook_idx
  on public.cuaderno_enlaces(user_id, notebook_id, created_at desc);

drop trigger if exists set_cuaderno_enlaces_updated_at on public.cuaderno_enlaces;
create trigger set_cuaderno_enlaces_updated_at
before update on public.cuaderno_enlaces
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='cuaderno_enlaces'
  ) then
    alter publication supabase_realtime add table public.cuaderno_enlaces;
  end if;
end
$$;

notify pgrst, 'reload schema';
