import { ParsedScript, ScriptChapter, ScriptLine } from '../types';
import { applyPeakCeilingPcm16, PRODUCTION_SAMPLE_RATE, resamplePcm16 } from './audio';

/**
 * Converts timestamp string (e.g., "01:26" or "00:03" or "02:50") to seconds integer.
 */
export function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  if (parts.length === 2) {
    const mins = parseInt(parts[0], 10) || 0;
    const secs = parseInt(parts[1], 10) || 0;
    return mins * 60 + secs;
  } else if (parts.length === 3) {
    const hrs = parseInt(parts[0], 10) || 0;
    const mins = parseInt(parts[1], 10) || 0;
    const secs = parseInt(parts[2], 10) || 0;
    return hrs * 3600 + mins * 60 + secs;
  }
  return 0;
}

/**
 * Converts seconds to "MM:SS" format.
 */
export function secondsToTimeString(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** Converts an HH:MM:SS:FF production timecode into seconds. */
export function frameTimecodeToSeconds(timecode: string, frameRate = 30): number {
  const match = timecode.trim().match(/^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/);
  if (!match || !Number.isFinite(frameRate) || frameRate <= 0) return 0;
  const [, hours, minutes, seconds, frames] = match.map(Number);
  if (minutes > 59 || seconds > 59 || frames >= frameRate) return 0;
  return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
}

/** Converts seconds into the HH:MM:SS:FF notation used by production scripts. */
export function secondsToFrameTimecode(totalSeconds: number, frameRate = 30): string {
  const totalFrames = Math.round(Math.max(0, totalSeconds) * frameRate);
  const frames = totalFrames % frameRate;
  const totalWholeSeconds = Math.floor(totalFrames / frameRate);
  const seconds = totalWholeSeconds % 60;
  const totalMinutes = Math.floor(totalWholeSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return [hours, minutes, seconds, frames]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':');
}

function cleanMarkdownSpeechText(value: string): string {
  return value
    .replace(/^>\s?/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyPronunciations(
  text: string,
  pronunciations: Array<{ term: string; spoken: string }>
): string {
  return pronunciations.reduce((result, { term, spoken }) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return result.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
      spoken
    );
  }, text);
}

interface FrameTimedBlock {
  label: string;
  startCode: string;
  endCode: string;
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Parses NUVIA production Markdown with blocks such as:
 * ## P01 · `00:00:00:00–00:00:07:00` · 7 segundos
 *
 * Non-spoken appendices (educational notice, pronunciation notes, etc.) are
 * deliberately excluded. Pronunciation mappings are kept separately through
 * ScriptLine.spokenText so subtitle text remains unchanged.
 */
function parseFrameTimedMarkdown(scriptText: string): ParsedScript | null {
  const normalized = scriptText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const fpsMatch = normalized.match(/\*\*Frecuencia:\*\*\s*(\d+(?:[.,]\d+)?)\s*fps/i);
  const frameRate = fpsMatch ? Number(fpsMatch[1].replace(',', '.')) : 30;
  const blockHeaderPattern = /^##\s+(.+?)\s*·\s*`?(\d{2}:\d{2}:\d{2}:\d{2})\s*[–—-]\s*(\d{2}:\d{2}:\d{2}:\d{2})`?(?:\s*·.*)?$/;
  const lines = normalized.split('\n');
  const blocks: FrameTimedBlock[] = [];

  for (let index = 0; index < lines.length; index++) {
    const header = lines[index].trim().match(blockHeaderPattern);
    if (!header) continue;

    const startCode = header[2];
    const endCode = header[3];
    const startSec = frameTimecodeToSeconds(startCode, frameRate);
    const endSec = frameTimecodeToSeconds(endCode, frameRate);
    const body: string[] = [];

    for (index += 1; index < lines.length; index++) {
      const candidate = lines[index].trim();
      if (/^#{1,6}\s+/.test(candidate) || blockHeaderPattern.test(candidate)) {
        index -= 1;
        break;
      }
      if (candidate === '---') continue;
      if (candidate) body.push(candidate);
    }

    const text = cleanMarkdownSpeechText(body.join(' '));
    if (text && endSec > startSec) {
      blocks.push({
        label: cleanMarkdownSpeechText(header[1]),
        startCode,
        endCode,
        startSec,
        endSec,
        text,
      });
    }
  }

  if (blocks.length === 0) return null;

  const pronunciationSection = normalized.match(
    /(?:^|\n)##\s+Pronunciaci[oó]n\s*\n([\s\S]*?)(?=\n##\s+|\n---|$)/i
  )?.[1] ?? '';
  const pronunciations = pronunciationSection
    .split('\n')
    .map((line) => {
      const mapping = line.match(
        /^\s*-\s*`?([^`:]+)`?\s*:\s*(?:leer|pronunciar)\s+\*\*([^*]+)\*\*/i
      );
      return mapping
        ? { term: cleanMarkdownSpeechText(mapping[1]), spoken: cleanMarkdownSpeechText(mapping[2]) }
        : null;
    })
    .filter((mapping): mapping is { term: string; spoken: string } => Boolean(mapping?.term && mapping?.spoken));

  const h1Title = normalized.match(/^#\s+(.+)$/m)?.[1];
  const tone = normalized.match(/\*\*Tono:\*\*\s*([^\n]+)/i)?.[1]?.trim();
  const designDurationCode = normalized.match(/\*\*Duraci[oó]n de dise[ñn]o:\*\*\s*`(\d{2}:\d{2}:\d{2}:\d{2})`/i)?.[1];
  const maxBlockEnd = Math.max(...blocks.map((block) => block.endSec));
  const designDuration = designDurationCode
    ? frameTimecodeToSeconds(designDurationCode, frameRate)
    : 0;

  const chapters: ScriptChapter[] = blocks.map((block, index) => {
    const spokenText = applyPronunciations(block.text, pronunciations);
    const line: ScriptLine = {
      id: `line_${index + 1}`,
      startSec: block.startSec,
      endSec: block.endSec,
      targetDurationSec: block.endSec - block.startSec,
      text: block.text,
      spokenText: spokenText === block.text ? undefined : spokenText,
      sourceTimecode: `${block.startCode}–${block.endCode}`,
    };
    return {
      id: `chap_${index + 1}`,
      title: block.label,
      timeRange: `${block.startCode} – ${block.endCode}`,
      lines: [line],
    };
  });

  return {
    title: cleanMarkdownSpeechText(h1Title || 'Locución con código de tiempo'),
    voiceInfo: [tone, `${frameRate} fps`].filter(Boolean).join(' · '),
    totalDurationSec: Math.max(maxBlockEnd, designDuration),
    chapters,
    sourceFormat: 'frame-timed-markdown',
    frameRate,
  };
}

/**
 * Default sample script provided by Nuvia Academy - Dónde crece el dinero
 */
export const DEFAULT_NUVIA_SCRIPT = `NUVIA ACADEMY · DINERO CON CRITERIO
DÓNDE CRECE EL DINERO
LOCUCIÓN DEL VÍDEO · voz femenina, español de España · duración 03:00

─────────────────────────────────────────────
00:00–00:14 · APERTURA / GANCHO (14 s)

  [00:00] Cien dólares, guardados en 1928.
  [00:03] Casi cien años después, ¿cuánto valen?
  [00:06] La respuesta depende de un solo detalle:
  [00:09] dónde decidiste ponerlos.
  [00:10] Esa decisión lo cambia todo.

─────────────────────────────────────────────
00:14–00:52 · PILAR 1 · EL EXPERIMENTO DE LOS 100 DÓLARES (38 s)

  [00:14] Empecemos por el experimento más claro que existe.
  [00:17] Cien dólares invertidos en 1928, hasta hoy.
  [00:20] En bolsa se convierten en un millón ciento sesenta mil dólares.
  [00:25] En bonos de empresa, cincuenta y tres mil novecientos.
  [00:29] En oro, veintiún mil.
  [00:30] En deuda pública, siete mil setecientos.
  [00:33] En vivienda, cinco mil seiscientos.
  [00:35] Y en el banco, dos mil quinientos setenta y ocho.
  [00:39] La diferencia entre el primero y el último
  [00:42] no es del doble ni del triple:
  [00:45] es de más de cuatrocientas veces.
  [00:47] Y todos partieron del mismo billete.

─────────────────────────────────────────────
00:52–01:26 · PILAR 2 · LA CURVA DEL LARGO PLAZO (34 s)

  [00:52] Segundo: cómo se recorre ese camino.
  [00:54] Visto año a año, el trayecto no es una línea recta.
  [00:59] La Gran Depresión, la crisis del petróleo,
  [01:02] la crisis financiera, la pandemia y la subida de tipos.
  [01:05] Cada una parecía el final de todo.
  [01:08] Y sin embargo, la curva siempre acabó por encima.
  [01:12] Fíjate en el orden: la bolsa manda,
  [01:14] los bonos la siguen de lejos,
  [01:17] y el dinero parado apenas se mueve.
  [01:20] Las caídas son el precio de la entrada,
  [01:23] no una avería.

─────────────────────────────────────────────
01:26–02:00 · PILAR 3 · NINGUNA DÉCADA SE PARECE A OTRA (34 s)

  [01:26] Tercero, y esto es lo que casi nadie cuenta:
  [01:29] ninguna década se parece a la anterior.
  [01:31] En los cincuenta la bolsa ganó casi un veinte por ciento al año.
  [01:36] En los setenta el oro subió un veintiocho, y la bolsa apenas un seis.
  [01:40] En los dos mil la bolsa perdió dinero durante diez años seguidos.
  [01:44] Y en los ochenta y noventa volvió a mandar.
  [01:47] El ganador de una década
  [01:49] casi nunca es el ganador de la siguiente.
  [01:51] Por eso no se elige un ganador:
  [01:54] se reparte entre varios.
  [01:55] Repartir no es dudar; es no depender de acertar.

─────────────────────────────────────────────
02:00–02:32 · PILAR 4 · LO QUE HACIENDA SE LLEVA (32 s)

  [02:00] Y cuarto: lo que cuenta es la rentabilidad después de impuestos.
  [02:04] En España las ganancias del ahorro tributan en una escala propia:
  [02:08] arranca en el diecinueve por ciento
  [02:11] y sube por tramos hasta el treinta.
  [02:13] Pero solo pagas cuando vendes.
  [02:15] Mientras no vendas, la ganancia sigue trabajando entera.
  [02:18] Y hay dos reglas que conviene conocer.
  [02:21] Puedes traspasar entre fondos de inversión
  [02:23] sin pasar por Hacienda.
  [02:25] Y puedes compensar tus pérdidas con tus ganancias.
  [02:28] Menos movimiento suele significar menos impuestos.

─────────────────────────────────────────────
02:32–02:50 · LAS 5 DIRECTRICES (18 s)

  [02:32] Cinco directrices finales.
  [02:33] Uno: el tiempo pesa más que el acierto.
  [02:37] Dos: reparte, porque el ganador rota.
  [02:39] Tres: las caídas son parte del precio.
  [02:42] Cuatro: el dinero parado pierde en silencio.
  [02:46] Y cinco: cuenta siempre después de impuestos.

─────────────────────────────────────────────
02:50–03:00 · CIERRE DE MARCA (10 s)

  [02:50] El dinero no crece donde parece más seguro:
  [02:54] crece donde le das tiempo.
  [02:56] Gracias por acompañarnos en Dinero con Criterio.`;

interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

function secondsToSubtitleTime(totalSeconds: number, decimalSeparator: ',' | '.'): string {
  const totalMilliseconds = Math.round(Math.max(0, totalSeconds) * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}${decimalSeparator}${milliseconds.toString().padStart(3, '0')}`;
}

export function scriptToSrt(script: ParsedScript): string {
  return script.chapters
    .flatMap((chapter) => chapter.lines)
    .map(
      (line, index) =>
        `${index + 1}\n${secondsToSubtitleTime(line.startSec, ',')} --> ${secondsToSubtitleTime(
          line.endSec,
          ','
        )}\n${line.text}`
    )
    .join('\n\n');
}

export function scriptToVtt(script: ParsedScript): string {
  const cues = script.chapters
    .flatMap((chapter) => chapter.lines)
    .map(
      (line) =>
        `${secondsToSubtitleTime(line.startSec, '.')} --> ${secondsToSubtitleTime(line.endSec, '.')}\n${line.text}`
    )
    .join('\n\n');
  return `WEBVTT\n\n${cues}`;
}

function subtitleTimeToSeconds(value: string): number {
  const parts = value.replace(',', '.').split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/** Parse standard SRT and WebVTT timing blocks, including multi-line captions. */
export function parseSubtitleCues(scriptText: string): SubtitleCue[] {
  const lines = scriptText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const timingPattern = /^((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/;
  const cues: SubtitleCue[] = [];

  for (let index = 0; index < lines.length; index++) {
    const timing = lines[index].trim().match(timingPattern);
    if (!timing) continue;

    const startSec = subtitleTimeToSeconds(timing[1]);
    const endSec = subtitleTimeToSeconds(timing[2]);
    const captionLines: string[] = [];

    for (index += 1; index < lines.length && lines[index].trim() !== ''; index++) {
      if (timingPattern.test(lines[index].trim())) {
        index -= 1;
        break;
      }
      captionLines.push(lines[index].trim());
    }

    const text = captionLines
      .join(' ')
      .replace(/<\d{2}:\d{2}(?::\d{2})?[,.]\d{3}>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (text && endSec > startSec) cues.push({ startSec, endSec, text });
  }

  return cues;
}

/**
 * Parses script text containing timestamps like [00:00], [01:26] and chapter section headers.
 */
export function parseVideoScript(scriptText: string): ParsedScript {
  const frameTimedMarkdown = parseFrameTimedMarkdown(scriptText);
  if (frameTimedMarkdown) return frameTimedMarkdown;

  const subtitleCues = parseSubtitleCues(scriptText);
  if (subtitleCues.length > 0) {
    const totalDurationSec = Math.max(...subtitleCues.map((cue) => cue.endSec));
    const lines: ScriptLine[] = subtitleCues.map((cue, index) => ({
      id: `line_${index + 1}`,
      startSec: cue.startSec,
      endSec: cue.endSec,
      targetDurationSec: Math.max(0.1, cue.endSec - cue.startSec),
      text: cue.text,
    }));
    return {
      title: 'Guion importado desde subtítulos',
      voiceInfo: 'Español de España',
      totalDurationSec,
      chapters: [
        {
          id: 'chap_1',
          title: 'Subtítulos importados',
          timeRange: `00:00 – ${secondsToTimeString(totalDurationSec)}`,
          lines,
        },
      ],
      sourceFormat: 'subtitles',
    };
  }

  const linesRaw = scriptText.split('\n');

  let title = 'Guión de Locución para Vídeo';
  let voiceInfo = 'Voz femenina, Español de España';
  let totalDurationSec = 0;

  const chapters: ScriptChapter[] = [];
  let currentChapter: ScriptChapter | null = null;
  const rawLinesWithTimes: { startSec: number; text: string; chapterTitle?: string }[] = [];
  let hasExplicitTimestamps = false;

  // 1. Scan headers & header metadata
  for (const rawLine of linesRaw) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check header lines
    if (trimmed.startsWith('NUVIA ACADEMY') || trimmed.includes('DÓNDE CRECE EL DINERO')) {
      title = 'DÓNDE CRECE EL DINERO · Nuvia Academy';
    }
    if (trimmed.includes('duración') || trimmed.includes('03:00')) {
      const matchDur = trimmed.match(/duración\s*(\d{2}:\d{2})/i);
      if (matchDur) {
        totalDurationSec = timeStringToSeconds(matchDur[1]);
      }
    }

    // Check chapter range headers e.g. "00:00–00:14 · APERTURA / GANCHO (14 s)"
    const chapterMatch = trimmed.match(/^(\d{2}:\d{2})[–-─\s]+(\d{2}:\d{2})\s*[·•|-]\s*(.*)/i);
    if (chapterMatch) {
      const startRange = chapterMatch[1];
      const endRange = chapterMatch[2];
      const name = chapterMatch[3].trim();
      currentChapter = {
        id: `chap_${chapters.length + 1}`,
        title: name,
        timeRange: `${startRange} – ${endRange}`,
        lines: [],
      };
      chapters.push(currentChapter);
      continue;
    }

    // Check timestamp lines like "[00:00] Cien dólares..." or "00:00 Cien dólares..."
    const timestampMatch = trimmed.match(/^\[?(\d{2}:\d{2})\]?\s*(.+)/);
    if (timestampMatch) {
      hasExplicitTimestamps = true;
      const startSec = timeStringToSeconds(timestampMatch[1]);
      const lineText = timestampMatch[2].trim();
      rawLinesWithTimes.push({
        startSec,
        text: lineText,
        chapterTitle: currentChapter ? currentChapter.title : undefined,
      });
    }
  }

  // Fallback: If no explicit timestamps like [00:00] were found, automatically break the text into timed sentences/lines
  if (rawLinesWithTimes.length === 0) {
    let currentSec = 0;
    let autoChapter: ScriptChapter = {
      id: 'chap_1',
      title: 'Capítulo Principal',
      timeRange: '00:00 – Auto',
      lines: [],
    };
    chapters.push(autoChapter);

    const paragraphs = scriptText.split('\n');
    for (const p of paragraphs) {
      const trimmedP = p.trim();
      if (!trimmedP || trimmedP.startsWith('─') || trimmedP.startsWith('=')) continue;

      // Extract title if line looks like a header (e.g., "CAPÍTULO 1", "PILAR 1", "SECCIÓN 1")
      if (trimmedP.length < 50 && (trimmedP.toUpperCase() === trimmedP || trimmedP.includes(':') || trimmedP.includes('·'))) {
        autoChapter = {
          id: `chap_${chapters.length + 1}`,
          title: trimmedP,
          timeRange: `${secondsToTimeString(currentSec)} – Auto`,
          lines: [],
        };
        chapters.push(autoChapter);
        continue;
      }

      // Split into sentences
      const sentences = trimmedP.split(/(?<=[.!?])\s+/);
      for (const sent of sentences) {
        const cleanSent = sent.trim();
        if (!cleanSent) continue;

        // Estimate duration based on word count (140 words/minute ~ 2.3 words/sec)
        const wordCount = cleanSent.split(/\s+/).length;
        const estimatedSec = Math.max(2, Math.round(wordCount / 2.3));

        rawLinesWithTimes.push({
          startSec: currentSec,
          text: cleanSent,
          chapterTitle: autoChapter.title,
        });

        currentSec += estimatedSec;
      }
    }

    totalDurationSec = currentSec;
  }

  // If no chapters were explicitly found by range header, create a main chapter
  if (chapters.length === 0) {
    chapters.push({
      id: 'chap_1',
      title: 'Capítulo Principal',
      timeRange: `00:00 – ${secondsToTimeString(totalDurationSec)}`,
      lines: [],
    });
  }

  // 2. Process timestamps and calculate endSec and targetDurationSec
  const parsedLines: ScriptLine[] = [];
  for (let i = 0; i < rawLinesWithTimes.length; i++) {
    const current = rawLinesWithTimes[i];
    const next = rawLinesWithTimes[i + 1];

    let endSec: number;
    if (next) {
      endSec = next.startSec;
    } else {
      endSec = Math.max(current.startSec + 4, totalDurationSec);
    }

    const targetDurationSec = Math.max(1, endSec - current.startSec);

    const lineObj: ScriptLine = {
      id: `line_${i + 1}`,
      startSec: current.startSec,
      endSec,
      targetDurationSec,
      text: current.text,
    };

    parsedLines.push(lineObj);

    // Assign to chapter
    let targetChap = chapters.find((c) => c.title === current.chapterTitle);
    if (!targetChap) targetChap = chapters[chapters.length - 1];
    if (targetChap) {
      targetChap.lines.push(lineObj);
    }
  }

  // Ensure total duration matches max timestamp if larger
  const maxEndSec = parsedLines.length > 0 ? parsedLines[parsedLines.length - 1].endSec : totalDurationSec;
  if (maxEndSec > totalDurationSec) {
    totalDurationSec = maxEndSec;
  }

  return {
    title,
    voiceInfo,
    totalDurationSec,
    chapters,
    sourceFormat: hasExplicitTimestamps ? 'timestamped' : 'automatic',
  };
}

export interface NaturalMasterTiming {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

function createPcm16WavBlob(pcmBytes: Uint8Array, sampleRate: number): Blob {
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, pcmBytes.byteLength, true);
  return new Blob([new Uint8Array(wavHeader), pcmBytes], { type: 'audio/wav' });
}

function prepareNaturalNarrationSegment(
  pcmBytes: Uint8Array,
  sampleRate: number,
  targetActiveRmsDbfs = -18.5
): Uint8Array {
  const sampleCount = Math.floor(pcmBytes.byteLength / 2);
  if (sampleCount === 0) return new Uint8Array();
  const input = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  const frameSamples = Math.max(1, Math.round(sampleRate * 0.01));
  const frameCount = Math.floor(sampleCount / frameSamples);
  const threshold = 32768 * 10 ** (-50 / 20);
  const activeFrames = new Uint8Array(frameCount);
  let firstActiveFrame = -1;
  let lastActiveFrame = -1;

  for (let frame = 0; frame < frameCount; frame++) {
    let energy = 0;
    const start = frame * frameSamples;
    for (let index = 0; index < frameSamples; index++) {
      const sample = input.getInt16((start + index) * 2, true);
      energy += sample * sample;
    }
    if (Math.sqrt(energy / frameSamples) > threshold) {
      activeFrames[frame] = 1;
      if (firstActiveFrame < 0) firstActiveFrame = frame;
      lastActiveFrame = frame;
    }
  }

  if (firstActiveFrame < 0) return pcmBytes.slice();
  const paddingSamples = Math.round(sampleRate * 0.1);
  const firstSample = Math.max(0, firstActiveFrame * frameSamples - paddingSamples);
  const lastSample = Math.min(
    sampleCount,
    (lastActiveFrame + 1) * frameSamples + paddingSamples
  );
  const trimmedSamples = lastSample - firstSample;
  const output = new Uint8Array(trimmedSamples * 2);
  const outputView = new DataView(output.buffer);

  let activeEnergy = 0;
  let activeSampleCount = 0;
  let peak = 0;
  for (let index = firstSample; index < lastSample; index++) {
    const sample = input.getInt16(index * 2, true);
    const frame = Math.floor(index / frameSamples);
    if (activeFrames[frame]) {
      activeEnergy += sample * sample;
      activeSampleCount += 1;
    }
    peak = Math.max(peak, Math.abs(sample));
  }

  const activeRms = Math.sqrt(activeEnergy / Math.max(1, activeSampleCount));
  const desiredRms = 32768 * 10 ** (targetActiveRmsDbfs / 20);
  const requestedGain = activeRms > 0 ? desiredRms / activeRms : 1;
  const limitedGain = Math.max(10 ** (-4 / 20), Math.min(10 ** (4 / 20), requestedGain));
  const peakCeiling = 32767 * 10 ** (-1.5 / 20);
  const gain = peak > 0 ? Math.min(limitedGain, peakCeiling / peak) : 1;
  const fadeSamples = Math.min(Math.round(sampleRate * 0.008), Math.floor(trimmedSamples / 2));

  for (let index = 0; index < trimmedSamples; index++) {
    let envelope = 1;
    if (index < fadeSamples) envelope = index / Math.max(1, fadeSamples);
    if (index >= trimmedSamples - fadeSamples) {
      envelope = Math.min(envelope, (trimmedSamples - index - 1) / Math.max(1, fadeSamples));
    }
    const sample = Math.round(input.getInt16((firstSample + index) * 2, true) * gain * envelope);
    outputView.setInt16(index * 2, Math.max(-32768, Math.min(32767, sample)), true);
  }
  return output;
}

/**
 * Joins independently generated natural phrases sequentially. It removes only
 * excessive edge silence, applies a very small loudness correction and creates
 * consistent pauses without changing the duration or pitch of the speech.
 */
export async function combineNaturalScriptAudioSegments(
  lines: ScriptLine[],
  pauseSeconds = 0.25
): Promise<{
  masterBlob: Blob;
  masterBlobUrl: string;
  durationSeconds: number;
  timings: NaturalMasterTiming[];
}> {
  const sampleRate = PRODUCTION_SAMPLE_RATE;
  const leadingSilenceSamples = Math.round(sampleRate * 0.2);
  const trailingSilenceSamples = Math.round(sampleRate * 0.4);
  const pauseSamples = Math.round(sampleRate * pauseSeconds);
  const preparedSegments: Array<{ line: ScriptLine; pcm: Uint8Array }> = [];

  for (const line of lines) {
    if (!line.audioUrl) continue;
    const response = await fetch(line.audioUrl);
    const wav = await response.arrayBuffer();
    if (wav.byteLength <= 44) continue;
    const sourceSampleRate = new DataView(wav).getUint32(24, true);
    const sourcePcm = new Uint8Array(wav, 44);
    const productionPcm = sourceSampleRate === sampleRate
      ? sourcePcm
      : resamplePcm16(sourcePcm, sourceSampleRate, sampleRate);
    preparedSegments.push({ line, pcm: prepareNaturalNarrationSegment(productionPcm, sampleRate) });
  }

  if (preparedSegments.length === 0) {
    throw new Error('No hay frases naturales válidas para crear el máster.');
  }

  const totalSamples = leadingSilenceSamples
    + trailingSilenceSamples
    + preparedSegments.reduce((total, segment) => total + segment.pcm.byteLength / 2, 0)
    + pauseSamples * Math.max(0, preparedSegments.length - 1);
  const masterPcm = new Uint8Array(totalSamples * 2);
  const timings: NaturalMasterTiming[] = [];
  let cursor = leadingSilenceSamples;
  let planStartSample = 0;

  preparedSegments.forEach((segment, index) => {
    masterPcm.set(segment.pcm, cursor * 2);
    cursor += segment.pcm.byteLength / 2;
    const isLast = index === preparedSegments.length - 1;
    const planEndSample = isLast ? totalSamples : cursor + Math.floor(pauseSamples / 2);
    timings.push({
      id: segment.line.id,
      startSec: planStartSample / sampleRate,
      endSec: planEndSample / sampleRate,
      durationSec: (planEndSample - planStartSample) / sampleRate,
    });
    planStartSample = planEndSample;
    if (!isLast) cursor += pauseSamples;
  });

  const safeMasterPcm = applyPeakCeilingPcm16(masterPcm, -1.5);
  const masterBlob = createPcm16WavBlob(safeMasterPcm, sampleRate);
  return {
    masterBlob,
    masterBlobUrl: URL.createObjectURL(masterBlob),
    durationSeconds: totalSamples / sampleRate,
    timings,
  };
}

/**
 * Stitch multiple PCM audio Blobs/WAVs into a single continuous master WAV
 * video audio file (48 kHz mono 16-bit PCM).
 */
export async function combineScriptAudioSegments(
  lines: ScriptLine[],
  totalDurationSec: number
): Promise<{ masterBlob: Blob; masterBlobUrl: string; totalBytes: number }> {
  const sampleRate = PRODUCTION_SAMPLE_RATE;
  const numChannels = 1;
  const bitsPerSample = 16;
  const totalSamples = Math.ceil(totalDurationSec * sampleRate);
  const masterPcmBytes = new Uint8Array(totalSamples * 2);
  const masterView = new DataView(masterPcmBytes.buffer);

  for (const line of lines) {
    if (!line.audioUrl) continue;

    try {
      const resp = await fetch(line.audioUrl);
      const arrayBuf = await resp.arrayBuffer();
      if (arrayBuf.byteLength <= 44) continue;

      // App-generated WAVs use a canonical 44-byte PCM header. Keep a fallback
      // conversion so older 24 kHz projects can still be compiled correctly.
      const sourceSampleRate = new DataView(arrayBuf).getUint32(24, true);
      const sourcePcmBytes = new Uint8Array(arrayBuf, 44);
      const productionPcmBytes = sourceSampleRate === sampleRate
        ? sourcePcmBytes
        : resamplePcm16(sourcePcmBytes, sourceSampleRate, sampleRate);
      const linePcmView = new DataView(
        productionPcmBytes.buffer,
        productionPcmBytes.byteOffset,
        productionPcmBytes.byteLength
      );
      const lineSamples = Math.floor(productionPcmBytes.byteLength / 2);

      const startSampleIndex = Math.floor(line.startSec * sampleRate);

      for (let s = 0; s < lineSamples; s++) {
        const destSampleIndex = startSampleIndex + s;
        if (destSampleIndex >= totalSamples) break;

        const val = linePcmView.getInt16(s * 2, true);
        masterView.setInt16(destSampleIndex * 2, val, true);
      }
    } catch (err) {
      console.error(`Failed to combine audio for line ${line.id}:`, err);
    }
  }

  // Build Master WAV header
  const pcmLen = masterPcmBytes.length;
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + pcmLen, true);
  // "WAVE"
  view.setUint32(8, 0x57415645, false);

  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, pcmLen, true);

  const fullWavBytes = new Uint8Array(44 + pcmLen);
  fullWavBytes.set(new Uint8Array(wavHeader), 0);
  fullWavBytes.set(masterPcmBytes, 44);

  const blob = new Blob([fullWavBytes], { type: 'audio/wav' });
  const masterBlobUrl = URL.createObjectURL(blob);

  return { masterBlob: blob, masterBlobUrl, totalBytes: fullWavBytes.length };
}
