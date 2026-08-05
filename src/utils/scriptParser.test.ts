import { describe, expect, it } from 'vitest';
import { DEFAULT_NUVIA_SCRIPT, parseVideoScript } from './scriptParser';

describe('parseVideoScript', () => {
  it('parses SRT cues with exact timing', () => {
    const parsed = parseVideoScript(`1
00:00:00,000 --> 00:00:02,000
Hola mundo.

2
00:00:02,000 --> 00:00:04,500
Segunda frase.`);
    const lines = parsed.chapters.flatMap((chapter) => chapter.lines);

    expect(parsed.totalDurationSec).toBe(4.5);
    expect(lines).toMatchObject([
      { startSec: 0, endSec: 2, text: 'Hola mundo.' },
      { startSec: 2, endSec: 4.5, text: 'Segunda frase.' },
    ]);
  });

  it('parses WebVTT captions and removes markup', () => {
    const parsed = parseVideoScript(`WEBVTT

00:00.000 --> 00:02.000
Hola <b>mundo</b>.
Segunda línea.`);
    const lines = parsed.chapters.flatMap((chapter) => chapter.lines);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ startSec: 0, endSec: 2, text: 'Hola mundo. Segunda línea.' });
  });

  it('does not assume a three-minute duration for a generic timed script', () => {
    const parsed = parseVideoScript(`[00:00] Primera frase.
[00:03] Segunda frase.`);

    expect(parsed.totalDurationSec).toBe(7);
  });

  it('keeps the bundled example at three minutes and 59 lines', () => {
    const parsed = parseVideoScript(DEFAULT_NUVIA_SCRIPT);

    expect(parsed.totalDurationSec).toBe(180);
    expect(parsed.chapters.flatMap((chapter) => chapter.lines)).toHaveLength(59);
  });
});
