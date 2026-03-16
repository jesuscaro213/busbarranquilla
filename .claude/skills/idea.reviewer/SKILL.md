---
name: idea-reviewer
description: >
  Evalúa ideas y genera planes de implementación antes de ejecutarlos. SIEMPRE usa esta skill
  cuando el usuario diga frases como "tengo una idea", "qué opinas si...", "quiero implementar...",
  "pensé en hacer...", "sería bueno agregar...", "qué tal si...", "se me ocurrió...", o cualquier
  frase donde el usuario plantee algo que aún no se ha hecho y quiera saber cómo proceder.
  Esta skill NO implementa nada — solo evalúa y planifica.
---

# Idea Reviewer — Contexto, Beneficios y Plan

## Propósito

Cuando el usuario describa una idea, entregar cuatro cosas en orden:

1. **Contexto** — qué es la idea y qué problema resuelve
2. **Beneficios** — qué ganan los usuarios con esto
3. **Tu plan** — los pasos para implementar exactamente lo que el usuario describió, sin modificaciones
4. **Mi recomendación** — solo si hay algo que quitar, agregar o cambiar. Incluye la razón y el plan ajustado

NO implementar nada. Solo analizar y planificar.

## Proceso de análisis

Antes de responder, analiza en silencio usando el contexto del proyecto (CLAUDE.md, AI_CONTEXT.md, README.md):

- ¿Qué problema concreto resuelve esta idea?
- ¿Qué tipo de usuario se beneficia y de qué forma?
- ¿Todas las partes que menciona el usuario son necesarias o algunas sobran?
- ¿Falta algo que haría la idea más completa o robusta?
- ¿El plan recomendado sería materialmente diferente al del usuario?

Si el plan recomendado termina siendo igual al del usuario, omitir esa sección.

## Formato de salida

**Contexto:**
Una o dos oraciones explicando qué es la idea y qué problema resuelve en el proyecto. Específico, no genérico.

**Beneficios para los usuarios:**
Qué ganan concretamente los usuarios con esta funcionalidad. Sin inflar con beneficios obvios o de relleno.

**Tu plan:**
Los pasos exactos y ordenados para implementar la idea tal como el usuario la describió. Claro y accionable — suficiente para que Claude lo ejecute después sin ambigüedad.

**Mi recomendación:** *(Solo si hay diferencias reales)*
Primero una o dos oraciones explicando qué cambiaría y por qué. Luego los pasos del plan ajustado. Si no hay nada relevante que cambiar, omitir esta sección completamente.

## Tono y estilo

- Directo y conversacional
- Sin frases de relleno ni validaciones vacías
- Los beneficios deben ser concretos, no marketineros
- La recomendación debe tener razones reales, no opiniones vagas
- Usa el contexto del proyecto para que todo sea específico al stack y usuarios reales de la app

## Ejemplo

**Usuario:** "Quiero agregar notificaciones push cuando el conductor acepta el viaje, cuando llega al punto de recogida, cuando inicia el viaje y cuando lo termina."

**Contexto:**
La idea agrega notificaciones push en los cuatro momentos clave del ciclo de un viaje, permitiendo al usuario seguir el estado sin tener que estar con la app abierta.

**Beneficios para los usuarios:**
- Sabe en tiempo real qué está pasando con su viaje sin depender de estar mirando la pantalla
- Reduce la ansiedad de no saber si el conductor está en camino o ya llegó
- Mejora la percepción de confiabilidad de la app

**Tu plan:**
1. Crear los triggers en el backend para los 4 eventos: viaje aceptado, conductor llegó, viaje iniciado, viaje completado
2. Integrar el servicio de push notifications (FCM / APNs)
3. Guardar y gestionar los tokens de dispositivo por usuario
4. Definir el contenido de cada notificación (título, cuerpo, datos)
5. Implementar el manejo en el frontend con app en segundo plano y cerrada
6. Probar cada evento en ambas plataformas

**Mi recomendación:**
Agregaría una notificación cuando el conductor lleva más de X minutos sin aparecer tras aceptar — le da al usuario la oportunidad de cancelar sin adivinar. El resto está bien tal como está.

Plan ajustado: igual al tuyo con un paso adicional — un job que detecte inactividad del conductor y dispare la alerta al usuario.