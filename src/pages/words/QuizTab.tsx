import React, { useState, useMemo } from 'react';
import type { Word, QuizConfig, QuizQuestion } from '../../types/words';
import {
  shuffle,
  DEFAULT_QUIZ_CONFIGS,
  QUIZ_GENERATORS,
  buildQuizzesFromConfig,
  type GeneratedQuiz,
} from '../../lib/quizBuilders';

interface QuizTabProps {
  wordList: Word[];
}

const QuizTab: React.FC<QuizTabProps> = ({ wordList }) => {
  const [configs, setConfigs] = useState<QuizConfig[]>(DEFAULT_QUIZ_CONFIGS);
  const [generatedQuizzes, setGeneratedQuizzes] = useState<GeneratedQuiz[]>([]);
  const [showAnswers, setShowAnswers] = useState(false);

  const totalWords = wordList.length;
  const totalQuizCount = configs.reduce(
    (sum, c) => sum + (c.enabled ? c.count : 0),
    0
  );

  // 유효한 단어 수 (각 퀴즈 유형별 최대 출제 가능 수)
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

  const updateConfig = (idx: number, updates: Partial<QuizConfig>) => {
    setConfigs((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
  };

  // 랜덤 배정 → 자동으로 모든 유형 활성화 + 배분 + 즉시 "랜덤퀴즈" 생성
  const handleRandom = () => {
    if (totalWords < 5) {
      alert('단어가 최소 5개 이상 필요합니다.');
      return;
    }

    // 모든 유형의 최대 가능 수 파악 (0보다 큰 것만)
    const allTypes = configs
      .map((c, i) => ({ config: c, idx: i, max: counts[c.type] as number }))
      .filter((x) => x.max > 0);

    if (allTypes.length === 0) {
      alert('출제 가능한 단어가 없습니다.');
      return;
    }

    // 전체 단어 수를 유형별로 균등 배분
    const numTypes = allTypes.length;
    const basePerType = Math.floor(totalWords / numTypes);
    let remainder = totalWords % numTypes;

    const newConfigs = configs.map((c) => ({ ...c }));
    const assigned: Record<number, number> = {};

    for (const item of allTypes) {
      let count = basePerType + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      count = Math.min(count, item.max);
      assigned[item.idx] = count;
      newConfigs[item.idx] = { ...newConfigs[item.idx], count, enabled: true };
    }

    // 남은 단어 추가 배정
    let remaining = totalWords - Object.values(assigned).reduce((s, v) => s + v, 0);
    if (remaining > 0) {
      for (const item of shuffle(allTypes)) {
        const current = assigned[item.idx];
        const canAdd = item.max - current;
        if (canAdd > 0) {
          const add = Math.min(canAdd, remaining);
          assigned[item.idx] = current + add;
          newConfigs[item.idx] = { ...newConfigs[item.idx], count: current + add };
          remaining -= add;
        }
        if (remaining <= 0) break;
      }
    }

    // 사용 안 되는 유형은 비활성 + 0
    for (let i = 0; i < newConfigs.length; i++) {
      if (!(i in assigned) || assigned[i] === 0) {
        newConfigs[i] = { ...newConfigs[i], count: 0, enabled: false };
      }
    }

    setConfigs(newConfigs);

    // 즉시 퀴즈 생성 → 모든 문제를 섞어서 "랜덤퀴즈"로 합치기
    const allQuestions: QuizQuestion[] = [];
    for (const item of allTypes) {
      const count = assigned[item.idx] || 0;
      if (count <= 0) continue;
      const gen = QUIZ_GENERATORS[item.config.type];
      const questions = gen(wordList, count, wordList);
      allQuestions.push(...questions);
    }

    // 전체 셔플 후 번호 재지정
    const shuffledQuestions = shuffle(allQuestions);
    shuffledQuestions.forEach((q, i) => { q.num = i + 1; });

    setGeneratedQuizzes([{
      type: '영한퀴즈', // 내부용 (표시에는 안 쓰임)
      icon: '🎲',
      color: '#7C3AED',
      questions: shuffledQuestions,
      _isRandom: true,
    }]);
    setShowAnswers(false);
  };

  // 퀴즈 생성
  const handleGenerate = () => {
    if (totalWords < 5) {
      alert('단어가 최소 5개 이상 필요합니다.');
      return;
    }
    if (totalQuizCount === 0) {
      alert('최소 1개 이상의 퀴즈 유형을 선택하고 문제 수를 입력하세요.');
      return;
    }
    const results = buildQuizzesFromConfig(wordList, configs);
    setGeneratedQuizzes(results);
    setShowAnswers(false);
  };

  // PDF 내보내기 (항상 정답 포함)
  const handleExportPdf = () => {
    if (generatedQuizzes.length === 0) {
      alert('먼저 퀴즈를 생성하세요.');
      return;
    }
    const html = generateQuizHtml(generatedQuizzes, true);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      {/* 퀴즈 설정 패널 */}
      <div
        style={{
          background: 'linear-gradient(135deg, #F5F3FF, #EDE9FE)',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '16px',
          flexShrink: 0,
        }}
      >
        <h3 style={{ margin: '0 0 16px', color: '#6D28D9', fontSize: '17px' }}>
          🎯 퀴즈 설정 (전체 {totalWords}개 단어)
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          {configs.map((config, idx) => (
            <div
              key={config.type}
              style={{
                background: 'white',
                borderRadius: '10px',
                padding: '14px',
                border: config.enabled ? `2px solid ${config.color}` : '2px solid #E5E7EB',
                opacity: totalWords < 5 ? 0.5 : 1,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '10px',
                }}
              >
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) =>
                    updateConfig(idx, {
                      enabled: e.target.checked,
                      count: e.target.checked ? counts[config.type] : 0,
                    })
                  }
                  style={{ width: '18px', height: '18px', accentColor: config.color }}
                />
                <span style={{ fontSize: '15px', fontWeight: 'bold', color: config.color }}>
                  {config.icon} {config.type}
                </span>
                <span style={{ fontSize: '12px', color: '#9CA3AF', marginLeft: 'auto' }}>
                  (최대 {counts[config.type]})
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: '#6B7280' }}>문제 수:</span>
                <input
                  type="number"
                  min={0}
                  max={counts[config.type]}
                  value={config.count}
                  onChange={(e) =>
                    updateConfig(idx, {
                      count: Math.max(0, Math.min(Number(e.target.value), counts[config.type])),
                      enabled: Number(e.target.value) > 0,
                    })
                  }
                  disabled={!config.enabled}
                  style={{
                    width: '75px',
                    padding: '7px 9px',
                    borderRadius: '6px',
                    border: '1px solid #D1D5DB',
                    fontSize: '15px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                  }}
                />
                {config.enabled && (
                  <button
                    onClick={() => updateConfig(idx, { count: counts[config.type] })}
                    style={{
                      ...btnSmStyle,
                      background: config.color,
                      padding: '3px 8px',
                      fontSize: '10px',
                    }}
                    title="최대로 설정"
                  >
                    MAX
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 합산 + 버튼 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: '#F0FDF4',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '15px' }}>
            <strong>
              총 {totalQuizCount}문제
            </strong>
            <span style={{ color: '#6B7280', marginLeft: '8px', fontSize: '13px' }}>
              (각 유형별 최대까지 자유롭게 설정 가능)
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleRandom}
              disabled={totalWords < 5}
              style={{
                ...btnStyle,
                background: totalWords < 5 ? '#D1D5DB' : 'linear-gradient(135deg, #F59E0B, #FBBF24)',
                fontSize: '14px',
                padding: '10px 20px',
              }}
            >
              🎲 랜덤 배정
            </button>
            <button
              onClick={handleGenerate}
              disabled={totalQuizCount === 0 || totalWords < 5}
              style={{
                ...btnStyle,
                background:
                  totalQuizCount === 0
                    ? '#D1D5DB'
                    : 'linear-gradient(135deg, #7C3AED, #A78BFA)',
                fontSize: '15px',
                padding: '10px 24px',
              }}
            >
              ✨ 퀴즈 생성
            </button>
            <button
              onClick={handleExportPdf}
              disabled={generatedQuizzes.length === 0}
              style={{
                ...btnStyle,
                background: generatedQuizzes.length > 0 ? '#DC2626' : '#D1D5DB',
              }}
            >
              📄 PDF 미리보기
            </button>
          </div>
        </div>
      </div>

      {/* 퀴즈 미리보기 */}
      {generatedQuizzes.length > 0 && (
        <div
          style={{
            border: '2px solid #E5E7EB',
            borderRadius: '12px',
            overflow: 'hidden',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              background: '#F3F4F6',
              flexShrink: 0,
            }}
          >
            <h3 style={{ margin: 0, color: '#1F2937', fontSize: '16px' }}>
              📋 퀴즈 미리보기 (
              {generatedQuizzes.reduce((s, q) => s + q.questions.length, 0)}문제)
            </h3>
            <button
              onClick={() => setShowAnswers(!showAnswers)}
              style={{
                ...btnSmStyle,
                background: showAnswers ? '#EF4444' : '#10B981',
              }}
            >
              {showAnswers ? '🙈 정답 숨기기' : '👁️ 정답 보기'}
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              minHeight: 0,
            }}
          >
            {generatedQuizzes.map((quiz, qIdx) => (
              <div key={qIdx} style={{ marginBottom: '24px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '12px',
                    padding: '8px 14px',
                    background: quiz._isRandom ? '#F5F3FF' : quiz.color + '15',
                    borderRadius: '8px',
                    borderLeft: `4px solid ${quiz.color}`,
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{quiz.icon}</span>
                  <span
                    style={{
                      fontWeight: 'bold',
                      color: quiz.color,
                      fontSize: '16px',
                    }}
                  >
                    {quiz._isRandom ? '랜덤퀴즈' : quiz.type} ({quiz.questions.length}문제)
                  </span>
                  {quiz._isRandom && (
                    <span style={{ fontSize: '11px', color: '#9CA3AF', marginLeft: '4px' }}>
                      모든 유형 혼합
                    </span>
                  )}
                </div>

                {quiz.questions.map((q) => (
                  <div
                    key={q.num}
                    style={{
                      marginBottom: '12px',
                      padding: '10px 14px',
                      background: '#FAFBFC',
                      borderRadius: '8px',
                      border: '1px solid #F3F4F6',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 'bold',
                        marginBottom: '6px',
                        fontSize: '14px',
                        color: '#1F2937',
                      }}
                    >
                      {q.num}. {q.question}
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: '6px',
                      }}
                    >
                      {q.choices.map((c, cIdx) => (
                        <div
                          key={cIdx}
                          style={{
                            padding: '5px 9px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            background:
                              showAnswers && cIdx + 1 === q.answer
                                ? '#DCFCE7'
                                : 'white',
                            border:
                              showAnswers && cIdx + 1 === q.answer
                                ? '2px solid #10B981'
                                : '1px solid #E5E7EB',
                            fontWeight:
                              showAnswers && cIdx + 1 === q.answer ? 'bold' : 'normal',
                          }}
                        >
                          {String.fromCharCode(9312 + cIdx)} {c}
                        </div>
                      ))}
                    </div>
                    {showAnswers && (
                      <div
                        style={{
                          marginTop: '4px',
                          fontSize: '11px',
                          color: '#10B981',
                          fontWeight: 'bold',
                        }}
                      >
                        정답: {String.fromCharCode(9312 + q.answer - 1)} {q.correct_word} (
                        {q.correct_meaning_kr})
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// 스타일
const btnStyle: React.CSSProperties = {
  padding: '9px 18px',
  borderRadius: '8px',
  border: 'none',
  color: 'white',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontSize: '14px',
  fontFamily: "'Noto Sans KR', sans-serif",
};

const btnSmStyle: React.CSSProperties = {
  padding: '6px 13px',
  borderRadius: '6px',
  border: 'none',
  color: 'white',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontSize: '13px',
};

// 퀴즈 HTML 생성 (원본 Python 스타일 참고)
function generateQuizHtml(
  quizzes: GeneratedQuiz[],
  withAnswers: boolean
): string {
  let quizSections = '';
  let answerSectionsMergedThreeCol = ''; // 3단 퀴즈 정답 한 묶음
  let answerSectionsRest = ''; // 랜덤/예문 정답
  let inMergedThreeCol = false;
  let inMergedAnswerThreeCol = false;

  for (const quiz of quizzes) {
    const isRandom = quiz._isRandom;
    const isExample = !isRandom && quiz.type === '예문퀴즈';
    const isThreeCol = !isRandom && !isExample; // 영한, 한영, 영영풀이, 유의어, 반의어
    const sectionTitle = isRandom ? '랜덤퀴즈' : quiz.type;

    // 3단 퀴즈: 하나의 묶음(quiz-sections-merged-three-col) 안에 제목+문제만 연속으로
    if (isThreeCol) {
      if (!inMergedThreeCol) {
        quizSections += `
    <div class="quiz-sections-merged-three-col">`;
        inMergedThreeCol = true;
      }
      quizSections += `
      <div class="section-header-inline">${sectionTitle}</div>`;
    } else {
      if (inMergedThreeCol) {
        quizSections += `
    </div>`;
        inMergedThreeCol = false;
      }
      quizSections += `
    <div class="quiz-section">
      <div class="section-header">${sectionTitle}</div>
      <div class="columns-2">`;
    }

    for (const q of quiz.questions) {
      let qTextHtml = q.question;
      if (isExample) {
        qTextHtml = qTextHtml.replace(
          /_________/g,
          '[<span class="blank" style="display:inline-block; min-width:105px; background:#F5F5F5; padding:2px 5px;">&nbsp;</span>]'
        );
      } else {
        qTextHtml = qTextHtml.replace(/_________/g, '<span class="blank">_________</span>');
      }

      let choicesHtml = '';
      for (let i = 0; i < q.choices.length; i++) {
        const circled = String.fromCharCode(9312 + i);
        choicesHtml += `<div class="choice">${circled} ${q.choices[i]}</div>`;
      }

      const numStr = String(q.num).padStart(2, '0');
      quizSections += `
        <div class="question">
          <div class="question-text"><span class="question-num">${numStr}</span><span class="question-body">${qTextHtml}</span></div>
          <div class="choices">${choicesHtml}</div>
        </div>`;
    }

    if (!isThreeCol) {
      quizSections += `
      </div>
    </div>`;
    }

    // 정답 섹션: 3단 퀴즈는 한 묶음으로, 랜덤/예문은 별도
    const answerHeaderTitle = `${sectionTitle} 정답`;
    const answerItemsHtml = quiz.questions
      .map((q) => {
        const circled = String.fromCharCode(9312 + q.answer - 1);
        const answerText =
          q.correct_word && q.correct_meaning_kr
            ? `${circled} ${q.correct_word} (${q.correct_meaning_kr})`
            : circled;
        const ansNumStr = String(q.num).padStart(2, '0');
        return `<div class="answer-item"><span class="num">${ansNumStr}</span> ${answerText}</div>`;
      })
      .join('');

    if (isThreeCol) {
      if (!inMergedAnswerThreeCol) {
        answerSectionsMergedThreeCol += `
    <div class="answer-sections-merged-three-col">`;
        inMergedAnswerThreeCol = true;
      }
      answerSectionsMergedThreeCol += `
      <div class="answer-header-inline">${answerHeaderTitle}</div>
      <div class="answer-grid">${answerItemsHtml}</div>`;
    } else {
      if (inMergedAnswerThreeCol) {
        answerSectionsMergedThreeCol += `
    </div>`;
        inMergedAnswerThreeCol = false;
      }
      answerSectionsRest += `
    <div class="answer-section">
      <div class="answer-header">${answerHeaderTitle}</div>
      <div class="answer-grid">${answerItemsHtml}</div>
    </div>`;
    }
  }

  if (inMergedThreeCol) {
    quizSections += `
    </div>`;
  }

  if (inMergedAnswerThreeCol) {
    answerSectionsMergedThreeCol += `
    </div>`;
  }

  const answerSections =
    (answerSectionsMergedThreeCol ? answerSectionsMergedThreeCol : '') +
    answerSectionsRest;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>퀴즈</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Noto Sans KR', sans-serif;
      background: #FFFFFF;
      padding: 15px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      color-adjust: exact;
      font-size: 11px;
    }
    /* 퀴즈 유형 섹션 */
    .quiz-section { margin-bottom: 30px; }
    .quiz-section:not(:first-child) { page-break-before: always; }
    /* 3단 퀴즈 전부 한 묶음: 영한/한영/영영/유의어/반의어 연속 배치, 공간 효율 */
    .quiz-sections-merged-three-col {
      column-count: 3; column-gap: 15px; column-rule: 1px dashed #CCC; column-fill: auto;
      margin-bottom: 20px;
    }
    .section-header-inline {
      background: #1E40AF; color: #FFFFFF;
      padding: 6px 8px; font-weight: 700; font-size: 11px;
      margin-bottom: 8px; text-align: center; break-inside: avoid;
    }
    /* 2단 퀴즈(랜덤/예문) 전용 헤더 - 전체 너비 */
    .section-header {
      background: #1E40AF; color: #FFFFFF;
      padding: 10px 12px; font-weight: 700; font-size: 15px;
      margin-bottom: 10px; text-align: center; column-span: all;
    }
    /* 문제 번호 뱃지 - 헤더와 동일한 진한 파란 */
    .question-num {
      flex-shrink: 0; display: inline-block; background: #1E40AF; color: #FFFFFF;
      padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 11px;
      min-width: 22px; text-align: center;
    }
    /* 문제 텍스트 영역 - 번호와 분리되어 줄바꿈 시 번호 영역 침범 안 함 */
    .question-text {
      display: flex; align-items: flex-start; gap: 6px;
      font-size: 11px; font-weight: 500; margin-bottom: 4px; color: #1F2937; line-height: 1.4;
    }
    .question-body { flex: 1; min-width: 0; }
    /* CSS Multi-column - 3단 */
    .columns-3 { column-count: 3; column-gap: 15px; column-rule: 1px dashed #CCC; column-fill: auto; }
    /* CSS Multi-column - 2단 */
    .columns-2 { column-count: 2; column-gap: 20px; column-rule: 1px dashed #CCC; column-fill: auto; }
    /* 문제 */
    .question { margin-bottom: 8px; padding: 5px 0; break-inside: avoid; }
    .question-body .blank { color: #DC2626; font-weight: 700; }
    .choices { margin-left: 15px; }
    .choice { font-size: 10px; color: #4B5563; margin: 2px 0; }
    /* 정답 섹션 */
    .answers-wrapper { page-break-before: always; }
    .answer-sections-merged-three-col {
      column-count: 3; column-gap: 15px; column-rule: 1px dashed #CCC; column-fill: auto;
      margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px dashed #CCC;
    }
    .answer-header-inline {
      background: #1E40AF; color: #FFFFFF;
      padding: 6px 8px; font-weight: 700; font-size: 11px;
      margin: 10px 0 6px 0; text-align: center; break-inside: avoid;
    }
    .answer-sections-merged-three-col .answer-grid {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 10px; font-size: 10px;
    }
    .answer-section { margin-top: 15px; }
    .answer-section .answer-header {
      background: #1E40AF; color: #FFFFFF;
      padding: 10px 12px; font-weight: 700; font-size: 14px; margin-bottom: 10px; text-align: center;
    }
    .answer-section .answer-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; font-size: 10px; }
    .answer-item { background: #F5F5F5; padding: 4px 6px; text-align: left; }
    .answer-item .num {
      display: inline-block; background: #1E40AF; color: #FFFFFF;
      padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 10px;
      margin-right: 4px; min-width: 20px; text-align: center;
    }
    /* 플로팅 버튼 */
    .floating-btn-wrap { position: fixed; bottom: 30px; right: 30px; display: flex; flex-direction: column; gap: 10px; z-index: 9999; }
    .floating-btn { width: 56px; height: 56px; border-radius: 50%; border: none; color: white; font-size: 22px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; transition: transform 0.2s, box-shadow 0.2s; }
    .floating-btn:hover { transform: scale(1.1); box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
    .floating-btn.print { background: linear-gradient(135deg, #7C3AED, #A78BFA); }
    .floating-btn.close { background: linear-gradient(135deg, #6B7280, #9CA3AF); }
    /* 인쇄 스타일 */
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
      body { padding: 10px; }
      .floating-btn-wrap { display: none; }
      .quiz-section:not(:first-child) { page-break-before: always; }
    }
  </style>
</head>
<body>
  ${quizSections}
  ${withAnswers ? `<div class="answers-wrapper">${answerSections}</div>` : ''}
  <div class="floating-btn-wrap">
    <button class="floating-btn print" onclick="window.print()" title="PDF로 인쇄/저장">🖨️</button>
    <button class="floating-btn close" onclick="window.close()" title="닫기">✕</button>
  </div>
</body>
</html>`;
}

export default QuizTab;
