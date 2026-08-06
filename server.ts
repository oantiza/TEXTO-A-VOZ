import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { splitTextForStableTts } from './src/utils/ttsChunking';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const MAX_TEXT_LENGTH = 24_000;
const LONG_FORM_TTS_THRESHOLD_CHARS = 1_000;
const LONG_FORM_TTS_CHUNK_CHARS = 6_000;
const FAST_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const LONG_FORM_TTS_MODEL = 'gemini-2.5-pro-preview-tts';
const RATE_LIMIT_PER_MINUTE = Math.max(1, Number(process.env.TTS_RATE_LIMIT_PER_MINUTE) || 30);
const ALLOWED_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;
const ALLOWED_EMOTIONS = [
  'natural',
  'cheerful',
  'calm',
  'dramatic',
  'news anchor',
  'storyteller',
  'whispering',
  'fast',
  'slow',
] as const;
const ALLOWED_ACCENTS = ['spain', 'latam', 'argentina', 'neutral'] as const;
const ACCESS_PASSWORD = process.env.APP_ACCESS_PASSWORD?.trim() || '';
const SESSION_COOKIE = 'texto_a_voz_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ttsRateLimits = new Map<string, RateLimitEntry>();
const loginRateLimits = new Map<string, RateLimitEntry>();
const authenticatedSessions = new Map<string, number>();

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((cookie) => {
      const separator = cookie.indexOf('=');
      return separator < 0
        ? [cookie.trim(), '']
        : [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1))];
    })
  );
}

function isAuthenticated(cookieHeader: string | undefined): boolean {
  if (!ACCESS_PASSWORD) return true;
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return false;
  const expiresAt = authenticatedSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    authenticatedSessions.delete(token);
    return false;
  }
  return true;
}

function passwordMatches(candidate: string): boolean {
  const expected = Buffer.from(ACCESS_PASSWORD);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function extractAudioPart(response: any) {
  return response?.candidates
    ?.flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .find((part: any) => part?.inlineData?.data && String(part?.inlineData?.mimeType || '').startsWith('audio/'));
}

function getPcmSampleRate(mimeType: string): number {
  const match = mimeType.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : 24_000;
}

function isRawPcmMimeType(mimeType: string): boolean {
  return /audio\/(?:pcm|l16)/i.test(mimeType) || /codec=pcm/i.test(mimeType);
}

function fadePcm16Edges(source: Buffer, sampleRate: number, fadeMilliseconds = 8): Buffer {
  const output = Buffer.from(source);
  const sampleCount = Math.floor(output.length / 2);
  const fadeSamples = Math.min(sampleCount, Math.max(1, Math.round((sampleRate * fadeMilliseconds) / 1000)));

  for (let index = 0; index < fadeSamples; index++) {
    const gainIn = index / fadeSamples;
    const gainOut = (fadeSamples - index - 1) / fadeSamples;
    const endIndex = sampleCount - fadeSamples + index;
    output.writeInt16LE(Math.round(output.readInt16LE(index * 2) * gainIn), index * 2);
    output.writeInt16LE(Math.round(output.readInt16LE(endIndex * 2) * gainOut), endIndex * 2);
  }
  return output;
}

function combinePcmNarration(parts: Buffer[], mimeType: string): Buffer {
  if (parts.length === 1) return parts[0];
  if (!isRawPcmMimeType(mimeType)) {
    throw new Error(`No se pueden unir fragmentos con el formato ${mimeType}.`);
  }

  const sampleRate = getPcmSampleRate(mimeType);
  const silence = Buffer.alloc(Math.round(sampleRate * 0.08) * 2);
  const output: Buffer[] = [];
  parts.forEach((part, index) => {
    if (index > 0) output.push(silence);
    output.push(fadePcm16Edges(part, sampleRate));
  });
  return Buffer.concat(output);
}

// Helper to construct prompt with tone, regional accent & target duration instructions
function buildPromptText(
  text: string,
  emotion?: string,
  accent?: string,
  targetDuration?: number | null,
  continuingNarration = false
): string {
  const instructions: string[] = [];

  if (continuingNarration) {
    instructions.push('Keep exactly the same configured voice identity, pitch range, accent, and delivery as every other segment of this continuous narration');
  }

  if (accent === 'spain') {
    instructions.push('Say in a standard Peninsular Spanish accent from Spain (Castellano de España with clear distinción between z/c and s)');
  } else if (accent === 'latam') {
    instructions.push('Say in a neutral Latin American Spanish accent');
  } else if (accent === 'argentina') {
    instructions.push('Say in an Argentine Rioplatense Spanish accent');
  } else if (accent === 'neutral') {
    instructions.push('Say in a clear, natural Spanish tone');
  }

  if (emotion && emotion !== 'natural') {
    instructions.push(`with a ${emotion} tone`);
  }

  if (targetDuration && targetDuration > 0) {
    instructions.push(`Pace the speaking speed so the utterance takes approximately ${targetDuration} seconds`);
  }

  if (instructions.length > 0) {
    return `Synthesize speech using these director notes: ${instructions.join(', ')}.\n\nTRANSCRIPT (speak only this text):\n${text}`;
  }
  return `Synthesize the following transcript as speech.\n\nTRANSCRIPT (speak only this text):\n${text}`;
}

// Helper for calling Gemini with exponential backoff retries for 503 / high demand / 429 rate limit errors
async function generateTTSWithRetry(aiClient: GoogleGenAI, genConfig: any, maxRetries = 3) {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await aiClient.models.generateContent(genConfig);
      if (!extractAudioPart(response)) {
        const missingAudioError: any = new Error('El modelo no devolvió audio en este intento.');
        missingAudioError.isMissingAudio = true;
        throw missingAudioError;
      }
      return response;
    } catch (err: any) {
      lastError = err;
      const errStr = String(err?.message || err);
      const isQuota =
        err?.status === 429 ||
        err?.code === 429 ||
        errStr.includes("429") ||
        errStr.includes("RESOURCE_EXHAUSTED") ||
        errStr.includes("Quota exceeded");

      const isTransient =
        isQuota ||
        err?.isMissingAudio === true ||
        err?.status === 503 ||
        err?.code === 503 ||
        errStr.includes("503") ||
        errStr.includes("UNAVAILABLE") ||
        errStr.includes("high demand") ||
        errStr.includes("overloaded");

      if (isTransient && attempt < maxRetries) {
        let delayMs = attempt * 2000;
        if (isQuota) {
          const matchDelay = errStr.match(/retry in ([\d\.]+)s/i);
          if (matchDelay && matchDelay[1]) {
            delayMs = Math.max(5000, (Math.ceil(parseFloat(matchDelay[1])) + 2) * 1000);
          } else {
            delayMs = attempt * 8000;
          }
        }
        const reason = isQuota ? 'Cuota 429' : err?.isMissingAudio ? 'Respuesta sin audio' : '503 Servidor';
        console.warn(`[Gemini TTS Retry] Intento ${attempt}/${maxRetries} (${reason}). Esperando ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();

  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  // Initialize Gemini AI SDK
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY?.trim(),
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", model: FAST_TTS_MODEL, longFormModel: LONG_FORM_TTS_MODEL });
  });

  app.get('/api/auth/status', (req, res) => {
    res.json({ required: Boolean(ACCESS_PASSWORD), authenticated: isAuthenticated(req.headers.cookie) });
  });

  app.post('/api/auth/login', (req, res) => {
    if (!ACCESS_PASSWORD) return res.json({ authenticated: true });
    const now = Date.now();
    const clientId = req.ip || req.socket.remoteAddress || 'unknown';
    const current = loginRateLimits.get(clientId);
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + 15 * 60_000 } : current;
    if (entry.count >= 10) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({ error: `Demasiados intentos. Reintenta en ${retryAfterSec} segundos.` });
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!passwordMatches(password)) {
      entry.count += 1;
      loginRateLimits.set(clientId, entry);
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }
    loginRateLimits.delete(clientId);
    const token = randomBytes(32).toString('base64url');
    authenticatedSessions.set(token, Date.now() + SESSION_DURATION_MS);
    const secure = process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_HTTP !== 'true' ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(
        SESSION_DURATION_MS / 1000
      )}${secure}`
    );
    res.json({ authenticated: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) authenticatedSessions.delete(token);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ authenticated: false });
  });

  app.use('/api/tts', (req, res, next) => {
    if (!isAuthenticated(req.headers.cookie)) {
      return res.status(401).json({ error: 'Inicia sesión para generar audio.' });
    }
    next();
  });

  // Basic zero-cost protection for local/private deployments.
  app.use('/api/tts', (req, res, next) => {
    const now = Date.now();
    const clientId = req.ip || req.socket.remoteAddress || 'unknown';
    const current = ttsRateLimits.get(clientId);
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current;
    entry.count += 1;
    ttsRateLimits.set(clientId, entry);

    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_PER_MINUTE);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_PER_MINUTE - entry.count));
    if (entry.count > RATE_LIMIT_PER_MINUTE) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: `Límite temporal alcanzado. Reintenta en ${retryAfterSec} segundos.`,
        isQuotaExhausted: true,
        retryAfterSec,
      });
    }
    next();
  });

  // TTS Generation Endpoint
  app.post("/api/tts", async (req, res) => {
    try {
      const {
        text: rawText,
        voice = "Kore",
        emotion = "natural",
        accent = "neutral",
        targetDuration = null,
        isMultiSpeaker = false,
        speakers = [],
      } = req.body;

      const text = typeof rawText === 'string' ? rawText.trim() : '';

      if (!text) {
        return res.status(400).json({ error: "El texto es requerido para la conversión." });
      }
      if (text.length > MAX_TEXT_LENGTH) {
        return res.status(413).json({
          error: `El texto supera el máximo de ${MAX_TEXT_LENGTH.toLocaleString('es-ES')} caracteres. Divídelo en fragmentos.`,
        });
      }
      if (!ALLOWED_VOICES.includes(voice)) {
        return res.status(400).json({ error: 'La voz seleccionada no es válida.' });
      }
      if (!ALLOWED_EMOTIONS.includes(emotion)) {
        return res.status(400).json({ error: 'El estilo de voz seleccionado no es válido.' });
      }
      if (!ALLOWED_ACCENTS.includes(accent)) {
        return res.status(400).json({ error: 'El acento seleccionado no es válido.' });
      }
      if (
        targetDuration !== null &&
        targetDuration !== undefined &&
        (!Number.isFinite(Number(targetDuration)) || Number(targetDuration) < 0.5 || Number(targetDuration) > 300)
      ) {
        return res.status(400).json({ error: 'La duración objetivo debe estar entre 0,5 y 300 segundos.' });
      }

      let validatedSpeakers: Array<{ name: string; voiceName: (typeof ALLOWED_VOICES)[number] }> = [];
      if (isMultiSpeaker) {
        if (!Array.isArray(speakers) || speakers.length !== 2) {
          return res.status(400).json({ error: 'El modo diálogo requiere exactamente dos hablantes.' });
        }
        validatedSpeakers = speakers.map((speaker: any) => ({
          name: typeof speaker?.name === 'string' ? speaker.name.trim().slice(0, 40) : '',
          voiceName: speaker?.voiceName,
        }));
        if (
          validatedSpeakers.some(
            (speaker) => !speaker.name || !ALLOWED_VOICES.includes(speaker.voiceName)
          ) ||
          validatedSpeakers[0].name.toLocaleLowerCase() === validatedSpeakers[1].name.toLocaleLowerCase()
        ) {
          return res.status(400).json({ error: 'Cada hablante necesita un nombre distinto y una voz válida.' });
        }
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          error: "Falta la clave GEMINI_API_KEY en las variables de entorno.",
        });
      }

      const isLongForm = text.length > LONG_FORM_TTS_THRESHOLD_CHARS;
      const selectedModel = isLongForm ? LONG_FORM_TTS_MODEL : FAST_TTS_MODEL;
      const textChunks = splitTextForStableTts(
        text,
        isLongForm ? LONG_FORM_TTS_CHUNK_CHARS : LONG_FORM_TTS_THRESHOLD_CHARS
      );
      const audioParts: Buffer[] = [];
      let outputMimeType = '';
      const numericTargetDuration = targetDuration === null || targetDuration === undefined
        ? null
        : Number(targetDuration);

      console.log(
        `[Gemini TTS] Modelo ${selectedModel}: ${text.length} caracteres en ${textChunks.length} fragmento(s).`
      );

      for (const [chunkIndex, textChunk] of textChunks.entries()) {
        const chunkTargetDuration = numericTargetDuration
          ? Math.max(0.5, numericTargetDuration * (textChunk.length / text.length))
          : null;
        let response;

        if (isMultiSpeaker) {
          const speakerVoiceConfigs = validatedSpeakers.map((sp) => ({
            speaker: sp.name,
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: sp.voiceName },
            },
          }));

          const accentInstruction =
            accent === "spain"
              ? "in standard Peninsular Spanish accent from Spain (Castellano de España)"
              : accent === "latam"
              ? "in Latin American Spanish accent"
              : accent === "argentina"
              ? "in Argentine Rioplatense Spanish accent"
              : "in Spanish";

          const durationInstruction = chunkTargetDuration
            ? ` Pace this part to approximately ${chunkTargetDuration.toFixed(1)} seconds.`
            : '';
          const promptText = `Synthesize this continuing dialogue segment ${accentInstruction} between ${
            validatedSpeakers[0].name
          } and ${validatedSpeakers[1].name}. Keep exactly the configured voices and delivery.${durationInstruction} Speak only the transcript.\n\nTRANSCRIPT:\n${textChunk}`;

          response = await generateTTSWithRetry(ai, {
            model: selectedModel,
            contents: [{ parts: [{ text: promptText }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs,
                },
              },
            },
          });
        } else {
          const promptText = buildPromptText(
            textChunk,
            emotion,
            accent,
            chunkTargetDuration,
            isLongForm || textChunks.length > 1
          );

          response = await generateTTSWithRetry(ai, {
            model: selectedModel,
            contents: [{ parts: [{ text: promptText }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: voice },
                },
              },
            },
          });
        }

        const candidatePart = extractAudioPart(response);
        const audioData = candidatePart?.inlineData?.data;
        const mimeType = candidatePart?.inlineData?.mimeType || "audio/pcm;rate=24000";
        if (!audioData) {
          throw new Error(`Gemini no devolvió audio para el fragmento ${chunkIndex + 1}.`);
        }
        if (outputMimeType && mimeType !== outputMimeType) {
          throw new Error('Gemini devolvió formatos de audio incompatibles entre fragmentos.');
        }
        outputMimeType = mimeType;
        audioParts.push(Buffer.from(audioData, 'base64'));
      }

      const combinedAudio = combinePcmNarration(audioParts, outputMimeType || "audio/pcm;rate=24000");
      res.json({
        audioBase64: combinedAudio.toString('base64'),
        mimeType: outputMimeType || "audio/pcm;rate=24000",
        segmentCount: textChunks.length,
        stabilizedLongForm: isLongForm,
        model: selectedModel,
      });
    } catch (err: any) {
      const errStr = String(err?.message || err);
      const is429 =
        err?.status === 429 ||
        err?.code === 429 ||
        errStr.includes("429") ||
        errStr.includes("RESOURCE_EXHAUSTED") ||
        errStr.includes("Quota exceeded");

      if (is429) {
        console.log("[Gemini TTS Rate Limit 429]: Cuota alcanzada, pausando...");
      } else {
        console.error("Error generating TTS:", err);
      }

      const is503 =
        err?.status === 503 ||
        err?.code === 503 ||
        errStr.includes("503") ||
        errStr.includes("UNAVAILABLE") ||
        errStr.includes("high demand");

      if (is429) {
        let retryAfterSec = 12;
        const matchDelay = errStr.match(/retry in ([\d\.]+)s/i) || errStr.match(/retryDelay":"(\d+)s"/i);
        if (matchDelay && matchDelay[1]) {
          retryAfterSec = Math.ceil(parseFloat(matchDelay[1])) + 2;
        }

        return res.status(429).json({
          error: `Límite de la API gratuita alcanzado. Reintentando automáticamente en ${retryAfterSec}s...`,
          isQuotaExhausted: true,
          retryAfterSec,
        });
      }

      if (is503) {
        return res.status(503).json({
          error:
            "El modelo de voz de Gemini está experimentando una alta demanda en los servidores de Google en este momento. Por favor reintenta en unos segundos.",
          isHighDemand: true,
        });
      }

      res.status(500).json({
        error: "No se pudo generar el audio. Reintenta en unos segundos.",
      });
    }
  });

  // Vite Middleware for development vs static build in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
