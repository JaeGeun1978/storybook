import React, { useState, useEffect } from 'react';
import type { Word, Sentence, DirectReadSentence } from '../../types/words';
import InputTab from './InputTab';
import EditTab from './EditTab';
import QuizTab from './QuizTab';
import DirectReadTab from './DirectReadTab';
import ComprehensiveTab from './ComprehensiveTab';
import VideoTab from './VideoTab';
import WordBookTab from './WordBookTab';

type TabId = 'input' | 'edit' | 'quiz' | 'directread' | 'comprehensive' | 'video' | 'wordbook';

const TABS: { id: TabId; label: string; icon: string; color: string }[] = [
  { id: 'input', label: '입력', icon: '✏️', color: '#7C3AED' },
  { id: 'edit', label: '편집 / 저장', icon: '📋', color: '#3B82F6' },
  { id: 'quiz', label: '퀴즈', icon: '🎯', color: '#10B981' },
  { id: 'directread', label: '직독직해', icon: '📖', color: '#0EA5E9' },
  { id: 'comprehensive', label: '종합본', icon: '📚', color: '#F59E0B' },
  { id: 'video', label: '동영상', icon: '🎬', color: '#EF4444' },
  { id: 'wordbook', label: '단어장', icon: '📕', color: '#1E40AF' },
];

const WordsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('input');
  const [wordList, setWordList] = useState<Word[]>([]);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  /** 직독직해 탭에서 생성/편집한 문장별 분석. sentences[i] ↔ sentenceAnalyses[i] */
  const [sentenceAnalyses, setSentenceAnalyses] = useState<(DirectReadSentence | null)[]>([]);

  const switchToEdit = () => setActiveTab('edit');

  useEffect(() => {
    setSentenceAnalyses((prev) => {
      const next = [...prev];
      while (next.length < sentences.length) next.push(null);
      if (next.length > sentences.length) return next.slice(0, sentences.length);
      return next;
    });
  }, [sentences.length]);

  // 문장에 id 없으면 부여 (음성·슬라이드 ID 매칭용)
  useEffect(() => {
    const needId = sentences.some((s) => !s.id);
    if (!needId) return;
    setSentences((prev) =>
      prev.map((s, i) => ({
        ...s,
        id: s.id || `s-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 11)}`,
      }))
    );
  }, [sentences]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 페이지 헤더 */}
      <div
        style={{
          padding: '16px 20px',
          background: 'linear-gradient(135deg, #7C3AED 0%, #A78BFA 100%)',
          borderRadius: '12px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              color: 'white',
              fontSize: '24px',
              fontWeight: 900,
            }}
          >
            📖 재근쌤 단어장
          </h1>
          <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.8)', fontSize: '14px' }}>
            영문 텍스트 → AI 단어 추출 → 퀴즈 생성
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            gap: '12px',
            color: 'white',
            fontSize: '14px',
          }}
        >
          <span>📊 단어 {wordList.length}개</span>
          <span>📝 문장 {sentences.length}개</span>
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '0',
          padding: '0 4px',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const isDisabled = false;
          return (
            <button
              key={tab.id}
              onClick={() => !isDisabled && setActiveTab(tab.id)}
              disabled={isDisabled}
              style={{
                padding: '11px 22px',
                borderRadius: '10px 10px 0 0',
                border: 'none',
                background: isActive
                  ? 'white'
                  : isDisabled
                    ? '#E5E7EB'
                    : '#F3F4F6',
                color: isActive ? tab.color : isDisabled ? '#9CA3AF' : '#6B7280',
                fontWeight: isActive ? 'bold' : 'normal',
                fontSize: '15px',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                fontFamily: "'Noto Sans KR', sans-serif",
                borderBottom: isActive ? '3px solid ' + tab.color : '3px solid transparent',
                transition: 'all 0.2s',
                opacity: isDisabled ? 0.6 : 1,
              }}
            >
              {tab.icon} {tab.label}
              {isDisabled && ' (준비 중)'}
            </button>
          );
        })}
      </div>

      {/* 탭 컨텐츠 */}
      <div
        className="words-page-content"
        style={{
          flex: 1,
          background: 'white',
          borderRadius: '0 12px 12px 12px',
          border: '2px solid #E5E7EB',
          overflow: 'auto',
          minHeight: 0,
          color: '#1F2937',
        }}
      >
        {activeTab === 'input' && (
          <InputTab
            sentences={sentences}
            setSentences={setSentences}
            wordList={wordList}
            setWordList={setWordList}
            onSwitchToEdit={switchToEdit}
          />
        )}
        {activeTab === 'edit' && (
          <EditTab
            wordList={wordList}
            setWordList={setWordList}
            sentences={sentences}
            setSentences={setSentences}
            setSentenceAnalyses={setSentenceAnalyses}
          />
        )}
        {activeTab === 'quiz' && <QuizTab wordList={wordList} />}
        {activeTab === 'directread' && (
          <DirectReadTab
            sentences={sentences}
            wordList={wordList}
            sentenceAnalyses={sentenceAnalyses}
            setSentenceAnalyses={setSentenceAnalyses}
            setSentences={setSentences}
          />
        )}
        {activeTab === 'comprehensive' && (
          <ComprehensiveTab
            wordList={wordList}
            sentences={sentences}
            sentenceAnalyses={sentenceAnalyses}
          />
        )}
        {activeTab === 'video' && (
          <VideoTab wordList={wordList} sentences={sentences} sentenceAnalyses={sentenceAnalyses} />
        )}
        {activeTab === 'wordbook' && (
          <WordBookTab
            wordList={wordList}
            sentences={sentences}
            setWordList={setWordList}
            setSentences={setSentences}
          />
        )}
      </div>
    </div>
  );
};

export default WordsPage;
