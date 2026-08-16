# Texto a Voz

Aplicación en español para convertir texto y guiones de vídeo en locuciones, usando las voces de Gemini TTS. Está pensada para trabajar primero en el ordenador, conservar los proyectos localmente y exportar el resultado a WAV, MP3, SRT o VTT.

## Qué incluye

- Generación con cinco voces y varios estilos expresivos.
- Preferencia de acento castellano de España.
- Diálogos con dos voces.
- Lectura natural continua como flujo recomendado para vídeo.
- Ajuste a una duración objetivo disponible como modo alternativo.
- Estudio de guiones con capítulos y marcas de tiempo.
- Formato de producción Markdown `HH:MM:SS:FF` con sincronización exacta a 30 fps.
- Importación de TXT, Markdown, SRT, VTT y DOCX.
- Exportación de producción WAV a 48 kHz, MP3 y subtítulos SRT/VTT.
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
- Para producción a 30 fps, el formato recomendado y prioritario es:

```markdown
**Duración de diseño:** `00:00:19:00`
**Frecuencia:** 30 fps constantes

## P01 · `00:00:00:00–00:00:07:00` · 7 segundos

Primera frase que debe ocupar exactamente este intervalo.

## P02 · `00:00:07:00–00:00:19:00` · 12 segundos

Segunda frase.

## Pronunciación

- `TAE`: leer **te-a-e**.
```

La aplicación solo convierte en voz los bloques temporizados. Los avisos escritos y demás apéndices quedan fuera. Las reglas de pronunciación se aplican al audio sin cambiar el texto visible ni los subtítulos.

Para el máster final, usa **Natural por bloques · Flash**. Cada bloque se interpreta a velocidad natural con la misma voz, sin estirado temporal. La aplicación recorta únicamente el silencio sobrante de los extremos, iguala el nivel con suavidad y exporta la temporización real a 30 fps. Con **Encajar cada bloque con pausas** activado, cada frase se centra dentro de su intervalo visual y el tiempo restante se convierte en silencio natural antes y después; la voz nunca se ralentiza ni se deforma. Si una frase no cabe, la aplicación indica el bloque que hay que ampliar. **Ajustar voz a intervalos** se conserva como alternativa para piezas que necesiten modificar la cadencia y debe revisarse auditivamente. La petición continua de larga duración queda como modo experimental.

Gemini entrega actualmente PCM nativo a 24 kHz. La aplicación realiza una única conversión de alta calidad y descarga el WAV de producción a 48 kHz, mono y 16 bits, con margen de pico para la mezcla.

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

## Despliegue web actual

La aplicación está desplegada como servicio privado en Google Cloud Run:

- URL: [https://texto-a-voz-2qdvewjg7a-ew.a.run.app](https://texto-a-voz-2qdvewjg7a-ew.a.run.app)
- Región: `europe-west1`
- Servicio: `texto-a-voz`
- Escalado mínimo: cero instancias cuando no se utiliza.
- Escalado máximo: una instancia para limitar el consumo.
- Clave de Gemini y contraseña: almacenadas en Google Secret Manager.

La contraseña de acceso generada se conserva también como variable de usuario de Windows. Para consultarla localmente:

```powershell
[Environment]::GetEnvironmentVariable('TEXTO_A_VOZ_ACCESS_PASSWORD', 'User')
```

Los proyectos permanecen en el navegador de cada dispositivo. Para trasladarlos entre navegadores se utiliza **Copia** e **Importar**.

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
