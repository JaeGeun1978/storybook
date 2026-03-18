import type { Word, Sentence, DirectReadSentence } from '../types/words';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// =========================================
// PCM → WAV 변환 (브라우저 재생 호환)
// =========================================
function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function pcmToWav(
  pcmData: Uint8Array,
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Blob {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

// =========================================
// Gemini TTS (음성 생성)
// =========================================
export async function generateSpeechAudio(
  apiKey: string,
  text: string,
  voiceName: string = 'Kore',
  model: string = 'gemini-2.5-flash-preview-tts'
): Promise<Blob> {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voiceName,
          },
        },
      },
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Gemini TTS Error (${response.status}): ${error.error?.message || response.statusText}`
    );
  }

  const result = await response.json();
  const audioPart = result.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData
  );

  if (!audioPart?.inlineData?.data) {
    throw new Error('Gemini TTS: 음성 데이터가 비어있습니다.');
  }

  const { data, mimeType } = audioPart.inlineData;
  const byteChars = atob(data);
  const byteArr = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteArr[i] = byteChars.charCodeAt(i);
  }

  // raw PCM(L16) 이면 WAV 헤더를 붙여서 브라우저가 재생할 수 있게 변환
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('l16') || mime.includes('pcm') || mime.includes('raw') || !mime.includes('wav')) {
    // mimeType에서 sample rate 추출 시도 (예: "audio/L16;rate=24000")
    const rateMatch = mime.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;
    return pcmToWav(byteArr, sampleRate);
  }

  return new Blob([byteArr], { type: mimeType });
}

// Gemini 모델 목록
export const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

/**
 * Gemini API 호출
 */
async function callGemini(
  apiKey: string,
  prompt: string,
  model: string = 'gemini-2.0-flash',
  jsonMode: boolean = true
): Promise<string> {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  if (jsonMode) {
    body.generationConfig = {
      responseMimeType: 'application/json',
      temperature: 0.8,
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Gemini API Error: ${error.error?.message || response.statusText}`
    );
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini API: 응답이 비어있습니다.');
  }

  return text;
}

/**
 * 영문 텍스트를 문장 단위로 분리하고 한글 번역 추가
 */
export async function splitAndTranslate(
  apiKey: string,
  englishText: string,
  sourceName: string,
  model: string = 'gemini-2.0-flash'
): Promise<Sentence[]> {
  const prompt = `다음 영어 지문을 한 문장씩 나누고, 각 문장에 대해 자연스러운 한글 해석을 붙여주세요.

[영어 지문]
${englishText}

[출처] ${sourceName}

다음 JSON 형식으로 응답해주세요:
{
  "sentences": [
    {
      "sentence_en": "영어 문장 1",
      "sentence_kr": "한글 해석 1"
    },
    {
      "sentence_en": "영어 문장 2",
      "sentence_kr": "한글 해석 2"
    }
  ]
}

주의사항:
1. 문장을 정확히 하나씩 나누세요 (마침표/물음표/느낌표 기준)
2. 원문을 변형하지 마세요
3. 한글 해석은 자연스럽고 정확하게 해주세요
4. 반드시 JSON 형식으로만 응답하세요`;

  const responseText = await callGemini(apiKey, prompt, model);
  const data = JSON.parse(responseText);

  const sentences: Sentence[] = (data.sentences || []).map(
    (s: { sentence_en: string; sentence_kr: string }) => ({
      source: sourceName,
      sentence_en: s.sentence_en,
      sentence_kr: s.sentence_kr,
    })
  );

  return sentences;
}

const EXTRACT_BATCH_SIZE = 10;   // 문장 10개씩 한 번에 전송
const EXTRACT_CONCURRENCY = 5;   // 동시에 최대 5개 배치까지 요청 (순서 유지)

function parseWordsRange(r: string): [number, number] {
  const parts = r.split('~').map(Number);
  return [parts[0] || 5, parts[1] ?? parts[0] ?? 10];
}

/**
 * 단어 추출 - 한 배치(문장 배열)만 처리. 출처별로 그룹해 각각 API 1회 호출.
 */
async function extractWordsForBatch(
  apiKey: string,
  sentences: Sentence[],
  wordsRange: string,
  model: string,
  wordsRangeBySource?: Record<string, string>
): Promise<Word[]> {
  if (sentences.length === 0) return [];
  const allWords: Word[] = [];
  const sourceGroups: Record<string, Sentence[]> = {};
  for (const s of sentences) {
    if (!sourceGroups[s.source]) sourceGroups[s.source] = [];
    sourceGroups[s.source].push(s);
  }
  for (const [source, sourceSentences] of Object.entries(sourceGroups)) {
    const rangeStr = wordsRangeBySource?.[source] ?? wordsRange;
    const [minWords, maxWords] = parseWordsRange(rangeStr);
    const fullPassageEn = sourceSentences.map((s) => s.sentence_en).join(' ');
    const fullPassageKr = sourceSentences.map((s) => s.sentence_kr).join(' ');

    const prompt = `당신은 학생들에게 인기 있는 친근한 영어 코치입니다.
단어를 쉽고 재미있게 가르치는 것이 특기입니다.
반드시 JSON 형식으로만 응답하세요.

다음 영어 지문에서 어휘를 추출하고, 각 단어에 대해 아래 JSON 형식으로 정보를 생성해주세요.

⚠️⚠️⚠️ 매우 중요한 지시사항 ⚠️⚠️⚠️
1. ${minWords}~${maxWords}개의 단어를 추출하세요!
2. 어려운 단어가 부족하면 중급/기본 단어도 포함하세요
3. 숙어(phrasal verbs), 구동사도 포함 가능합니다
4. ⚠️ 반드시 지문에 실제로 등장하는 단어만 추출하세요!

[난이도 가이드 - CEFR 레벨 기준]
🔴 C2 (최우선) - 학술 논문, 전문 서적에 등장하는 고급 어휘
🟠 C1 (우선) - 수능/토익 고난도, 대학 교재 수준 어휘
🟡 B2 (일반) - 고등학교 필수 어휘, 뉴스/시사 영어
🟢 B1 (부족시만) - 중급 수준, 문맥상 특별한 의미로 쓰인 경우만
⛔ A1-A2 (절대 제외) - 기초 수준 단어

[영어 지문]
${fullPassageEn}

[한글 해석]
${fullPassageKr}

[출처] ${source}

각 단어에 대해 다음 정보를 포함해주세요:
- word: 단어 (원형으로)
- pronunciation: 발음 기호 (IPA)
- pronunciation_kr: 한글 발음 (예: apple → "애플", through → "쓰루", determine → "디터민")
- pos: 품사 (n., v., adj., adv. 등)
- meaning_kr: 한글 뜻 (간결하게)
- meaning_en: 영영 풀이 (학습자용으로 쉽게)
- derivatives_str: 주요 파생어 1-2개와 뜻 (예: "perspectival (관점의)")
- collocations: 콜로케이션(표현) 3개, 형식: "영어표현 한글뜻/ 영어표현 한글뜻/ 영어표현 한글뜻"
- synonyms: 유의어 2-3개, 쉼표로만 구분! (예: fortune, luck, chance)
- antonyms: 반의어 1-2개, 쉼표로만 구분! (예: misfortune, bad luck)
- tip: 단어 암기 코칭 팁 (친근한 반말로 50자 이내)
- example_en: 단어가 포함된 예문 (지문에서)
- example_kr: 예문의 한글 해석

[Tip 작성 가이드]
친근한 코치가 학생에게 알려주듯 반말로 작성. 다음 중 1가지 선택:
1. 어원 분해: "con(함께)+clude(닫다)=결론!"
2. 의미 변천: "salary는 원래 '소금 값'이었어!"
3. 접사 패턴: "-tion은 동사→명사!"

반드시 "words" 키를 가진 JSON 객체로 응답: {"words": [...]}`;

    const responseText = await callGemini(apiKey, prompt, model);
    const data = JSON.parse(responseText);
    const words: Word[] = (data.words || []).map((w: Partial<Word>) => ({
      word: w.word || '',
      pronunciation: w.pronunciation || '',
      pronunciation_kr: w.pronunciation_kr || '',
      pos: w.pos || '',
      meaning_kr: w.meaning_kr || '',
      meaning_en: w.meaning_en || '',
      derivatives_str: w.derivatives_str || '',
      collocations: w.collocations || '',
      synonyms: w.synonyms || '',
      antonyms: w.antonyms || '',
      tip: w.tip || '',
      example_en: w.example_en || '',
      example_kr: w.example_kr || '',
      source: source,
    }));
    allWords.push(...words);
  }
  return allWords;
}

/**
 * 단어 추출 (Gemini API)
 * 문장을 10개씩 묶어 배치로 나누고, 배치 단위로 비동기 병렬 요청 후 결과를 원래 문장 순서대로 합칩니다.
 */
export async function extractWords(
  apiKey: string,
  sentences: Sentence[],
  wordsRange: string = '5~10',
  model: string = 'gemini-2.0-flash',
  /** 출처별 찾을 단어 수. 있으면 해당 출처에 이 값을 사용 (예: { "고2 36번": "6~12" }) */
  wordsRangeBySource?: Record<string, string>
): Promise<Word[]> {
  if (sentences.length === 0) return [];

  const batches: Sentence[][] = [];
  for (let i = 0; i < sentences.length; i += EXTRACT_BATCH_SIZE) {
    batches.push(sentences.slice(i, i + EXTRACT_BATCH_SIZE));
  }

  const allWords: Word[] = [];
  for (let i = 0; i < batches.length; i += EXTRACT_CONCURRENCY) {
    const group = batches.slice(i, i + EXTRACT_CONCURRENCY);
    const groupResults = await Promise.all(
      group.map((batch) =>
        extractWordsForBatch(apiKey, batch, wordsRange, model, wordsRangeBySource)
      )
    );
    for (const words of groupResults) {
      allWords.push(...words);
    }
  }
  return allWords;
}

/**
 * 수동 선택된 단어들의 상세 정보 조회 (Gemini API)
 */
export interface ManualWordInput {
  word: string;
  sentence_en: string;
  sentence_kr: string;
  source: string;
}

export async function getManualWordDetails(
  apiKey: string,
  words: ManualWordInput[],
  model: string = 'gemini-2.0-flash'
): Promise<Word[]> {
  if (words.length === 0) return [];

  const wordList = words
    .map(
      (w, i) =>
        `${i + 1}. 단어: "${w.word}" / 예문: "${w.sentence_en}" / 해석: "${w.sentence_kr}" / 출처: "${w.source}"`
    )
    .join('\n');

  const prompt = `당신은 학생들에게 인기 있는 친근한 영어 코치입니다.
반드시 JSON 형식으로만 응답하세요.

아래 단어들의 상세 정보를 생성해주세요. 각 단어는 예문 속에서의 의미로 분석해주세요.

[단어 목록]
${wordList}

각 단어에 대해 다음 정보를 포함:
- word: 단어 (원형으로)
- pronunciation: 발음 기호 (IPA)
- pronunciation_kr: 한글 발음 (예: apple → "애플", through → "쓰루")
- pos: 품사 (n., v., adj., adv. 등)
- meaning_kr: 한글 뜻 (간결하게)
- meaning_en: 영영 풀이 (학습자용으로 쉽게)
- derivatives_str: 주요 파생어 1-2개와 뜻
- collocations: 콜로케이션 3개, "영어표현 한글뜻/ 영어표현 한글뜻/ 영어표현 한글뜻"
- synonyms: 유의어 2-3개, 쉼표로만 구분
- antonyms: 반의어 1-2개, 쉼표로만 구분
- tip: 단어 암기 팁 (친근한 반말, 50자 이내)
- example_en: 위에 제공된 예문 그대로
- example_kr: 위에 제공된 해석 그대로
- source: 위에 제공된 출처 그대로

⚠️ 반드시 입력된 순서대로, 입력된 개수만큼 응답하세요!
반드시 "words" 키를 가진 JSON 객체로 응답: {"words": [...]}`;

  const responseText = await callGemini(apiKey, prompt, model);
  const data = JSON.parse(responseText);

  const result: Word[] = (data.words || []).map((w: Partial<Word>, i: number) => ({
    word: w.word || words[i]?.word || '',
    pronunciation: w.pronunciation || '',
    pronunciation_kr: w.pronunciation_kr || '',
    pos: w.pos || '',
    meaning_kr: w.meaning_kr || '',
    meaning_en: w.meaning_en || '',
    derivatives_str: w.derivatives_str || '',
    collocations: w.collocations || '',
    synonyms: w.synonyms || '',
    antonyms: w.antonyms || '',
    tip: w.tip || '',
    example_en: w.example_en || words[i]?.sentence_en || '',
    example_kr: w.example_kr || words[i]?.sentence_kr || '',
    source: w.source || words[i]?.source || '',
  }));

  return result;
}

/**
 * 직독직해 + 문법태그 + 문장성분 (prompt.md 기반 고도화)
 * 문장 1개 분량의 토큰 배열을 받아 chunking, grammar_tags, main_sv 배열을 반환
 * sentenceEn, sentenceKr 은 참고 해석으로 전달 시 품질 향상
 */
export async function generateDirectReadAnalysis(
  apiKey: string,
  tokens: string[],
  model: string = 'gemini-2.0-flash',
  sentenceEn?: string,
  sentenceKr?: string
): Promise<DirectReadSentence> {
  if (tokens.length === 0) {
    return { chunking: [], main_sv: [], grammar_tags: [] };
  }

  const systemPrompt = `당신은 한국 고등학생용 직독직해(직역·해석) 및 영어 문법 분석 전문가입니다. 아래 세 가지 작업만 수행하고, 반드시 JSON만 반환하세요.

═══════════════════════════════════════════════════════════════
TASK 1: CHUNKING (직독직해)
═══════════════════════════════════════════════════════════════
목적: 영어 문장을 왼쪽에서 오른쪽으로 읽을 때, 각 토큰에 대응하는 한글 직역을 생성합니다.

규칙:
1) 빈 문자열 "" 처리 대상: 관사(a, an, the), 전치사(in, of, to, for, by, with, at, on, from 등), 관계대명사(who, which, that), 종속접속사, 구두점, 조동사/연결동사(is, are, was, were, be, been).
2) 내용어: 명사·동사·형용사·부사는 1~3개의 한글 단어로 번역.
3) 등위접속사: and→그리고, but→하지만, or→또는, so→그래서.
4) 조사 포함: 핵심 단어에 한글 조사를 붙임. 주어(은/는/이/가), 목적어(을/를), 장소(에/에서), 방향(으로), 소유(의).
5) 전치사 의미 병합: 전치사 뜻은 뒤 명사에 합침. "in the city" → ["","","도시에서"], "of science" → ["","과학의"].
6) 조사 정확성: 문맥에 맞게 주어는 은/는/이/가, 목적어는 을/를, 장소는 에/에서, 방향은 으로, 소유는 의.

예시 1:
Tokens: ["The","book","that","I","read","yesterday","was","very","interesting"]
Chunking: ["","책은","","내가","읽은","어제","","매우","흥미로웠다"]

예시 2:
Tokens: ["People","living","in","large","cities","often","feel","lonely"]
Chunking: ["사람들은","사는","","큰","도시에","자주","느낀다","외로움을"]

═══════════════════════════════════════════════════════════════
TASK 2: SENTENCE PATTERN LABELS (main_sv)
═══════════════════════════════════════════════════════════════
목적: 주절의 문장 성분을 각 성분의 핵심 단어에만 표시. 문장 5형식 기준.

라벨: "S"=주어, "V"=동사, "O"=목적어(3·5형식), "IO"=간접목적어(4형식만), "DO"=직접목적어(4형식만), "C"=주격보어(2형식), "OC"=목적격보어(5형식), ""=그 외 전부.

중요 규칙:
- 준동사는 "V"로 표시하지 않음: 분사(People living...의 living)→"", 동명사·to부정사→"". 수동태는 be동사에 "V".
- IO/DO는 4형식에서만. 3형식·5형식 목적어는 반드시 "O"(DO 사용 금지).
- 주절만 표시, 각 성분의 핵심 단어만 표시(수식어·한정사 제외).

5형식: 1형식 S+V, 2형식 S+V+C, 3형식 S+V+O, 4형식 S+V+IO+DO, 5형식 S+V+O+OC.

예시:
"The book that I read yesterday was very interesting" (2형식) → ["","S","","","","","V","","C"]
"People living in large cities often feel lonely" (2형식) → ["S","","","","","","V","C"]
"Having finished the work, he went home" (1형식) → ["","","","","S","V",""]
"It is difficult to think simultaneously" (2형식 가주어) → ["S","V","C","","",""]
"She gave him a present" (4형식) → ["S","V","IO","","DO"]
"The teacher considered the student brilliant" (5형식) → ["","S","V","","O","OC"]
"Many students study English every day" (3형식) → ["","S","V","O","",""]

═══════════════════════════════════════════════════════════════
TASK 3: GRAMMAR TAGS (grammar_tags)
═══════════════════════════════════════════════════════════════
목적: 한국 고등학생이 어려워할 복잡한 문법만 선별. 문장당 0~2개, 30~50자(한글). 형식: "구문명: 자세한 설명".

태그 안 함: 기본 S+V+O, 단순 시제, 기본 접속사, 단순 비교급 → 해당 토큰은 모두 "".

태그 함: 관계대명사/관계부사(생략·계속적 용법), 분사구문(현재/과거·독립분사), 가정법, 도치, 강조(It is~that), 동격 that절, 가주어/가목적어, 복잡한 to부정사/동명사, with+O+C, 복합관계사.

간단한 문장 예(전부 ""): "I like apples", "She went to school", "The weather is nice today"

복잡한 문장 예(해당 토큰에만 태그):
"The book that I read was interesting" → "that"에 "관계대명사 that: 목적격 관계대명사로 'I read'의 목적어 역할, book을 수식하며 생략 가능"
"Having finished the work, he went home" → "Having"에 "분사구문: Having p.p 형태로 주절보다 앞선 시간을 나타내는 완료 분사구문"
"If I had studied harder, I would have passed the exam" → "had"에 "가정법 과거완료: If+had p.p, would have p.p 구조로 과거 사실의 반대 가정"
"Not only did he win, but he also set a new record" → "Not"에 "부정어 도치: Not only가 문두에 와서 주어-동사 도치(did he) 발생"
"Written in plain English, the book was easy to read" → "Written"에 "과거분사구문: 수동 의미로 'the book이 쓰여진' 상태, Being 생략 형태"

═══════════════════════════════════════════════════════════════
출력 형식
═══════════════════════════════════════════════════════════════
JSON만 반환. 키: chunking, main_sv, grammar_tags. 세 배열 길이는 반드시 토큰 리스트와 동일. 설명·마크다운 없음.`;

  const refKr = sentenceKr?.trim() ? `\n참고 해석: ${sentenceKr}` : '';
  const userPrompt = `영어 문장: ${sentenceEn ?? tokens.join(' ')}
토큰 리스트: ${JSON.stringify(tokens)}${refKr}

위 토큰 리스트의 각 토큰에 대한 직독직해(chunking), 문장 성분(main_sv), 문법태그(grammar_tags)를 JSON 객체로 반환하세요.
세 배열 모두 길이가 반드시 ${tokens.length}개여야 합니다.

Respond with valid JSON only: {"chunking": [...], "main_sv": [...], "grammar_tags": [...]}`;

  const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

  const responseText = await callGemini(apiKey, fullPrompt, model);
  const data = JSON.parse(responseText);

  const chunking = Array.isArray(data.chunking) ? data.chunking.map((x: unknown) => String(x ?? '')) : [];
  const main_sv = Array.isArray(data.main_sv) ? data.main_sv.map((x: unknown) => String(x ?? '')) : [];
  const grammar_tags = Array.isArray(data.grammar_tags) ? data.grammar_tags.map((x: unknown) => String(x ?? '')) : [];

  // 길이 맞추기 (토큰 수와 동일)
  const n = tokens.length;
  return {
    chunking: chunking.slice(0, n).concat(Array(Math.max(0, n - chunking.length)).fill('')),
    main_sv: main_sv.slice(0, n).concat(Array(Math.max(0, n - main_sv.length)).fill('')),
    grammar_tags: grammar_tags.slice(0, n).concat(Array(Math.max(0, n - grammar_tags.length)).fill('')),
  };
}
