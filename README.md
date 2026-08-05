# Texto a Voz

Aplicación en español para convertir texto y guiones de vídeo en locuciones, usando las voces de Gemini TTS. Está pensada para trabajar primero en el ordenador, conservar los proyectos localmente y exportar el resultado a WAV, MP3, SRT o VTT.

## Qué incluye

- Generación con cinco voces y varios estilos expresivos.
- Preferencia de acento castellano de España.
- Diálogos con dos voces.
- Duración objetivo con ajuste de tiempo que conserva el tono.
- Estudio de guiones con capítulos y marcas de tiempo.
- Importación de TXT, Markdown, SRT, VTT y DOCX.
- Exportación de audio WAV y MP3 y subtítulos SRT/VTT.
- Proyectos guardados automáticamente en el navegador, incluidos los audios.
- Copias completas de proyecto en archivos `.tav.json`.
- Aplicación web instalable (PWA) y acceso privado opcional mediante contraseña.

## Recomendación de uso

La opción con menor coste es esta arquitectura híbrida:

1. Usarla como aplicación web local en el ordenador.
2. Instalarla como si fuera una aplicación desde el navegador.
3. Añadir más adelante un acceso web privado solo cuando haga falta usarla desde otros equipos.

Así se evita mantener dos aplicaciones distintas. La interfaz y los proyectos funcionan en el navegador; el pequeño servidor protege la clave de Gemini. El único coste variable es el consumo de la API de voz cuando se supera cualquier cuota gratuita disponible.

### Coste orientativo

A 5 de agosto de 2026, Google indica nivel gratuito para `gemini-3.1-flash-tts-preview`. En el nivel de pago, la salida cuesta 20 USD por millón de tokens de audio y Google calcula 25 tokens por segundo: aproximadamente **0,03 USD por minuto generado**, más una cantidad pequeña por el texto de entrada. Las tarifas y los límites de los modelos Preview pueden cambiar; comprueba siempre la [tarifa oficial de Gemini](https://ai.google.dev/gemini-api/docs/pricing) antes de activar facturación.

## Puesta en marcha local

Necesitas Node.js 20 o posterior y una clave de Google Gemini API.

```powershell
cd "C:\Users\oanti\Documents\Texto a Voz"
Copy-Item .env.example .env
```

Edita `.env` e introduce tu clave:

```dotenv
GEMINI_API_KEY="tu_clave"
```

Después:

```powershell
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Uso diario

- Pon nombre al proyecto; se guarda automáticamente.
- Usa **Copia** para descargar una copia completa del proyecto.
- Usa **Importar** para recuperar esa copia en este u otro navegador.
- Los datos locales dependen del perfil del navegador. Antes de limpiar sus datos, crea una copia.
- Para un guion de vídeo, usa marcas `[MM:SS]` por frase y rangos `MM:SS–MM:SS · TÍTULO` para los capítulos.

## Versión de producción

```powershell
npm run build
npm start
```

Para proteger un acceso web privado, configura además:

```dotenv
APP_ACCESS_PASSWORD="una_contraseña_larga_y_unica"
TRUST_PROXY=true
```

En producción se debe usar HTTPS. `ALLOW_INSECURE_HTTP=true` está reservado para pruebas controladas en una red local.

## Controles de calidad

```powershell
npm run lint
npm test
npm run build
```

La integración continua de GitHub ejecuta estos tres controles en cada cambio propuesto.

## Privacidad y seguridad

- La clave de Gemini solo vive en el servidor y nunca se envía al navegador.
- Los proyectos se guardan en el navegador local, no en una base de datos externa.
- Al generar una locución, el texto necesario se envía a la API de Gemini.
- No publiques el archivo `.env` ni una copia que contenga información sensible.

Consulta [SECURITY.md](SECURITY.md) para las medidas y limitaciones de despliegue.

## Estructura principal

- `src/`: interfaz, audio, guiones y almacenamiento local.
- `server.ts`: servidor, protección de la clave y conexión con Gemini.
- `public/`: PWA, iconos y funcionamiento instalable.
- `.github/workflows/ci.yml`: controles automáticos.
