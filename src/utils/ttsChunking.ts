export const DEFAULT_STABLE_TTS_CHUNK_CHARS = 1_000;

function findLastBoundary(text: string, pattern: RegExp, minimumIndex: number, maximumIndex: number): number {
  let boundary = -1;
  for (const match of text.matchAll(pattern)) {
    const candidate = match.index + match[0].length;
    if (candidate >= minimumIndex && candidate <= maximumIndex) boundary = candidate;
  }
  return boundary;
}

/**
 * Splits long narration at natural language boundaries. Keeping each model
 * request relatively short prevents long-form TTS voices from drifting near
 * the end while the caller can still concatenate one continuous audio file.
 */
export function splitTextForStableTts(
  input: string,
  maximumCharacters = DEFAULT_STABLE_TTS_CHUNK_CHARS
): string[] {
  const text = input.trim();
  if (!text) return [];
  if (maximumCharacters < 200) throw new Error('El tamaño mínimo de fragmento es de 200 caracteres.');
  if (text.length <= maximumCharacters) return [text];

  const chunks: string[] = [];
  let remaining = text;
  const minimumBoundary = Math.floor(maximumCharacters * 0.55);

  while (remaining.length > maximumCharacters) {
    const prefix = remaining.slice(0, maximumCharacters + 1);
    const boundaryPatterns = [
      /\n\s*\n/g,
      /[.!?…]+(?:["'»”)]*)\s+/g,
      /[;:]\s+/g,
      /,\s+/g,
      /\s+/g,
    ];

    let boundary = -1;
    for (const pattern of boundaryPatterns) {
      boundary = findLastBoundary(prefix, pattern, minimumBoundary, maximumCharacters);
      if (boundary >= 0) break;
    }
    if (boundary < 0) boundary = maximumCharacters;

    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trimStart();
  }

  if (remaining) chunks.push(remaining.trim());

  // Avoid a very short final request when it can safely be folded into the
  // preceding fragment without making that fragment long enough to drift.
  if (chunks.length > 1) {
    const tail = chunks[chunks.length - 1];
    const previous = chunks[chunks.length - 2];
    const mergeLimit = Math.round(maximumCharacters * 1.15);
    if (tail.length < maximumCharacters * 0.2 && previous.length + tail.length + 1 <= mergeLimit) {
      chunks.splice(chunks.length - 2, 2, `${previous} ${tail}`);
    }
  }

  return chunks.filter(Boolean);
}
