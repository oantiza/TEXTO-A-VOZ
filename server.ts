import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const PORT = 3000;

// Helper to construct prompt with tone, regional accent & target duration instructions
function buildPromptText(text: string, emotion?: string, accent?: string, targetDuration?: number | null): string {
  const instructions: string[] = [];

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
    return `${instructions.join(', ')}:\n${text}`;
  }
  return text;
}

// Helper for calling Gemini with exponential backoff retries for 503 / high demand / 429 rate limit errors
async function generateTTSWithRetry(aiClient: GoogleGenAI, genConfig: any, maxRetries = 3) {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await aiClient.models.generateContent(genConfig);
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
        console.warn(`[Gemini TTS Retry] Intento ${attempt}/${maxRetries} (${isQuota ? 'Cuota 429' : '503 Servidor'}). Esperando ${delayMs / 1000}s...`);
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

  app.use(express.json({ limit: "10mb" }));

  // Initialize Gemini AI SDK
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", model: "gemini-3.1-flash-tts-preview" });
  });

  // TTS Generation Endpoint
  app.post("/api/tts", async (req, res) => {
    try {
      const {
        text,
        voice = "Kore",
        emotion = "natural",
        accent = "neutral",
        targetDuration = null,
        isMultiSpeaker = false,
        speakers = [],
      } = req.body;

      if (!text || typeof text !== "string" || text.trim() === "") {
        return res.status(400).json({ error: "El texto es requerido para la conversión." });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          error: "Falta la clave GEMINI_API_KEY en las variables de entorno.",
        });
      }

      let response;

      if (isMultiSpeaker && Array.isArray(speakers) && speakers.length >= 2) {
        // Multi-speaker TTS
        const speakerVoiceConfigs = speakers.slice(0, 2).map((sp) => ({
          speaker: sp.name || "Hablante",
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: sp.voiceName || "Kore" },
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

        const promptText = `TTS the following dialogue ${accentInstruction} between ${
          speakers[0].name || "Hablante 1"
        } and ${speakers[1].name || "Hablante 2"}:\n${text}`;

        response = await generateTTSWithRetry(ai, {
          model: "gemini-3.1-flash-tts-preview",
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
        // Single-speaker TTS with accent, emotion & target duration enhancement
        const promptText = buildPromptText(text, emotion, accent, targetDuration);

        response = await generateTTSWithRetry(ai, {
          model: "gemini-3.1-flash-tts-preview",
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

      const candidatePart = response.candidates?.[0]?.content?.parts?.[0];
      const audioData = candidatePart?.inlineData?.data;
      const mimeType = candidatePart?.inlineData?.mimeType || "audio/pcm;rate=24000";

      if (!audioData) {
        return res.status(500).json({
          error: "No se pudo generar el audio de respuesta desde el modelo Gemini.",
        });
      }

      res.json({
        audioBase64: audioData,
        mimeType: mimeType,
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
        error: err.message || "Ocurrió un error al procesar el texto a voz.",
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
