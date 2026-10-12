-- Cuaderno Notas · organización de apuntes visuales por categoría y fecha
--
-- La interfaz reutiliza campos existentes y ya sincronizados:
--   etiqueta -> categoría del apunte visual
--   fecha    -> fecha de organización
--
-- No se modifica ni se elimina ningún dato existente. Las etiquetas históricas
-- "Imagen + prompt · ..." se muestran como "General" desde la aplicación hasta
-- que el usuario edite el apunte y elija una categoría.

create index if not exists cuaderno_notas_visual_category_date_idx
  on public.cuaderno_notas (user_id, notebook_id, etiqueta, fecha desc)
  where tipo = 'visual';
