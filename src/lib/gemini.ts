import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSettings } from './store';
import type { StoryLanguage } from './storyStore';

const MODEL_NAME = 'gemini-2.0-flash';

export interface VocabItem {
  word: string;    // 영어 단어
  meaning: string; // 한글 뜻
}

export interface GeneratedScene {
  text: string;
  imagePrompt: string;
  vocabulary?: VocabItem[]; // 영어 스토리북: 중학생에게 어려운 단어
  translation?: string;     // 영어 스토리북: 한글 번역 (한줄해석용)
}

export const generateStoryContent = async (topic: string, language: StoryLanguage = 'ko'): Promise<GeneratedScene[]> => {
  const { geminiApiKey, useGeminiTTS } = getSettings();

  if (!geminiApiKey) {
    throw new Error('Gemini API Key가 설정되지 않았습니다. 설정 페이지에서 먼저 키를 등록해주세요.');
  }

  const genAI = new GoogleGenerativeAI(geminiApiKey);

  console.log(`[Story] Using model: ${MODEL_NAME}, Language: ${language}`);

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
  }, {
    apiVersion: 'v1beta',
    // @ts-ignore
    dangerouslyAllowBrowser: true,
  });

  let prompt: string;

  if (language === 'en') {
    // ═══ 영어 스토리북 ═══
    const toneInstruction = useGeminiTTS
      ? "Style: Write like a warm, expressive children's storybook narrator. Use vivid imagery, playful language, and gentle emotions."
      : "Style: Write in a calm, clear, and descriptive tone suitable for children.";

    prompt = `
      Topic: "${topic}"
      
      Create a short English storybook based on the topic above.
      Even if the topic is in Korean, you MUST write the story entirely in English.
      Compose 3 to 5 scenes.
      Each scene MUST have exactly 2 sentences. No more, no less.
      
      ${toneInstruction}
      
      For each scene, also include:
      1. "vocabulary": 2~4 English words appropriate for Korean middle school students (ages 13-15) to learn, with Korean meanings.
      2. "translation": A natural Korean translation of the English text (for line-by-line study).
      
      Output ONLY raw JSON (no markdown code blocks).
      Format:
      [
        {
          "text": "Scene narration text in English",
          "imagePrompt": "Detailed English image prompt for illustrating this scene",
          "vocabulary": [
            { "word": "whimsical", "meaning": "기발한, 엉뚱한" },
            { "word": "resilient", "meaning": "회복력 있는" }
          ],
          "translation": "이 장면의 한글 번역"
        },
        ...
      ]
    `;
  } else {
    // ═══ 한글 스토리북 ═══
    const toneInstruction = useGeminiTTS
      ? "스타일: 아이들에게 읽어주는 동화책처럼 매우 감정적이고, 따뜻하며, 입체적인 표현을 사용해. 생동감 넘치는 의성어와 의태어를 적절히 섞어서 작성해줘."
      : "스타일: 차분하고 명확한 설명조로 작성해줘.";

    prompt = `
      주제: "${topic}"
      
      위 주제로 짧은 스토리북을 만들어줘.
      총 3~5개의 장면(Scene)으로 구성해줘.
      
      ${toneInstruction}
      
      결과는 반드시 JSON 형식으로만 출력해. (Markdown 코드 블록 없이 순수 JSON만)
      형식:
      [
        {
          "text": "장면 1의 나레이션 텍스트 (한글)",
          "imagePrompt": "장면 1을 그리기 위한 영어 이미지 프롬프트 (상세하게)"
        },
        ...
      ]
    `;
  }

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log('[Story] Gemini Raw Response:', text);

    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');

    if (firstBracket === -1 || lastBracket === -1) {
      throw new Error('JSON 형식을 찾을 수 없습니다.');
    }

    const jsonString = text.substring(firstBracket, lastBracket + 1);
    return JSON.parse(jsonString) as GeneratedScene[];
  } catch (error) {
    throw new Error(`스토리 생성 실패: ${(error as Error).message}`);
  }
};

// ═══════════════════════════════════════════════════════════
// 📓 영어일기 변환 (Korean → English Diary)
// ═══════════════════════════════════════════════════════════

export interface DiaryGenerationResult {
  sentences: { english: string; korean: string }[];
  vocabulary: { word: string; meaning: string; type: 'word' | 'phrase' | 'idiom' }[];
}

export const generateEnglishDiary = async (koreanText: string): Promise<DiaryGenerationResult> => {
  const { geminiApiKey } = getSettings();
  if (!geminiApiKey) throw new Error('Gemini API Key가 설정되지 않았습니다.');

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
  }, {
    apiVersion: 'v1beta',
    // @ts-ignore
    dangerouslyAllowBrowser: true,
  });

  const prompt = `
You are an expert English teacher helping Korean students write English diaries.

The user wrote this diary entry in Korean:
"""
${koreanText}
"""

Your tasks:
1. **Convert** the Korean text into natural, fluent English diary sentences.
   - Keep the meaning faithful to the original
   - Use natural English expressions, phrasal verbs, and idioms where appropriate
   - Maximum 30 sentences. If the input is long, summarize into 30 or fewer sentences.
   - Each sentence should be a complete thought

2. **Extract vocabulary**: Find ALL meaningful English words, phrasal verbs, and idioms from the English diary.
   - Skip only the most basic words: a, an, the, I, is, am, are, was, were, be, to, of, in, on, at, it, my, and, or, but, so, do, did, not, no, this, that, for, with, as, by, up
   - Include ALL other words with Korean meanings
   - Include phrasal verbs (e.g., "wake up", "look forward to")
   - Include idioms and expressions (e.g., "on cloud nine", "a piece of cake")
   - Classify each as "word", "phrase", or "idiom"

Output ONLY raw JSON (no markdown code blocks):
{
  "sentences": [
    { "english": "I woke up early this morning.", "korean": "나는 오늘 아침 일찍 일어났다." },
    ...
  ],
  "vocabulary": [
    { "word": "woke up", "meaning": "일어나다, 잠에서 깨다", "type": "phrase" },
    { "word": "early", "meaning": "일찍, 이른", "type": "word" },
    { "word": "morning", "meaning": "아침", "type": "word" },
    ...
  ]
}
`;

  try {
    console.log('[Diary] 📓 영어일기 생성 중...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log('[Diary] Gemini Raw Response:', text.substring(0, 300));

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('JSON 형식을 찾을 수 없습니다.');
    }

    const jsonString = text.substring(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonString) as DiaryGenerationResult;

    // 30문장 제한
    if (parsed.sentences.length > 30) {
      parsed.sentences = parsed.sentences.slice(0, 30);
    }

    console.log(`[Diary] ✅ 완료: ${parsed.sentences.length}문장, ${parsed.vocabulary.length}단어`);
    return parsed;
  } catch (error) {
    throw new Error(`영어일기 생성 실패: ${(error as Error).message}`);
  }
};

// ═══════════════════════════════════════════════════════════
// 🎭 캐릭터 시트 생성 (Character Sheet Anchoring)
// ═══════════════════════════════════════════════════════════
//
// 스토리 생성 후, 등장 캐릭터의 외형/스타일을 상세하게 정의합니다.
// 이 가이드를 모든 이미지 프롬프트 앞에 붙이면
// 장면이 바뀌어도 캐릭터 외형이 일관되게 유지됩니다.
// ═══════════════════════════════════════════════════════════

export const generateCharacterGuide = async (
  scenes: { text: string; imagePrompt: string }[],
  _language: StoryLanguage = 'ko'
): Promise<string> => {
  const { geminiApiKey } = getSettings();
  if (!geminiApiKey) throw new Error('API Key is missing');

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
  }, {
    apiVersion: 'v1beta',
    // @ts-ignore
    dangerouslyAllowBrowser: true,
  });

  const storyText = scenes.map((s, i) => `Scene ${i + 1}: ${s.text}`).join('\n');

  const prompt = `
You are a professional children's book illustrator creating a character design sheet.

Below is a story. Analyze ALL characters and the setting, then create a **Character & Art Style Guide** in English.

=== STORY ===
${storyText}
=== END ===

Create a concise guide following this EXACT structure. Be very specific about visual details.

**Art Style:** (e.g., "Soft watercolor children's book illustration with warm pastel tones, rounded shapes, gentle lighting")

**Characters:**
For EACH character, describe:
- Name/Role
- Species/Type (human child, animal, creature, etc.)
- Age appearance
- Hair: color, style, length
- Eyes: color, shape
- Skin/Fur: color, texture
- Outfit: specific clothing, colors, patterns
- Distinguishing features: accessories, markings, expressions
- Size/Build

**Setting Style:** (overall environment look, color palette, lighting mood)

RULES:
- Write ONLY in English
- Be extremely specific (e.g., "bright cherry-red round glasses" NOT just "glasses")
- Use specific color names (e.g., "warm honey-blonde" NOT just "blonde")
- Keep the total guide under 400 words
- Output plain text only (no markdown formatting, no code blocks)
`;

  try {
    console.log('[CharacterGuide] 🎭 캐릭터 가이드 생성 중...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const guide = response.text().trim();
    console.log('[CharacterGuide] ✅ 캐릭터 가이드 생성 완료:', guide.substring(0, 200) + '...');
    return guide;
  } catch (error) {
    console.warn('[CharacterGuide] ⚠️ 캐릭터 가이드 생성 실패:', error);
    return '';
  }
};

// ═══════════════════════════════════════════════════════════
// 📝 영어지문설명 (고등학생 모의고사 지문 분석)
// ═══════════════════════════════════════════════════════════

export interface PassageSegment {
  segment_id: number;
  segment_role: string;
  image_prompt: string;
  script_male_original: string;
  script_female_simplified: string;
  script_male_explanation: string;
  korean_translation: string; // PDF 한줄해석용
}

export const generatePassageAnalysis = async (passage: string): Promise<PassageSegment[]> => {
  const { geminiApiKey } = getSettings();
  if (!geminiApiKey) throw new Error('Gemini API Key가 설정되지 않았습니다.');

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
  }, {
    apiVersion: 'v1beta',
    // @ts-ignore
    dangerouslyAllowBrowser: true,
  });

  const prompt = `
You are an expert English teacher specializing in Korean university entrance exam (수능/모의고사) preparation.
Your goal is to analyze the given English passage and create a structured 5-step educational video script.

=== INPUT PASSAGE ===
${passage}
=== END PASSAGE ===

Task:
1. Divide the passage into exactly 5 logical segments (Introduction → Development 1 → Development 2 → Key Point/Turning Point → Conclusion/Summary).
2. ALL text content must be ENTIRELY in ENGLISH. Every script must be in English.
3. For each segment, create:
   - segment_role: Brief description of this segment's role
   - image_prompt: A detailed image generation prompt for an educational illustration (stylized, infographic elements, modern design)
   - script_male_original: The EXACT original passage sentences for this segment (read verbatim)
   - script_female_simplified: A VERY DETAILED and THOROUGH simplified English explanation. Break down EVERY idea in the original text step by step. Use simple vocabulary and short sentences. Explain abstract concepts with concrete examples or analogies. Paraphrase everything so a beginner can fully understand. Do NOT summarize — instead, EXPAND and ELABORATE on each point. Aim for at LEAST 2-3x the length of the original text. Speak as if you are a kind teacher patiently explaining to a student who is hearing this for the first time.
   - script_male_explanation: Key vocabulary (1-2 words) with English definitions AND important grammar points, all in English. Example: "'Resilient' means able to recover quickly. Notice the use of the passive voice here: 'was determined by...'"
   - korean_translation: Korean translation of the original sentences (한줄해석) for PDF export

4. Image prompts MUST include infographic elements (arrows, labels, icons, diagrams) for educational clarity.

Output ONLY raw JSON array (no markdown, no code blocks):
[
  {
    "segment_id": 1,
    "segment_role": "Introduction of the topic",
    "image_prompt": "A stylized educational illustration showing [topic]. Clean modern design with infographic elements: [specific visual elements]. Labels showing key concepts.",
    "script_male_original": "Original passage sentences...",
    "script_female_simplified": "Okay, let me break this down for you step by step. What the author is trying to say here is... Think of it like this: imagine you are... So basically, the main idea is that... And the reason this matters is because...",
    "script_male_explanation": "The key word here is 'X' which means... Also notice the grammar structure...",
    "korean_translation": "이 부분의 한글 해석..."
  },
  ...5 segments total
]
`;

  try {
    console.log('[ExamAnalysis] 📝 지문 분석 시작...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log('[ExamAnalysis] Gemini Raw:', text.substring(0, 300));

    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1) {
      throw new Error('JSON 형식을 찾을 수 없습니다.');
    }

    const jsonString = text.substring(firstBracket, lastBracket + 1);
    const segments = JSON.parse(jsonString) as PassageSegment[];
    console.log(`[ExamAnalysis] ✅ ${segments.length}개 세그먼트 분석 완료`);
    return segments;
  } catch (error) {
    throw new Error(`지문 분석 실패: ${(error as Error).message}`);
  }
};

// ─────────────────────────────────────────────────────────
// Raw PCM (L16) → WAV 변환 유틸리티
// Gemini TTS는 audio/L16;codec=pcm;rate=24000 형식으로 반환함
// 브라우저는 raw PCM을 재생할 수 없으므로 WAV 헤더를 추가해야 함
// ─────────────────────────────────────────────────────────
function pcmToWav(pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Blob {
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // file size - 8
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // sub-chunk size (16 for PCM)
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM 데이터 복사
  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(pcmData, headerSize);

  console.log(`[PCM→WAV] Converted ${dataSize} bytes PCM → ${buffer.byteLength} bytes WAV (${sampleRate}Hz, ${numChannels}ch, ${bitsPerSample}bit)`);
  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * MIME 타입에서 샘플레이트 파싱
 * 예: "audio/L16;codec=pcm;rate=24000" → 24000
 */
function parseSampleRate(mimeType: string): number {
  const rateMatch = mimeType.match(/rate=(\d+)/i);
  if (rateMatch) return parseInt(rateMatch[1], 10);
  return 24000; // 기본값
}

/**
 * Gemini Native Audio TTS
 * 
 * 지원 모델 (우선순위):
 *  1. gemini-2.5-flash-preview-tts  — Gemini TTS Flash (저지연, 실시간 대화에 유리)
 *  2. gemini-2.5-pro-preview-tts    — Gemini TTS Pro (풍부한 표현력, 오디오북/팟캐스트)
 *  3. gemini-2.0-flash-exp          — 레거시 폴백
 * 
 * ⚡ 핵심: raw PCM L16 → WAV 변환 포함
 */
export const generateAudio = async (text: string, voiceName: string = 'Aoede', language: StoryLanguage = 'ko'): Promise<Blob> => {
  const { geminiApiKey } = getSettings();
  if (!geminiApiKey) throw new Error("Gemini API Key is missing");

  // 오디오 출력을 지원하는 전용 TTS 모델들 (순서대로 시도)
  const TTS_MODELS = [
    'gemini-2.5-flash-preview-tts',   // 🔥 Gemini TTS Flash (Tier 1 지원)
    'gemini-2.5-pro-preview-tts',     // 🎙️ Gemini TTS Pro (고품질)
    'gemini-2.0-flash-exp',           // 레거시 폴백
  ];

  // 언어별 프롬프트
  const ttsPrompt = language === 'en'
    ? `Read the following text naturally and expressively: "${text}"`
    : `다음 텍스트를 자연스럽고 감정을 담아 읽어주세요: "${text}"`;

  for (const model of TTS_MODELS) {
    try {
      console.log(`[Gemini Audio] Trying model: ${model}, Voice: ${voiceName}, Lang: ${language}`);

      const url = `/api/gemini/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

      const requestBody = {
        contents: [{
          parts: [{ text: ttsPrompt }]
        }],
        generationConfig: {
          response_modalities: ["AUDIO"],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: voiceName
              }
            }
          }
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[Gemini Audio] ${model} failed (${response.status}):`, errText.substring(0, 150));
        continue; // 다음 모델 시도
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audioPart = candidate?.content?.parts?.find((p: any) => p.inline_data || p.inlineData);
      const inlineData = audioPart?.inline_data || audioPart?.inlineData;

      if (inlineData && inlineData.data) {
        const base64Audio = inlineData.data;
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const mimeType = inlineData.mime_type || inlineData.mimeType || 'audio/wav';
        console.log(`[Gemini Audio] ✅ Raw data from ${model}! Size: ${bytes.length}, Type: ${mimeType}`);

        // ⚡ 핵심: L16/PCM → WAV 변환
        if (mimeType.toLowerCase().includes('l16') || mimeType.toLowerCase().includes('pcm')) {
          const sampleRate = parseSampleRate(mimeType);
          console.log(`[Gemini Audio] 🔄 Raw PCM 감지 → WAV 변환 (sampleRate=${sampleRate})`);
          const wavBlob = pcmToWav(bytes, sampleRate, 1, 16);
          console.log(`[Gemini Audio] ✅ WAV 변환 완료! Size: ${wavBlob.size}, Type: ${wavBlob.type}`);
          return wavBlob;
        }

        // 이미 WAV/MP3 등 표준 포맷이면 그대로 반환
        return new Blob([bytes], { type: mimeType });
      }

      console.warn(`[Gemini Audio] ${model}: No audio data in response`);
    } catch (error) {
      console.warn(`[Gemini Audio] ${model} error:`, error);
    }
  }

  throw new Error("모든 Gemini TTS 모델에서 오디오 생성에 실패했습니다.");
};

// ═══════════════════════════════════════════════════════════
// 🎨 나노 바나나 (Nano Banana) 이미지 생성
// ═══════════════════════════════════════════════════════════
//
// 전략 순서 (Tier 1 API Key 기준):
//  1) gemini-2.5-flash-image       — 나노 바나나 (빠른 속도, 효율적)
//  2) gemini-3-pro-image-preview   — 나노 바나나 프로 (4K, 정교한 텍스트)
//  3) gemini-2.0-flash-exp         — 레거시 이미지 생성
//  4) Pollinations.ai              — 무료 폴백 (API 키 불필요)
// ═══════════════════════════════════════════════════════════

export const generateSceneImage = async (imagePrompt: string, characterGuide?: string): Promise<string> => {
  const { geminiApiKey } = getSettings();
  if (!geminiApiKey) throw new Error("Gemini API Key is missing");

  // 캐릭터 가이드가 있으면 이미지 프롬프트 앞에 붙여서 일관성 유지
  const characterAnchor = characterGuide
    ? `[CHARACTER & STYLE REFERENCE - Follow these descriptions EXACTLY for visual consistency across all scenes]\n${characterGuide}\n\n[SCENE TO ILLUSTRATE]\n`
    : 'Style: warm, colorful, whimsical, digital painting. ';

  const prompt = `Generate a beautiful children's storybook illustration. No text or words in the image.\n\n${characterAnchor}Scene: ${imagePrompt}`;

  // ── 🔥 Strategy 1: 나노 바나나 모델들 (REST API) ──
  // gemini-2.5-flash-image (빠름) → gemini-3-pro-image-preview (고품질)
  const nanoBananaModels = [
    { model: 'gemini-2.5-flash-image', apiVer: 'v1beta', label: '🍌 나노 바나나 (Flash)' },
    { model: 'gemini-2.5-flash-image', apiVer: 'v1alpha', label: '🍌 나노 바나나 (Flash, v1alpha)' },
    { model: 'gemini-3-pro-image-preview', apiVer: 'v1beta', label: '🍌 나노 바나나 Pro' },
    { model: 'gemini-3-pro-image-preview', apiVer: 'v1alpha', label: '🍌 나노 바나나 Pro (v1alpha)' },
  ];

  for (const { model, apiVer, label } of nanoBananaModels) {
    try {
      console.log(`[Image] 🎨 ${label} 시도: ${model} (${apiVer})`);

      const url = `/api/gemini/${apiVer}/models/${model}:generateContent?key=${geminiApiKey}`;

      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_modalities: ["IMAGE", "TEXT"],
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[Image] ${label} 실패 (${response.status}):`, errText.substring(0, 200));
        continue;
      }

      const data = await response.json();
      const result = extractImageFromResponse(data);
      if (result) {
        console.log(`[Image] ✅ ${label} 성공!`);
        return result;
      }
      console.warn(`[Image] ${label}: 응답에 이미지 없음`);
    } catch (error) {
      console.warn(`[Image] ${label} 에러:`, error);
    }
  }

  // ── Strategy 2: SDK 기반 나노 바나나 시도 ──
  const sdkModels = ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview', 'gemini-2.0-flash-exp'];
  for (const sdkModel of sdkModels) {
    try {
      console.log(`[Image] 🎨 SDK 시도: ${sdkModel}`);
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: sdkModel,
        // @ts-ignore — responseModalities는 SDK 타입에 아직 없을 수 있음
        generationConfig: { responseModalities: ['Image', 'Text'] },
      }, {
        apiVersion: 'v1beta',
        // @ts-ignore
        dangerouslyAllowBrowser: true,
      });

      const result = await model.generateContent(prompt);
      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        // @ts-ignore — inlineData 타입이 SDK에서 다를 수 있음
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData?.data && (inlineData?.mimeType?.startsWith('image') || inlineData?.mime_type?.startsWith('image'))) {
          const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
          console.log(`[Image] ✅ SDK 성공 (${sdkModel})!`);
          return `data:${mimeType};base64,${inlineData.data}`;
        }
      }
      console.warn(`[Image] SDK (${sdkModel}): 응답에 이미지 없음`);
    } catch (error) {
      console.warn(`[Image] SDK (${sdkModel}) 에러:`, error);
    }
  }

  // ── Strategy 3: 레거시 REST API 폴백 ──
  const legacyAttempts = [
    { model: 'gemini-2.0-flash-exp', apiVer: 'v1beta' },
    { model: 'gemini-2.0-flash-exp', apiVer: 'v1alpha' },
    { model: 'gemini-2.0-flash-preview-image-generation', apiVer: 'v1beta' },
  ];

  for (const { model, apiVer } of legacyAttempts) {
    try {
      console.log(`[Image] 🎨 레거시 REST 시도: ${model} (${apiVer})`);

      const url = `/api/gemini/${apiVer}/models/${model}:generateContent?key=${geminiApiKey}`;

      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_modalities: ["IMAGE", "TEXT"],
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[Image] ${model}(${apiVer}) 실패 (${response.status}):`, errText.substring(0, 150));
        continue;
      }

      const data = await response.json();
      const result = extractImageFromResponse(data);
      if (result) {
        console.log(`[Image] ✅ ${model}(${apiVer}) 성공!`);
        return result;
      }
      console.warn(`[Image] ${model}(${apiVer}): 응답에 이미지 없음`);
    } catch (error) {
      console.warn(`[Image] ${model} 에러:`, error);
    }
  }

  // ── Strategy 4: Imagen API ──
  const imagenModels = ['imagen-3.0-generate-001', 'imagen-3.0-generate-002', 'imagen-3.0-fast-generate-001'];
  for (const imagenModel of imagenModels) {
    try {
      console.log(`[Image] 🎨 Imagen 시도: ${imagenModel}`);

      const url = `/api/gemini/v1beta/models/${imagenModel}:predict?key=${geminiApiKey}`;
      const requestBody = {
        instances: [{ prompt: `children's storybook illustration: ${imagePrompt}` }],
        parameters: { sampleCount: 1, aspectRatio: "16:9" }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) continue;

      const data = await response.json();
      const predictions = data.predictions || [];
      if (predictions[0]?.bytesBase64Encoded) {
        console.log(`[Image] ✅ ${imagenModel} 성공!`);
        return `data:image/png;base64,${predictions[0].bytesBase64Encoded}`;
      }
    } catch {
      // 다음 시도
    }
  }

  // ── Strategy 5: Pollinations.ai (무료, API 키 불필요, CORS 허용) ──
  try {
    console.log(`[Image] 🎨 Pollinations.ai 폴백 시도...`);
    const pollinationsPrompt = encodeURIComponent(
      `children's storybook illustration, warm colors, whimsical, digital painting, no text: ${imagePrompt}`
    );
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${pollinationsPrompt}?width=1280&height=720&nologo=true&seed=${Date.now()}`;

    const response = await fetch(pollinationsUrl);
    if (response.ok) {
      const blob = await response.blob();
      if (blob.size > 1000 && blob.type.startsWith('image')) {
        console.log(`[Image] ✅ Pollinations.ai 성공! Size: ${blob.size} bytes`);
        // Blob → data URL
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    }
    console.warn(`[Image] Pollinations.ai 실패:`, response.status);
  } catch (error) {
    console.warn(`[Image] Pollinations.ai 에러:`, error);
  }

  throw new Error("이미지 생성 실패: 모든 방법을 시도했습니다. Gemini API 키가 이미지 생성을 지원하는지 확인하세요.");
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractImageFromResponse(data: any): string | null {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inlineData = part.inline_data || part.inlineData;
    if (inlineData?.data) {
      const mimeType = inlineData.mime_type || inlineData.mimeType || 'image/png';
      if (mimeType.startsWith('image')) {
        return `data:${mimeType};base64,${inlineData.data}`;
      }
    }
  }
  return null;
}
