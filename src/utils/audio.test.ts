import { describe, expect, it } from 'vitest';
import { base64ToWavBlob, timeStretchPcm16, wavBlobToMp3Blob } from './audio';

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

  it('keeps natural long-form PCM untouched when no exact duration is forced', async () => {
    const source = createSineWave(220, 1);
    const base64 = Buffer.from(source).toString('base64');
    const result = base64ToWavBlob(base64, 'audio/pcm;rate=24000');
    const wav = new Uint8Array(await result.blob.arrayBuffer());

    expect(result.duration).toBe(1);
    expect(result.originalDuration).toBe(1);
    expect(result.speedFactor).toBe(1);
    expect(wav.slice(44)).toEqual(source);
  });
});
