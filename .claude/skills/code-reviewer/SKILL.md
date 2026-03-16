---
name: code-reviewer
description: >
  Revisión y retroalimentación automática después de completar cualquier tarea de programación,
  modificación de código, o cambio técnico. SIEMPRE usa esta skill al finalizar una tarea cuando
  el usuario diga frases como "hazlo", "implementa", "crea", "modifica", "arregla", "actualiza",
  "agrega", "quiero que hagas", o cualquier instrucción que implique producir o cambiar algo.
  Esta skill se ejecuta como cierre DESPUÉS de completar la tarea solicitada.
---

# Code Reviewer — Cierre de Tarea con Retroalimentación

## Propósito

Al terminar cualquier tarea, cerrar la respuesta en lenguaje natural y conversacional con:
1. Confirmación de qué se hizo
2. Revisión de si algo podría fallar o mejorar
3. Recomendación — solo si genuinamente existe una forma mejor de hacerlo

## Cuándo ejecutar

Siempre al final de una respuesta que haya producido o modificado:
- Código en cualquier lenguaje
- Archivos de configuración
- Queries, scripts, funciones, clases, componentes
- Cualquier entregable técnico o de contenido

## Formato de salida

Escribe en prosa clara, como si le hablaras directamente a la persona. Sin bloques técnicos separados, sin tablas, sin íconos.

**Tarea realizada:** Una o dos oraciones explicando qué se hizo exactamente.

**Revisión:** Si algo podría generar un problema o hubo una decisión importante al implementarlo. Si todo está limpio, dilo en una línea.

**Podría ser mejor:** *(Solo incluir si realmente existe una alternativa superior)* Explica cómo y por qué sería mejor. Si la implementación es correcta y no hay una mejora significativa que ofrecer, omite esta sección completamente — no inventes recomendaciones para llenar espacio.

## Tono y estilo

- Habla en primera persona: "Realicé...", "Lo que hice fue...", "Una forma más sólida sería..."
- Sin tecnicismos innecesarios, a menos que el usuario claramente sea técnico
- Directo, sin rodeos, sin frases de relleno
- Honesto: si está bien hecho, dilo. Si hay algo que mejorar, dilo con razones concretas

## Ejemplo con recomendación

**Tarea realizada:** Creé la función que filtra los usuarios activos de una lista y devuelve solo los que tienen más de 30 días registrados.

**Revisión:** La lógica funciona para el caso descrito. Si la lista llega vacía devuelve un array vacío sin error, lo cual es un comportamiento válido.

**Podría ser mejor:** Pasar los "30 días" como parámetro en lugar de tenerlo fijo dentro de la función. Así la misma función sirve para cualquier criterio de antigüedad sin tocar el código cada vez — más reutilizable y más fácil de testear.

## Ejemplo sin recomendación

**Tarea realizada:** Agregué validación de campos vacíos al formulario de login.

**Revisión:** Todo correcto. Los casos de campo vacío, espacios en blanco y valor nulo están cubiertos.