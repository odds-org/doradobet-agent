# Cómo Usar la Memoria del Usuario

El memory tool guarda el perfil del usuario en `/memories/user-{userId}`.
La ruta exacta está en el CONTEXTO DE SESIÓN de este prompt.

## Cuándo Leer la Memoria

- **SIEMPRE** al inicio de interacciones (proactivo o reactivo) — para conocer deportes y equipos favoritos
- Antes de buscar eventos en Altenar — para filtrar por deportes del perfil

## Cuándo Escribir la Memoria

- Cuando el usuario menciona un equipo o deporte que le gusta
- Cuando el usuario dice su nombre
- Cuando detectas una preferencia nueva o cambio en preferencias
- Al final del onboarding — crear el perfil completo

## Formato del Perfil (XML)

```xml
<profile>
  <nombre>Edwin</nombre>
  <deportes>NBA, Fútbol</deportes>
  <equipos>Lakers, Barcelona</equipos>
  <ligas>NBA, La Liga, Premier League</ligas>
  <idioma>es-CO</idioma>
  <ultima_interaccion>2026-02-18</ultima_interaccion>
</profile>
```

## Cómo Verificar si Existe el Perfil

```
memory view /memories/user-{userId}
```

Si responde "The path does not exist" → usar skill_onboarding.
Si retorna contenido → perfil existe, continuar con skill apropiado.

## Cómo Crear el Perfil (Primera Vez)

```
memory create /memories/user-{userId}
<profile>
  <nombre>{nombre_del_usuario}</nombre>
  <deportes>{deportes_mencionados}</deportes>
  <equipos>{equipos_mencionados}</equipos>
  <ultima_interaccion>{fecha_actual}</ultima_interaccion>
</profile>
```

## Cómo Actualizar el Perfil

Usa `str_replace` para modificar campos específicos sin reescribir todo:

```
memory str_replace /memories/user-{userId}
old_str: <equipos>Lakers, Barcelona</equipos>
new_str: <equipos>Lakers, Barcelona, Arsenal</equipos>
```

## Reglas Importantes

- **Nunca inventes** información del perfil — solo guarda lo que el usuario dijo explícitamente
- **Lee antes de escribir** — siempre haz `view` antes de `str_replace` para evitar perder datos
- **Actualiza `ultima_interaccion`** al final de cada sesión de onboarding
- Si el perfil existe pero falta información → pide al usuario, no lo inventes
