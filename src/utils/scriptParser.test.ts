import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NUVIA_SCRIPT,
  cleanSpokenText,
  calculateNaturalGapSamples,
  calculateNaturalBlockPlacements,
  calculateCenteredBlockPaddingSamples,
  frameTimecodeToSeconds,
  getMissingAudioBlockIds,
  mergeGeneratedAudio,
  parseVideoScript,
  scriptToSrt,
  scriptToVtt,
} from './scriptParser';

describe('getMissingAudioBlockIds', () => {
  it('lists only blocks that have no generated audio', () => {
    expect(getMissingAudioBlockIds([
      { id: 'p01', audioUrl: 'blob:audio-1' },
      { id: 'p02', audioUrl: undefined },
      { id: 'p03', audioUrl: '' },
    ])).toEqual(['P02', 'P03']);
  });

  it('returns an empty list when the master is complete', () => {
    expect(getMissingAudioBlockIds([
      { id: 'p01', audioUrl: 'blob:audio-1' },
      { id: 'p02', audioUrl: 'blob:audio-2' },
    ])).toEqual([]);
  });
});

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

  it('accepts the three-level block headings used by current NUVIA scripts', () => {
    const parsed = parseVideoScript(`# Locución NUVIA

**Frecuencia:** 30 fps

### P01 · 00:00:00:00–00:00:05:00 · F0000–F0149

Primera idea.

### P02 · 00:00:05:00–00:00:11:00 · F0150–F0329

Segunda idea.

## Aviso educativo escrito

Esto no se lee.`);
    const lines = parsed.chapters.flatMap((chapter) => chapter.lines);

    expect(parsed.sourceFormat).toBe('frame-timed-markdown');
    expect(parsed.totalDurationSec).toBe(11);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.text)).toEqual(['Primera idea.', 'Segunda idea.']);
  });
});

describe('calculateNaturalGapSamples', () => {
  it('keeps the standard pause when no final duration is requested', () => {
    expect(calculateNaturalGapSamples(800, 3, 100)).toEqual([25, 25]);
  });

  it('fills a longer target only with evenly distributed pauses', () => {
    const gaps = calculateNaturalGapSamples(800, 3, 100, {
      targetDurationSeconds: 11,
    });

    expect(gaps).toEqual([120, 120]);
    expect(20 + 40 + 800 + gaps.reduce((total, gap) => total + gap, 0)).toBe(1100);
  });

  it('never shortens pauses or speech to reach a target that is too small', () => {
    expect(calculateNaturalGapSamples(800, 3, 100, {
      targetDurationSeconds: 8,
    })).toEqual([25, 25]);
  });
});

describe('calculateCenteredBlockPaddingSamples', () => {
  it('centres natural speech inside the visual interval', () => {
    expect(calculateCenteredBlockPaddingSamples(800, 1000)).toEqual({
      beforeSamples: 100,
      afterSamples: 100,
    });
  });

  it('rejects a phrase that would require speeding up the voice', () => {
    expect(() => calculateCenteredBlockPaddingSamples(1001, 1000)).toThrow(
      'La voz natural no cabe en el intervalo asignado.'
    );
  });
});

describe('calculateNaturalBlockPlacements', () => {
  it('borrows silence from neighbouring blocks without overlapping speech', () => {
    expect(calculateNaturalBlockPlacements([
      { startSample: 0, endSample: 100, speechSamples: 80 },
      { startSample: 100, endSample: 200, speechSamples: 120 },
      { startSample: 200, endSample: 300, speechSamples: 80 },
    ], 300)).toEqual([
      { startSample: 10, endSample: 90 },
      { startSample: 90, endSample: 210 },
      { startSample: 210, endSample: 290 },
    ]);
  });

  it('moves earlier phrases back when the last phrase needs trailing room', () => {
    expect(calculateNaturalBlockPlacements([
      { startSample: 0, endSample: 100, speechSamples: 80 },
      { startSample: 100, endSample: 200, speechSamples: 80 },
      { startSample: 200, endSample: 300, speechSamples: 120 },
    ], 300)).toEqual([
      { startSample: 10, endSample: 90 },
      { startSample: 100, endSample: 180 },
      { startSample: 180, endSample: 300 },
    ]);
  });

  it('rejects a set of phrases that cannot fit without overlap', () => {
    expect(() => calculateNaturalBlockPlacements([
      { startSample: 0, endSample: 100, speechSamples: 160 },
      { startSample: 100, endSample: 200, speechSamples: 160 },
    ], 200)).toThrow('La locución completa no cabe');
  });
});

describe('parseVideoScript en modo automático', () => {
  it('no convierte en título una frase corta que lleva dos puntos', () => {
    const script = parseVideoScript(
      'Y aquí está la clave: el interés compuesto.\nPor eso conviene empezar pronto.'
    );
    const spoken = script.chapters.flatMap((chapter) => chapter.lines).map((line) => line.text);
    expect(spoken).toContain('Y aquí está la clave: el interés compuesto.');
  });

  it('sigue reconociendo los rótulos de capítulo', () => {
    const script = parseVideoScript('PILAR 1\nEl ahorro manda.\nPILAR 2\nDespués, el tiempo.');
    expect(script.chapters.map((chapter) => chapter.title)).toEqual(
      expect.arrayContaining(['PILAR 1', 'PILAR 2'])
    );
    const spoken = script.chapters.flatMap((chapter) => chapter.lines).map((line) => line.text);
    expect(spoken).toEqual(['El ahorro manda.', 'Después, el tiempo.']);
  });
});

describe('mergeGeneratedAudio', () => {
  const scriptWith = (lines: Array<{ id: string; text: string; audioUrl?: string }>) => ({
    title: 'Guion',
    voiceInfo: '',
    totalDurationSec: 20,
    chapters: [
      {
        id: 'chap_1',
        title: 'Capítulo',
        timeRange: '00:00 – 00:20',
        lines: lines.map((line, index) => ({
          id: line.id,
          startSec: index * 10,
          endSec: index * 10 + 10,
          targetDurationSec: 10,
          text: line.text,
          audioUrl: line.audioUrl,
        })),
      },
    ],
  });

  it('conserva el audio de los bloques que no han cambiado', () => {
    const previous = scriptWith([
      { id: 'line_1', text: 'Uno', audioUrl: 'blob:uno' },
      { id: 'line_2', text: 'Dos', audioUrl: 'blob:dos' },
    ]);
    const next = scriptWith([
      { id: 'line_1', text: 'Uno' },
      { id: 'line_2', text: 'Dos' },
    ]);

    const { script, releasedAudioUrls } = mergeGeneratedAudio(previous, next);
    expect(script.chapters[0].lines.map((line) => line.audioUrl)).toEqual(['blob:uno', 'blob:dos']);
    expect(releasedAudioUrls).toEqual([]);
  });

  it('libera solo el audio del bloque cuyo texto ha cambiado', () => {
    const previous = scriptWith([
      { id: 'line_1', text: 'Uno', audioUrl: 'blob:uno' },
      { id: 'line_2', text: 'Dos', audioUrl: 'blob:dos' },
    ]);
    const next = scriptWith([
      { id: 'line_1', text: 'Uno' },
      { id: 'line_2', text: 'Dos corregido' },
    ]);

    const { script, releasedAudioUrls } = mergeGeneratedAudio(previous, next);
    expect(script.chapters[0].lines[0].audioUrl).toBe('blob:uno');
    expect(script.chapters[0].lines[1].audioUrl).toBeUndefined();
    expect(releasedAudioUrls).toEqual(['blob:dos']);
  });
});

describe('cleanSpokenText', () => {
  it('quita el rango de tiempo entre comillas invertidas que rompe al modelo', () => {
    expect(cleanSpokenText('`02:45.1 \u2192 02:50.7` Sumar lo que se produce.')).toBe('Sumar lo que se produce.');
  });

  it('quita el énfasis y la marca inicial, y respeta el texto limpio', () => {
    expect(cleanSpokenText('_Produccion y gasto._')).toBe('Produccion y gasto.');
    expect(cleanSpokenText('[03:23] Sumar lo que se gasta.')).toBe('Sumar lo que se gasta.');
    expect(cleanSpokenText('Tu gasto es el ingreso de otro.')).toBe('Tu gasto es el ingreso de otro.');
  });
});

describe('parseVideoScript con guion Markdown cronometrado', () => {
  const guion = [
    '# El PIB, explicado desde cero',
    '',
    'Cada linea es un subtitulo: el tiempo es cuando entra y sale de pantalla.',
    '',
    '---',
    '',
    '## PARTE 1 - Que mide el PIB',
    '',
    'Duracion: 00:40.0 - 3 lineas - 2 escenas',
    '',
    '### 00:00.0 - Portada',
    '_El titulo aparece y una linea roja se dibuja bajo el._',
    '',
    '`00:00.7 -> 00:05.1`  Un pais produce millones de cosas.',
    '',
    '`00:05.1 -> 00:10.4`  Vamos a resumirlas en un solo numero.',
    '',
    '### 00:10.0 - Pregunta',
    '_Fotos de bienes y etiquetas de servicios se acumulan._',
    '',
    '`00:10.4 -> 00:15.6`  Coches, pan, cortes de pelo.',
    '',
    '## PARTE 2 - Nominal y real',
    '',
    'Duracion: 00:30.0 - 1 lineas - 1 escenas',
    '',
    '### 00:00.0 - Portada2',
    '_Las mismas barras, con una brecha mayor._',
    '',
    '`00:02.0 -> 00:08.5`  En 2023 la brecha fue mucho mayor.',
  ].join('\n');

  it('locuta solo las líneas con timecode, nunca las indicaciones de escena', () => {
    const script = parseVideoScript(guion);
    const textos = script.chapters.flatMap((chapter) => chapter.lines).map((line) => line.text);
    expect(script.sourceFormat).toBe('timed-markdown');
    expect(textos).toEqual([
      'Un pais produce millones de cosas.',
      'Vamos a resumirlas en un solo numero.',
      'Coches, pan, cortes de pelo.',
      'En 2023 la brecha fue mucho mayor.',
    ]);
  });

  it('encadena las partes sumando su duración declarada', () => {
    const script = parseVideoScript(guion);
    const ultima = script.chapters.flatMap((chapter) => chapter.lines).at(-1)!;
    // La parte 2 empieza en 00:40.0, así que 00:02.0 local son 42 s globales.
    expect(ultima.startSec).toBeCloseTo(42, 3);
    expect(ultima.endSec).toBeCloseTo(48.5, 3);
    expect(script.totalDurationSec).toBeCloseTo(70, 3);
  });

  it('usa la duración real de cada subtítulo, no una estimación por palabras', () => {
    const script = parseVideoScript(guion);
    const primera = script.chapters[0].lines[0];
    expect(primera.targetDurationSec).toBeCloseTo(4.4, 3);
    expect(primera.sourceTimecode).toBe('00:00.7\u201300:05.1');
  });
});
