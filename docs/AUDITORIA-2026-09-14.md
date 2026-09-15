# Auditoría · Texto a Voz AI

**Fecha:** 14-09-2026 · **Commit auditado:** `5b1b619` (árbol limpio)
**Alcance:** `server.ts`, `src/**`, configuración de build, CI, PWA y seguridad.

## Verificación ejecutada

| Comprobación | Resultado |
|---|---|
| `npm run lint` (tsc --noEmit) | ✅ sin errores |
| `npm test` (vitest) | ✅ 34/34 en 4 ficheros |
| `npm audit --audit-level=high` | ❌ salida 1 — 6 vulnerabilidades (1 alta, 5 moderadas) |
| `git status` | ✅ limpio |

---

## 0. El «Cuota temporal de voz» que estás viendo — causa encontrada

**No es un límite de la API gratuita ni un problema de ritmo de peticiones.** El proyecto de Google asociado a la clave que usa el servidor ha superado su tope de gasto mensual:

```
429 RESOURCE_EXHAUSTED
"Your project has exceeded its monthly spending cap.
 Please go to AI Studio at https://ai.studio/spend to manage your project spend cap."
```

Y la clave que usa el servidor **no es la de tu `.env`**. Hay dos claves en el equipo:

| Origen | Clave | Estado |
|---|---|---|
| Variable de entorno de usuario de Windows | `AIzaSy…xwbg` (39 car.) | ❌ tope de gasto superado → 429 permanente |
| Fichero `.env` del proyecto | `AQ.Ab8…1B9A` (53 car.) | ✅ funciona |

`dotenv.config()` **no sobrescribe** variables que ya existen en `process.env`. Como lanzas `npm run dev` desde una sesión que hereda la variable de usuario, el servidor usaba la clave agotada e ignoraba la del `.env`.

**Comprobaciones hechas:**

- Llamada directa al modelo con la clave del `.env`: 26 peticiones, todas con audio, ~2-3 s cada una.
- Llamada directa con la clave heredada del entorno: 429 con el mensaje del tope de gasto.
- Peticiones a tu servidor en `localhost:3000`: 429 tras 24,6 s (los 3 reintentos internos) y cabecera `X-RateLimit-Remaining: 27` → el limitador local de la app **no** era el culpable.

Encima, la app traducía cualquier 429 a «Límite de la API gratuita alcanzado» y entraba en el bucle sin fin descrito en 1.4, ocultando el mensaje real de Google.

### Lo que he corregido (verificado: `tsc` limpio, 34/34 pruebas, solo 2 ficheros tocados)

1. **`server.ts`** — la clave del `.env` ahora manda sobre la heredada del entorno, y **solo** la clave: `PORT` y el resto conservan la precedencia normal, así que el despliegue en Cloud Run no cambia.
2. **`server.ts`** — un 429 que sea de tope de gasto, facturación o límite diario se devuelve con el mensaje real de Google y la marca `isQuotaFatal`.
3. **`VideoScriptStudio.tsx`** — los dos lotes abortan de inmediato ante un `isQuotaFatal` y, en cualquier caso, se detienen tras 40 esperas por cuota en lugar de reintentar para siempre.

**Tienes que reiniciar `npm run dev`** para que el servidor cargue la clave correcta. Alternativa (o complemento): sube el tope en https://ai.studio/spend, o borra la variable de usuario `GEMINI_API_KEY` de Windows si ya no la necesitas para otra herramienta.

---

## 1. Bloqueantes

### 1.1 El CI está en rojo hoy
`npm audit --audit-level=high` devuelve código 1: `qs` (DoS, alta) arrastrado por `body-parser` → `express@4.22.2`. El job *Calidad* falla en cada push a `main`.
**Arreglo:** `npm audit fix`, volver a ejecutar `npm test` y `npm run build`.

### 1.2 Editar el guion borra todos los audios ya generados
`VideoScriptStudio.tsx` reparsea con un debounce de 500 ms y sustituye `parsedScript` entero:

```ts
useEffect(() => {
  const timer = setTimeout(() => setParsedScript(parseVideoScript(scriptText)), 500);
  ...
}, [scriptText]);
```

Los objetos nuevos no llevan `audioUrl`. Un solo carácter tecleado en el editor destruye una tanda completa de bloques ya sintetizados — y la cuota de API gastada en ellos.
**Arreglo:** fusionar por `id`, conservando `audioUrl`/`actualDurationSec` de los bloques cuyo texto e intervalo no han cambiado.

### 1.3 Cambiar de pestaña destruye la sesión de trabajo
`App.tsx` renderiza `<VideoScriptStudio>` solo en modo `script`. Pulsar «Generador Estándar» desmonta el componente: se pierden los audios por bloque, el máster y el CSV de tiempos. El proyecto guardado solo conserva `scriptText`.
**Arreglo:** elevar el estado del estudio a `App` (o mantener ambos montados y alternar con CSS).

### 1.4 Bucle infinito cuando se agota la cuota — *corregido hoy (ver apartado 0)*
En los dos modos por lotes, ante un 429:

```ts
attempts -= 1;   // justo después de attempts++ → el contador nunca avanza
```

Si la cuota diaria está agotada, la app espera 15 s y reintenta indefinidamente. No hay `AbortController` ni botón de cancelar: la única salida es recargar y perder lo generado (ver 1.3).
**Arreglo:** contador propio de esperas por cuota con tope (p. ej. 40 reintentos o 20 min) + botón «Detener» con `AbortController`.

### 1.5 Fuga de memoria en el estudio
No hay ni un `URL.revokeObjectURL` para audios de bloque, de capítulo ni del máster (solo para descargas). Cada regeneración de un guion de 3 min deja retenidos ~17 MB del máster a 48 kHz más ~1 MB por bloque. Tras varias pasadas la pestaña se degrada o cae.
**Arreglo:** revocar la URL anterior en cada sustitución de `audioUrl` / `masterAudioUrl`.

---

## 2. Rendimiento

### 2.1 El autoguardado reescribe todos los audios en cada pausa al teclear
`App.tsx` guarda el proyecto completo 700 ms después de cualquier cambio, y `toStoredProject` incluye **todos** los blobs del historial. Con 5–6 másters guardados son decenas de MB reescritos en IndexedDB cada vez que se hace una pausa escribiendo el guion.
**Arreglo:** separar los audios en su propio object store por id y guardar solo metadatos cuando cambie texto o ajustes.

---

## 3. Corrección funcional

### 3.1 El parser automático se come frases
En `parseVideoScript`, modo sin marcas de tiempo:

```ts
if (trimmedP.length < 50 && (trimmedP.toUpperCase() === trimmedP || trimmedP.includes(':') || trimmedP.includes('·')))
```

Cualquier frase corta con dos puntos se convierte en título de capítulo y **no se locuta**. «Y aquí está la clave: el interés compuesto.» desaparece del audio sin aviso.
**Arreglo:** exigir que el candidato a título no acabe en `.`/`!`/`?` y no contenga verbo conjugado evidente, o restringir los títulos a un formato explícito.

### 3.2 `crypto.randomUUID()` rompe la app en HTTP plano
Solo existe en contexto seguro. Con `ALLOW_INSECURE_HTTP=true` sobre HTTP en la LAN (escenario que el propio `.env.example` contempla), `createBlankProject()` lanza y la aplicación no arranca.
**Arreglo:** *fallback* a un generador propio con `crypto.getRandomValues` o `Math.random`.

### 3.3 Descargas que pueden abortarse
`downloadSubtitles` y `handleExportProject` revocan la URL inmediatamente tras `click()`; el resto del código usa `setTimeout(..., 1000)`. En Firefox y Safari la descarga puede cancelarse.
**Arreglo:** unificar con el patrón de retardo.

### 3.4 El máster exacto sobrescribe en vez de mezclar
`combineScriptAudioSegments` escribe muestras con `setInt16` sobre el búfer: si un bloque se sale de su hueco, el siguiente le corta la cola en seco, sin fundido. Poco frecuente en modo exacto (cada bloque se ajusta a su intervalo), pero audible cuando ocurre.

### 3.5 Mutación directa del estado de React
`generateChapterAudio` y `generateSingleLine` hacen `{...prev}` (copia superficial) y después mutan capítulos y líneas dentro. Funciona hoy, pero en React 19 + StrictMode es fuente típica de renders obsoletos.
**Arreglo:** usar el mismo patrón inmutable de `updateLineState`.

---

## 4. Seguridad

Nivel correcto para uso privado. Lo que está bien hecho: la clave de Gemini nunca sale del servidor; `.env` ignorado y **no** trackeado en git (verificado); cookie `HttpOnly` + `SameSite=Strict` + `Secure` en producción; comparación de contraseña en tiempo constante; límite de intentos de login; validación estricta de voz, emoción, acento y duración; cuerpo limitado a 256 kB y texto a 24 000 caracteres.

Pendiente:

- **Mapas en memoria sin purga.** `authenticatedSessions`, `ttsRateLimits` y `loginRateLimits` crecen sin límite; las sesiones caducadas solo se borran si alguien las vuelve a usar. Irrelevante en local, conviene arreglarlo antes de exponer la app.
- **No hay botón de cerrar sesión** en la interfaz, aunque `/api/auth/logout` existe y funciona.
- **Sin cabeceras de seguridad** (CSP, `X-Content-Type-Options`, `Referrer-Policy`). Si se publica en web, añadir `helmet`.
- `/api/health` revela los nombres de modelo sin autenticar. Trivial, pero innecesario.

---

## 5. Limpieza y mantenimiento

- **`motion` (12.23) está en `dependencies` y no se importa en ningún sitio.** Peso muerto en el bundle y en la superficie de auditoría.
- **`autoprefixer`** no hace falta con Tailwind v4; **`vite`** está duplicado en `dependencies` y `devDependencies`.
- **`animate-fade-in` se usa 9 veces y no está definida en ninguna parte** (`index.css` solo importa Tailwind; v4 no trae esa utilidad). Las animaciones de entrada sencillamente no ocurren.
- **Cobertura de pruebas:** 34 pruebas sólidas sobre audio, *chunking* y parser con timecode. Sin pruebas de `server.ts` (auth, rate-limit, validación) ni del modo automático de `parseVideoScript` — justo donde están 3.1 y 1.4.
- **Node:** `package.json` pide `>=20`, el CI usa 20 y tu equipo corre 24.15. Coherente, pero convendría igualar el CI a la versión con la que realmente trabajas.

---

## 6. Lo que está bien

El pipeline de audio es serio y poco habitual en una app de este tamaño: WSOLA con búsqueda de correlación para estirar sin cambiar el tono, remuestreo Lanczos a 48 kHz, techo de picos, recorte de silencio técnico por energía y colocación centrada de bloques con préstamo de silencio del vecino. La gestión de 429/503 con backoff y lectura del `retryDelay` de Google está bien pensada. Tipado estricto limpio y separación cliente/servidor correcta.

---

## 7. Orden sugerido

1. `npm audit fix` → CI en verde.
2. Conservar audios al reparsear y al cambiar de pestaña (1.2 + 1.3). Es lo que más tiempo y cuota te cuesta hoy.
3. Tope y botón de cancelar en los bucles de cuota (1.4).
4. Revocar blob URLs (1.5).
5. Autoguardado incremental (2.1).
6. Parser automático (3.1) y `randomUUID` (3.2).
7. Limpieza de dependencias y `animate-fade-in`.
