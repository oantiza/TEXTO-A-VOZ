import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NUVIA_SCRIPT,
  frameTimecodeToSeconds,
  parseVideoScript,
  scriptToSrt,
  scriptToVtt,
} from './scriptParser';

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

  it('exports parsed timing as SRT and WebVTT', () => {
    const parsed = parseVideoScript(`[00:00] Primera frase.\n[00:03] Segunda frase.`);

    expect(scriptToSrt(parsed)).toContain('00:00:00,000 --> 00:00:03,000');
    expect(scriptToVtt(parsed)).toMatch(/^WEBVTT/);
    expect(scriptToVtt(parsed)).toContain('00:00:03.000 --> 00:00:07.000');
  });

  it('parses the canonical 30 fps Markdown format and ignores non-spoken appendices', () => {
    const parsed = parseVideoScript(`# Locución completa V4 · YouTube-first · 30 fps

**Duración de diseño:** \`00:00:19:00\`
**Frecuencia:** 30 fps constantes
**Tono:** cercano y sereno

## P01 · \`00:00:00:00–00:00:07:15\` · 7,5 segundos

La TAE se compara con los repos.

## P02 · \`00:00:07:15–00:00:19:00\` · 11,5 segundos

Segunda frase.

## Aviso educativo escrito

Este texto aparece en pantalla y no se lee en voz alta.

## Pronunciación

- \`TAE\`: leer **te-a-e**.
- \`repos\`: pronunciar **répos**; no deletrear.
`);
    const lines = parsed.chapters.flatMap((chapter) => chapter.lines);

    expect(parsed.sourceFormat).toBe('frame-timed-markdown');
    expect(parsed.frameRate).toBe(30);
    expect(parsed.totalDurationSec).toBe(19);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      startSec: 0,
      endSec: 7.5,
      targetDurationSec: 7.5,
      text: 'La TAE se compara con los repos.',
      spokenText: 'La te-a-e se compara con los répos.',
      sourceTimecode: '00:00:00:00–00:00:07:15',
    });
    expect(lines.map((line) => line.text).join(' ')).not.toContain('no se lee');
  });

  it('converts frame timecodes using the declared frame rate', () => {
    expect(frameTimecodeToSeconds('00:01:02:15', 30)).toBe(62.5);
    expect(frameTimecodeToSeconds('00:00:01:12', 24)).toBe(1.5);
    expect(frameTimecodeToSeconds('00:00:01:30', 30)).toBe(0);
  });
});
