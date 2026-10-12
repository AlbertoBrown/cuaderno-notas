# Categoría y fecha en apuntes visuales

La organización de la biblioteca visual reutiliza campos ya existentes en `public.cuaderno_notas`:

- `etiqueta`: categoría elegida por el usuario.
- `fecha`: fecha de organización elegida por el usuario.

Esto mantiene la compatibilidad con la sincronización offline/online existente. Las etiquetas históricas del tipo `Imagen + prompt · ...` se presentan como `General` hasta que el apunte se edite.

La migración `20261012_visual_category_date_index.sql` añade únicamente un índice parcial para acelerar consultas futuras por usuario, cuaderno, categoría y fecha. No transforma ni elimina datos.
