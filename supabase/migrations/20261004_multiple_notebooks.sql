-- Cuaderno Notas · múltiples cuadernos
-- Crea espacios separados por usuario y migra todos los datos existentes
-- al cuaderno "Combustibles Los Baldíos" sin perder información.

create table if not exists public.cuadernos (
  user_id uuid not null,
  id text not null,
  nombre text not null,
  icono text not null default '▤',
  color text not null default 'sand',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.cuadernos enable row level security;

drop policy if exists "cuadernos_select_own" on public.cuadernos;
drop policy if exists "cuadernos_insert_own" on public.cuadernos;
drop policy if exists "cuadernos_update_own" on public.cuadernos;
drop policy if exists "cuadernos_delete_own" on public.cuadernos;

create policy "cuadernos_select_own"
on public.cuadernos
for select
to authenticated
using (user_id = auth.uid());

create policy "cuadernos_insert_own"
on public.cuadernos
for insert
to authenticated
with check (user_id = auth.uid());

create policy "cuadernos_update_own"
on public.cuadernos
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "cuadernos_delete_own"
on public.cuadernos
for delete
to authenticated
using (user_id = auth.uid());

alter table public.cuaderno_dias
  add column if not exists notebook_id text;

alter table public.cuaderno_notas
  add column if not exists notebook_id text;

update public.cuaderno_dias
set notebook_id = 'combustibles-los-baldios'
where notebook_id is null or btrim(notebook_id) = '';

update public.cuaderno_notas
set notebook_id = 'combustibles-los-baldios'
where notebook_id is null or btrim(notebook_id) = '';

alter table public.cuaderno_dias
  alter column notebook_id set default 'combustibles-los-baldios',
  alter column notebook_id set not null;

alter table public.cuaderno_notas
  alter column notebook_id set default 'combustibles-los-baldios',
  alter column notebook_id set not null;

-- Crear los dos cuadernos iniciales para todos los usuarios con datos ya existentes.
with usuarios as (
  select user_id from public.cuaderno_dias where user_id is not null
  union
  select user_id from public.cuaderno_notas where user_id is not null
)
insert into public.cuadernos (user_id, id, nombre, icono, color, is_default)
select user_id, 'combustibles-los-baldios', 'Combustibles Los Baldíos', '◫', 'sand', true
from usuarios
on conflict (user_id, id) do update
set
  nombre = excluded.nombre,
  icono = excluded.icono,
  color = excluded.color,
  is_default = true;

with usuarios as (
  select user_id from public.cuaderno_dias where user_id is not null
  union
  select user_id from public.cuaderno_notas where user_id is not null
)
insert into public.cuadernos (user_id, id, nombre, icono, color, is_default)
select user_id, 'programacion', 'Programación', '</>', 'blue', false
from usuarios
on conflict (user_id, id) do nothing;

-- La fecha deja de ser única por usuario: ahora puede repetirse en distintos cuadernos.
drop index if exists public.cuaderno_dias_user_fecha_uidx;

create unique index if not exists cuaderno_dias_user_notebook_fecha_uidx
  on public.cuaderno_dias(user_id, notebook_id, fecha);

create index if not exists cuaderno_notas_user_notebook_fecha_idx
  on public.cuaderno_notas(user_id, notebook_id, fecha);

create index if not exists cuadernos_user_updated_idx
  on public.cuadernos(user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_cuadernos_updated_at on public.cuadernos;
create trigger set_cuadernos_updated_at
before update on public.cuadernos
for each row execute function public.set_updated_at();

-- Realtime para que el selector de cuadernos se actualice entre dispositivos.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cuadernos'
  ) then
    alter publication supabase_realtime add table public.cuadernos;
  end if;
end
$$;

notify pgrst, 'reload schema';
