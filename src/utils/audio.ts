/**
 * Converts Base64 audio returned by Gemini TTS into a playable WAV Blob URL.
 * If targetDurationSeconds is specified (> 0), resamples/time-stretches the 16-bit PCM buffer to fit exact target duration!
 */
export function base64ToWavBlob(
  base64Audio: string,
  mimeType: string = 'audio/pcm;rate=24000',
  targetDurationSeconds?: number | null
): { blobUrl: string; duration: number; originalDuration: number; speedFactor: number } {
  const binaryString = atob(base64Audio);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Sample rate & parameters
  const sampleRate = mimeType.includes('rate=') ? parseInt(mimeType.split('rate=')[1]) || 24000 : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;

  // Calculate raw PCM duration from Gemini
  const origDurationSeconds = (len / (bitsPerSample / 8)) / sampleRate;

  let finalPcmBytes = bytes;
  let finalDurationSeconds = origDurationSeconds;
  let speedFactor = 1.0;

  // If target duration is explicitly requested (> 0.5s)
  if (targetDurationSeconds && targetDurationSeconds >= 0.5) {
    const origSamples = Math.floor(len / 2);
    const targetSamples = Math.round(targetDurationSeconds * sampleRate);

    if (origSamples > 0 && targetSamples > 0 && Math.abs(origDurationSeconds - targetDurationSeconds) >= 0.05) {
      const pcmView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const resampledBytes = new Uint8Array(targetSamples * 2);
      const resampledView = new DataView(resampledBytes.buffer);

      const ratio = origSamples / targetSamples;
      speedFactor = origDurationSeconds / targetDurationSeconds; // e.g. 12s orig / 10s target = 1.2x speed

      for (let i = 0; i < targetSamples; i++) {
        const origPos = i * ratio;
        const indexFloor = Math.floor(origPos);
        const indexCeil = Math.min(origSamples - 1, indexFloor + 1);
        const fraction = origPos - indexFloor;

        const sampleFloor = pcmView.getInt16(indexFloor * 2, true);
        const sampleCeil = pcmView.getInt16(indexCeil * 2, true);

        const interpolated = Math.round(sampleFloor + fraction * (sampleCeil - sampleFloor));
        const clamped = Math.max(-32768, Math.min(32767, interpolated));
        resampledView.setInt16(i * 2, clamped, true);
      }

      finalPcmBytes = resampledBytes;
      finalDurationSeconds = targetDurationSeconds;
    }
  }

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
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true); // ByteRate
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
    blobUrl,
    duration: Math.round(finalDurationSeconds * 10) / 10,
    originalDuration: Math.round(origDurationSeconds * 10) / 10,
    speedFactor: Math.round(speedFactor * 100) / 100,
  };
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
