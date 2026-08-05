# Plan de evolución

## Estado actual: versión local estable

La aplicación ya cubre el flujo completo para uso personal: redactar o importar, elegir voz, generar, ajustar la duración, guardar el proyecto y exportar audio o subtítulos.

## Siguiente etapa recomendada: acceso web privado

Mantener la misma aplicación y desplegarla detrás de HTTPS con contraseña. Es la solución de menor coste y evita duplicar trabajo. Antes de abrirla a más usuarios conviene añadir almacenamiento de cuentas, recuperación de proyectos en servidor y control de gasto por usuario.

## Mejoras futuras por prioridad

1. **Uso y coste:** contador estimado de consumo antes de generar y presupuesto mensual configurable.
2. **Edición:** forma de onda, cortes visuales, silencios y fundidos por clip.
3. **Vídeo:** previsualización de vídeo con audio y subtítulos en la misma línea de tiempo.
4. **Colaboración:** proyectos cifrados en la nube y versiones recuperables.
5. **Distribución:** empaquetado de escritorio solo si aparece una necesidad real de acceso sin navegador.

La aplicación de escritorio nativa no es prioritaria: elevaría el mantenimiento sin reducir el coste de la API de voz.
