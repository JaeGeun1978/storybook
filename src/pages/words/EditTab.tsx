import React, { useState, useRef } from 'react';
import type { Word, WordsJsonData, Sentence, DirectReadSentence } from '../../types/words';

interface EditTabProps {
  wordList: Word[];
  setWordList: React.Dispatch<React.SetStateAction<Word[]>>;
  sentences: Sentence[];
  setSentences: React.Dispatch<React.SetStateAction<Sentence[]>>;
  setSentenceAnalyses?: React.Dispatch<React.SetStateAction<(DirectReadSentence | null)[]>>;
}

const COLUMNS: { key: keyof Word; label: string; width: string }[] = [
  { key: 'source', label: '출처', width: '100px' },
  { key: 'word', label: '단어', width: '110px' },
  { key: 'pronunciation', label: '발음', width: '90px' },
  { key: 'pos', label: '품사', width: '50px' },
  { key: 'meaning_kr', label: '한글 뜻', width: '130px' },
  { key: 'meaning_en', label: '영영 풀이', width: '180px' },
  { key: 'collocations', label: '표현', width: '150px' },
  { key: 'example_en', label: '예문(영)', width: '200px' },
  { key: 'example_kr', label: '예문(한)', width: '200px' },
  { key: 'derivatives_str', label: '파생어', width: '100px' },
  { key: 'synonyms', label: '유의어', width: '100px' },
  { key: 'antonyms', label: '반의어', width: '80px' },
  { key: 'tip', label: 'Tip', width: '160px' },
];

const EditTab: React.FC<EditTabProps> = ({ wordList, setWordList, sentences, setSentences, setSentenceAnalyses }) => {
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{
    row: number;
    col: keyof Word;
  } | null>(null);
  const [editValue, setEditValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // JSON 저장 (이름 입력)
  const handleSaveJson = () => {
    const defaultName = `단어장_${new Date().toISOString().slice(0, 10)}`;
    const fileName = window.prompt('저장할 파일 이름을 입력하세요:', defaultName);
    if (!fileName) return; // 취소 시

    // 저장 시 pronunciation_kr 항상 포함 (생성된 JSON에 키 보장)
    const wordsForSave = wordList.map((w) => ({
      ...w,
      pronunciation_kr: w.pronunciation_kr ?? '',
    }));
    const data: WordsJsonData = {
      version: '1.0',
      created_at: new Date().toISOString(),
      word_count: wordList.length,
      words: wordsForSave,
      sentences: sentences,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // JSON 불러오기 (웹앱 형식 + 원본 Python 형식 모두 호환)
  const handleLoadJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.words && Array.isArray(data.words)) {
        // 로드 시 pronunciation_kr 없으면 빈 문자열로 보정 (예전 JSON 호환)
        const normalized = data.words.map((w: Word & { pronunciation_kr?: string }) => ({
          ...w,
          pronunciation_kr: w.pronunciation_kr ?? '',
        }));
        setWordList(normalized);

        // 문장 로드: 웹앱 형식(sentence_en/sentence_kr) + 원본 형식(english/korean) 모두 지원
        if (data.sentences && Array.isArray(data.sentences)) {
          const rawSentences = data.sentences as Array<{
            id?: string;
            source?: string;
            sentence_en?: string;
            english?: string;
            sentence_kr?: string;
            korean?: string;
            chunking?: string[];
            main_sv?: string[];
            grammar_tags?: string[];
            grammar_note?: string;
          }>;
          const mappedSentences: Sentence[] = rawSentences.map((s) => ({
            id: s.id,
            source: s.source || '',
            sentence_en: s.sentence_en || s.english || '',
            sentence_kr: s.sentence_kr || s.korean || '',
          }));
          setSentences(mappedSentences);

          if (setSentenceAnalyses) {
            const mainIdea = data.main_idea as Record<string, { sentences?: Array<{ num?: number; role?: string; logic?: string; vocab_point?: unknown; blank_point?: unknown }> }> | undefined;
            const analyses: (DirectReadSentence | null)[] = rawSentences.map((s, i) => {
              const chunking = Array.isArray(s.chunking) ? s.chunking : [];
              const main_sv = Array.isArray(s.main_sv) ? s.main_sv : [];
              const grammar_tags = Array.isArray(s.grammar_tags) ? s.grammar_tags : [];
              if (chunking.length === 0 && main_sv.length === 0 && grammar_tags.length === 0) return null;
              const base: DirectReadSentence = {
                chunking,
                main_sv,
                grammar_tags,
                grammar_note: s.grammar_note,
              };
              const src = mappedSentences[i].source;
              const localIdx = mappedSentences.slice(0, i).filter((x) => x.source === src).length;
              const mainSentences = mainIdea?.[src]?.sentences;
              const extra = mainSentences?.[localIdx];
              if (extra) {
                if (extra.role != null || extra.logic != null) {
                  base.reading_point = { role: extra.role || '', logic: extra.logic || '' };
                }
                if (extra.vocab_point != null && typeof extra.vocab_point === 'object') {
                  const v = extra.vocab_point as { word?: string; context_meaning?: string; antonyms?: string[]; exam_reason?: string };
                  base.vocab_point = { word: v.word || '', context_meaning: v.context_meaning || '', antonyms: v.antonyms, exam_reason: v.exam_reason };
                }
                if (extra.blank_point != null && typeof extra.blank_point === 'object') {
                  const b = extra.blank_point as { target_phrase?: string; paraphrases?: string[]; exam_reason?: string };
                  base.blank_point = { target_phrase: b.target_phrase || '', paraphrases: b.paraphrases, exam_reason: b.exam_reason };
                }
              }
              return base;
            });
            setSentenceAnalyses(analyses);
          }
          alert(`✅ ${data.words.length}개 단어, ${mappedSentences.length}개 문장을 불러왔습니다.${setSentenceAnalyses ? ' (직독직해·독해/어휘/빈칸 포인트 포함)' : ''}`);
        } else {
          alert(`✅ ${data.words.length}개 단어를 불러왔습니다. (문장 없음)`);
        }
      } else {
        alert('올바른 JSON 형식이 아닙니다.');
      }
    } catch {
      alert('JSON 파일 읽기 실패');
    }

    // 파일 입력 초기화
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 셀 더블클릭 편집
  const startEdit = (row: number, col: keyof Word) => {
    setEditingCell({ row, col });
    setEditValue(String(wordList[row][col] || ''));
  };

  const finishEdit = () => {
    if (editingCell) {
      const { row, col } = editingCell;
      setWordList((prev) => {
        const next = [...prev];
        next[row] = { ...next[row], [col]: editValue };
        return next;
      });
    }
    setEditingCell(null);
  };

  // 행 선택 토글
  const toggleRowSelection = (idx: number, e: React.MouseEvent) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && prev.size > 0) {
        // Shift+클릭: 범위 선택
        const lastSelected = Math.max(...prev);
        const [start, end] = idx > lastSelected ? [lastSelected, idx] : [idx, lastSelected];
        for (let i = start; i <= end; i++) next.add(i);
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl+클릭: 토글
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
      } else {
        // 일반 클릭: 단일 선택
        next.clear();
        next.add(idx);
      }
      return next;
    });
  };

  // 선택 삭제
  const handleDelete = () => {
    if (selectedRows.size === 0) return;
    if (!window.confirm(`${selectedRows.size}개 단어를 삭제하시겠습니까?`)) return;
    setWordList((prev) => prev.filter((_, i) => !selectedRows.has(i)));
    setSelectedRows(new Set());
  };

  // 전체 삭제
  const handleClearAll = () => {
    if (!window.confirm('모든 단어를 삭제하시겠습니까?')) return;
    setWordList([]);
    setSelectedRows(new Set());
  };

  // 이동 함수들
  const moveSelected = (direction: 'up' | 'down' | 'top' | 'bottom') => {
    if (selectedRows.size === 0) return;
    const indices = Array.from(selectedRows).sort((a, b) => a - b);

    setWordList((prev) => {
      const next = [...prev];
      if (direction === 'up') {
        if (indices[0] === 0) return prev;
        for (const idx of indices) {
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        }
        setSelectedRows(new Set(indices.map((i) => i - 1)));
      } else if (direction === 'down') {
        if (indices[indices.length - 1] === prev.length - 1) return prev;
        for (const idx of [...indices].reverse()) {
          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
        }
        setSelectedRows(new Set(indices.map((i) => i + 1)));
      } else if (direction === 'top') {
        const selected = indices.map((i) => prev[i]);
        const rest = prev.filter((_, i) => !selectedRows.has(i));
        const newList = [...selected, ...rest];
        setSelectedRows(new Set(selected.map((_, i) => i)));
        return newList;
      } else if (direction === 'bottom') {
        const selected = indices.map((i) => prev[i]);
        const rest = prev.filter((_, i) => !selectedRows.has(i));
        const newList = [...rest, ...selected];
        setSelectedRows(new Set(selected.map((_, i) => rest.length + i)));
        return newList;
      }
      return next;
    });
  };

  // 정렬 (출처별)
  const handleSort = () => {
    setWordList((prev) => {
      const sorted = [...prev].sort((a, b) => {
        const srcCmp = a.source.localeCompare(b.source);
        if (srcCmp !== 0) return srcCmp;
        return (a.sentence_index || 0) - (b.sentence_index || 0);
      });
      return sorted;
    });
    setSelectedRows(new Set());
  };

  // PDF 미리보기 (HTML → 새 창)
  const handlePreviewPdf = () => {
    if (wordList.length === 0) {
      alert('단어가 없습니다.');
      return;
    }
    const html = generateWordListHtml(wordList);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      {/* 상단 버튼 영역 */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '12px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          accept=".json"
          onChange={handleLoadJson}
          style={{ display: 'none' }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{ ...btnStyle, background: '#3B82F6' }}
        >
          📂 JSON 불러오기
        </button>
        <button
          onClick={handleSaveJson}
          style={{ ...btnStyle, background: '#10B981' }}
        >
          💾 JSON 저장
        </button>
        <button
          onClick={handleSort}
          style={{ ...btnStyle, background: '#EC4899' }}
        >
          🔤 Sorting
        </button>

        <span style={{ color: '#9CA3AF', fontSize: '16px' }}>|</span>

        <button
          onClick={() => moveSelected('top')}
          style={{ ...btnSmStyle, background: '#6366F1' }}
        >
          ⏫ 맨위
        </button>
        <button
          onClick={() => moveSelected('up')}
          style={{ ...btnSmStyle, background: '#8B5CF6' }}
        >
          ⬆️ 위로
        </button>
        <button
          onClick={() => moveSelected('down')}
          style={{ ...btnSmStyle, background: '#8B5CF6' }}
        >
          ⬇️ 아래로
        </button>
        <button
          onClick={() => moveSelected('bottom')}
          style={{ ...btnSmStyle, background: '#6366F1' }}
        >
          ⏬ 맨아래
        </button>

        <div style={{ flex: 1 }} />

        <span
          style={{
            fontWeight: 'bold',
            color: '#6D28D9',
            fontSize: '14px',
          }}
        >
          📊 단어: {wordList.length}개
        </span>

        <button
          onClick={handlePreviewPdf}
          style={{ ...btnStyle, background: '#7C3AED' }}
        >
          👁️ PDF 미리보기
        </button>
      </div>

      {/* 테이블 */}
      <div
        style={{
          border: '2px solid #E5E7EB',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: 'calc(100vh - 340px)',
          }}
        >
          <table
            style={{
              width: 'max-content',
              borderCollapse: 'collapse',
              fontSize: '12px',
            }}
          >
            <thead>
              <tr style={{ background: '#F3F4F6', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ ...thStyle, width: '36px' }}>No</th>
                {COLUMNS.map((col) => (
                  <th key={col.key} style={{ ...thStyle, width: col.width }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wordList.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length + 1}
                    style={{
                      padding: '40px',
                      textAlign: 'center',
                      color: '#9CA3AF',
                    }}
                  >
                    단어가 없습니다. 입력 탭에서 단어를 추출하거나 JSON을 불러오세요.
                  </td>
                </tr>
              ) : (
                wordList.map((word, rowIdx) => (
                  <tr
                    key={rowIdx}
                    onClick={(e) => toggleRowSelection(rowIdx, e)}
                    style={{
                      background: selectedRows.has(rowIdx)
                        ? '#EDE9FE'
                        : rowIdx % 2 === 0
                          ? 'white'
                          : '#FAFBFC',
                      cursor: 'pointer',
                    }}
                  >
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold', color: '#6D28D9' }}>
                      {rowIdx + 1}
                    </td>
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          ...tdStyle,
                          maxWidth: col.width,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startEdit(rowIdx, col.key);
                        }}
                        title={String(word[col.key] || '')}
                      >
                        {editingCell?.row === rowIdx && editingCell?.col === col.key ? (
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={finishEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') finishEdit();
                              if (e.key === 'Escape') setEditingCell(null);
                            }}
                            style={{
                              width: '100%',
                              padding: '2px 4px',
                              border: '2px solid #7C3AED',
                              borderRadius: '4px',
                              fontSize: '12px',
                            }}
                          />
                        ) : (
                          String(word[col.key] || '')
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 하단 버튼 */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginTop: '12px',
          alignItems: 'center',
        }}
      >
        <button
          onClick={handleDelete}
          disabled={selectedRows.size === 0}
          style={{
            ...btnSmStyle,
            background: selectedRows.size > 0 ? '#EF4444' : '#D1D5DB',
          }}
        >
          🗑️ 선택 삭제 ({selectedRows.size})
        </button>
        <button
          onClick={handleClearAll}
          style={{ ...btnSmStyle, background: '#9CA3AF' }}
        >
          🗑️ 전체 삭제
        </button>
      </div>
    </div>
  );
};

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
  fontSize: '12px',
};

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 'bold',
  color: '#374151',
  borderBottom: '2px solid #E5E7EB',
  fontSize: '12px',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid #F3F4F6',
  fontSize: '12px',
  color: '#1F2937',
};

// 예문에서 단어를 하이라이트하는 헬퍼 함수
function highlightWordInText(text: string, word: string): string {
  if (!text || !word) return text || '';
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped}\\w*)`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}

// --- HTML 생성 (PDF 미리보기용) ---
function generateWordListHtml(wordList: Word[]): string {
  // 출처별 그룹화
  const groups: Record<string, Word[]> = {};
  for (const w of wordList) {
    const src = w.source || '기타';
    if (!groups[src]) groups[src] = [];
    groups[src].push(w);
  }

  let wordCards = '';
  let globalIdx = 0;

  for (const [source, words] of Object.entries(groups)) {
    const isFirst = globalIdx === 0;
    wordCards += `
      <div class="source-divider ${isFirst ? 'first' : ''}">
        <span class="source-title">${source}</span>
      </div>`;

    for (const w of words) {
      globalIdx++;
      const numStr = String(globalIdx).padStart(3, '0');
      const highlightedExample = highlightWordInText(w.example_en, w.word);
      wordCards += `
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

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>단어장</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap');
    * { font-family: 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif; box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 8mm; }
    body { background: #F5F5F5; padding: 12px; font-size: 11px; line-height: 1.5; color: #333; }
    .container { max-width: 210mm; margin: 0 auto; }

    /* 출처 구분 */
    .source-divider { text-align: center; margin: 20px 0 12px 0; padding: 10px 0; background: #F0F7FF; border-radius: 6px; page-break-before: always; }
    .source-divider.first { page-break-before: avoid; margin-top: 0; }
    .source-title { color: #1E40AF; font-size: 18px; font-weight: 700; }

    /* 카드 컨테이너 */
    .word-card { background: #FFFFFF; border-radius: 10px; margin-bottom: 8px; page-break-inside: avoid; break-inside: avoid; display: flex; overflow: hidden; min-height: 124px; border: 1px solid #E0E0E0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }

    /* 카드 왼쪽 (27%) */
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

    /* 카드 오른쪽 (73%) */
    .card-right { flex: 1; display: flex; flex-direction: column; padding: 8px 12px; gap: 4px; }

    /* 1단: [품사] 한글뜻 + 파생어 + 출처 */
    .row-meaning-kr { display: flex; align-items: center; gap: 6px; padding-bottom: 5px; border-bottom: 1px solid #ECECEC; }
    .word-pos { background: #EFF6FF; color: #1D4ED8; font-weight: 700; font-size: 9px; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
    .word-meaning-kr { font-size: 14px; color: #1a1a1a; font-weight: 700; }
    .derivatives-inline { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .derivatives-label { background: #ECFDF5; color: #0D9488; padding: 1px 5px; border-radius: 3px; font-weight: 700; font-size: 7px; }
    .derivatives-content { color: #555; font-size: 8px; }
    .word-source { background: #F0F0F0; color: #888; padding: 2px 6px; border-radius: 4px; font-size: 8px; flex-shrink: 0; margin-left: auto; }

    /* 2단: 영영풀이 */
    .row-meaning-en { padding: 5px 0; border-bottom: 1px solid #ECECEC; }
    .word-meaning-en { color: #555; font-size: 10px; line-height: 1.5; }

    /* 표현 (Collocations) */
    .row-collocations { padding: 5px 8px; background: #E8F4FD; border-bottom: 1px solid #ECECEC; border-radius: 4px; margin-top: 3px; }
    .collocations-label { display: inline-block; background: #BFDBFE; color: #1E40AF; padding: 1px 6px; border-radius: 3px; font-weight: 700; font-size: 8px; margin-right: 8px; }
    .collocations-content { color: #1E3A5F; font-size: 9px; line-height: 1.5; }

    /* 3단: 예문 + Tip */
    .row-bottom { display: flex; gap: 8px; margin-top: auto; flex: 1; }
    .example-box { flex: 3; background: linear-gradient(90deg, #F0F7FF 0%, #FFFFFF 100%); border-left: 3px solid #2563EB; padding: 6px 8px; border-radius: 0 6px 6px 0; display: flex; flex-direction: column; justify-content: center; }
    .example-en { color: #333; font-size: 11px; line-height: 1.5; margin-bottom: 3px; }
    .example-en .highlight { color: #1D4ED8; font-weight: 700; background: rgba(37,99,235,0.08); padding: 0 2px; border-radius: 2px; }
    .example-kr { color: #777; font-size: 10px; line-height: 1.4; }
    .tip-box { flex: 1; background: linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%); padding: 6px; border-radius: 5px; border-left: 3px solid #64748B; display: flex; flex-direction: column; }
    .tip-label { display: inline-block; background: #E2E8F0; color: #475569; padding: 1px 4px; border-radius: 3px; font-weight: 700; font-size: 7px; margin-bottom: 3px; align-self: flex-start; }
    .tip-content { color: #334155; font-size: 8px; line-height: 1.4; font-weight: 500; }

    /* 플로팅 버튼 */
    .floating-btn-wrap { position: fixed; bottom: 30px; right: 30px; display: flex; flex-direction: column; gap: 10px; z-index: 9999; }
    .floating-btn { width: 56px; height: 56px; border-radius: 50%; border: none; color: white; font-size: 22px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; transition: transform 0.2s, box-shadow 0.2s; }
    .floating-btn:hover { transform: scale(1.1); box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
    .floating-btn.print { background: linear-gradient(135deg, #1E3A8A, #3B82F6); }
    .floating-btn.close { background: linear-gradient(135deg, #6B7280, #9CA3AF); }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
      body { padding: 0; background: white; }
      .word-card { box-shadow: none; margin-bottom: 8px !important; page-break-inside: avoid !important; }
      .card-left, .tip-box, .example-box { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .source-divider { page-break-before: always; }
      .source-divider.first { page-break-before: avoid; }
      .floating-btn-wrap { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    ${wordCards}
  </div>
  <div class="floating-btn-wrap">
    <button class="floating-btn print" onclick="window.print()" title="PDF로 인쇄/저장">🖨️</button>
    <button class="floating-btn close" onclick="window.close()" title="닫기">✕</button>
  </div>
</body>
</html>`;
}

export default EditTab;
