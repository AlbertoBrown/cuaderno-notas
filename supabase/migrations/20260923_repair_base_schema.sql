-- Cuaderno Notas · reparación de esquema base
-- Ejecutar en el SQL Editor del proyecto Supabase del cuaderno.

alter table public.cuaderno_notas
  add column if not exists tipo text not null default 'note',
  add column if not exists titulo text not null default '',
  add column if not exists etiqueta text not null default '',
  add column if not exists contenido text not null default '',
  add column if not exists imagen_path text,
  add column if not exists imagen_nombre text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.cuaderno_dias
  add column if not exists prompt text not null default '',
  add column if not exists apuntes text not null default '',
  add column if not exists conclusiones text not null default '',
  add column if not exists tareas jsonb not null default '[]'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Asegurar unicidad por usuario y fecha para el upsert del día.
create unique index if not exists cuaderno_dias_user_fecha_uidx
  on public.cuaderno_dias(user_id, fecha);

-- Refrescar la caché de esquema de PostgREST.
notify pgrst, 'reload schema';
