import { VoiceOption, SampleTemplate } from './types';
import { DEFAULT_NUVIA_SCRIPT } from './utils/scriptParser';

export const VOICE_OPTIONS: VoiceOption[] = [
  {
    id: 'Kore',
    name: 'Kore',
    gender: 'Femenino',
    description: 'Voz cálida, equilibrada e ideal para narraciones y asistencia.',
    avatarColor: 'from-amber-500 to-rose-500',
    sampleText: 'Hola, soy Kore. Mi voz es cálida, natural y fluida para tus locuciones en castellano.',
  },
  {
    id: 'Puck',
    name: 'Puck',
    gender: 'Masculino',
    description: 'Voz dinámica, entusiasta y clara. Perfecta para presentaciones.',
    avatarColor: 'from-blue-500 to-indigo-500',
    sampleText: 'Hola, soy Puck. Mi voz es dinámica, clara y entusiasta, ideal para vídeos y presentaciones.',
  },
  {
    id: 'Charon',
    name: 'Charon',
    gender: 'Masculino',
    description: 'Voz profunda, autoritaria e imponente. Ideal para boletines.',
    avatarColor: 'from-slate-600 to-slate-900',
    sampleText: 'Hola, soy Charon. Mi voz es profunda y autoritaria, perfecta para informes y boletines.',
  },
  {
    id: 'Fenrir',
    name: 'Fenrir',
    gender: 'Masculino',
    description: 'Voz grave, dramática y envolvente. Excelente para historias.',
    avatarColor: 'from-emerald-600 to-teal-800',
    sampleText: 'Hola, soy Fenrir. Mi voz es grave, dramática y envolvente, excelente para relatos e historias.',
  },
  {
    id: 'Zephyr',
    name: 'Zephyr',
    gender: 'Femenino',
    description: 'Voz suave, pausada y relajante. Perfecta para meditación.',
    avatarColor: 'from-violet-500 to-purple-600',
    sampleText: 'Hola, soy Zephyr. Mi voz es suave y pausada, perfecta para contenido relajante y meditación.',
  },
];

export const TONE_EMOTIONS = [
  { id: 'natural', label: 'Natural / Neutro', desc: 'Entonación fluida y estándar' },
  { id: 'cheerful', label: 'Alegre y Entusiasta', desc: 'Tono positivo y enérgico' },
  { id: 'calm', label: 'Calmado y Sereno', desc: 'Ritmo pausado e intencional' },
  { id: 'dramatic', label: 'Dramático', desc: 'Énfasis en los matices emotivos' },
  { id: 'news anchor', label: 'Noticiero / Profesional', desc: 'Locución formal e informativa' },
  { id: 'storyteller', label: 'Cuentacuentos', desc: 'Locución narrativa envolvente' },
  { id: 'whispering', label: 'Susurro Intimista', desc: 'Tono suave y cercano' },
];

export const ACCENT_OPTIONS = [
  {
    id: 'spain',
    label: 'Castellano (España)',
    flag: '🇪🇸',
    desc: 'Pronunciación y acento castellano (España) garantizado en todas las locuciones.',
  },
];

export const SAMPLE_TEMPLATES: SampleTemplate[] = [
  {
    id: 'video_script_nuvia',
    title: '🎬 Vídeo: Dónde Crece el Dinero (03:00)',
    icon: 'Video',
    category: 'Guión de Vídeo (Marcas de Tiempo)',
    isScriptMode: true,
    text: 'Guión con locución completa de 3:00 minutos sincronizada con 59 frases y marcas de tiempo exactas para YouTube/Vimeo.',
    scriptContent: DEFAULT_NUVIA_SCRIPT,
    voice: 'Kore',
    emotion: 'natural',
    accent: 'spain',
  },
  {
    id: 'news',
    title: 'Locución Noticiosa',
    icon: 'Radio',
    category: 'Informativo',
    text: 'Muy buenas tardes. Les saluda Carlos Mendoza con el boletín meteorológico de hoy. Se esperan cielos despejados con temperaturas máximas de veinticinco grados durante la tarde. Recomendamos llevar protección solar.',
    voice: 'Charon',
    emotion: 'news anchor',
  },
  {
    id: 'story',
    title: 'Cuento Fantástico',
    icon: 'Sparkles',
    category: 'Narración',
    text: 'En el corazón del antiguo bosque encantado, donde los árboles conversaban con el viento, una pequeña luz dorada comenzó a titilar entre las sombras de la noche misteriosa...',
    voice: 'Fenrir',
    emotion: 'storyteller',
  },
  {
    id: 'dialogue',
    title: 'Diálogo entre 2 Voces',
    icon: 'Users',
    category: 'Podcast / Diálogo',
    isMultiSpeaker: true,
    text: `Carlos: Hola María, ¿tienes un minuto para revisar el informe de ventas?
María: ¡Hola Carlos! Por supuesto, lo estuve leyendo esta mañana y los resultados de este trimestre son excelentes.`,
    voice: 'Kore',
    emotion: 'cheerful',
    speakers: [
      { name: 'Carlos', voiceName: 'Puck' },
      { name: 'María', voiceName: 'Kore' },
    ],
  },
  {
    id: 'meditation',
    title: 'Meditación Guiada',
    icon: 'Music',
    category: 'Bienestar',
    text: 'Cierra suavemente los ojos. Inhala profundamente por la nariz, sostén el aire durante cuatro segundos... y exhala liberando toda la tensión acumulada en tus hombros.',
    voice: 'Zephyr',
    emotion: 'calm',
  },
  {
    id: 'promo',
    title: 'Anuncio Publicitario',
    icon: 'FileText',
    category: 'Comercial',
    text: '¡Descubre la nueva forma de crear contenido sin límites! Con nuestra tecnología de vanguardia, tus ideas se transforman al instante en experiencias inolvidables. ¡Pruébalo hoy!',
    voice: 'Puck',
    emotion: 'cheerful',
  },
];
