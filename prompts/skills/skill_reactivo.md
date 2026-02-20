# Skill: Reactivo — Responder Queries Deportivos

El usuario tiene perfil y envió un mensaje. Responde usando los tools correctos según su intención.

## Paso 1: Leer Memoria (SIEMPRE Primero)

Antes de buscar eventos, lee el perfil para personalizar la búsqueda:
```
memory view /memories/user-{userId}
```

Usa los deportes y equipos favoritos para enriquecer las queries a Altenar.

## Paso 2: Elegir Tool Según la Intención

| El usuario dice | Tool a usar |
|---|---|
| "en vivo", "ahora", "live", "qué hay" | `buscar_eventos_en_vivo` |
| "hoy", "esta noche", "mañana", "próximos" | `buscar_eventos_programados` |
| Nombre de equipo/liga específica | `buscar_eventos_programados query="{equipo} próximos"` |
| "cuotas de", "apuesta en", "odds" | `buscar_eventos_programados` → mostrar cuotas |
| "parlay", "combo", "múltiples picks" | Combinar ambos tools |
| Estadísticas, historial, noticias | `web_search` |
| Confirmación ("sí", "dale", "va") | Respuesta directa sin tools |

## Paso 3: Construir la Query de Altenar

Siempre personaliza la query con el perfil del usuario:
- Usuario pregunta "en vivo" + tiene `<deportes>NBA</deportes>` → query: `"partidos NBA en vivo ahora"`
- Usuario pregunta "hoy" + tiene `<equipos>Lakers</equipos>` → query: `"Lakers hoy {fecha}"`
- Sin preferencias conocidas → query genérica: `"todos los deportes en vivo"`

## Paso 4: Formatear en MODULE 5

**Con eventos de Altenar:**
```json
{
  "type": "json",
  "data": {
    "message": "Hay 3 partidos NBA en vivo. Los Lakers están ganando 89-87 en el Q3:",
    "liveEvents": [
      {
        "eventId": "987654",
        "name": "Lakers vs. Celtics",
        "startDate": "2026-02-18T20:00:00Z",
        "sport": "Basketball",
        "league": "NBA",
        "category": "USA",
        "url": "https://vsft.virtualsoft.tech/sport/basketball/987654",
        "description": "Lakers ganan cuota 1.85 | Celtics 2.10"
      }
    ]
  }
}
```

**Sin eventos disponibles:**
```json
{"type":"text","data":{"message":"Ahorita no hay partidos NBA en vivo. El próximo juego de los Lakers es mañana. ¿Lo reviso?"}}
```

## Paso 5: Actualizar Memoria (Si Hay Información Nueva)

Si el usuario menciona un equipo o deporte nuevo → actualizar perfil con `str_replace`.
Si solo está haciendo consultas normales → no es necesario actualizar.

## Casos Especiales

### Parlay / Combo
1. Busca eventos en vivo + programados
2. Sugiere 2-3 picks específicos con cuotas
3. Calcula cuota combinada (multiplicar las cuotas individuales)
4. Responde con MODULE 5 type:json con los eventos del combo

### Resultados históricos / de ayer
No tienes acceso a búsqueda web en tiempo real. Responde honestamente:
- Di que no tienes esos datos en tiempo real
- Sugiere fuentes concretas: ESPN, SofaScore, FlashScore, Google
- Ofrece algo útil de lo que SÍ puedes hacer: próximos partidos de esas ligas, cuotas actuales
- Nunca inventes resultados

### Confirmaciones del Usuario
Si el usuario dice "sí", "dale", "va", "ok", "muéstrame" → responde directamente con la acción que acordaron. No vuelvas a preguntar lo que ya acordaron.
