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
- Vídeo MP4 de un presentador hablando con lip-sync sobre la locución (solo en local, con GPU NVIDIA).

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

## Vídeo con presentador (solo en local)

Junto a las descargas WAV/MP3 aparece el panel **Vídeo con presentador**. Anima una imagen fija de un busto para que hable con sincronía labial sobre la locución recién generada y entrega un MP4 H.264 a 30 fps con color BT.709 y audio AAC a 48 kHz, listo para subir a YouTube. Formatos:

- **YouTube 16:9** (1920×1080, por defecto): si la foto no es 16:9, se encuadra sola en la mayor ventana 16:9 centrada en la cara y sin cortar el pelo.
- **Vertical 9:16** (1080×1920) para Shorts o Reels.
- **Como la imagen**: respeta la proporción de la foto (lado mayor hasta 1920 px).

Para un plano medio (cabeza y pecho) en YouTube, usa una foto 16:9 de al menos 1920×1080. Una foto casi cuadrada da un primer plano de la cabeza hasta el cuello de la camisa.

Funciona con un segundo servidor, en Python, que usa la GPU del PC:

- [Ditto](https://github.com/antgroup/ditto-talkinghead) (Ant Group, Apache 2.0, código y pesos) convierte el audio en movimiento de boca y cabeza con un modelo de difusión condicionado por HuBERT, y [LivePortrait](https://github.com/KwaiVGI/LivePortrait) (MIT) renderiza la cara a plena resolución. Los labios salen nítidos, con dientes y con parpadeos naturales.
- La detección facial usa MediaPipe (Apache 2.0). No se descargan los modelos de InsightFace que Ditto trae de serie, porque son solo para uso no comercial. Así, toda la cadena es gratuita y admite uso comercial.
- Alternativa (`AVATAR_MOTION_ENGINE=joyvasa`): [JoyVASA](https://github.com/jdh-algo/JoyVASA) para cabeza y ojos con [MuseTalk 1.5](https://github.com/TMElyralab/MuseTalk) regenerando la boca (ambos MIT, pesos aptos para uso comercial). Se conserva por si hiciera falta, pero MuseTalk genera la boca a 256 px, más blanda y con algo de vibración.
- Cloud Run no tiene GPU. Allí la función se desactiva automáticamente (detecta `K_SERVICE`) y el resto de la app sigue igual.

### Instalación (una vez)

Requisitos: Windows, GPU NVIDIA con driver reciente (probado con RTX 5070 Ti), Python 3.10 (`py -3.10`) y Git. Descarga unos 11 GB.

```powershell
npm run avatar:setup
```

El script crea `avatar-service\.venv`, instala PyTorch con CUDA 12.8 (necesario para las RTX 50xx), clona Ditto, JoyVASA y MuseTalk en versiones fijas, descarga solo los pesos con licencia apta para uso comercial e instala ffmpeg si falta. Se puede repetir sin problema.

Después coloca la imagen del presentador en `avatar-service\presenter\` (PNG/JPG/WEBP). Consulta [avatar-service/presenter/README.md](avatar-service/presenter/README.md) para ver cómo prepararla. Desde la app también se puede elegir otra imagen para la sesión con **Cambiar imagen**.

### Arranque en desarrollo (dos terminales)

```powershell
# Terminal 1: servicio de vídeo (tarda ~30 s en cargar los modelos y calentar la GPU)
npm run avatar
```

```powershell
# Terminal 2: la app de siempre
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Si el servicio de vídeo no está arrancado, el panel lo indica y se activa solo cuando el servicio queda listo. La app funciona igual sin él.

### Cómo funciona

```
Navegador ──WAV──▶ Express /api/avatar ──▶ FastAPI 127.0.0.1:8765 (cola, 1 GPU)
          ◀──MP4──                     ◀── Ditto (audio → movimiento) + LivePortrait + ffmpeg
```

- `POST /api/avatar` reenvía el WAV (y la imagen, si se ha cambiado) al servicio y devuelve un identificador de trabajo.
- `GET /api/avatar/:id` informa del progreso, `GET /api/avatar/:id/video` descarga el MP4 y `DELETE /api/avatar/:id` cancela el trabajo.
- `GET /api/avatar/status` indica si la función está disponible y por qué no lo está.
- Los trabajos se procesan de uno en uno y los MP4 se borran a las 24 horas (`avatar-service\jobs\`).

Rendimiento medido con una RTX 5070 Ti a 1080p: 15,6 s de audio se generan en unos 31 s, unas 2 veces la duración del audio. Por extrapolación, una locución de 3 minutos tardaría unos 6 minutos. El servicio ocupa unos 7 GB de VRAM.

Prueba por línea de comandos, sin servidores:

```powershell
cd avatar-service
.venv\Scripts\python.exe cli.py --image presenter\mi-busto.png --audio locucion.wav --out prueba.mp4
```

Variables opcionales (en `.env`, las lee tanto Node como el servicio Python):

| Variable | Por defecto | Uso |
|---|---|---|
| `AVATAR_SERVICE_URL` | `http://127.0.0.1:8765` | Dirección del servicio de vídeo |
| `AVATAR_SERVICE_TOKEN` | vacío | Secreto compartido entre Node y Python |
| `AVATAR_ENABLED` | `true` | `false` oculta la función también en local |
| `AVATAR_MAX_AUDIO_SEC` | `1200` | Duración máxima del audio (servicio Python) |
| `AVATAR_MOTION_ENGINE` | `ditto` | Motor de movimiento: `ditto` o `joyvasa` (JoyVASA + MuseTalk) |
| `AVATAR_POSE_SMOOTHING` | `6` | Suavizado temporal de la pose que genera Ditto (sigma en fotogramas a 25 fps; 0 = sin filtro) |
| `AVATAR_LIP_SMOOTHING` | `1.2` | Suavizado ligero de los labios de Ditto (simétrico, no retrasa la boca; 0 = sin filtro) |
| `AVATAR_AUDIO_LEAD_MS` | `120` | Adelanto del movimiento de Ditto respecto a la voz, en ms (súbelo si la boca va tarde; bájalo si se adelanta) |
| `AVATAR_EXPRESSION_SCALE` | `0.6` | Solo motor `joyvasa`: intensidad de ojos y cejas (1 = JoyVASA original) |
| `AVATAR_DETAIL_SIGMA` | `0.03` | Solo motor `joyvasa`: textura (barba, piel) recuperada del original en la zona regenerada por MuseTalk |
| `AVATAR_UPPER_LIP_LIFT` | `0.6` | Solo motor `joyvasa`: cuánto sube el labio superior al abrirse la boca (0 = desactivado) |
| `AVATAR_MOUTH_SHARPEN` | `1.2` | Solo motor `joyvasa`: enfoque de la boca generada por MuseTalk (0 = sin enfoque) |
| `AVATAR_MOUTH_SMOOTHING` | `0.5` | Solo motor `joyvasa`: media móvil de la boca de MuseTalk (0 = sin suavizar); el audio se adelanta para compensar el retraso |
| `AVATAR_BOX_SMOOTHING` | `0.2` | Solo motor `joyvasa`: suavizado del recuadro de la cara que se envía a MuseTalk (1 = sin suavizar) |

Estabilizaciones que conviene conocer:

- Ditto genera la pose (giros y desplazamiento de la cabeza) con algo de ruido de un fotograma a otro. El motor la suaviza en el tiempo; medido en píxeles sobre la zona de la frente y las gafas, el temblor baja de 0,17 a 0,07 px de media. La boca y los parpadeos no pasan por ese filtro; los labios llevan uno mucho más ligero contra la vibración de las comisuras.
- La boca de Ditto llega unos 100–130 ms tarde respecto a la voz (medido comparando la apertura de la boca con la de MuseTalk, que se entrena con una pérdida de sincronía). El motor adelanta el movimiento 120 ms al remuestrear, con precisión de subfotograma; con eso el desfase medido queda en 0 ms.
- Con el motor `joyvasa`, la expresión de JoyVASA se suaviza (temblor de 0,49 a 0,05 px) y la boca de MuseTalk se estabiliza con una media móvil en el espacio latente, adelantando el audio un fotograma para compensar el retraso.
| `AVATAR_DEFAULT_IMAGE` | primera imagen de `presenter\` | Ruta alternativa de la imagen |

**Uso responsable:** usa solo imágenes de personas que hayan dado su consentimiento. Si el vídeo se publica, indica que ha sido generado con IA; el Reglamento Europeo de IA lo exige para contenido sintético de personas.

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
- `server.ts`: servidor, protección de la clave, conexión con Gemini y puente `/api/avatar`.
- `avatar-service/`: servicio Python local de vídeo con presentador (`service.py`, `avatar_engine.py`, `setup.ps1`).
- `public/`: PWA, iconos y funcionamiento instalable.
- `.github/workflows/ci.yml`: controles automáticos.
