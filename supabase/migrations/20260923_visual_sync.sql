-- Cuaderno Notas · migración de persistencia visual y sincronización
-- Ejecutar en Supabase SQL Editor si estas columnas/bucket todavía no existen.

alter table public.cuaderno_notas
  add column if not exists imagen_path text,
  add column if not exists imagen_nombre text;

alter table public.cuaderno_notas
  add column if not exists updated_at timestamptz not null default now();

alter table public.cuaderno_dias
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_cuaderno_notas_updated_at on public.cuaderno_notas;
create trigger set_cuaderno_notas_updated_at
before update on public.cuaderno_notas
for each row execute function public.set_updated_at();

drop trigger if exists set_cuaderno_dias_updated_at on public.cuaderno_dias;
create trigger set_cuaderno_dias_updated_at
before update on public.cuaderno_dias
for each row execute function public.set_updated_at();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'cuaderno-imagenes',
  'cuaderno-imagenes',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic'];

drop policy if exists "cuaderno_imagenes_select" on storage.objects;
drop policy if exists "cuaderno_imagenes_insert" on storage.objects;
drop policy if exists "cuaderno_imagenes_update" on storage.objects;
drop policy if exists "cuaderno_imagenes_delete" on storage.objects;

create policy "cuaderno_imagenes_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'cuaderno-imagenes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "cuaderno_imagenes_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'cuaderno-imagenes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "cuaderno_imagenes_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'cuaderno-imagenes'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'cuaderno-imagenes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "cuaderno_imagenes_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'cuaderno-imagenes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Realtime: añade las tablas solo si aún no pertenecen a la publicación.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cuaderno_dias'
  ) then
    alter publication supabase_realtime add table public.cuaderno_dias;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cuaderno_notas'
  ) then
    alter publication supabase_realtime add table public.cuaderno_notas;
  end if;
end
$$;
