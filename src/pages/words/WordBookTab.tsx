import React, { useState, useEffect, useRef } from 'react';
import type { Word, Sentence, WordsJsonData } from '../../types/words';

interface SavedWordBook {
  id: string;
  name: string;
  createdAt: string;
  wordCount: number;
  sentenceCount: number;
  words: Word[];
  sentences: Sentence[];
}

interface WordBookTabProps {
  wordList: Word[];
  sentences: Sentence[];
  setWordList: React.Dispatch<React.SetStateAction<Word[]>>;
  setSentences: React.Dispatch<React.SetStateAction<Sentence[]>>;
}

const STORAGE_KEY = 'jaegeun-wordbooks';

function loadWordBooks(): SavedWordBook[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWordBooks(books: SavedWordBook[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
}

const WordBookTab: React.FC<WordBookTabProps> = ({ wordList, sentences, setWordList, setSentences }) => {
  const [savedBooks, setSavedBooks] = useState<SavedWordBook[]>([]);
  const [viewingBook, setViewingBook] = useState<SavedWordBook | null>(null);
  const [saveName, setSaveName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSavedBooks(loadWordBooks());
  }, []);

  // --- 현재 단어장 저장 ---
  const handleSave = () => {
    if (!saveName.trim()) {
      alert('단어장 이름을 입력하세요.');
      return;
    }
    if (wordList.length === 0 && sentences.length === 0) {
      alert('저장할 단어나 문장이 없습니다. 입력 탭에서 먼저 데이터를 준비하세요.');
      return;
    }
    const newBook: SavedWordBook = {
      id: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: saveName.trim(),
      createdAt: new Date().toISOString(),
      wordCount: wordList.length,
      sentenceCount: sentences.length,
      words: wordList.map((w) => ({ ...w, pronunciation_kr: w.pronunciation_kr ?? '' })),
      sentences: [...sentences],
    };
    const updated = [newBook, ...savedBooks];
    setSavedBooks(updated);
    saveWordBooks(updated);
    setSaveName('');
    setShowSaveForm(false);
    alert(`✅ "${newBook.name}" 단어장이 저장되었습니다!`);
  };

  // --- 단어장 삭제 ---
  const handleDelete = (id: string) => {
    if (!window.confirm('이 단어장을 삭제하시겠습니까?')) return;
    const updated = savedBooks.filter((b) => b.id !== id);
    setSavedBooks(updated);
    saveWordBooks(updated);
    if (viewingBook?.id === id) setViewingBook(null);
  };

  // --- 단어장 불러오기 (편집 탭으로) ---
  const handleLoadToEditor = (book: SavedWordBook) => {
    if (wordList.length > 0 || sentences.length > 0) {
      if (!window.confirm('현재 작업 중인 단어/문장이 있습니다. 덮어쓰시겠습니까?')) return;
    }
    setWordList(book.words);
    setSentences(book.sentences);
    alert(`✅ "${book.name}" 단어장을 불러왔습니다. 편집/저장 탭에서 확인하세요.`);
  };

  // --- JSON 파일 가져오기 ---
  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data: WordsJsonData = JSON.parse(text);
      if (!data.words || !Array.isArray(data.words)) {
        alert('올바른 단어장 JSON 형식이 아닙니다.');
        return;
      }
      const words = data.words.map((w: Word & { pronunciation_kr?: string }) => ({
        ...w,
        pronunciation_kr: w.pronunciation_kr ?? '',
      }));
      const sents: Sentence[] = Array.isArray(data.sentences)
        ? data.sentences.map((s: any) => ({
            source: s.source || '',
            sentence_en: s.sentence_en || s.english || '',
            sentence_kr: s.sentence_kr || s.korean || '',
          }))
        : [];
      const name = file.name.replace(/\.json$/, '') || '가져온 단어장';
      const newBook: SavedWordBook = {
        id: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        createdAt: data.created_at || new Date().toISOString(),
        wordCount: words.length,
        sentenceCount: sents.length,
        words,
        sentences: sents,
      };
      const updated = [newBook, ...savedBooks];
      setSavedBooks(updated);
      saveWordBooks(updated);
      alert(`✅ "${name}" - ${words.length}개 단어, ${sents.length}개 문장을 가져왔습니다!`);
    } catch {
      alert('JSON 파일 읽기 실패');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- JSON 내보내기 ---
  const handleExportJson = (book: SavedWordBook) => {
    const data: WordsJsonData = {
      version: '1.0',
      created_at: book.createdAt,
      word_count: book.wordCount,
      words: book.words,
      sentences: book.sentences,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- 미리보기 HTML ---
  const handlePreviewHtml = (book: SavedWordBook) => {
    const html = generateWordBookHtml(book.words, book.name);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  // --- 보기 모드 ---
  if (viewingBook) {
    return (
      <div style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={() => setViewingBook(null)} style={{ ...btnStyle, background: '#6B7280', padding: '8px 16px' }}>
              ← 목록으로
            </button>
            <h2 style={{ margin: 0, color: '#1E40AF', fontSize: '20px' }}>
              📖 {viewingBook.name}
            </h2>
            <span style={{ color: '#9CA3AF', fontSize: '14px' }}>
              {viewingBook.wordCount}개 단어 · {viewingBook.sentenceCount}개 문장
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => handleLoadToEditor(viewingBook)} style={{ ...btnStyle, background: '#10B981' }}>
              📥 편집탭에 불러오기
            </button>
            <button onClick={() => handlePreviewHtml(viewingBook)} style={{ ...btnStyle, background: '#7C3AED' }}>
              🖨️ 인쇄용 미리보기
            </button>
          </div>
        </div>

        {/* 단어 카드 목록 */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {renderWordCards(viewingBook.words)}
        </div>
      </div>
    );
  }

  // --- 메인 목록 뷰 ---
  return (
    <div style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 상단 액션 바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexShrink: 0 }}>
        <h2 style={{ margin: 0, color: '#1E40AF', fontSize: '20px' }}>
          📚 내 단어장 ({savedBooks.length})
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="file"
            ref={fileInputRef}
            accept=".json"
            onChange={handleImportJson}
            style={{ display: 'none' }}
          />
          <button onClick={() => fileInputRef.current?.click()} style={{ ...btnStyle, background: '#3B82F6' }}>
            📂 JSON 가져오기
          </button>
          <button
            onClick={() => setShowSaveForm(!showSaveForm)}
            disabled={wordList.length === 0 && sentences.length === 0}
            style={{
              ...btnStyle,
              background: wordList.length === 0 && sentences.length === 0 ? '#D1D5DB' : '#10B981',
            }}
          >
            💾 현재 단어장 저장
          </button>
        </div>
      </div>

      {/* 저장 폼 */}
      {showSaveForm && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '16px',
            padding: '16px',
            background: '#F0FDF4',
            borderRadius: '12px',
            border: '2px solid #86EFAC',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 'bold', color: '#166534', fontSize: '14px', flexShrink: 0 }}>💾 이름:</span>
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="단어장 이름을 입력하세요 (예: 고2 10월 모의고사)"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #BBF7D0',
              fontSize: '14px',
              fontFamily: "'Noto Sans KR', sans-serif",
            }}
          />
          <button onClick={handleSave} style={{ ...btnStyle, background: '#10B981' }}>
            저장
          </button>
          <button onClick={() => { setShowSaveForm(false); setSaveName(''); }} style={{ ...btnStyle, background: '#9CA3AF' }}>
            취소
          </button>
          <span style={{ color: '#6B7280', fontSize: '13px' }}>
            (단어 {wordList.length}개, 문장 {sentences.length}개)
          </span>
        </div>
      )}

      {/* 단어장 목록 */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {savedBooks.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              color: '#9CA3AF',
            }}
          >
            <div style={{ fontSize: '64px', marginBottom: '16px' }}>📚</div>
            <h3 style={{ color: '#6B7280', marginBottom: '8px' }}>저장된 단어장이 없습니다</h3>
            <p style={{ fontSize: '14px', textAlign: 'center', lineHeight: '1.8' }}>
              입력 탭에서 단어를 추출한 후 여기서 저장하거나,
              <br />
              기존 JSON 파일을 가져올 수 있습니다.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
            {savedBooks.map((book) => (
              <div
                key={book.id}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  border: '2px solid #E5E7EB',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#93C5FD';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#E5E7EB';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {/* 카드 상단 */}
                <div
                  onClick={() => setViewingBook(book)}
                  style={{
                    padding: '16px',
                    background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
                    borderBottom: '1px solid #BFDBFE',
                  }}
                >
                  <h3 style={{ margin: '0 0 4px', color: '#1E40AF', fontSize: '16px', fontWeight: 700 }}>
                    📖 {book.name}
                  </h3>
                  <p style={{ margin: 0, color: '#6B7280', fontSize: '12px' }}>
                    {new Date(book.createdAt).toLocaleDateString('ko-KR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>

                {/* 카드 바디 */}
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ background: '#DBEAFE', color: '#1E40AF', padding: '2px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 700 }}>
                        📊 {book.wordCount}개
                      </span>
                      <span style={{ color: '#6B7280', fontSize: '12px' }}>단어</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ background: '#E0E7FF', color: '#4338CA', padding: '2px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 700 }}>
                        📝 {book.sentenceCount}개
                      </span>
                      <span style={{ color: '#6B7280', fontSize: '12px' }}>문장</span>
                    </div>
                  </div>

                  {/* 출처 미리보기 */}
                  {book.words.length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      {[...new Set(book.words.map((w) => w.source))].slice(0, 3).map((src) => (
                        <span
                          key={src}
                          style={{
                            display: 'inline-block',
                            background: '#F3F4F6',
                            color: '#6B7280',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            marginRight: '4px',
                            marginBottom: '4px',
                          }}
                        >
                          {src}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 액션 버튼 */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewingBook(book); }}
                      style={{ ...btnSmStyle, background: '#3B82F6' }}
                    >
                      👁️ 보기
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleLoadToEditor(book); }}
                      style={{ ...btnSmStyle, background: '#10B981' }}
                    >
                      📥 불러오기
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handlePreviewHtml(book); }}
                      style={{ ...btnSmStyle, background: '#7C3AED' }}
                    >
                      🖨️ 인쇄
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExportJson(book); }}
                      style={{ ...btnSmStyle, background: '#F59E0B' }}
                    >
                      📤 JSON
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(book.id); }}
                      style={{ ...btnSmStyle, background: '#EF4444' }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// --- 인라인 단어 카드 렌더링 ---
function renderWordCards(words: Word[]): React.ReactNode {
  const groups: Record<string, Word[]> = {};
  for (const w of words) {
    const src = w.source || '기타';
    if (!groups[src]) groups[src] = [];
    groups[src].push(w);
  }

  let globalIdx = 0;
  const elements: React.ReactNode[] = [];

  for (const [source, groupWords] of Object.entries(groups)) {
    elements.push(
      <div
        key={`src-${source}`}
        style={{
          textAlign: 'center',
          margin: '16px 0 12px',
          padding: '10px',
          background: '#F0F7FF',
          borderRadius: '8px',
        }}
      >
        <span style={{ color: '#1E40AF', fontSize: '18px', fontWeight: 700 }}>{source}</span>
      </div>
    );

    for (const w of groupWords) {
      globalIdx++;
      elements.push(
        <div
          key={`word-${globalIdx}`}
          style={{
            display: 'flex',
            background: 'white',
            borderRadius: '10px',
            marginBottom: '8px',
            border: '1px solid #E0E0E0',
            boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
            overflow: 'hidden',
            minHeight: '110px',
          }}
        >
          {/* Left */}
          <div
            style={{
              width: '25%',
              minWidth: '120px',
              background: 'linear-gradient(180deg, #EFF6FF 0%, #DBEAFE 100%)',
              display: 'flex',
              flexDirection: 'column',
              padding: '8px 10px',
              borderRight: '2px solid #BFDBFE',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span
                style={{
                  background: 'linear-gradient(135deg, #1D4ED8, #60A5FA)',
                  color: 'white',
                  padding: '2px 10px',
                  borderRadius: '10px',
                  fontSize: '9px',
                  fontWeight: 700,
                }}
              >
                {String(globalIdx).padStart(3, '0')}
              </span>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: '18px', fontWeight: 900, color: '#1D4ED8', textAlign: 'center', wordBreak: 'break-word', marginBottom: '4px' }}>
                {w.word}
              </div>
              {w.pronunciation && (
                <div style={{ color: '#888', fontSize: '10px', textAlign: 'center' }}>{w.pronunciation}</div>
              )}
              {w.pronunciation_kr && (
                <div style={{ color: '#64748B', fontSize: '11px', textAlign: 'center' }}>{w.pronunciation_kr}</div>
              )}
            </div>
            {(w.synonyms || w.antonyms) && (
              <div style={{ display: 'flex', gap: '4px', paddingTop: '4px', borderTop: '1px dashed #DDD', width: '100%' }}>
                {w.synonyms && (
                  <div style={{ flex: 1 }}>
                    <span style={{ background: '#EFF6FF', color: '#1D4ED8', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, fontSize: '7px' }}>동</span>
                    <div style={{ color: '#555', fontSize: '8px', lineHeight: 1.3 }}>{w.synonyms}</div>
                  </div>
                )}
                {w.antonyms && (
                  <div style={{ flex: 1 }}>
                    <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, fontSize: '7px' }}>반</span>
                    <div style={{ color: '#555', fontSize: '8px', lineHeight: 1.3 }}>{w.antonyms}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8px 12px', gap: '4px' }}>
            {/* 품사 + 뜻 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '4px', borderBottom: '1px solid #ECECEC' }}>
              <span style={{ background: '#EFF6FF', color: '#1D4ED8', fontWeight: 700, fontSize: '9px', padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>
                {w.pos}
              </span>
              <span style={{ fontSize: '14px', color: '#1a1a1a', fontWeight: 700 }}>{w.meaning_kr}</span>
              {w.derivatives_str && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                  <span style={{ background: '#ECFDF5', color: '#0D9488', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, fontSize: '7px' }}>파생</span>
                  <span style={{ color: '#555', fontSize: '8px' }}>{w.derivatives_str}</span>
                </div>
              )}
              <span style={{ background: '#F0F0F0', color: '#888', padding: '2px 6px', borderRadius: '4px', fontSize: '8px', marginLeft: 'auto', flexShrink: 0 }}>
                {w.source}
              </span>
            </div>

            {/* 영영 풀이 */}
            {w.meaning_en && (
              <div style={{ padding: '3px 0', borderBottom: '1px solid #ECECEC' }}>
                <span style={{ color: '#555', fontSize: '10px', lineHeight: 1.5 }}>{w.meaning_en}</span>
              </div>
            )}

            {/* 표현 */}
            {w.collocations && (
              <div style={{ padding: '4px 6px', background: '#E8F4FD', borderRadius: '4px', marginTop: '2px' }}>
                <span style={{ background: '#BFDBFE', color: '#1E40AF', padding: '1px 5px', borderRadius: '3px', fontWeight: 700, fontSize: '8px', marginRight: '6px' }}>collocations</span>
                <span style={{ color: '#1E3A5F', fontSize: '9px' }}>{w.collocations}</span>
              </div>
            )}

            {/* 예문 + Tip */}
            <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', flex: 1 }}>
              <div
                style={{
                  flex: 3,
                  background: 'linear-gradient(90deg, #F0F7FF, #FFF)',
                  borderLeft: '3px solid #2563EB',
                  padding: '6px 8px',
                  borderRadius: '0 6px 6px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{ color: '#333', fontSize: '11px', lineHeight: 1.5, marginBottom: '3px' }}
                  dangerouslySetInnerHTML={{ __html: highlightWord(w.example_en, w.word) }}
                />
                <div style={{ color: '#777', fontSize: '10px', lineHeight: 1.4 }}>{w.example_kr}</div>
              </div>
              {w.tip && (
                <div
                  style={{
                    flex: 1,
                    background: 'linear-gradient(135deg, #F1F5F9, #E2E8F0)',
                    padding: '6px',
                    borderRadius: '5px',
                    borderLeft: '3px solid #64748B',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <span style={{ background: '#E2E8F0', color: '#475569', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, fontSize: '7px', marginBottom: '3px', alignSelf: 'flex-start' }}>
                    💡 Tip
                  </span>
                  <div style={{ color: '#334155', fontSize: '8px', lineHeight: 1.4, fontWeight: 500 }}>{w.tip}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
  }

  return <>{elements}</>;
}

function highlightWord(text: string, word: string): string {
  if (!text || !word) return text || '';
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped}\\w*)`, 'gi');
  return text.replace(regex, '<span style="color:#1D4ED8;font-weight:700;background:rgba(37,99,235,0.08);padding:0 2px;border-radius:2px;">$1</span>');
}

// --- 인쇄용 HTML 생성 ---
function generateWordBookHtml(wordList: Word[], title: string): string {
  let cards = '';
  const groups: Record<string, Word[]> = {};
  for (const w of wordList) {
    const src = w.source || '기타';
    if (!groups[src]) groups[src] = [];
    groups[src].push(w);
  }

  let globalIdx = 0;
  for (const [source, words] of Object.entries(groups)) {
    const isFirst = globalIdx === 0;
    cards += `<div class="source-divider ${isFirst ? 'first' : ''}"><span class="source-title">${source}</span></div>`;
    for (const w of words) {
      globalIdx++;
      const numStr = String(globalIdx).padStart(3, '0');
      const hlExample = highlightWord(w.example_en, w.word);
      cards += `
      <div class="word-card">
        <div class="card-left">
          <div class="number-row">
            <span class="word-number">${numStr}</span>
            <div class="checkbox-group"><input type="checkbox" title="1회차"><input type="checkbox" title="2회차"><input type="checkbox" title="3회차"></div>
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
          <div class="row-meaning-en"><div class="word-meaning-en">${w.meaning_en}</div></div>
          ${w.collocations ? `<div class="row-collocations"><span class="collocations-label">collocations</span><span class="collocations-content">${w.collocations}</span></div>` : ''}
          <div class="row-bottom">
            <div class="example-box">
              <div class="example-en">${hlExample}</div>
              <div class="example-kr">${w.example_kr}</div>
            </div>
            ${w.tip ? `<div class="tip-box"><span class="tip-label">💡 Tip</span><div class="tip-content">${w.tip}</div></div>` : ''}
          </div>
        </div>
      </div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${title} - 재근쌤 단어장</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap');
    * { font-family: 'Noto Sans KR', sans-serif; box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 8mm; }
    body { background: #F5F5F5; padding: 12px; font-size: 11px; line-height: 1.5; color: #333; }
    .container { max-width: 210mm; margin: 0 auto; }
    .page-title { text-align: center; font-size: 22px; font-weight: 900; color: #1E40AF; margin-bottom: 16px; padding: 12px; background: #EFF6FF; border-radius: 8px; }
    .source-divider { text-align: center; margin: 20px 0 12px; padding: 10px; background: #F0F7FF; border-radius: 6px; page-break-before: always; }
    .source-divider.first { page-break-before: avoid; margin-top: 0; }
    .source-title { color: #1E40AF; font-size: 18px; font-weight: 700; }
    .word-card { background: #FFF; border-radius: 10px; margin-bottom: 8px; page-break-inside: avoid; break-inside: avoid; display: flex; overflow: hidden; min-height: 124px; border: 1px solid #E0E0E0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .card-left { width: 27%; min-width: 120px; background: linear-gradient(180deg, #EFF6FF, #DBEAFE); display: flex; flex-direction: column; padding: 8px 10px; border-right: 2px solid #BFDBFE; }
    .number-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .word-number { background: linear-gradient(135deg, #1D4ED8, #60A5FA); color: white; padding: 2px 10px; border-radius: 10px; font-size: 9px; font-weight: 700; }
    .checkbox-group { display: flex; gap: 3px; }
    .checkbox-group input[type="checkbox"] { width: 14px; height: 14px; accent-color: #2563EB; }
    .word-area { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .word-main { font-size: 20px; font-weight: 900; color: #1D4ED8; text-align: center; word-break: break-word; margin-bottom: 4px; }
    .word-pronunciation { color: #888; font-size: 10px; text-align: center; margin-bottom: 2px; }
    .word-pronunciation-kr { color: #64748B; font-size: 11px; text-align: center; }
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
    .example-box { flex: 3; background: linear-gradient(90deg, #F0F7FF, #FFF); border-left: 3px solid #2563EB; padding: 6px 8px; border-radius: 0 6px 6px 0; display: flex; flex-direction: column; justify-content: center; }
    .example-en { color: #333; font-size: 11px; line-height: 1.5; margin-bottom: 3px; }
    .example-en span { color: #1D4ED8; font-weight: 700; }
    .example-kr { color: #777; font-size: 10px; line-height: 1.4; }
    .tip-box { flex: 1; background: linear-gradient(135deg, #F1F5F9, #E2E8F0); padding: 6px; border-radius: 5px; border-left: 3px solid #64748B; display: flex; flex-direction: column; }
    .tip-label { display: inline-block; background: #E2E8F0; color: #475569; padding: 1px 4px; border-radius: 3px; font-weight: 700; font-size: 7px; margin-bottom: 3px; align-self: flex-start; }
    .tip-content { color: #334155; font-size: 8px; line-height: 1.4; font-weight: 500; }
    .floating-btn-wrap { position: fixed; bottom: 30px; right: 30px; display: flex; flex-direction: column; gap: 10px; z-index: 9999; }
    .floating-btn { width: 56px; height: 56px; border-radius: 50%; border: none; color: white; font-size: 22px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; transition: transform 0.2s; }
    .floating-btn:hover { transform: scale(1.1); }
    .floating-btn.print { background: linear-gradient(135deg, #1E3A8A, #3B82F6); }
    .floating-btn.close { background: linear-gradient(135deg, #6B7280, #9CA3AF); }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { padding: 0; background: white; }
      .page-title { margin-bottom: 10px; }
      .word-card { box-shadow: none; margin-bottom: 8px !important; page-break-inside: avoid !important; }
      .source-divider { page-break-before: always; }
      .source-divider.first { page-break-before: avoid; }
      .floating-btn-wrap { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="page-title">📖 ${title}</div>
    ${cards}
  </div>
  <div class="floating-btn-wrap">
    <button class="floating-btn print" onclick="window.print()" title="PDF로 인쇄/저장">🖨️</button>
    <button class="floating-btn close" onclick="window.close()" title="닫기">✕</button>
  </div>
</body>
</html>`;
}

// --- 스타일 ---
const btnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '8px',
  border: 'none',
  color: 'white',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontSize: '13px',
  fontFamily: "'Noto Sans KR', sans-serif",
};

const btnSmStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: '6px',
  border: 'none',
  color: 'white',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontSize: '11px',
  fontFamily: "'Noto Sans KR', sans-serif",
};

export default WordBookTab;
