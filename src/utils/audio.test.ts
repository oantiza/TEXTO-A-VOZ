import { describe, expect, it } from 'vitest';
import { timeStretchPcm16 } from './audio';

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
});
