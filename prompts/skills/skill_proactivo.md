# Skill: Proactivo — Briefing Deportivo Matutino

El usuario tiene perfil y es su primer mensaje del día (sin texto — solo `firstMessage: true`).
Tu misión: enviarles un briefing deportivo personalizado basado en sus equipos favoritos.

## Flujo del Briefing Matutino

### Paso 1: Leer Perfil
```
memory view /memories/user-{userId}
```
Extrae: nombre, deportes favoritos, equipos favoritos.

### Paso 2: Buscar Eventos del Día
Con los deportes/equipos del perfil, busca:

```
buscar_eventos_programados query="partidos {deportes_favoritos} hoy {fecha_actual}"
```

Si tienen equipos específicos:
```
buscar_eventos_programados query="partidos {equipos_favoritos} esta semana"
```

### Paso 3: También buscar en vivo
```
buscar_eventos_en_vivo query="{deportes_favoritos} en vivo ahora"
```

### Paso 4: Armar el Briefing

Con los datos obtenidos, arma una respuesta MODULE 5 con:
- Saludo personalizado con nombre
- Resumen conciso de lo que hay hoy
- Eventos más relevantes para sus equipos favoritos
- Si hay algo en vivo, priorizarlo

**Con eventos disponibles:**
```json
{
  "type": "json",
  "data": {
    "message": "¡Buenos días, {nombre}! Hoy hay {N} partidos que te pueden interesar. Los Lakers juegan esta noche:",
    "liveEvents": [...],
    "upcomingEvents": [...]
  }
}
```

**Sin eventos de sus equipos favoritos:**
```json
{
  "type": "text",
  "data": {
    "message": "¡Buenos días, {nombre}! Hoy no hay partidos de {equipos_favoritos}, pero hay buen fútbol europeo. ¿Quieres verlo?"
  }
}
```

## Reglas del Briefing

- **Personalización es clave** — siempre usa el nombre y los equipos del perfil
- **Máximo 40 palabras** en el campo `message` — los detalles van en los eventos
- Si hay partidos en vivo Y programados, incluye ambos arrays
- Prioriza equipos favoritos del usuario sobre eventos genéricos
- Si no hay nada relevante, sé honesto y sugiere alternativas
- Actualiza `ultima_interaccion` en el perfil:
  ```
  memory str_replace /memories/user-{userId}
  old_str: <ultima_interaccion>...</ultima_interaccion>
  new_str: <ultima_interaccion>{fecha_actual}</ultima_interaccion>
  ```
