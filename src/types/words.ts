// 단어 데이터 타입
export interface Word {
  word: string;
  pronunciation: string;
  pronunciation_kr?: string;
  pos: string;
  meaning_kr: string;
  meaning_en: string;
  derivatives_str: string;
  collocations?: string;
  synonyms: string;
  antonyms: string;
  tip: string;
  example_en: string;
  example_kr: string;
  source: string;
  sentence_index?: number;
  word_position?: number;
}

// 문장 데이터 타입
export interface Sentence {
  /** 문장 고유 ID (음성·슬라이드 매칭용, 없으면 앱에서 자동 부여) */
  id?: string;
  source: string;
  sentence_en: string;
  sentence_kr: string;
}

// 퀴즈 문제 타입
export interface QuizQuestion {
  num: number;
  question: string;
  choices: string[];
  answer: number; // 1-based index
  source: string;
  correct_word: string;
  correct_meaning_kr: string;
}

// 퀴즈 유형별 그룹
export interface QuizGroup {
  source: string;
  questions: QuizQuestion[];
}

// 퀴즈 유형 enum
export type QuizType = 
  | '영한퀴즈' 
  | '한영퀴즈' 
  | '영영풀이퀴즈' 
  | '유의어퀴즈' 
  | '반의어퀴즈' 
  | '예문퀴즈';

// 퀴즈 설정 (유형별 문제 수)
export interface QuizConfig {
  type: QuizType;
  count: number;
  enabled: boolean;
  icon: string;
  color: string;
}

/** 독해 포인트 (문장 역할·논리) */
export interface ReadingPoint {
  role: string;
  logic: string;
}

/** 어휘 포인트 */
export interface VocabPoint {
  word: string;
  context_meaning: string;
  antonyms?: string[];
  exam_reason?: string;
}

/** 빈칸 포인트 */
export interface BlankPoint {
  target_phrase: string;
  paraphrases?: string[];
  exam_reason?: string;
}

/** 직독직해 문장별 분석 (analysis.md 2.2~2.4) */
export interface DirectReadSentence {
  /** 토큰 수와 동일한 길이. 각 토큰의 한글 직독직해 (빈 문자열 가능) */
  chunking: string[];
  /** 문장 성분: S, V, O, IO, DO, C, OC 또는 "" */
  main_sv: string[];
  /** 문법 설명 (30~50자). 빈 문자열 가능 */
  grammar_tags: string[];
  /** 문장 역할: 주제문, 요지, 도입, 예시/근거 등 */
  role?: string;
  /** 문법 포인트 통합 메모 */
  grammar_note?: string;
  /** 독해 포인트 (표시 순서 1) */
  reading_point?: ReadingPoint | null;
  /** 어휘 포인트 (표시 순서 3) */
  vocab_point?: VocabPoint | null;
  /** 빈칸 포인트 (표시 순서 4) */
  blank_point?: BlankPoint | null;
}

// JSON 저장 형식
export interface WordsJsonData {
  version: string;
  created_at: string;
  word_count: number;
  words: Word[];
  sentences?: Sentence[];
}

/** 직독직해 전용 JSON 저장 형식 */
export interface DirectReadJsonData {
  version: string;
  type: 'directread';
  created_at: string;
  sentences: Sentence[];
  sentence_analyses: (DirectReadSentence | null)[];
}
