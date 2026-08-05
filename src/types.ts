export type VoiceName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export type AccentOption = 'spain' | 'latam' | 'argentina' | 'neutral';

export interface VoiceOption {
  id: VoiceName;
  name: string;
  gender: 'Femenino' | 'Masculino';
  description: string;
  avatarColor: string;
  sampleText?: string;
}

export type ToneEmotion =
  | 'natural'
  | 'cheerful'
  | 'calm'
  | 'dramatic'
  | 'news anchor'
  | 'storyteller'
  | 'whispering'
  | 'fast'
  | 'slow';

export interface SpeakerConfig {
  name: string;
  voiceName: VoiceName;
}

export interface GeneratedAudioItem {
  id: string;
  text: string;
  voice: VoiceName;
  emotion: ToneEmotion;
  accent?: AccentOption;
  targetDurationSeconds?: number | null;
  speedFactor?: number;
  isMultiSpeaker: boolean;
  speakers?: SpeakerConfig[];
  audioUrl: string;
  durationSeconds: number;
  createdAt: string;
}

export interface ScriptLine {
  id: string;
  startSec: number;
  endSec: number;
  targetDurationSec: number;
  text: string;
  audioUrl?: string;
  speedFactor?: number;
  actualDurationSec?: number;
  isGenerating?: boolean;
  error?: string;
}

export interface ScriptChapter {
  id: string;
  title: string;
  timeRange: string;
  lines: ScriptLine[];
  audioUrl?: string;
  isGenerating?: boolean;
  error?: string;
}

export interface ParsedScript {
  title: string;
  voiceInfo: string;
  totalDurationSec: number;
  chapters: ScriptChapter[];
}

export interface SampleTemplate {
  id: string;
  title: string;
  icon: string;
  category: string;
  text: string;
  voice: VoiceName;
  emotion: ToneEmotion;
  accent?: AccentOption;
  targetDurationSeconds?: number;
  isMultiSpeaker?: boolean;
  speakers?: SpeakerConfig[];
  isScriptMode?: boolean;
  scriptContent?: string;
}
