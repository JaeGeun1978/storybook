/**
 * 퀴즈 유형별 생성 로직 + 설정 (퀴즈탭 / 종합본 공용)
 */
import type { Word, QuizConfig, QuizType, QuizQuestion } from '../types/words';

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const DEFAULT_QUIZ_CONFIGS: QuizConfig[] = [
  { type: '영한퀴즈', count: 0, enabled: false, icon: '🇬🇧→🇰🇷', color: '#3B82F6' },
  { type: '한영퀴즈', count: 0, enabled: false, icon: '🇰🇷→🇬🇧', color: '#10B981' },
  { type: '영영풀이퀴즈', count: 0, enabled: false, icon: '📖', color: '#8B5CF6' },
  { type: '유의어퀴즈', count: 0, enabled: false, icon: '🔗', color: '#F59E0B' },
  { type: '반의어퀴즈', count: 0, enabled: false, icon: '⚡', color: '#EF4444' },
  { type: '예문퀴즈', count: 0, enabled: false, icon: '📝', color: '#EC4899' },
];

export interface GeneratedQuiz {
  type: QuizType;
  icon: string;
  color: string;
  questions: QuizQuestion[];
  _isRandom?: boolean;
}

export function generateEngKorQuiz(words: Word[], count: number, allWords: Word[]): QuizQuestion[] {
  const pool = shuffle(words).slice(0, count);
  const allMeanings = allWords.map((w) => w.meaning_kr).filter(Boolean);
  const questions: QuizQuestion[] = [];
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i];
    const correct = w.meaning_kr;
    if (!correct) continue;
    const wrongs = shuffle(allMeanings.filter((m) => m !== correct)).slice(0, 4);
    if (wrongs.length < 4) continue;
    const choices = shuffle([correct, ...wrongs]);
    questions.push({
      num: i + 1,
      question: w.word,
      choices,
      answer: choices.indexOf(correct) + 1,
      source: w.source,
      correct_word: w.word,
      correct_meaning_kr: w.meaning_kr,
    });
  }
  return questions;
}

export function generateKorEngQuiz(words: Word[], count: number, allWords: Word[]): QuizQuestion[] {
  const pool = shuffle(words).slice(0, count);
  const allWordTexts = allWords.map((w) => w.word).filter(Boolean);
  const questions: QuizQuestion[] = [];
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i];
    const correct = w.word;
    if (!correct || !w.meaning_kr) continue;
    const wrongs = shuffle(allWordTexts.filter((t) => t !== correct)).slice(0, 4);
    if (wrongs.length < 4) continue;
    const choices = shuffle([correct, ...wrongs]);
    questions.push({
      num: i + 1,
      question: w.meaning_kr,
      choices,
      answer: choices.indexOf(correct) + 1,
      source: w.source,
      correct_word: w.word,
      correct_meaning_kr: w.meaning_kr,
    });
  }
  return questions;
}

export function generateEngEngQuiz(words: Word[], count: number, allWords: Word[]): QuizQuestion[] {
  const pool = shuffle(words.filter((w) => w.meaning_en)).slice(0, count);
  const allWordTexts = allWords.map((w) => w.word).filter(Boolean);
  const questions: QuizQuestion[] = [];
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i];
    const correct = w.word;
    if (!correct || !w.meaning_en) continue;
    const wrongs = shuffle(allWordTexts.filter((t) => t !== correct)).slice(0, 4);
    if (wrongs.length < 4) continue;
    const choices = shuffle([correct, ...wrongs]);
    questions.push({
      num: i + 1,
      question: w.meaning_en,
      choices,
      answer: choices.indexOf(correct) + 1,
      source: w.source,
      correct_word: w.word,
      correct_meaning_kr: w.meaning_kr,
    });
  }
  return questions;
}

export function generateSynonymQuiz(words: Word[], count: number, allWords: Word[]): QuizQuestion[] {
  const pool = shuffle(words.filter((w) => w.synonyms && w.synonyms !== '-')).slice(0, count);
  const allWordTexts = allWords.map((w) => w.word).filter(Boolean);
  const questions: QuizQuestion[] = [];
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i];
    const correct = w.word;
    if (!correct || !w.synonyms) continue;
    const wrongs = shuffle(allWordTexts.filter((t) => t !== correct)).slice(0, 4);
    if (wrongs.length < 4) continue;
    const choices = shuffle([correct, ...wrongs]);
    questions.push({
      num: i + 1,
      question: `${w.synonyms}의 동의어는?`,
      choices,
      answer: choices.indexOf(correct) + 1,
      source: w.source,
      correct_word: w.word,
      correct_meaning_kr: w.meaning_kr,
    });
  }
  return questions;
}

export function generateAntonymQuiz(words: Word[], count: number, allWords: Word[]): QuizQuestion[] {
  const pool = shuffle(words.filter((w) => w.antonyms && w.antonyms !== '-')).slice(0, count);
  const allWordTexts = allWords.map((w) => w.word).filter(Boolean);
  const questions: QuizQuestion[] = [];
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i];
    const correct = w.word;
    if (!correct || !w.antonyms) continue;
    const wrongs = shuffle(allWordTexts.filter((t) => t !== correct)).slice(0, 4);
    if (wrongs.length < 4) continue;
    const choices = shuffle([correct, ...wrongs]);
    questions.push({
      num: i + 1,
      question: `${w.antonyms}의 반의어는?`,
      choices,
      answer: choices.indexOf(correct) + 1,
      source: w.source,
      correct_word: w.word,
      correct_meaning_kr: w.meaning_kr,
    });
  }
  return questions;
}

export function generateExampleQuiz(words: Word[], count: number, allWords: Word[]): QuizQuestion[] {
  const pool = shuffle(words.filter((w) => w.example_en)).slice(0, count);
  const allWordTexts = allWords.map((w) => w.word).filter(Boolean);
  const questions: QuizQuestion[] = [];
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i];
    const correct = w.word;
    if (!correct || !w.example_en) continue;
    const blanked = w.example_en.replace(new RegExp(`\\b${w.word}\\b`, 'gi'), '_________');
    const wrongs = shuffle(allWordTexts.filter((t) => t !== correct)).slice(0, 4);
    if (wrongs.length < 4) continue;
    const choices = shuffle([correct, ...wrongs]);
    questions.push({
      num: i + 1,
      question: blanked,
      choices,
      answer: choices.indexOf(correct) + 1,
      source: w.source,
      correct_word: w.word,
      correct_meaning_kr: w.meaning_kr,
    });
  }
  return questions;
}

export const QUIZ_GENERATORS: Record<
  QuizType,
  (words: Word[], count: number, all: Word[]) => QuizQuestion[]
> = {
  영한퀴즈: generateEngKorQuiz,
  한영퀴즈: generateKorEngQuiz,
  영영풀이퀴즈: generateEngEngQuiz,
  유의어퀴즈: generateSynonymQuiz,
  반의어퀴즈: generateAntonymQuiz,
  예문퀴즈: generateExampleQuiz,
};

/** 설정대로 퀴즈 목록 생성 (퀴즈탭 / 종합본 공용) */
export function buildQuizzesFromConfig(wordList: Word[], configs: QuizConfig[]): GeneratedQuiz[] {
  const results: GeneratedQuiz[] = [];
  let questionNum = 1;
  for (const config of configs) {
    if (!config.enabled || config.count <= 0) continue;
    const gen = QUIZ_GENERATORS[config.type];
    const questions = gen(wordList, config.count, wordList);
    for (const q of questions) {
      q.num = questionNum++;
    }
    results.push({
      type: config.type,
      icon: config.icon,
      color: config.color,
      questions,
    });
  }
  return results;
}
