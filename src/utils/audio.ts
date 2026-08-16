import { Mp3Encoder } from '@breezystack/lamejs';

export const PRODUCTION_SAMPLE_RATE = 48_000;

function getSampleRateFromMimeType(mimeType: string): number {
  const match = mimeType.match(/(?:^|[;,\s])rate=(\d+)/i);
  return match ? Number(match[1]) : 24_000;
}

/**
 * Changes PCM duration with a lightweight WSOLA-style overlap algorithm.
 * Frames are repositioned instead of resampling individual samples, which keeps
 * speech pitch stable while making small and medium timing corrections.
 */
export function timeStretchPcm16(
  pcmBytes: Uint8Array,
  targetSamples: number,
  sampleRate: number
): Uint8Array {
  const sourceSamples = Math.floor(pcmBytes.byteLength / 2);
  if (sourceSamples === 0 || targetSamples <= 0) return new Uint8Array();
  if (Math.abs(sourceSamples - targetSamples) < sampleRate * 0.01) {
    return pcmBytes.slice(0, targetSamples * 2);
  }

  const sourceView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  const input = new Float32Array(sourceSamples);
  for (let index = 0; index < sourceSamples; index++) {
    input[index] = sourceView.getInt16(index * 2, true) / 32768;
  }

  const windowSize = Math.min(sourceSamples, Math.max(256, Math.round(sampleRate * 0.04))) & ~1;
  if (windowSize < 32) {
    const output = new Uint8Array(targetSamples * 2);
    const outputView = new DataView(output.buffer);
    for (let index = 0; index < targetSamples; index++) {
      const sourceIndex = Math.min(sourceSamples - 1, Math.floor((index * sourceSamples) / targetSamples));
      outputView.setInt16(index * 2, sourceView.getInt16(sourceIndex * 2, true), true);
    }
    return output;
  }

  const synthesisHop = Math.floor(windowSize / 2);
  const overlapSize = windowSize - synthesisHop;
  const speedFactor = sourceSamples / targetSamples;
  const analysisHop = Math.max(1, synthesisHop * speedFactor);
  const searchRadius = Math.min(Math.round(sampleRate * 0.015), Math.floor(windowSize / 3));
  const maxInputStart = Math.max(0, sourceSamples - windowSize);
  const accumulator = new Float32Array(targetSamples + windowSize);
  const weights = new Float32Array(targetSamples + windowSize);
  const window = new Float32Array(windowSize);

  for (let index = 0; index < windowSize; index++) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (windowSize - 1));
  }

  const addFrame = (inputStart: number, outputStart: number) => {
    for (let index = 0; index < windowSize; index++) {
      const destination = outputStart + index;
      if (destination >= accumulator.length || inputStart + index >= sourceSamples) break;
      const weight = window[index];
      accumulator[destination] += input[inputStart + index] * weight;
      weights[destination] += weight;
    }
  };

  let previousInputStart = 0;
  let outputStart = 0;
  addFrame(previousInputStart, outputStart);

  while (outputStart + synthesisHop < targetSamples) {
    outputStart += synthesisHop;
    const predictedStart = Math.min(maxInputStart, Math.round(previousInputStart + analysisHop));
    const referenceStart = Math.min(maxInputStart, previousInputStart + synthesisHop);
    const minimumCandidate = Math.max(0, predictedStart - searchRadius);
    const maximumCandidate = Math.min(maxInputStart, predictedStart + searchRadius);
    let bestCandidate = predictedStart;
    let bestScore = Number.NEGATIVE_INFINITY;

    // Coarse correlation is fast enough for long scripts and still aligns voice periods accurately.
    for (let candidate = minimumCandidate; candidate <= maximumCandidate; candidate += 8) {
      let cross = 0;
      let referenceEnergy = 0;
      let candidateEnergy = 0;
      for (let index = 0; index < overlapSize; index += 8) {
        const referenceValue = input[Math.min(sourceSamples - 1, referenceStart + index)];
        const candidateValue = input[Math.min(sourceSamples - 1, candidate + index)];
        cross += referenceValue * candidateValue;
        referenceEnergy += referenceValue * referenceValue;
        candidateEnergy += candidateValue * candidateValue;
      }
      const score = cross / Math.sqrt(Math.max(1e-9, referenceEnergy * candidateEnergy));
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    previousInputStart = bestCandidate;
    addFrame(previousInputStart, outputStart);
  }

  const output = new Uint8Array(targetSamples * 2);
  const outputView = new DataView(output.buffer);
  for (let index = 0; index < targetSamples; index++) {
    const normalized = weights[index] > 1e-6 ? accumulator[index] / weights[index] : 0;
    const sample = Math.max(-32768, Math.min(32767, Math.round(normalized * 32767)));
    outputView.setInt16(index * 2, sample, true);
  }
  return output;
}

/**
 * Converts mono PCM16 to the production sample rate. Gemini currently returns
 * 24 kHz PCM, while video editors and delivery masters expect 48 kHz. The
 * common 2x path uses band-limited Lanczos interpolation instead of duplicating
 * samples or changing only the WAV header.
 */
export function resamplePcm16(
  pcmBytes: Uint8Array,
  sourceSampleRate: number,
  targetSampleRate = PRODUCTION_SAMPLE_RATE
): Uint8Array {
  if (sourceSampleRate <= 0 || targetSampleRate <= 0) {
    throw new Error('La frecuencia de muestreo debe ser mayor que cero.');
  }
  if (sourceSampleRate === targetSampleRate) return pcmBytes.slice();

  const sourceSamples = Math.floor(pcmBytes.byteLength / 2);
  if (sourceSamples === 0) return new Uint8Array();

  const sourceView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  const input = new Float64Array(sourceSamples);
  for (let index = 0; index < sourceSamples; index++) {
    input[index] = sourceView.getInt16(index * 2, true);
  }

  const targetSamples = Math.max(1, Math.round((sourceSamples * targetSampleRate) / sourceSampleRate));
  const output = new Uint8Array(targetSamples * 2);
  const outputView = new DataView(output.buffer);
  const radius = 4;
  const sinc = (value: number) => {
    if (Math.abs(value) < 1e-9) return 1;
    const angle = Math.PI * value;
    return Math.sin(angle) / angle;
  };

  for (let targetIndex = 0; targetIndex < targetSamples; targetIndex++) {
    const sourcePosition = (targetIndex * sourceSampleRate) / targetSampleRate;
    const nearestInteger = Math.round(sourcePosition);
    let sample: number;

    if (Math.abs(sourcePosition - nearestInteger) < 1e-9 && nearestInteger < sourceSamples) {
      sample = input[nearestInteger];
    } else {
      const center = Math.floor(sourcePosition);
      let weightedSample = 0;
      let totalWeight = 0;
      for (let sourceIndex = center - radius + 1; sourceIndex <= center + radius; sourceIndex++) {
        const clampedIndex = Math.max(0, Math.min(sourceSamples - 1, sourceIndex));
        const distance = sourcePosition - sourceIndex;
        const weight = sinc(distance) * sinc(distance / radius);
        weightedSample += input[clampedIndex] * weight;
        totalWeight += weight;
      }
      sample = totalWeight === 0
        ? input[Math.max(0, Math.min(sourceSamples - 1, center))]
        : weightedSample / totalWeight;
    }

    outputView.setInt16(
      targetIndex * 2,
      Math.max(-32768, Math.min(32767, Math.round(sample))),
      true
    );
  }

  return output;
}

/** Reduces only excessive peaks, preserving the natural dynamics of the voice. */
export function applyPeakCeilingPcm16(pcmBytes: Uint8Array, ceilingDbfs = -3): Uint8Array {
  const sampleCount = Math.floor(pcmBytes.byteLength / 2);
  if (sampleCount === 0) return new Uint8Array();
  const sourceView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  let peak = 0;
  for (let index = 0; index < sampleCount; index++) {
    peak = Math.max(peak, Math.abs(sourceView.getInt16(index * 2, true)));
  }
  const ceiling = 32767 * 10 ** (ceilingDbfs / 20);
  if (peak <= ceiling || peak === 0) return pcmBytes.slice();

  const gain = ceiling / peak;
  const output = new Uint8Array(sampleCount * 2);
  const outputView = new DataView(output.buffer);
  for (let index = 0; index < sampleCount; index++) {
    outputView.setInt16(index * 2, Math.round(sourceView.getInt16(index * 2, true) * gain), true);
  }
  return output;
}

/**
 * Converts Base64 audio returned by Gemini TTS into a playable WAV Blob URL.
 * When a target duration is provided, timing is adjusted without changing pitch.
 */
export function base64ToWavBlob(
  base64Audio: string,
  mimeType: string = 'audio/pcm;rate=24000',
  targetDurationSeconds?: number | null,
  outputSampleRate = PRODUCTION_SAMPLE_RATE
): {
  blob: Blob;
  blobUrl: string;
  duration: number;
  originalDuration: number;
  speedFactor: number;
  sampleRate: number;
  sourceSampleRate: number;
} {
  const binaryString = atob(base64Audio);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Sample rate & parameters
  const sourceSampleRate = getSampleRateFromMimeType(mimeType);
  const numChannels = 1;
  const bitsPerSample = 16;

  // Calculate raw PCM duration from Gemini
  const origDurationSeconds = (len / (bitsPerSample / 8)) / sourceSampleRate;

  let finalPcmBytes = bytes;
  let finalDurationSeconds = origDurationSeconds;
  let speedFactor = 1.0;

  // If target duration is explicitly requested (> 0.5s)
  if (targetDurationSeconds && targetDurationSeconds >= 0.5) {
    const origSamples = Math.floor(len / 2);
    const targetSamples = Math.round(targetDurationSeconds * sourceSampleRate);

    if (origSamples > 0 && targetSamples > 0 && Math.abs(origDurationSeconds - targetDurationSeconds) >= 0.05) {
      speedFactor = origDurationSeconds / targetDurationSeconds; // e.g. 12s orig / 10s target = 1.2x speed
      finalPcmBytes = timeStretchPcm16(bytes, targetSamples, sourceSampleRate);
      finalDurationSeconds = targetDurationSeconds;
    }
  }

  // Perform one production-rate conversion after any optional timing change,
  // then leave safe headroom for EQ, music and effects in the video mix.
  finalPcmBytes = resamplePcm16(finalPcmBytes, sourceSampleRate, outputSampleRate);
  finalPcmBytes = applyPeakCeilingPcm16(finalPcmBytes);
  finalDurationSeconds = finalPcmBytes.byteLength / 2 / outputSampleRate;

  const pcmLen = finalPcmBytes.length;
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + pcmLen, true);
  // "WAVE"
  view.setUint32(8, 0x57415645, false);

  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true); // Subchunk1Size for PCM
  view.setUint16(20, 1, true); // AudioFormat 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, outputSampleRate, true);
  view.setUint32(28, outputSampleRate * numChannels * (bitsPerSample / 8), true); // ByteRate
  view.setUint16(32, numChannels * (bitsPerSample / 8), true); // BlockAlign
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, pcmLen, true);

  const wavBytes = new Uint8Array(44 + pcmLen);
  wavBytes.set(new Uint8Array(wavHeader), 0);
  wavBytes.set(finalPcmBytes, 44);

  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  const blobUrl = URL.createObjectURL(blob);

  return {
    blob,
    blobUrl,
    duration: Math.round(finalDurationSeconds * 10) / 10,
    originalDuration: Math.round(origDurationSeconds * 10) / 10,
    speedFactor: Math.round(speedFactor * 100) / 100,
    sampleRate: outputSampleRate,
    sourceSampleRate,
  };
}

/** Convert the mono 16-bit WAV files produced by the app to MP3 in the browser. */
export async function wavBlobToMp3Blob(wavBlob: Blob, kbps = 128): Promise<Blob> {
  const buffer = await wavBlob.arrayBuffer();
  const view = new DataView(buffer);
  if (buffer.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) {
    throw new Error('El archivo de audio no es un WAV válido.');
  }

  let channels = 1;
  let sampleRate = 24_000;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  for (let offset = 12; offset + 8 <= buffer.byteLength; ) {
    const chunkId = view.getUint32(offset, false);
    const chunkLength = view.getUint32(offset + 4, true);
    if (chunkId === 0x666d7420 && chunkLength >= 16) {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 0x64617461) {
      dataOffset = offset + 8;
      dataLength = Math.min(chunkLength, buffer.byteLength - dataOffset);
      break;
    }
    offset += 8 + chunkLength + (chunkLength % 2);
  }

  if (dataOffset < 0 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error('Solo se pueden convertir WAV mono de 16 bits.');
  }

  const sampleCount = Math.floor(dataLength / 2);
  const samples = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index++) {
    samples[index] = view.getInt16(dataOffset + index * 2, true);
  }

  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const chunks: Uint8Array[] = [];
  const blockSize = 1152;
  for (let index = 0; index < samples.length; index += blockSize) {
    const encoded = encoder.encodeBuffer(samples.subarray(index, index + blockSize));
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded));
  }
  const finalChunk = encoder.flush();
  if (finalChunk.length > 0) chunks.push(new Uint8Array(finalChunk));
  return new Blob(chunks, { type: 'audio/mpeg' });
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
