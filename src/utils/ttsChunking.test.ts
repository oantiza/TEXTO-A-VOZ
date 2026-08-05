import { describe, expect, it } from 'vitest';
import { splitTextForStableTts } from './ttsChunking';

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

describe('splitTextForStableTts', () => {
  it('keeps short narration in a single request', () => {
    expect(splitTextForStableTts('Una locución breve.')).toEqual(['Una locución breve.']);
  });

  it('splits long narration at sentence boundaries without losing words', () => {
    const text = Array.from(
      { length: 30 },
      (_, index) => `Esta es la frase número ${index + 1}, escrita para comprobar una narración prolongada.`
    ).join(' ');

    const chunks = splitTextForStableTts(text, 400);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 460)).toBe(true);
    expect(normalize(chunks.join(' '))).toBe(normalize(text));
    expect(chunks.slice(0, -1).every((chunk) => /[.!?…]["'»”)]?$/.test(chunk))).toBe(true);
  });

  it('falls back to whitespace when punctuation is unavailable', () => {
    const text = Array.from({ length: 120 }, (_, index) => `palabra${index}`).join(' ');
    const chunks = splitTextForStableTts(text, 250);

    expect(chunks.length).toBeGreaterThan(1);
    expect(normalize(chunks.join(' '))).toBe(normalize(text));
  });
});
