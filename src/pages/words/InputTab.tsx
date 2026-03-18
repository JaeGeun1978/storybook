import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Word, Sentence } from '../../types/words';
import {
  splitAndTranslate,
  extractWords,
  getManualWordDetails,
  GEMINI_MODELS,
} from '../../lib/wordsGemini';
import type { ManualWordInput } from '../../lib/wordsGemini';
import { getSettings } from '../../lib/store';

interface InputSet {
  id: number;
  sourceName: string;
  englishText: string;
  /** 세트(출처)마다 찾을 단어 수. "5~10" 또는 "자동" (자동은 문장 수 기준으로 계산) */
  wordsToFind: string;
}

// 수동 선택 단어
interface ManualSelection {
  id: number;
  word: string;
  sentenceIdx: number; // sentences 배열의 인덱스
  source: string;
  sentence_en: string;
  sentence_kr: string;
}

interface InputTabProps {
  sentences: Sentence[];
  setSentences: React.Dispatch<React.SetStateAction<Sentence[]>>;
  wordList: Word[];
  setWordList: React.Dispatch<React.SetStateAction<Word[]>>;
  onSwitchToEdit: () => void;
}

let nextInputId = 1;
let nextManualId = 1;

const InputTab: React.FC<InputTabProps> = ({
  sentences,
  setSentences,
  wordList,
  setWordList,
  onSwitchToEdit,
}) => {
  const apiKey = getSettings().geminiApiKey;
  const [inputSets, setInputSets] = useState<InputSet[]>([
    { id: nextInputId++, sourceName: '', englishText: '', wordsToFind: '5~10' },
  ]);
  const [wordsRange, setWordsRange] = useState('5~10');
  /** 엑셀 등에서 불러온 출처별 찾을 단어 수 (자동 지정 후 조정용) */
  const [sourceWordsOverride, setSourceWordsOverride] = useState<Record<string, string>>({});
  const [model, setModel] = useState(GEMINI_MODELS[0]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSendingManual, setIsSendingManual] = useState(false);
  const [log, setLog] = useState('');

  // 문장별 추출된 단어 매핑 (sentenceIdx → Word[])
  const [sentenceWordsMap, setSentenceWordsMap] = useState<Record<number, Word[]>>({});

  // 수동 선택 단어 목록
  const [manualSelections, setManualSelections] = useState<ManualSelection[]>([]);

  // 문장 편집 모드
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState<Sentence[]>([]);

  // 문장 영역 ref (Alt+1 이벤트 감지용)
  const sentenceAreaRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => setLog((prev) => prev + '\n' + msg);

  // --- 단어 → 문장 매핑 ---
  const mapWordsToSentences = useCallback(
    (words: Word[]) => {
      const map: Record<number, Word[]> = {};
      for (const w of words) {
        // example_en과 source로 매칭
        const idx = sentences.findIndex(
          (s) =>
            s.source === w.source &&
            (s.sentence_en === w.example_en ||
              w.example_en?.includes(s.sentence_en) ||
              s.sentence_en?.includes(w.word))
        );
        // 매칭 안되면 source만으로 첫 문장 매칭
        let matchIdx = idx;
        if (matchIdx < 0) {
          matchIdx = sentences.findIndex((s) => s.source === w.source);
        }
        if (matchIdx >= 0) {
          if (!map[matchIdx]) map[matchIdx] = [];
          map[matchIdx].push(w);
        }
      }
      return map;
    },
    [sentences]
  );

  // --- 세트 관리 ---
  const handleAddSet = () => {
    setInputSets((prev) => [
      ...prev,
      { id: nextInputId++, sourceName: '', englishText: '', wordsToFind: '5~10' },
    ]);
  };

  const handleRemoveSet = (id: number) => {
    setInputSets((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((s) => s.id !== id);
    });
  };

  const updateSet = (id: number, field: 'sourceName' | 'englishText' | 'wordsToFind', value: string) => {
    setInputSets((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  /** 세트별 찾을 단어 수 자동 계산: 해당 출처 문장 수 기준 N~2N (최대 30) */
  const handleAutoCalcWordsPerSet = () => {
    setInputSets((prev) =>
      prev.map((set) => {
        if (!set.sourceName.trim()) return set;
        const count = sentences.filter((s) => s.source === set.sourceName.trim()).length;
        if (count === 0) return set;
        const max = Math.min(Math.max(count * 2, count), 30);
        return { ...set, wordsToFind: `${count}~${max}` };
      })
    );
    addLog('✅ 세트별 찾을 단어 수를 문장 수 기준으로 자동 계산했습니다.');
  };

  // --- 엑셀 파일 업로드 ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      const newSentences: Sentence[] = [];
      let currentSource = '';
      for (const row of rows) {
        if (row[0]) currentSource = String(row[0]);
        const en = row[1] ? String(row[1]) : '';
        const kr = row[2] ? String(row[2]) : '';
        if (en) {
          newSentences.push({ source: currentSource || '엑셀', sentence_en: en, sentence_kr: kr });
        }
      }
      setSentences((prev) => [...prev, ...newSentences]);
      const sourcesInFile = [...new Set(newSentences.map((s) => s.source))];
      setSourceWordsOverride((prev) => {
        const next = { ...prev };
        for (const src of sourcesInFile) {
          if (next[src]) continue;
          const count = newSentences.filter((s) => s.source === src).length;
          const max = Math.min(Math.max(count * 2, count), 30);
          next[src] = `${count}~${max}`;
        }
        return next;
      });
      addLog(`✅ 엑셀 파일에서 ${newSentences.length}개 문장을 불러왔습니다. (출처 ${sourcesInFile.length}개, 찾을 단어 수 자동 지정됨)`);
    } catch (err: unknown) {
      addLog(`❌ 엑셀 파일 읽기 실패: ${(err as Error).message}`);
    }
  };

  // --- 전체 문장 분리 & 번역 ---
  const handleTranslateAll = async () => {
    if (!apiKey) { alert('Settings에서 API Key를 먼저 설정해주세요.'); return; }
    const activeSets = inputSets.filter((s) => s.englishText.trim() && s.sourceName.trim());
    if (activeSets.length === 0) { alert('출처와 영문 텍스트를 입력한 세트가 없습니다.'); return; }

    setIsTranslating(true);
    addLog(`📡 ${activeSets.length}개 세트 문장 분리 & 번역 요청 중...`);
    let totalSentences = 0;
    try {
      for (const set of activeSets) {
        addLog(`  → [${set.sourceName}] 번역 중...`);
        const result = await splitAndTranslate(apiKey, set.englishText, set.sourceName, model);
        setSentences((prev) => [...prev, ...result]);
        totalSentences += result.length;
        addLog(`  ✅ [${set.sourceName}] ${result.length}개 문장 완료`);
      }
      addLog(`✅ 전체 ${totalSentences}개 문장을 분리 & 번역했습니다.`);
      setInputSets((prev) =>
        prev.map((s) => (activeSets.find((a) => a.id === s.id) ? { ...s, englishText: '' } : s))
      );
    } catch (err: unknown) {
      addLog(`❌ 오류: ${(err as Error).message}`);
      alert(`오류: ${(err as Error).message}`);
    } finally {
      setIsTranslating(false);
    }
  };

  // --- 단어 추출 (Gemini) ---
  const getWordsRangeBySource = useCallback(() => {
    const bySource: Record<string, string> = {};
    const setSourceNames = new Set(inputSets.map((s) => s.sourceName.trim()).filter(Boolean));
    for (const set of inputSets) {
      const src = set.sourceName.trim();
      if (!src) continue;
      const val = set.wordsToFind.trim() || wordsRange;
      if (val === '자동') {
        const count = sentences.filter((s) => s.source === src).length;
        const max = count ? Math.min(Math.max(count * 2, count), 30) : 5;
        bySource[src] = count ? `${count}~${max}` : wordsRange;
      } else {
        bySource[src] = val;
      }
    }
    for (const [src, val] of Object.entries(sourceWordsOverride)) {
      if (val.trim()) bySource[src] = val.trim();
    }
    for (const src of [...new Set(sentences.map((s) => s.source))]) {
      if (bySource[src]) continue;
      if (setSourceNames.has(src)) continue;
      const count = sentences.filter((s) => s.source === src).length;
      const max = Math.min(Math.max(count * 2, count), 30);
      bySource[src] = sourceWordsOverride[src]?.trim() || `${count}~${max}`;
    }
    return bySource;
  }, [inputSets, sourceWordsOverride, wordsRange, sentences]);

  const handleExtractWords = async () => {
    if (!apiKey) { alert('Settings에서 API Key를 먼저 설정해주세요.'); return; }
    if (sentences.length === 0) { alert('먼저 문장을 분리해주세요.'); return; }

    const wordsRangeBySource = getWordsRangeBySource();

    setIsExtracting(true);
    addLog(Object.keys(wordsRangeBySource).length > 0 ? '📡 Gemini에게 단어 추출 요청 중 (출처별 단어 수 적용)...' : '📡 Gemini에게 단어 추출 요청 중...');
    try {
      const result = await extractWords(apiKey, sentences, wordsRange, model, Object.keys(wordsRangeBySource).length > 0 ? wordsRangeBySource : undefined);
      setWordList((prev) => [...prev, ...result]);

      // 문장별 매핑 업데이트
      const newMap = mapWordsToSentences(result);
      setSentenceWordsMap((prev) => {
        const merged = { ...prev };
        for (const [k, v] of Object.entries(newMap)) {
          const key = Number(k);
          merged[key] = [...(merged[key] || []), ...v];
        }
        return merged;
      });

      addLog(`✅ ${result.length}개 단어를 추출했습니다!`);
    } catch (err: unknown) {
      addLog(`❌ 오류: ${(err as Error).message}`);
      alert(`오류: ${(err as Error).message}`);
    } finally {
      setIsExtracting(false);
    }
  };

  // --- Alt+1 수동 선택 ---
  const handleAltOne = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // 어떤 문장에서 선택했는지 찾기
    const anchorNode = selection.anchorNode;
    if (!anchorNode) return;

    // data-sentence-idx 속성으로 문장 인덱스 찾기
    let el: HTMLElement | null =
      anchorNode.nodeType === Node.TEXT_NODE
        ? anchorNode.parentElement
        : (anchorNode as HTMLElement);

    let sentenceIdx: number | null = null;
    while (el && sentenceAreaRef.current?.contains(el)) {
      const idx = el.getAttribute('data-sentence-idx');
      if (idx !== null) {
        sentenceIdx = parseInt(idx, 10);
        break;
      }
      el = el.parentElement;
    }

    if (sentenceIdx === null || sentenceIdx < 0 || sentenceIdx >= sentences.length) {
      return;
    }

    // 이미 같은 단어+같은 문장 조합이 있으면 무시
    const exists = manualSelections.some(
      (m) =>
        m.word.toLowerCase() === selectedText.toLowerCase() &&
        m.sentenceIdx === sentenceIdx
    );
    if (exists) {
      selection.removeAllRanges();
      return;
    }

    const sentence = sentences[sentenceIdx];
    setManualSelections((prev) => [
      ...prev,
      {
        id: nextManualId++,
        word: selectedText,
        sentenceIdx,
        source: sentence.source,
        sentence_en: sentence.sentence_en,
        sentence_kr: sentence.sentence_kr,
      },
    ]);

    selection.removeAllRanges();
  }, [sentences, manualSelections]);

  // 키보드 이벤트 리스너
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === '1') {
        e.preventDefault();
        handleAltOne();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleAltOne]);

  // --- 수동 선택 단어 삭제 ---
  const removeManualSelection = (id: number) => {
    setManualSelections((prev) => prev.filter((m) => m.id !== id));
  };

  // --- 수동 선택 단어 Gemini 전송 ---
  const handleSendManualToGemini = async () => {
    if (!apiKey) { alert('Settings에서 API Key를 먼저 설정해주세요.'); return; }
    if (manualSelections.length === 0) { alert('수동 선택한 단어가 없습니다.'); return; }

    setIsSendingManual(true);
    addLog(`📡 수동 선택 ${manualSelections.length}개 단어 Gemini 전송 중...`);

    try {
      const inputs: ManualWordInput[] = manualSelections.map((m) => ({
        word: m.word,
        sentence_en: m.sentence_en,
        sentence_kr: m.sentence_kr,
        source: m.source,
      }));

      const result = await getManualWordDetails(apiKey, inputs, model);

      // 문장 순서대로 정렬해서 wordList에 추가
      const sortedResult = result.map((w, i) => ({
        ...w,
        _sentenceIdx: manualSelections[i]?.sentenceIdx ?? 999,
      }));
      sortedResult.sort((a, b) => a._sentenceIdx - b._sentenceIdx);

      const cleanResult: Word[] = sortedResult.map(({ _sentenceIdx: _, ...rest }) => rest);
      setWordList((prev) => [...prev, ...cleanResult]);

      // 문장별 매핑도 업데이트
      setSentenceWordsMap((prev) => {
        const merged = { ...prev };
        for (let i = 0; i < cleanResult.length; i++) {
          const sIdx = sortedResult[i]._sentenceIdx;
          if (!merged[sIdx]) merged[sIdx] = [];
          merged[sIdx].push(cleanResult[i]);
        }
        return merged;
      });

      addLog(`✅ ${result.length}개 단어 상세정보를 받았습니다! 편집 탭에서 확인하세요.`);
      setManualSelections([]);
      onSwitchToEdit();
    } catch (err: unknown) {
      addLog(`❌ 오류: ${(err as Error).message}`);
      alert(`오류: ${(err as Error).message}`);
    } finally {
      setIsSendingManual(false);
    }
  };

  // --- 문장 관리 ---
  const handleDeleteSentence = (idx: number) => {
    setSentences((prev) => prev.filter((_, i) => i !== idx));
    setSentenceWordsMap((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
    setManualSelections((prev) => prev.filter((m) => m.sentenceIdx !== idx));
  };

  const handleClearSentences = () => {
    if (window.confirm('모든 문장을 삭제하시겠습니까?')) {
      setSentences([]);
      setSentenceWordsMap({});
      setManualSelections([]);
      setIsEditingMode(false);
      setEditBuffer([]);
      addLog('🗑️ 모든 문장을 삭제했습니다.');
    }
  };

  // --- 편집 모드 토글 ---
  const handleToggleEdit = () => {
    if (!isEditingMode) {
      // 편집 시작: 현재 문장을 버퍼에 복사
      setEditBuffer(sentences.map((s) => ({ ...s })));
      setIsEditingMode(true);
    } else {
      // 편집 완료: 버퍼 내용을 반영
      setSentences(editBuffer);
      setIsEditingMode(false);
      setEditBuffer([]);
      addLog('✅ 문장 편집 내용이 반영되었습니다.');
    }
  };

  const updateEditBuffer = (idx: number, field: 'sentence_en' | 'sentence_kr' | 'source', value: string) => {
    setEditBuffer((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s))
    );
  };

  // --- 문장 텍스트에서 단어 하이라이트 ---
  const highlightWords = (text: string, sentenceIdx: number) => {
    // 이 문장에서 수동 선택된 단어 + AI 추출 단어
    const manualWords = manualSelections
      .filter((m) => m.sentenceIdx === sentenceIdx)
      .map((m) => m.word);
    const aiWords = (sentenceWordsMap[sentenceIdx] || []).map((w) => w.word);

    const allHighlightWords = [...new Set([...manualWords, ...aiWords])];
    if (allHighlightWords.length === 0) return <>{text}</>;

    // 정규식으로 단어 매칭 (대소문자 무시)
    const escaped = allHighlightWords.map((w) =>
      w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      const matched = match[0];
      const isManual = manualWords.some(
        (w) => w.toLowerCase() === matched.toLowerCase()
      );
      parts.push(
        <span
          key={match.index}
          style={{
            background: isManual ? '#FEF3C7' : '#DBEAFE',
            color: isManual ? '#92400E' : '#1E40AF',
            fontWeight: 'bold',
            padding: '0 2px',
            borderRadius: '3px',
            borderBottom: isManual ? '2px solid #F59E0B' : '2px solid #3B82F6',
          }}
        >
          {matched}
        </span>
      );
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return <>{parts}</>;
  };

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
      {/* 설정 영역 */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '16px',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <div style={{ width: '220px' }}>
          <label style={labelStyle}>🤖 AI 모델</label>
          <select value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
            {GEMINI_MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div style={{ width: '130px' }}>
          <label style={labelStyle}>📊 단어 범위</label>
          <input
            type="text"
            value={wordsRange}
            onChange={(e) => setWordsRange(e.target.value)}
            placeholder="5~10"
            style={inputStyle}
          />
        </div>
        <label
          style={{ ...btnStyle, background: 'linear-gradient(135deg, #F59E0B, #FBBF24)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
        >
          📂 엑셀 불러오기
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} style={{ display: 'none' }} />
        </label>
      </div>

      {/* 출처별 찾을 단어 수 (엑셀 등) */}
      {(() => {
        const setSourceNames = new Set(inputSets.map((s) => s.sourceName.trim()).filter(Boolean));
        const excelOnlySources = [...new Set(sentences.map((s) => s.source))].filter((src) => !setSourceNames.has(src));
        if (excelOnlySources.length === 0) return null;
        return (
          <div
            style={{
              marginBottom: '16px',
              border: '2px solid #F59E0B',
              borderRadius: '12px',
              padding: '12px 16px',
              background: '#FFFBEB',
            }}
          >
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#92400E' }}>
              📋 출처별 찾을 단어 수 (엑셀 등) — 자동 지정 후 조정
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
              {excelOnlySources.map((src) => {
                const count = sentences.filter((s) => s.source === src).length;
                const max = Math.min(Math.max(count * 2, count), 30);
                const autoVal = `${count}~${max}`;
                return (
                  <div key={src} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#78350F', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={src}>
                      {src}
                    </span>
                    <span style={{ fontSize: '11px', color: '#B45309' }}>({count}문장)</span>
                    <input
                      type="text"
                      value={sourceWordsOverride[src] ?? ''}
                      onChange={(e) => setSourceWordsOverride((prev) => ({ ...prev, [src]: e.target.value }))}
                      placeholder={autoVal}
                      style={{ ...inputStyle, width: '72px', padding: '4px 6px', fontSize: '12px' }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 메인 영역 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px', flex: 1, minHeight: 0 }}>
        {/* === 왼쪽: 입력 세트 목록 === */}
        <div
          style={{
            border: '2px solid #E5E7EB',
            borderRadius: '12px',
            padding: '16px',
            background: '#FAFBFC',
            overflowY: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, color: '#6D28D9', fontSize: '16px' }}>
              ✏️ 영문 입력 ({inputSets.length}세트)
            </h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleAutoCalcWordsPerSet}
                disabled={sentences.length === 0}
                style={{
                  ...btnSmallStyle,
                  background: sentences.length === 0 ? '#D1D5DB' : 'linear-gradient(135deg, #0EA5E9, #38BDF8)',
                  fontSize: '12px', padding: '5px 10px',
                }}
              >
                세트별 자동 계산
              </button>
              <button
                onClick={handleAddSet}
                style={{ ...btnStyle, background: 'linear-gradient(135deg, #6366F1, #818CF8)', padding: '7px 16px', fontSize: '14px' }}
              >
                ➕ 영문 추가
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {inputSets.map((set, idx) => (
              <div
                key={set.id}
                style={{ border: '1px solid #D1D5DB', borderRadius: '10px', padding: '12px', background: 'white' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span
                    style={{
                      background: '#7C3AED', color: 'white', width: '24px', height: '24px',
                      borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 'bold', fontSize: '12px', flexShrink: 0,
                    }}
                  >
                    {idx + 1}
                  </span>
                  <input
                    type="text"
                    value={set.sourceName}
                    onChange={(e) => updateSet(set.id, 'sourceName', e.target.value)}
                    placeholder="출처 (예: 고2 2025년 10월 36번)"
                    style={{ ...inputStyle, flex: 1, padding: '6px 10px', fontSize: '13px' }}
                  />
                  {inputSets.length > 1 && (
                    <button
                      onClick={() => handleRemoveSet(set.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#EF4444', padding: '2px 6px' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <textarea
                  value={set.englishText}
                  onChange={(e) => updateSet(set.id, 'englishText', e.target.value)}
                  placeholder="여기에 영어 지문을 붙여넣기 하세요..."
                  rows={6}
                  style={{
                    width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E5E7EB',
                    fontSize: '14px', lineHeight: '1.7', resize: 'vertical', fontFamily: "'Noto Sans KR', sans-serif", color: '#1F2937', backgroundColor: 'white',
                  }}
                />
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#6B7280', fontWeight: 600, flexShrink: 0 }}>
                    찾을 단어 수
                  </label>
                  <input
                    type="text"
                    value={set.wordsToFind}
                    onChange={(e) => updateSet(set.id, 'wordsToFind', e.target.value)}
                    placeholder="5~10 또는 자동"
                    style={{
                      ...inputStyle,
                      width: '100px', padding: '5px 8px', fontSize: '13px',
                    }}
                  />
                  {set.sourceName.trim() && (
                    <span style={{ fontSize: '11px', color: '#9CA3AF' }}>
                      {sentences.filter((s) => s.source === set.sourceName.trim()).length}문장
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '12px' }}>
            <button
              onClick={handleTranslateAll}
              disabled={isTranslating}
              style={{
                ...btnStyle, width: '100%',
                background: isTranslating ? '#9CA3AF' : 'linear-gradient(135deg, #7C3AED, #A78BFA)',
                fontSize: '16px', padding: '13px',
              }}
            >
              {isTranslating
                ? '⏳ 번역 중...'
                : `🌐 전체 문장 분리 & 번역 (${inputSets.filter((s) => s.englishText.trim() && s.sourceName.trim()).length}세트)`}
            </button>
          </div>
        </div>

        {/* === 오른쪽: 분리된 문장 + 단어 표시 === */}
        <div
          style={{
            border: '2px solid #E5E7EB',
            borderRadius: '12px',
            padding: '16px',
            background: '#FAFBFC',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* 수동 선택 단어 박스 */}
          {manualSelections.length > 0 && (
            <div
              style={{
                background: '#FFFBEB',
                border: '2px solid #F59E0B',
                borderRadius: '10px',
                padding: '12px',
                marginBottom: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h4 style={{ margin: 0, color: '#92400E', fontSize: '13px' }}>
                  ✋ 수동 선택 단어 ({manualSelections.length}개)
                </h4>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={handleSendManualToGemini}
                    disabled={isSendingManual}
                    style={{
                      ...btnStyle,
                      background: isSendingManual ? '#9CA3AF' : 'linear-gradient(135deg, #10B981, #34D399)',
                      padding: '6px 14px', fontSize: '12px',
                    }}
                  >
                    {isSendingManual ? '⏳ 전송 중...' : '🚀 Gemini 전송'}
                  </button>
                  <button
                    onClick={() => setManualSelections([])}
                    style={{ ...btnSmallStyle, background: '#EF4444' }}
                  >
                    🗑️ 비우기
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {manualSelections.map((m) => (
                  <span
                    key={m.id}
                    style={{
                      background: '#FEF3C7',
                      border: '1px solid #F59E0B',
                      borderRadius: '6px',
                      padding: '3px 8px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      color: '#92400E',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {m.word}
                    <span style={{ fontSize: '10px', color: '#B45309' }}>
                      ({m.source} #{m.sentenceIdx + 1})
                    </span>
                    <button
                      onClick={() => removeManualSelection(m.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#DC2626', fontSize: '12px', padding: '0 2px', lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 헤더 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, color: '#2563EB', fontSize: '16px' }}>
              📋 분리된 문장 ({sentences.length}개)
              {sentences.length > 0 && !isEditingMode && (
                <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 'normal', marginLeft: '8px' }}>
                  💡 드래그 + Alt+1로 단어 수동 선택
                </span>
              )}
              {isEditingMode && (
                <span style={{ fontSize: '11px', color: '#F59E0B', fontWeight: 'normal', marginLeft: '8px' }}>
                  ✏️ 편집 중... 완료 후 버튼을 다시 눌러주세요
                </span>
              )}
            </h3>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={handleToggleEdit}
                disabled={sentences.length === 0}
                style={{
                  ...btnSmallStyle,
                  background: sentences.length === 0
                    ? '#D1D5DB'
                    : isEditingMode
                      ? 'linear-gradient(135deg, #10B981, #34D399)'
                      : 'linear-gradient(135deg, #3B82F6, #60A5FA)',
                }}
              >
                {isEditingMode ? '✅ 편집 완료' : '✏️ 편집'}
              </button>
              <button
                onClick={handleClearSentences}
                disabled={sentences.length === 0 || isEditingMode}
                style={{
                  ...btnSmallStyle,
                  background: sentences.length === 0 || isEditingMode ? '#D1D5DB' : '#EF4444',
                }}
              >
                🗑️ 전체 삭제
              </button>
            </div>
          </div>

          {/* 문장 리스트 */}
          <div
            ref={sentenceAreaRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              border: '1px solid #E5E7EB',
              borderRadius: '8px',
              background: 'white',
              minHeight: 0,
            }}
          >
            {sentences.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>
                문장 분리 결과가 여기에 표시됩니다
              </div>
            ) : isEditingMode ? (
              /* === 편집 모드 === */
              editBuffer.map((s, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid #F3F4F6',
                    background: '#FFFBEB',
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span
                      style={{
                        minWidth: '28px', color: '#6D28D9', fontWeight: 'bold', fontSize: '12px', paddingTop: '6px',
                      }}
                    >
                      {idx + 1}.
                    </span>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <input
                        type="text"
                        value={s.sentence_en}
                        onChange={(e) => updateEditBuffer(idx, 'sentence_en', e.target.value)}
                        style={{
                          width: '100%', padding: '5px 8px', borderRadius: '6px',
                          border: '1px solid #93C5FD', fontSize: '13px', lineHeight: '1.6',
                          fontFamily: "'Noto Sans KR', sans-serif", color: '#1F2937',
                        }}
                      />
                      <input
                        type="text"
                        value={s.sentence_kr}
                        onChange={(e) => updateEditBuffer(idx, 'sentence_kr', e.target.value)}
                        style={{
                          width: '100%', padding: '5px 8px', borderRadius: '6px',
                          border: '1px solid #C4B5FD', fontSize: '12px', lineHeight: '1.5',
                          fontFamily: "'Noto Sans KR', sans-serif", color: '#6B7280',
                        }}
                      />
                      <input
                        type="text"
                        value={s.source}
                        onChange={(e) => updateEditBuffer(idx, 'source', e.target.value)}
                        style={{
                          width: '140px', padding: '3px 6px', borderRadius: '4px',
                          border: '1px solid #DDD6FE', fontSize: '11px',
                          fontFamily: "'Noto Sans KR', sans-serif", color: '#A78BFA',
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              /* === 일반 모드 === */
              sentences.map((s, idx) => {
                const wordsForSentence = sentenceWordsMap[idx] || [];
                const manualForSentence = manualSelections.filter((m) => m.sentenceIdx === idx);

                return (
                  <div
                    key={idx}
                    data-sentence-idx={idx}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid #F3F4F6',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <span
                        style={{
                          minWidth: '28px', color: '#6D28D9', fontWeight: 'bold', fontSize: '12px',
                        }}
                      >
                        {idx + 1}.
                      </span>
                      <div style={{ flex: 1 }} data-sentence-idx={idx}>
                        <div
                          style={{ fontSize: '14px', color: '#1F2937', marginBottom: '4px', lineHeight: '1.8', userSelect: 'text' }}
                          data-sentence-idx={idx}
                        >
                          {highlightWords(s.sentence_en, idx)}
                        </div>
                        <div style={{ fontSize: '13px', color: '#6B7280' }}>
                          {s.sentence_kr}
                        </div>
                        <div style={{ fontSize: '12px', color: '#A78BFA', marginTop: '2px' }}>
                          [{s.source}]
                        </div>

                        {/* AI 추출 단어 태그 */}
                        {wordsForSentence.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                            {wordsForSentence.map((w, wIdx) => (
                              <span
                                key={wIdx}
                                title={`${w.meaning_kr} | ${w.pos}`}
                                style={{
                                  background: '#EFF6FF',
                                  border: '1px solid #93C5FD',
                                  borderRadius: '4px',
                                  padding: '2px 6px',
                                  fontSize: '11px',
                                  color: '#1E40AF',
                                  fontWeight: 'bold',
                                }}
                              >
                                {w.word}
                                <span style={{ fontWeight: 'normal', color: '#6B7280', marginLeft: '3px' }}>
                                  {w.meaning_kr}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* 수동 선택 단어 태그 */}
                        {manualForSentence.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                            {manualForSentence.map((m) => (
                              <span
                                key={m.id}
                                style={{
                                  background: '#FEF3C7',
                                  border: '1px solid #FCD34D',
                                  borderRadius: '4px',
                                  padding: '2px 6px',
                                  fontSize: '11px',
                                  color: '#92400E',
                                  fontWeight: 'bold',
                                }}
                              >
                                ✋ {m.word}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => handleDeleteSentence(idx)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: '14px', color: '#EF4444', padding: '2px 6px',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 단어 추출 버튼 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '16px', padding: '16px',
          background: 'linear-gradient(135deg, #F5F3FF, #EDE9FE)', borderRadius: '12px', marginBottom: '16px',
          flexShrink: 0,
        }}
      >
        <button
          onClick={handleExtractWords}
          disabled={isExtracting || sentences.length === 0}
          style={{
            ...btnStyle,
            background: isExtracting ? '#9CA3AF' : 'linear-gradient(135deg, #10B981, #34D399)',
            fontSize: '17px', padding: '13px 30px',
          }}
        >
          {isExtracting ? '⏳ 단어 추출 중...' : '🔍 단어 추출하기'}
        </button>
        <div style={{ color: '#4B5563', fontSize: '15px' }}>
          <strong>{sentences.length}</strong>개 문장에서 출처별 단어 수로 추출 →{' '}
          <strong>{wordList.length}</strong>개 추출됨
          {manualSelections.length > 0 && (
            <span style={{ color: '#F59E0B', marginLeft: '12px' }}>
              + ✋ 수동 {manualSelections.length}개 대기 중
            </span>
          )}
        </div>
      </div>

      {/* 로그 */}
      {log && (
        <div
          style={{
            background: '#1F2937', color: '#D1D5DB', padding: '12px 16px',
            borderRadius: '8px', fontSize: '12px', fontFamily: 'monospace',
            whiteSpace: 'pre-wrap', maxHeight: '150px', overflowY: 'auto',
          }}
        >
          {log}
        </div>
      )}
    </div>
  );
};

// 스타일 상수
const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 'bold', color: '#374151',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 13px', borderRadius: '8px', border: '1px solid #D1D5DB',
  fontSize: '15px', fontFamily: "'Noto Sans KR', sans-serif", color: '#1F2937', backgroundColor: 'white',
};
const btnStyle: React.CSSProperties = {
  padding: '11px 22px', borderRadius: '8px', border: 'none', color: 'white',
  fontWeight: 'bold', cursor: 'pointer', fontSize: '15px', fontFamily: "'Noto Sans KR', sans-serif",
};
const btnSmallStyle: React.CSSProperties = {
  padding: '5px 11px', borderRadius: '6px', border: 'none', color: 'white',
  fontWeight: 'bold', cursor: 'pointer', fontSize: '13px',
};

export default InputTab;
