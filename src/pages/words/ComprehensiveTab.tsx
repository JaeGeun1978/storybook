import React, { useState, useMemo } from 'react';
import type { Word, Sentence, QuizQuestion, QuizType, QuizConfig, DirectReadSentence } from '../../types/words';
import {
  DEFAULT_QUIZ_CONFIGS,
  buildQuizzesFromConfig,
  type GeneratedQuiz,
} from '../../services/quizBuilders';

interface ComprehensiveTabProps {
  wordList: Word[];
  sentences: Sentence[];
  /** 직독직해 탭에서 생성한 문장별 분석. 있으면 종합본에 「분석본에 직독직해 포함」 옵션 사용 가능 */
  sentenceAnalyses?: (DirectReadSentence | null)[];
}

// --- 셔플 ---
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- 간단 퀴즈 생성 (랜덤 혼합) ---
function generateMixedQuiz(wordList: Word[]): { questions: QuizQuestion[]; typeLabel: string }[] {
  if (wordList.length < 5) return [];

  const allMeanings = wordList.map((w) => w.meaning_kr).filter(Boolean);
  const allWordTexts = wordList.map((w) => w.word).filter(Boolean);

  type GenFn = (w: Word) => QuizQuestion | null;

  const generators: { type: QuizType; label: string; gen: GenFn; filter: (w: Word) => boolean }[] = [
    {
      type: '영한퀴즈', label: '영한', filter: (w) => !!w.meaning_kr,
      gen: (w) => {
        const correct = w.meaning_kr;
        const wrongs = shuffle(allMeanings.filter((m) => m !== correct)).slice(0, 4);
        if (wrongs.length < 4) return null;
        const choices = shuffle([correct, ...wrongs]);
        return { num: 0, question: w.word, choices, answer: choices.indexOf(correct) + 1, source: w.source, correct_word: w.word, correct_meaning_kr: w.meaning_kr };
      },
    },
    {
      type: '한영퀴즈', label: '한영', filter: (w) => !!w.word && !!w.meaning_kr,
      gen: (w) => {
        const correct = w.word;
        const wrongs = shuffle(allWordTexts.filter((t) => t !== correct)).slice(0, 4);
        if (wrongs.length < 4) return null;
        const choices = shuffle([correct, ...wrongs]);
        return { num: 0, question: w.meaning_kr, choices, answer: choices.indexOf(correct) + 1, source: w.source, correct_word: w.word, correct_meaning_kr: w.meaning_kr };
      },
    },
    {
      type: '영영풀이퀴즈', label: '영영', filter: (w) => !!w.meaning_en,
      gen: (w) => {
        const correct = w.word;
        const wrongs = shuffle(allWordTexts.filter((t) => t !== correct)).slice(0, 4);
        if (wrongs.length < 4) return null;
        const choices = shuffle([correct, ...wrongs]);
        return { num: 0, question: w.meaning_en, choices, answer: choices.indexOf(correct) + 1, source: w.source, correct_word: w.word, correct_meaning_kr: w.meaning_kr };
      },
    },
    {
      type: '예문퀴즈', label: '예문', filter: (w) => !!w.example_en,
      gen: (w) => {
        const correct = w.word;
        const blanked = w.example_en.replace(new RegExp(`\\b${w.word}\\b`, 'gi'), '_________');
        const wrongs = shuffle(allWordTexts.filter((t) => t !== correct)).slice(0, 4);
        if (wrongs.length < 4) return null;
        const choices = shuffle([correct, ...wrongs]);
        return { num: 0, question: blanked, choices, answer: choices.indexOf(correct) + 1, source: w.source, correct_word: w.word, correct_meaning_kr: w.meaning_kr };
      },
    },
  ];

  // 단어들을 셔플해서 각 유형에 분배
  const shuffledWords = shuffle(wordList);
  const allQuestions: QuizQuestion[] = [];

  for (const w of shuffledWords) {
    // 사용 가능한 유형 중 랜덤 선택
    const available = generators.filter((g) => g.filter(w));
    if (available.length === 0) continue;
    const chosen = available[Math.floor(Math.random() * available.length)];
    const q = chosen.gen(w);
    if (q) allQuestions.push(q);
  }

  // 셔플 후 번호 매기기
  const finalQuestions = shuffle(allQuestions);
  finalQuestions.forEach((q, i) => { q.num = i + 1; });

  return [{ questions: finalQuestions, typeLabel: '랜덤퀴즈' }];
}

function tokenizeEn(english: string): string[] {
  return english.trim().split(/\s+/).filter(Boolean);
}

const ComprehensiveTab: React.FC<ComprehensiveTabProps> = ({ wordList, sentences, sentenceAnalyses = [] }) => {
  const [quizMode, setQuizMode] = useState<'random' | 'selected'>('random');
  const [quizConfigs, setQuizConfigs] = useState<typeof DEFAULT_QUIZ_CONFIGS>(() =>
    DEFAULT_QUIZ_CONFIGS.map((c) => ({ ...c }))
  );
  const [includeDirectRead, setIncludeDirectRead] = useState(false);
  const hasDirectReadData = sentenceAnalyses.some(Boolean) && sentences.length > 0;

  const counts = useMemo(
    () => ({
      영한퀴즈: wordList.filter((w) => w.meaning_kr).length,
      한영퀴즈: wordList.filter((w) => w.word && w.meaning_kr).length,
      영영풀이퀴즈: wordList.filter((w) => w.meaning_en).length,
      유의어퀴즈: wordList.filter((w) => w.synonyms && w.synonyms !== '-').length,
      반의어퀴즈: wordList.filter((w) => w.antonyms && w.antonyms !== '-').length,
      예문퀴즈: wordList.filter((w) => w.example_en).length,
    }),
    [wordList]
  );

  const updateQuizConfig = (idx: number, patch: Partial<(typeof quizConfigs)[0]>) => {
    setQuizConfigs((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    );
  };

  const handlePreview = () => {
    if (wordList.length === 0 && sentences.length === 0) {
      alert('단어나 문장이 없습니다. 입력 탭에서 먼저 데이터를 준비하세요.');
      return;
    }
    if (quizMode === 'selected') {
      const total = quizConfigs.reduce((s, c) => s + (c.enabled ? c.count : 0), 0);
      if (total === 0) {
        alert('퀴즈 유형을 선택하고 문제 수를 입력하세요.');
        return;
      }
    }
    const quizOption =
      quizMode === 'random'
        ? { mode: 'random' as const }
        : { mode: 'selected' as const, configs: quizConfigs };
    const html = generateComprehensiveHtml(wordList, sentences, quizOption, includeDirectRead && hasDirectReadData ? sentenceAnalyses : undefined);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: '72px', marginBottom: '16px' }}>📚</div>
      <h2 style={{ color: '#6D28D9', marginBottom: '12px', fontSize: '24px' }}>종합본</h2>
      <p style={{ color: '#6B7280', marginBottom: '8px', fontSize: '16px' }}>
        단어 카드장 + 퀴즈 + 분석본을 하나의 문서로
      </p>
      <p style={{ color: '#9CA3AF', fontSize: '14px', marginBottom: '20px' }}>
        📊 단어 {wordList.length}개 | 📝 문장 {sentences.length}개
      </p>

      {/* 퀴즈 선택: 랜덤만 vs 유형 선택 */}
      <div
        style={{
          background: 'linear-gradient(135deg, #F5F3FF, #EDE9FE)',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px',
          width: '100%',
          maxWidth: '560px',
        }}
      >
        <h3 style={{ margin: '0 0 14px', color: '#6D28D9', fontSize: '15px' }}>🎯 종합본에 넣을 퀴즈</h3>
        <div style={{ display: 'flex', gap: '20px', marginBottom: quizMode === 'selected' ? '16px' : 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="quizMode"
              checked={quizMode === 'random'}
              onChange={() => setQuizMode('random')}
              style={{ width: '18px', height: '18px', accentColor: '#7C3AED' }}
            />
            <span style={{ fontWeight: 600, color: '#1F2937' }}>랜덤퀴즈만</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="quizMode"
              checked={quizMode === 'selected'}
              onChange={() => setQuizMode('selected')}
              style={{ width: '18px', height: '18px', accentColor: '#7C3AED' }}
            />
            <span style={{ fontWeight: 600, color: '#1F2937' }}>퀴즈 유형 선택</span>
          </label>
        </div>

        {quizMode === 'selected' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {quizConfigs.map((config, idx) => (
              <div
                key={config.type}
                style={{
                  background: 'white',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  border: config.enabled ? `2px solid ${config.color}` : '1px solid #E5E7EB',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) =>
                      updateQuizConfig(idx, {
                        enabled: e.target.checked,
                        count: e.target.checked ? Math.min(10, counts[config.type] || 0) : 0,
                      })
                    }
                    style={{ width: '16px', height: '16px', accentColor: config.color }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 'bold', color: config.color }}>
                    {config.icon} {config.type}
                  </span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={counts[config.type] || 0}
                  value={config.count || ''}
                  onChange={(e) =>
                    updateQuizConfig(idx, {
                      count: Math.max(0, parseInt(e.target.value, 10) || 0),
                      enabled: Number(e.target.value) > 0,
                    })
                  }
                  disabled={!config.enabled}
                  placeholder="0"
                  style={{
                    width: '100%',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid #D1D5DB',
                    fontSize: '13px',
                  }}
                />
                <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>
                  최대 {counts[config.type] ?? 0}개
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {hasDirectReadData && (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 16px',
            background: '#E0F2FE',
            borderRadius: '10px',
            width: '100%',
            maxWidth: '560px',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeDirectRead}
              onChange={(e) => setIncludeDirectRead(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: '#0EA5E9' }}
            />
            <span style={{ fontWeight: 600, color: '#0C4A6E' }}>분석본에 직독직해 포함</span>
          </label>
          <p style={{ margin: '6px 0 0 28px', fontSize: '12px', color: '#0369A1' }}>
            직독직해 탭에서 생성한 3단 구조(직독직해/영문/문법태그)가 종합본의 분석본에 들어갑니다.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <div style={{ background: '#F5F3FF', borderRadius: '14px', padding: '24px', width: '200px', border: '1px solid #DDD6FE' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🃏</div>
          <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#7C3AED' }}>단어 카드장</div>
          <div style={{ fontSize: '13px', color: '#9CA3AF' }}>{wordList.length}개 단어</div>
        </div>
        <div style={{ background: '#F0FDF4', borderRadius: '14px', padding: '24px', width: '200px', border: '1px solid #BBF7D0' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🎲</div>
          <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#10B981' }}>퀴즈</div>
          <div style={{ fontSize: '13px', color: '#9CA3AF' }}>
            {quizMode === 'random' ? '랜덤' : `${quizConfigs.filter((c) => c.enabled).length}유형`}
          </div>
        </div>
        <div style={{ background: '#FEF3C7', borderRadius: '14px', padding: '24px', width: '200px', border: '1px solid #FCD34D' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>📖</div>
          <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#D97706' }}>분석본</div>
          <div style={{ fontSize: '13px', color: '#9CA3AF' }}>{sentences.length}개 문장</div>
        </div>
      </div>

      <button
        onClick={handlePreview}
        disabled={wordList.length === 0 && sentences.length === 0}
        style={{
          padding: '16px 44px',
          borderRadius: '12px',
          border: 'none',
          color: 'white',
          fontWeight: 'bold',
          cursor: wordList.length === 0 && sentences.length === 0 ? 'not-allowed' : 'pointer',
          fontSize: '18px',
          fontFamily: "'Noto Sans KR', sans-serif",
          background: wordList.length === 0 && sentences.length === 0 ? '#D1D5DB' : 'linear-gradient(135deg, #7C3AED, #A78BFA)',
          boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)',
        }}
      >
        📚 종합본 미리보기
      </button>
    </div>
  );
};

// ===================================================================
// 종합본 HTML 생성
// ===================================================================
type QuizOption =
  | { mode: 'random' }
  | { mode: 'selected'; configs: QuizConfig[] };

function generateComprehensiveHtml(
  wordList: Word[],
  sentences: Sentence[],
  quizOption: QuizOption = { mode: 'random' },
  directReadAnalyses?: (DirectReadSentence | null)[]
): string {
  // Part 1: 단어 카드장 (끝에 page-break)
  const wordCardsHtml = generateWordCardsSection(wordList);

  // Part 2: 퀴즈 (랜덤 또는 유형 선택)
  const quizParts =
    quizOption.mode === 'random'
      ? generateQuizSection(wordList)
      : generateQuizSectionFromQuizzes(buildQuizzesFromConfig(wordList, quizOption.configs));
  const quizQuestionsHtml = quizParts?.questionsHtml ?? '';
  const quizAnswerHtml = quizParts?.answerHtml ?? '';

  // Part 3: 분석본 (직독직해 포함 여부에 따라)
  const useDirectRead = Array.isArray(directReadAnalyses) && directReadAnalyses.some(Boolean);
  const analysisHtml = useDirectRead
    ? generateDirectReadAnalysisSection(sentences, directReadAnalyses!)
    : generateAnalysisSection(wordList, sentences);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>종합본</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&family=Noto+Sans:wght@400;500;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Noto Sans KR', sans-serif; }
    body { background: white; padding: 15px; font-size: 11px; line-height: 1.5; color: #333;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
    .container { max-width: 210mm; margin: 0 auto; }
    .word-cards-section { page-break-after: always; }

    /* === 단어 카드 === */
    .source-divider { text-align: center; margin: 20px 0 12px 0; padding: 10px 0; background: #F0F7FF; border-radius: 6px; }
    .source-divider.first { margin-top: 0; }
    .source-title { color: #1E40AF; font-size: 18px; font-weight: 700; }

    .word-card { background: #FFFFFF; border-radius: 10px; margin-bottom: 8px; page-break-inside: avoid; break-inside: avoid; display: flex; overflow: hidden; min-height: 124px; border: 1px solid #E0E0E0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }

    .card-left { width: 27%; min-width: 120px; background: linear-gradient(180deg, #EFF6FF 0%, #DBEAFE 100%); display: flex; flex-direction: column; padding: 8px 10px; border-right: 2px solid #BFDBFE; }
    .number-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .word-number { background: linear-gradient(135deg, #1D4ED8, #60A5FA); color: white; padding: 2px 10px; border-radius: 10px; font-size: 9px; font-weight: 700; }
    .checkbox-group { display: flex; gap: 3px; }
    .checkbox-group input[type="checkbox"] { width: 14px; height: 14px; cursor: pointer; accent-color: #2563EB; }
    .word-area { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .word-main { font-size: 20px; font-weight: 900; color: #1D4ED8; text-align: center; word-break: break-word; margin-bottom: 4px; }
    .word-pronunciation { color: #888; font-size: 10px; text-align: center; margin-bottom: 2px; }
    .word-pronunciation-kr { color: #64748B; font-size: 11px; text-align: center; margin-bottom: 2px; }
    .syn-ant-area { display: flex; gap: 6px; padding-top: 6px; border-top: 1px dashed #DDD; width: 100%; }
    .syn-box, .ant-box { flex: 1; font-size: 8px; }
    .syn-label, .ant-label { display: inline-block; background: #EFF6FF; color: #1D4ED8; padding: 1px 5px; border-radius: 3px; font-weight: 700; font-size: 7px; margin-bottom: 2px; }
    .syn-content, .ant-content { color: #555; font-size: 8px; line-height: 1.3; word-break: break-word; }

    .card-right { flex: 1; display: flex; flex-direction: column; padding: 8px 12px; gap: 4px; }
    .row-meaning-kr { display: flex; align-items: center; gap: 6px; padding-bottom: 5px; border-bottom: 1px solid #ECECEC; }
    .word-pos { background: #EFF6FF; color: #1D4ED8; font-weight: 700; font-size: 9px; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
    .word-meaning-kr { font-size: 14px; color: #1a1a1a; font-weight: 700; }
    .derivatives-inline { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .derivatives-label { background: #ECFDF5; color: #0D9488; padding: 1px 5px; border-radius: 3px; font-weight: 700; font-size: 7px; }
    .derivatives-content { color: #555; font-size: 8px; }
    .word-source { background: #F0F0F0; color: #888; padding: 2px 6px; border-radius: 4px; font-size: 8px; flex-shrink: 0; margin-left: auto; }

    .row-meaning-en { padding: 5px 0; border-bottom: 1px solid #ECECEC; }
    .word-meaning-en { color: #555; font-size: 10px; line-height: 1.5; }

    .row-collocations { padding: 5px 8px; background: #E8F4FD; border-bottom: 1px solid #ECECEC; border-radius: 4px; margin-top: 3px; }
    .collocations-label { display: inline-block; background: #BFDBFE; color: #1E40AF; padding: 1px 6px; border-radius: 3px; font-weight: 700; font-size: 8px; margin-right: 8px; }
    .collocations-content { color: #1E3A5F; font-size: 9px; line-height: 1.5; }

    .row-bottom { display: flex; gap: 8px; margin-top: auto; flex: 1; }
    .example-box { flex: 3; background: linear-gradient(90deg, #F0F7FF 0%, #FFFFFF 100%); border-left: 3px solid #2563EB; padding: 6px 8px; border-radius: 0 6px 6px 0; display: flex; flex-direction: column; justify-content: center; }
    .example-en { color: #333; font-size: 11px; line-height: 1.5; margin-bottom: 3px; }
    .example-en .highlight { color: #1D4ED8; font-weight: 700; background: rgba(37,99,235,0.08); padding: 0 2px; border-radius: 2px; }
    .example-kr { color: #777; font-size: 10px; line-height: 1.4; }
    .tip-box { flex: 1; background: linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%); padding: 6px; border-radius: 5px; border-left: 3px solid #64748B; display: flex; flex-direction: column; }
    .tip-label { display: inline-block; background: #E2E8F0; color: #475569; padding: 1px 4px; border-radius: 3px; font-weight: 700; font-size: 7px; margin-bottom: 3px; align-self: flex-start; }
    .tip-content { color: #334155; font-size: 8px; line-height: 1.4; font-weight: 500; }

    /* === 퀴즈 (진한 파란 통일, 문제 번호 영역 분리) === */
    .quiz-section { margin-bottom: 30px; }
    .quiz-section-header { background: #1E40AF; color: #FFFFFF; padding: 10px 12px; font-weight: 700; font-size: 15px; margin-bottom: 10px; text-align: center; column-span: all; }
    .question-num { flex-shrink: 0; display: inline-block; background: #1E40AF; color: #FFFFFF; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 11px; min-width: 22px; text-align: center; }
    .question-text { display: flex; align-items: flex-start; gap: 6px; font-size: 11px; font-weight: 500; margin-bottom: 4px; color: #1F2937; line-height: 1.4; }
    .question-body { flex: 1; min-width: 0; }
    .question-body .blank { color: #DC2626; font-weight: 700; }
    .columns-2 { column-count: 2; column-gap: 20px; column-rule: 1px dashed #CCC; column-fill: auto; }
    .question { margin-bottom: 8px; padding: 5px 0; break-inside: avoid; }
    .choices { margin-left: 15px; }
    .choice { font-size: 10px; color: #4B5563; margin: 2px 0; }
    .answer-section { margin-top: 20px; padding-top: 15px; border-top: 2px dashed #CCC; page-break-before: always; }
    .answer-header { background: #1E40AF; color: #FFFFFF; padding: 10px 12px; font-weight: 700; font-size: 14px; margin-bottom: 10px; text-align: center; }
    .answer-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; font-size: 10px; }
    .answer-item { background: #F5F5F5; padding: 4px 6px; text-align: left; }
    .answer-item .num { display: inline-block; background: #1E40AF; color: #FFFFFF; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 10px; margin-right: 4px; min-width: 20px; text-align: center; }

    /* === 분석본 === */
    .analysis-source-section { margin-bottom: 25px; }
    .analysis-source-title { font-size: 13px; font-weight: 700; color: #1F2937; padding: 8px 12px; background: #F3F4F6; border-radius: 4px; margin-bottom: 12px; }
    .sentence-block { margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #F3F4F6; page-break-inside: avoid; }
    .sentence-top { display: flex; gap: 10px; margin-bottom: 6px; }
    .sentence-left { flex: 0 1 80%; display: flex; align-items: flex-start; }
    .sentence-num-area { flex-shrink: 0; width: 40px; text-align: center; }
    .sentence-num { display: inline-block; background: #D1D5DB; color: #1F2937; padding: 2px 8px; border-radius: 3px; font-weight: 700; font-size: 11px; }
    .english-area { flex: 1; }
    .english-sentence { font-family: 'Noto Sans', sans-serif; font-size: 13px; line-height: 2.0; color: #1F2937; }
    .sentence-right { flex: 0 0 20%; min-width: 150px; background: #F9FAFB; padding: 6px 8px; border-radius: 4px; font-size: 11px; color: #374151; line-height: 1.4; align-self: flex-start; word-break: keep-all; }
    .word-points { margin: 4px 0 0 40px; padding: 5px 8px; background: #FAFAFA; border: 1px solid #E5E7EB; border-radius: 4px; }
    .word-points-title { font-size: 10px; font-weight: 700; color: #1F2937; margin-bottom: 3px; padding-left: 5px; border-left: 2px solid #1F2937; }
    .word-entry { font-size: 10px; margin: 2px 0; line-height: 1.15; }
    .word-name { font-weight: 700; color: #1F2937; }
    .word-pos-tag { color: #6B7280; font-size: 9px; }
    .word-meaning { color: #6B7280; }
    .word-points .syn-label, .word-points .ant-label { display: inline; background: none; color: #1F2937; font-weight: 500; font-size: 10px; padding: 0; border-radius: 0; margin-bottom: 0; }

    /* === 분석본 직독직해 (미리보기와 동일: 출처 파란바 + 3단 구조) === */
    .source-section { margin-bottom: 25px; }
    .source-title { font-size: 13px; font-weight: 700; color: #FFFFFF; padding: 8px 12px; background: #4A6FA5; border-radius: 4px; margin-bottom: 12px; }
    .source-section .sentence-num { background: #4A6FA5; color: #FFFFFF; }
    .source-section .sentence-num-area { padding-top: 14px; }
    .source-section .sentence-left { flex: 0 1 calc(80% - 5px); }
    .source-section .sentence-right { flex: 0 0 calc(20% - 5px); min-width: 150px; background: #F9FAFB; padding: 6px 8px; border-radius: 4px; font-size: 11px; color: #374151; word-break: keep-all; }
    .english-sentence .word-token { display: inline-flex; flex-direction: column; align-items: flex-start; vertical-align: top; margin: 0 3px; flex-shrink: 1; }
    .english-sentence .chunk-text { display: block; font-size: 8px; color: #1F2937; padding: 0 4px; min-height: 12px; margin-bottom: 1px; line-height: 1.3; text-align: left; white-space: nowrap; }
    .english-sentence .word-text { display: block; font-size: 15px; line-height: 1.2; text-align: left; white-space: nowrap; }
    .english-sentence .grammar-tag { display: block; font-size: 9px; font-weight: bold; color: #DC2626; background: white; padding: 0 2px; min-height: 10px; border-radius: 2px; margin-top: 1px; line-height: 1.3; white-space: nowrap; }
    .source-section .english-sentence { display: flex; flex-wrap: wrap; align-items: flex-start; }
    .word-text.grammar-highlight { background: #FFE8A0 !important; padding: 0 2px; border-radius: 2px; }
    .points-wrap { margin: 6px 0 0 40px; display: flex; flex-direction: column; gap: 8px; }
    .point-section { padding: 8px 12px; border-radius: 4px; font-size: 10px; color: #1F2937; line-height: 1.6; }
    .point-section.reading-point { background: #E0F2FE; border-left: 3px solid #0284C7; }
    .point-section.grammar-point { background: #FFE8A0; border-left: 3px solid #D4A843; }
    .point-section.vocab-point { background: #D1FAE5; border-left: 3px solid #059669; }
    .point-section.blank-point { background: #FCE7F3; border-left: 3px solid #DB2777; }
    .point-title { font-weight: 700; display: block; margin-bottom: 4px; }
    .point-content ul { margin: 4px 0 0; padding-left: 18px; }
    .point-list { margin: 0; padding-left: 18px; }
    .exam-reason { display: block; margin-top: 4px; font-size: 9px; color: #6B7280; }

    /* === 플로팅 버튼 === */
    .floating-btn-wrap { position: fixed; bottom: 30px; right: 30px; display: flex; flex-direction: column; gap: 10px; z-index: 9999; }
    .floating-btn { width: 56px; height: 56px; border-radius: 50%; border: none; color: white; font-size: 22px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; transition: transform 0.2s, box-shadow 0.2s; }
    .floating-btn:hover { transform: scale(1.1); box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
    .floating-btn.print { background: linear-gradient(135deg, #7C3AED, #A78BFA); }
    .floating-btn.close { background: linear-gradient(135deg, #6B7280, #9CA3AF); }

    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
      body { padding: 0; }
      .word-card { box-shadow: none; margin-bottom: 8px !important; page-break-inside: avoid !important; }
      .card-left, .tip-box, .example-box { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .source-divider { page-break-before: always; }
      .source-divider.first { page-break-before: avoid; }
      .floating-btn-wrap { display: none; }
      .sentence-block { break-inside: avoid; }
      .analysis-source-section, .source-section { break-before: page; }
      .analysis-source-section:first-child, .source-section:first-child { break-before: auto; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="word-cards-section">${wordCardsHtml}</div>
    ${quizQuestionsHtml}
    ${analysisHtml}
    ${quizAnswerHtml ? `<div style="page-break-before: always;"></div>${quizAnswerHtml}` : ''}
  </div>
  <div class="floating-btn-wrap">
    <button class="floating-btn print" onclick="window.print()" title="PDF로 인쇄/저장">🖨️</button>
    <button class="floating-btn close" onclick="window.close()" title="닫기">✕</button>
  </div>
</body>
</html>`;
}

// 예문에서 단어를 하이라이트하는 헬퍼 함수
function highlightWordInText(text: string, word: string): string {
  if (!text || !word) return text || '';
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped}\\w*)`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}

// --- Part 1: 단어 카드장 ---
function generateWordCardsSection(wordList: Word[]): string {
  if (wordList.length === 0) return '';

  const groups: Record<string, Word[]> = {};
  for (const w of wordList) {
    const src = w.source || '기타';
    if (!groups[src]) groups[src] = [];
    groups[src].push(w);
  }

  let cards = '';
  let globalIdx = 0;

  for (const [source, words] of Object.entries(groups)) {
    const isFirst = globalIdx === 0;
    cards += `<div class="source-divider ${isFirst ? 'first' : ''}"><span class="source-title">${source}</span></div>`;

    for (const w of words) {
      globalIdx++;
      const numStr = String(globalIdx).padStart(3, '0');
      const highlightedExample = highlightWordInText(w.example_en, w.word);
      cards += `
      <div class="word-card">
        <div class="card-left">
          <div class="number-row">
            <span class="word-number">${numStr}</span>
            <div class="checkbox-group">
              <input type="checkbox" title="1회차">
              <input type="checkbox" title="2회차">
              <input type="checkbox" title="3회차">
            </div>
          </div>
          <div class="word-area">
            <div class="word-main">${w.word}</div>
            <div class="word-pronunciation">${w.pronunciation || ''}</div>
            <div class="word-pronunciation-kr">${w.pronunciation_kr || ''}</div>
          </div>
          ${(w.synonyms || w.antonyms) ? `
          <div class="syn-ant-area">
            ${w.synonyms ? `<div class="syn-box"><span class="syn-label">동</span><div class="syn-content">${w.synonyms}</div></div>` : ''}
            ${w.antonyms ? `<div class="ant-box"><span class="ant-label">반</span><div class="ant-content">${w.antonyms}</div></div>` : ''}
          </div>` : ''}
        </div>
        <div class="card-right">
          <div class="row-meaning-kr">
            <span class="word-pos">${w.pos}</span>
            <div class="word-meaning-kr">${w.meaning_kr}</div>
            ${w.derivatives_str ? `<div class="derivatives-inline"><span class="derivatives-label">파생</span><span class="derivatives-content">${w.derivatives_str}</span></div>` : ''}
            <span class="word-source">${w.source || ''}</span>
          </div>
          <div class="row-meaning-en">
            <div class="word-meaning-en">${w.meaning_en}</div>
          </div>
          ${w.collocations ? `
          <div class="row-collocations">
            <span class="collocations-label">collocations</span>
            <span class="collocations-content">${w.collocations}</span>
          </div>` : ''}
          <div class="row-bottom">
            <div class="example-box">
              <div class="example-en">${highlightedExample}</div>
              <div class="example-kr">${w.example_kr}</div>
            </div>
            ${w.tip ? `
            <div class="tip-box">
              <span class="tip-label">💡 Tip</span>
              <div class="tip-content">${w.tip}</div>
            </div>` : ''}
          </div>
        </div>
      </div>`;
    }
  }

  return cards;
}

// --- Part 2: 랜덤 퀴즈 ---
function generateQuizSection(wordList: Word[]): { questionsHtml: string; answerHtml: string } | null {
  if (wordList.length < 5) return null;

  const quizData = generateMixedQuiz(wordList);
  if (quizData.length === 0 || quizData[0].questions.length === 0) return null;

  const questions = quizData[0].questions;

  let questionsHtml = '';
  questionsHtml += `<div class="quiz-section"><div class="quiz-section-header">랜덤퀴즈 (${questions.length}문제)</div><div class="columns-2">`;

  for (const q of questions) {
    let qTextHtml = q.question;
    qTextHtml = qTextHtml.replace(
      /_________/g,
      '[<span class="blank" style="display:inline-block; min-width:105px; background:#F5F5F5; padding:2px 5px;">&nbsp;</span>]'
    );

    let choicesHtml = '';
    for (let i = 0; i < q.choices.length; i++) {
      const circled = String.fromCharCode(9312 + i);
      choicesHtml += `<div class="choice">${circled} ${q.choices[i]}</div>`;
    }

    const numStr = String(q.num).padStart(2, '0');
    questionsHtml += `
      <div class="question">
        <div class="question-text"><span class="question-num">${numStr}</span><span class="question-body">${qTextHtml}</span></div>
        <div class="choices">${choicesHtml}</div>
      </div>`;
  }

  questionsHtml += `</div></div>`;

  let answerHtml = '';
  answerHtml += `<div class="answer-section"><div class="answer-header">랜덤퀴즈 정답</div><div class="answer-grid">`;
  for (const q of questions) {
    const circled = String.fromCharCode(9312 + q.answer - 1);
    const answerText = q.correct_word && q.correct_meaning_kr
      ? `${circled} ${q.correct_word} (${q.correct_meaning_kr})`
      : circled;
    const ansNumStr = String(q.num).padStart(2, '0');
    answerHtml += `<div class="answer-item"><span class="num">${ansNumStr}</span> ${answerText}</div>`;
  }
  answerHtml += `</div></div>`;

  return { questionsHtml, answerHtml };
}

// --- Part 2-2: 선택 퀴즈 (유형별 GeneratedQuiz[]) ---
function generateQuizSectionFromQuizzes(
  quizzes: GeneratedQuiz[]
): { questionsHtml: string; answerHtml: string } | null {
  const allQuestions: QuizQuestion[] = [];
  for (const g of quizzes) {
    for (const q of g.questions) allQuestions.push(q);
  }
  if (allQuestions.length === 0) return null;

  let questionsHtml = '';
  for (const g of quizzes) {
    if (g.questions.length === 0) continue;
    const headerLabel = `${g.icon} ${g.type} (${g.questions.length}문제)`;
    questionsHtml += `<div class="quiz-section"><div class="quiz-section-header" style="background:${g.color}">${headerLabel}</div><div class="columns-2">`;
    for (const q of g.questions) {
      let qTextHtml = q.question.replace(
        /_________/g,
        '[<span class="blank" style="display:inline-block; min-width:105px; background:#F5F5F5; padding:2px 5px;">&nbsp;</span>]'
      );
      let choicesHtml = '';
      for (let i = 0; i < q.choices.length; i++) {
        const circled = String.fromCharCode(9312 + i);
        choicesHtml += `<div class="choice">${circled} ${q.choices[i]}</div>`;
      }
      const numStr = String(q.num).padStart(2, '0');
      questionsHtml += `
      <div class="question">
        <div class="question-text"><span class="question-num">${numStr}</span><span class="question-body">${qTextHtml}</span></div>
        <div class="choices">${choicesHtml}</div>
      </div>`;
    }
    questionsHtml += `</div></div>`;
  }

  let answerHtml = '';
  answerHtml += `<div class="answer-section"><div class="answer-header">퀴즈 정답</div><div class="answer-grid">`;
  for (const q of allQuestions) {
    const circled = String.fromCharCode(9312 + q.answer - 1);
    const answerText =
      q.correct_word && q.correct_meaning_kr
        ? `${circled} ${q.correct_word} (${q.correct_meaning_kr})`
        : circled;
    const ansNumStr = String(q.num).padStart(2, '0');
    answerHtml += `<div class="answer-item"><span class="num">${ansNumStr}</span> ${answerText}</div>`;
  }
  answerHtml += `</div></div>`;

  return { questionsHtml, answerHtml };
}

// --- Part 3-1: 분석본 (직독직해 3단 구조) ---
function generateDirectReadAnalysisSection(
  sentences: Sentence[],
  sentenceAnalyses: (DirectReadSentence | null)[]
): string {
  if (sentences.length === 0) return '';

  const sourceGroups: Record<string, { sentence: Sentence; idx: number }[]> = {};
  sentences.forEach((s, i) => {
    const src = s.source || '기타';
    if (!sourceGroups[src]) sourceGroups[src] = [];
    sourceGroups[src].push({ sentence: s, idx: i });
  });

  let html = '';
  for (const [source, items] of Object.entries(sourceGroups)) {
    html += `<div class="source-section"><div class="source-title">${source}</div>`;
    for (let localIdx = 0; localIdx < items.length; localIdx++) {
      const { sentence, idx } = items[localIdx];
      const analysis = sentenceAnalyses[idx];
      const tokens = tokenizeEn(sentence.sentence_en);
      const hasAnalysis = analysis && analysis.chunking.length === tokens.length;

      if (hasAnalysis) {
        let tokensHtml = '';
        const grammarPoints: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
          const chunk = analysis!.chunking[i] ?? '';
          const sv = analysis!.main_sv[i] ?? '';
          const gram = analysis!.grammar_tags[i] ?? '';
          if (gram) grammarPoints.push(gram);
          const tag = sv;
          const tagClass = ['S', 'V', 'O', 'IO', 'DO', 'C', 'OC'].includes(sv) ? 'grammar-tag subject-verb' : 'grammar-tag';
          const wordClass = gram ? 'word-text grammar-highlight' : 'word-text';
          tokensHtml += `<span class="word-token"><span class="chunk-text">${escapeHtml(chunk)}</span><span class="${wordClass}">${escapeHtml(tokens[i])}</span><span class="${tagClass}">${escapeHtml(tag)}</span></span>`;
        }
        const pointBlocks: string[] = [];
        if (analysis!.reading_point?.role != null || analysis!.reading_point?.logic != null) {
          const r = analysis!.reading_point!;
          pointBlocks.push(`<div class="point-section reading-point"><span class="point-title">[독해 포인트]</span><div class="point-content">${r.role ? `<strong>${escapeHtml(r.role)}</strong> ` : ''}${escapeHtml(r.logic || '')}</div></div>`);
        }
        if (grammarPoints.length > 0) {
          pointBlocks.push(`<div class="point-section grammar-point"><span class="point-title">[문법 포인트]</span><ol class="point-list">${grammarPoints.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}</ol></div>`);
        }
        if (analysis!.vocab_point?.word) {
          const v = analysis!.vocab_point;
          let vHtml = `<strong>${escapeHtml(v.word)}</strong> ${escapeHtml(v.context_meaning || '')}`;
          if (v.antonyms?.length) vHtml += ` | 반의어: ${escapeHtml(v.antonyms.join(', '))}`;
          if (v.exam_reason) vHtml += `<br/><span class="exam-reason">${escapeHtml(v.exam_reason)}</span>`;
          pointBlocks.push(`<div class="point-section vocab-point"><span class="point-title">[어휘 포인트]</span><div class="point-content">${vHtml}</div></div>`);
        }
        if (analysis!.blank_point?.target_phrase) {
          const b = analysis!.blank_point;
          let bHtml = `<strong>${escapeHtml(b.target_phrase)}</strong>`;
          if (b.paraphrases?.length) bHtml += `<ul>${b.paraphrases.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;
          if (b.exam_reason) bHtml += `<span class="exam-reason">${escapeHtml(b.exam_reason)}</span>`;
          pointBlocks.push(`<div class="point-section blank-point"><span class="point-title">[빈칸 포인트]</span><div class="point-content">${bHtml}</div></div>`);
        }
        const pointsHtml = pointBlocks.length ? `<div class="points-wrap">${pointBlocks.join('')}</div>` : '';
        html += `
        <div class="sentence-block">
          <div class="sentence-top">
            <div class="sentence-left">
              <div class="sentence-num-area">
                <span class="sentence-num">${String(localIdx + 1).padStart(2, '0')}</span>
              </div>
              <div class="english-area">
                <span class="english-sentence">${tokensHtml}</span>
              </div>
            </div>
            <div class="sentence-right">${escapeHtml(sentence.sentence_kr)}</div>
          </div>
          ${pointsHtml}
        </div>`;
      } else {
        html += `
        <div class="sentence-block">
          <div class="sentence-top">
            <div class="sentence-left">
              <div class="sentence-num-area">
                <span class="sentence-num">${String(localIdx + 1).padStart(2, '0')}</span>
              </div>
              <div class="english-area">
                <span class="english-sentence">${escapeHtml(sentence.sentence_en)}</span>
              </div>
            </div>
            <div class="sentence-right">${escapeHtml(sentence.sentence_kr)}</div>
          </div>
        </div>`;
      }
    }
    html += `</div>`;
  }
  return html;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Part 3: 분석본 ---
function generateAnalysisSection(wordList: Word[], sentences: Sentence[]): string {
  if (sentences.length === 0) return '';

  // 출처별 그룹화
  const sourceGroups: Record<string, { sentence: Sentence; idx: number }[]> = {};
  for (let i = 0; i < sentences.length; i++) {
    const src = sentences[i].source || '기타';
    if (!sourceGroups[src]) sourceGroups[src] = [];
    sourceGroups[src].push({ sentence: sentences[i], idx: i });
  }

  // 문장별 단어 매핑
  const sentenceWordMap: Record<string, Word[]> = {};
  for (const w of wordList) {
    // example_en으로 문장 매칭
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (
        w.source === s.source &&
        (w.example_en === s.sentence_en ||
          s.sentence_en?.includes(w.word))
      ) {
        const key = `${i}`;
        if (!sentenceWordMap[key]) sentenceWordMap[key] = [];
        // 중복 방지
        if (!sentenceWordMap[key].some((x) => x.word === w.word)) {
          sentenceWordMap[key].push(w);
        }
      }
    }
  }

  let html = '';

  const circledNums = '①②③④⑤⑥⑦⑧⑨⑩';

  for (const [source, items] of Object.entries(sourceGroups)) {
    html += `<div class="analysis-source-section"><div class="analysis-source-title">${source}</div>`;

    for (let localIdx = 0; localIdx < items.length; localIdx++) {
      const { sentence, idx: globalIdx } = items[localIdx];
      const words = sentenceWordMap[`${globalIdx}`] || [];

      // 영문 문장에서 단어 하이라이트
      let enHtml = sentence.sentence_en;
      if (words.length > 0) {
        const escaped = words.map((w) => w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
        enHtml = enHtml.replace(regex, '<strong style="color:#7C3AED;">$1</strong>');
      }

      html += `
        <div class="sentence-block">
          <div class="sentence-top">
            <div class="sentence-left">
              <div class="sentence-num-area">
                <span class="sentence-num">${String(localIdx + 1).padStart(2, '0')}</span>
              </div>
              <div class="english-area">
                <span class="english-sentence">${enHtml}</span>
              </div>
            </div>
            <div class="sentence-right">${sentence.sentence_kr}</div>
          </div>`;

      // 어휘정리
      if (words.length > 0) {
        html += `<div class="word-points"><div class="word-points-title">| 어휘정리</div>`;
        words.forEach((w, wIdx) => {
          const num = wIdx < 10 ? circledNums[wIdx] : `${wIdx + 1}`;
          let entry = `<span class="word-name">${num} ${w.word}</span>`;
          if (w.pos) entry += ` <span class="word-pos-tag">${w.pos}</span>`;
          if (w.meaning_kr) entry += ` <span class="word-meaning">${w.meaning_kr}</span>`;
          if (w.synonyms) entry += ` | <span class="syn-label">[유사]</span> ${w.synonyms}`;
          if (w.antonyms) entry += ` <span class="ant-label">[반의]</span> ${w.antonyms}`;
          html += `<div class="word-entry">${entry}</div>`;
        });
        html += `</div>`;
      }

      html += `</div>`; // sentence-block
    }

    html += `</div>`; // analysis-source-section
  }

  return html;
}

export default ComprehensiveTab;
