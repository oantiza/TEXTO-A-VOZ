import { describe, expect, it } from 'vitest';
import {
  applyPeakCeilingPcm16,
  base64ToWavBlob,
  PRODUCTION_SAMPLE_RATE,
  resamplePcm16,
  timeStretchPcm16,
  wavBlobToMp3Blob,
} from './audio';
import { combineNaturalScriptAudioSegments, combineScriptAudioSegments } from './scriptParser';

const SAMPLE_RATE = 24_000;

function createSineWave(frequency: number, seconds: number): Uint8Array {
  const samples = Math.round(SAMPLE_RATE * seconds);
  const bytes = new Uint8Array(samples * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples; index++) {
    const value = Math.round(Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * 20_000);
    view.setInt16(index * 2, value, true);
  }
  return bytes;
}

function estimateFrequency(bytes: Uint8Array, seconds: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let positiveCrossings = 0;
  for (let index = 1; index < bytes.byteLength / 2; index++) {
    if (view.getInt16((index - 1) * 2, true) <= 0 && view.getInt16(index * 2, true) > 0) {
      positiveCrossings += 1;
    }
  }
  return positiveCrossings / seconds;
}

describe('timeStretchPcm16', () => {
  it.each([0.5, 1.5])('preserves pitch when changing duration to %s seconds', (targetSeconds) => {
    const source = createSineWave(440, 1);
    const stretched = timeStretchPcm16(source, Math.round(SAMPLE_RATE * targetSeconds), SAMPLE_RATE);

    expect(stretched.byteLength).toBe(Math.round(SAMPLE_RATE * targetSeconds) * 2);
    expect(estimateFrequency(stretched, targetSeconds)).toBeGreaterThan(430);
    expect(estimateFrequency(stretched, targetSeconds)).toBeLessThan(450);
  });

  it('encodes the generated WAV as a downloadable MP3', async () => {
    const source = createSineWave(440, 0.25);
    const base64 = Buffer.from(source).toString('base64');
    const { blob } = base64ToWavBlob(base64, 'audio/pcm;rate=24000');
    const mp3 = await wavBlobToMp3Blob(blob);

    expect(mp3.type).toBe('audio/mpeg');
    expect(mp3.size).toBeGreaterThan(100);
  });

  it('exports natural long-form PCM at the 48 kHz production rate without forcing duration', async () => {
    const source = createSineWave(220, 1);
    const base64 = Buffer.from(source).toString('base64');
    const result = base64ToWavBlob(base64, 'audio/pcm;rate=24000');
    const wav = new Uint8Array(await result.blob.arrayBuffer());
    const header = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(result.duration).toBe(1);
    expect(result.originalDuration).toBe(1);
    expect(result.speedFactor).toBe(1);
    expect(result.sourceSampleRate).toBe(SAMPLE_RATE);
    expect(result.sampleRate).toBe(PRODUCTION_SAMPLE_RATE);
    expect(header.getUint32(24, true)).toBe(PRODUCTION_SAMPLE_RATE);
    expect(wav.byteLength).toBe(44 + PRODUCTION_SAMPLE_RATE * 2);
  });

  it('preserves pitch when converting Gemini PCM from 24 to 48 kHz', () => {
    const source = createSineWave(440, 1);
    const converted = resamplePcm16(source, SAMPLE_RATE, PRODUCTION_SAMPLE_RATE);

    expect(converted.byteLength).toBe(source.byteLength * 2);
    expect(estimateFrequency(converted, 1)).toBeGreaterThan(430);
    expect(estimateFrequency(converted, 1)).toBeLessThan(450);
  });

  it('creates headroom without amplifying already-safe audio', () => {
    const loud = createSineWave(440, 0.25);
    const loudView = new DataView(loud.buffer);
    for (let index = 0; index < loud.byteLength / 2; index++) {
      loudView.setInt16(index * 2, Math.round(loudView.getInt16(index * 2, true) * 1.5), true);
    }
    const limited = applyPeakCeilingPcm16(loud);
    const limitedView = new DataView(limited.buffer);
    let peak = 0;
    for (let index = 0; index < limited.byteLength / 2; index++) {
      peak = Math.max(peak, Math.abs(limitedView.getInt16(index * 2, true)));
    }

    expect(peak).toBeLessThanOrEqual(Math.ceil(32767 * 10 ** (-3 / 20)));
  });

  it('upgrades audio from older 24 kHz projects when compiling a master', async () => {
    const source = createSineWave(220, 0.5);
    const base64 = Buffer.from(source).toString('base64');
    const legacy = base64ToWavBlob(base64, 'audio/pcm;rate=24000', null, SAMPLE_RATE);
    const compiled = await combineScriptAudioSegments(
      [{
        id: 'legacy-line',
        startSec: 0,
        endSec: 1,
        targetDurationSec: 1,
        text: 'Prueba',
        audioUrl: legacy.blobUrl,
      }],
      1
    );
    const master = await compiled.masterBlob.arrayBuffer();
    const header = new DataView(master);

    expect(header.getUint32(24, true)).toBe(PRODUCTION_SAMPLE_RATE);
    expect(master.byteLength).toBe(44 + PRODUCTION_SAMPLE_RATE * 2);
    URL.revokeObjectURL(legacy.blobUrl);
    URL.revokeObjectURL(compiled.masterBlobUrl);
  });

  it('joins natural blocks sequentially without stretching their speech', async () => {
    const source = createSineWave(220, 1);
    const base64 = Buffer.from(source).toString('base64');
    const first = base64ToWavBlob(base64, 'audio/pcm;rate=24000');
    const second = base64ToWavBlob(base64, 'audio/pcm;rate=24000');
    const result = await combineNaturalScriptAudioSegments([
      { id: 'line-1', startSec: 0, endSec: 1, targetDurationSec: 1, text: 'Uno', audioUrl: first.blobUrl },
      { id: 'line-2', startSec: 1, endSec: 2, targetDurationSec: 1, text: 'Dos', audioUrl: second.blobUrl },
    ]);
    const master = await result.masterBlob.arrayBuffer();
    const header = new DataView(master);

    expect(header.getUint32(24, true)).toBe(PRODUCTION_SAMPLE_RATE);
    expect(result.timings).toHaveLength(2);
    expect(result.durationSeconds).toBeCloseTo(2.85, 2);
    expect(result.timings[0].endSec).toBeLessThan(result.timings[1].endSec);
    URL.revokeObjectURL(first.blobUrl);
    URL.revokeObjectURL(second.blobUrl);
    URL.revokeObjectURL(result.masterBlobUrl);
  });

  it('absorbs short TTS edge silence when fitting a natural block', async () => {
    const edgeSilenceSamples = Math.round(SAMPLE_RATE * 0.1);
    const tone = createSineWave(220, 1);
    const source = new Uint8Array(edgeSilenceSamples * 2 + tone.byteLength + edgeSilenceSamples * 2);
    source.set(tone, edgeSilenceSamples * 2);
    const base64 = Buffer.from(source).toString('base64');
    const phrase = base64ToWavBlob(base64, 'audio/pcm;rate=24000');
    const result = await combineNaturalScriptAudioSegments([
      {
        id: 'line-1',
        startSec: 0,
        endSec: 1.12,
        targetDurationSec: 1.12,
        text: 'Prueba con silencio técnico',
        audioUrl: phrase.blobUrl,
      },
    ], { fitBlocksToTargets: true });

    expect(result.durationSeconds).toBeCloseTo(1.12, 4);
    expect(result.timings).toHaveLength(1);
    URL.revokeObjectURL(phrase.blobUrl);
    URL.revokeObjectURL(result.masterBlobUrl);
  });

  it('still rejects real speech that is longer than its target block', async () => {
    const source = createSineWave(220, 1);
    const base64 = Buffer.from(source).toString('base64');
    const phrase = base64ToWavBlob(base64, 'audio/pcm;rate=24000');

    await expect(combineNaturalScriptAudioSegments([
      {
        id: 'line-1',
        startSec: 0,
        endSec: 0.8,
        targetDurationSec: 0.8,
        text: 'Prueba demasiado larga',
        audioUrl: phrase.blobUrl,
      },
    ], { fitBlocksToTargets: true })).rejects.toThrow('no cabe en la duración del vídeo');
    URL.revokeObjectURL(phrase.blobUrl);
  });
});
