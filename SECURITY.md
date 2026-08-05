# Seguridad

## Configuración segura

- Guarda `GEMINI_API_KEY` únicamente en variables de entorno.
- Usa HTTPS si la aplicación sale del ordenador o de una red local de confianza.
- Configura `APP_ACCESS_PASSWORD` con una contraseña larga y única para cualquier acceso remoto.
- Mantén `ALLOW_INSECURE_HTTP=false` en Internet.
- Activa `TRUST_PROXY=true` solamente detrás de un proxy HTTPS conocido.
- No publiques copias `.tav.json` con guiones o audios privados.

El servidor limita peticiones de voz y los intentos de contraseña. Las sesiones privadas se almacenan en memoria y se cierran al reiniciar el servidor. Este sistema es apropiado para uso personal o de un grupo reducido; no sustituye una plataforma completa de identidad para un servicio público.

## Dependencias

Ejecuta periódicamente:

```powershell
npm audit
npm outdated
```

Revisa las actualizaciones antes de aplicarlas y vuelve a ejecutar las pruebas.

## Comunicación de problemas

No publiques claves, contraseñas, textos privados ni audios en una incidencia pública. Describe el problema sin datos sensibles y revoca de inmediato cualquier clave expuesta.
