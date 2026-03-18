import React, { useCallback, useRef, useState } from 'react';
import type { Word, Sentence, DirectReadSentence, DirectReadJsonData } from '../../types/words';
import { useSettings } from '../../contexts/SettingsContext';
import { generateDirectReadAnalysis } from '../../services/gemini';

interface DirectReadTabProps {
  sentences: Sentence[];
  wordList: Word[];
  sentenceAnalyses: (DirectReadSentence | null)[];
  setSentenceAnalyses: React.Dispatch<React.SetStateAction<(DirectReadSentence | null)[]>>;
  setSentences?: React.Dispatch<React.SetStateAction<Sentence[]>>;
}

/** 공백 기준 토큰화 (analysis.md STEP 1) */
function tokenize(english: string): string[] {
  return english.trim().split(/\s+/).filter(Boolean);
}

const GRAMMAR_HIGHLIGHT_COLOR = '#FFE8A0'; // 형광펜·[문법 포인트] 통일

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 직독직해만 보여주는 미리보기 HTML (analysis.md 4절 구조) + 문법 형광펜 & [문법 포인트] */
function buildDirectReadPreviewHtml(
  sentences: Sentence[],
  sentenceAnalyses: (DirectReadSentence | null)[]
): string {
  const sourceGroups: Record<string, { sentence: Sentence; idx: number }[]> = {};
  sentences.forEach((s, i) => {
    const src = s.source || '기타';
    if (!sourceGroups[src]) sourceGroups[src] = [];
    sourceGroups[src].push({ sentence: s, idx: i });
  });

  let body = '';
  for (const [source, items] of Object.entries(sourceGroups)) {
    body += `<div class="source-section"><div class="source-title">${source}</div>`;
    for (let localIdx = 0; localIdx < items.length; localIdx++) {
      const { sentence, idx } = items[localIdx];
      const analysis = sentenceAnalyses[idx];
      const tokens = tokenize(sentence.sentence_en);
      if (!analysis || analysis.chunking.length !== tokens.length) {
        body += `<div class="sentence-block"><div class="sentence-top"><div class="sentence-left"><div class="sentence-num-area"><span class="sentence-num">${String(localIdx + 1).padStart(2, '0')}</span></div><div class="english-area"><span class="english-sentence">${sentence.sentence_en}</span></div></div><div class="sentence-right">${sentence.sentence_kr}</div></div></div>`;
        continue;
      }
      let tokensHtml = '';
      const grammarPoints: string[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const chunk = analysis.chunking[i] ?? '';
        const sv = analysis.main_sv[i] ?? '';
        const gram = analysis.grammar_tags[i] ?? '';
        if (gram) grammarPoints.push(gram);
        const tag = sv;
        const tagClass = ['S', 'V', 'O', 'IO', 'DO', 'C', 'OC'].includes(sv) ? 'grammar-tag subject-verb' : 'grammar-tag';
        const wordClass = gram ? 'word-text grammar-highlight' : 'word-text';
        tokensHtml += `<span class="word-token"><span class="chunk-text">${escapeHtml(chunk)}</span><span class="${wordClass}">${escapeHtml(tokens[i])}</span><span class="${tagClass}">${escapeHtml(tag)}</span></span>`;
      }
      const pointBlocks: string[] = [];
      if (analysis.reading_point?.role || analysis.reading_point?.logic) {
        const r = analysis.reading_point!;
        pointBlocks.push(`<div class="point-section reading-point"><span class="point-title">[독해 포인트]</span><div class="point-content">${r.role ? `<strong>${escapeHtml(r.role)}</strong> ` : ''}${escapeHtml(r.logic || '')}</div></div>`);
      }
      if (grammarPoints.length > 0) {
        pointBlocks.push(`<div class="point-section grammar-point"><span class="point-title">[문법 포인트]</span><ol class="point-list">${grammarPoints.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}</ol></div>`);
      }
      if (analysis.vocab_point?.word) {
        const v = analysis.vocab_point;
        let html = `<strong>${escapeHtml(v.word)}</strong> ${escapeHtml(v.context_meaning || '')}`;
        if (v.antonyms?.length) html += ` | 반의어: ${escapeHtml(v.antonyms.join(', '))}`;
        if (v.exam_reason) html += `<br/><span class="exam-reason">${escapeHtml(v.exam_reason)}</span>`;
        pointBlocks.push(`<div class="point-section vocab-point"><span class="point-title">[어휘 포인트]</span><div class="point-content">${html}</div></div>`);
      }
      if (analysis.blank_point?.target_phrase) {
        const b = analysis.blank_point;
        let html = `<strong>${escapeHtml(b.target_phrase)}</strong>`;
        if (b.paraphrases?.length) html += `<ul>${b.paraphrases.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;
        if (b.exam_reason) html += `<span class="exam-reason">${escapeHtml(b.exam_reason)}</span>`;
        pointBlocks.push(`<div class="point-section blank-point"><span class="point-title">[빈칸 포인트]</span><div class="point-content">${html}</div></div>`);
      }
      const pointsHtml = pointBlocks.length ? `<div class="points-wrap">${pointBlocks.join('')}</div>` : '';
      body += `
<div class="sentence-block">
  <div class="sentence-top">
    <div class="sentence-left">
      <div class="sentence-num-area"><span class="sentence-num">${String(localIdx + 1).padStart(2, '0')}</span></div>
      <div class="english-area"><span class="english-sentence">${tokensHtml}</span></div>
    </div>
    <div class="sentence-right">${escapeHtml(sentence.sentence_kr)}</div>
  </div>
  ${pointsHtml}
</div>`;
    }
    body += '</div>';
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>직독직해 미리보기</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Sans:wght@400;500;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Noto Sans KR', 'Noto Sans', sans-serif; background: white; padding: 12px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .container { max-width: 1100px; margin: 0 auto; }
    .source-section { margin-bottom: 25px; }
    .source-title { font-size: 13px; font-weight: 700; color: #FFFFFF; padding: 8px 12px; background: #4A6FA5; border-radius: 4px; margin-bottom: 12px; }
    .sentence-block { margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #F3F4F6; }
    .sentence-top { display: flex; gap: 10px; margin-bottom: 6px; width: 100%; }
    .sentence-left { flex: 0 1 calc(80% - 5px); display: flex; align-items: flex-start; }
    .sentence-right { flex: 0 0 calc(20% - 5px); min-width: 150px; background: #F9FAFB; padding: 6px 8px; border-radius: 4px; font-size: 11px; color: #374151; word-break: keep-all; }
    .sentence-num-area { flex-shrink: 0; width: 40px; text-align: center; padding-top: 14px; }
    .sentence-num { display: inline-block; background: #4A6FA5; color: #FFFFFF; padding: 2px 8px; border-radius: 3px; font-weight: 700; font-size: 11px; }
    .english-area { flex: 1 1 0; min-width: 0; overflow: hidden; }
    .english-sentence { font-family: 'Noto Sans', sans-serif; font-size: 15px; line-height: 2.0; display: flex; flex-wrap: wrap; align-items: flex-start; }
    .word-token { display: inline-flex; flex-direction: column; align-items: flex-start; vertical-align: top; margin: 0 3px; flex-shrink: 1; }
    .chunk-text { display: block; font-size: 8px; color: #1F2937; padding: 0 4px; min-height: 12px; margin-bottom: 1px; line-height: 1.3; text-align: left; white-space: nowrap; }
    .word-text { display: block; font-size: 15px; line-height: 1.2; text-align: left; white-space: nowrap; }
    .grammar-tag { display: block; font-size: 9px; font-weight: bold; color: #DC2626; background: white; padding: 0 2px; min-height: 10px; border-radius: 2px; margin-top: 1px; line-height: 1.3; white-space: nowrap; }
    .grammar-tag.subject-verb { color: #DC2626; }
    .word-text.grammar-highlight { background: #FFE8A0; padding: 0 2px; border-radius: 2px; }
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
    .floating-btn-wrap { position: fixed; bottom: 24px; right: 24px; display: flex; flex-direction: column; gap: 8px; z-index: 9999; }
    .floating-btn { width: 52px; height: 52px; border-radius: 50%; border: none; color: white; font-size: 20px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; transition: transform 0.2s; }
    .floating-btn:hover { transform: scale(1.08); }
    .floating-btn.print { background: linear-gradient(135deg, #0EA5E9, #38BDF8); }
    .floating-btn.close { background: linear-gradient(135deg, #6B7280, #9CA3AF); }
    @media print { .sentence-block { break-inside: avoid; } .source-section { break-before: page; } .source-section:first-child { break-before: auto; } .floating-btn-wrap { display: none !important; } }
  </style>
</head>
<body>
  <div class="container">${body}</div>
  <div class="floating-btn-wrap">
    <button class="floating-btn print" onclick="window.print()" title="인쇄 / PDF 저장">🖨️</button>
    <button class="floating-btn close" onclick="window.close()" title="닫기">✕</button>
  </div>
</body>
</html>`;
}

const DirectReadTab: React.FC<DirectReadTabProps> = ({
  sentences,
  wordList: _wordList,
  sentenceAnalyses,
  setSentenceAnalyses,
  setSentences,
}) => {
  void _wordList; // used by parent
  const { apiKey } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftAnalysis, setDraftAnalysis] = useState<DirectReadSentence | null>(null);
  /** 문법 포인트만 편집 중인 문장 인덱스 + 해당 문장의 문법 포인트 목록(토큰인덱스, 내용) */
  const [editingGrammarPointFor, setEditingGrammarPointFor] = useState<number | null>(null);
  const [grammarPointDraft, setGrammarPointDraft] = useState<{ tokenIndex: number; text: string }[]>([]);

  const handleGenerateAll = useCallback(async () => {
    if (sentences.length === 0) {
      alert('문장이 없습니다. 입력 탭에서 문장을 먼저 준비하세요.');
      return;
    }
    if (!apiKey) {
      alert('Settings에서 Gemini API Key를 먼저 설정해주세요.');
      return;
    }
    setIsGenerating(true);
    try {
      const promises = sentences.map(async (s, i) => {
        const tokens = tokenize(s.sentence_en);
        if (tokens.length === 0) return { i, analysis: { chunking: [], main_sv: [], grammar_tags: [] } as DirectReadSentence };
        const analysis = await generateDirectReadAnalysis(apiKey, tokens, 'gemini-2.0-flash', s.sentence_en, s.sentence_kr);
        return { i, analysis };
      });
      const results = await Promise.all(promises);
      setSentenceAnalyses((prev) => {
        const next = [...prev];
        for (const { i, analysis } of results) next[i] = analysis;
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '직독직해 생성 실패';
      alert(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [sentences, apiKey, setSentenceAnalyses]);

  const handlePreview = useCallback(() => {
    const hasAny = sentenceAnalyses.some(Boolean);
    if (!hasAny || sentences.length === 0) {
      alert('직독직해를 먼저 생성하세요.');
      return;
    }
    const html = buildDirectReadPreviewHtml(sentences, sentenceAnalyses);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }, [sentences, sentenceAnalyses]);

  const handleSaveDirectReadJson = useCallback(() => {
    const defaultName = `직독직해_${new Date().toISOString().slice(0, 10)}`;
    const fileName = window.prompt('저장할 파일 이름을 입력하세요:', defaultName);
    if (!fileName) return;
    const data: DirectReadJsonData = {
      version: '1.0',
      type: 'directread',
      created_at: new Date().toISOString(),
      sentences,
      sentence_analyses: sentenceAnalyses,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sentences, sentenceAnalyses]);

  const handleLoadDirectReadJson = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text) as DirectReadJsonData & { sentence_analyses?: (DirectReadSentence | null)[]; sentences?: Sentence[] };
        if (data.type === 'directread' && Array.isArray(data.sentence_analyses)) {
          if (data.sentences && Array.isArray(data.sentences) && setSentences) {
            const mapped: Sentence[] = (data.sentences as (Sentence & { english?: string; korean?: string })[]).map((s) => ({
              id: s.id,
              source: s.source ?? '',
              sentence_en: s.sentence_en ?? s.english ?? '',
              sentence_kr: s.sentence_kr ?? s.korean ?? '',
            }));
            setSentences(mapped);
          }
          const analyses = data.sentence_analyses.map((a: DirectReadSentence | null) => {
            if (!a) return null;
            return {
              chunking: Array.isArray(a.chunking) ? a.chunking : [],
              main_sv: Array.isArray(a.main_sv) ? a.main_sv : [],
              grammar_tags: Array.isArray(a.grammar_tags) ? a.grammar_tags : [],
              role: a.role,
              grammar_note: a.grammar_note,
              reading_point: a.reading_point,
              vocab_point: a.vocab_point,
              blank_point: a.blank_point,
            };
          });
          setSentenceAnalyses(analyses);
          const sentCount = data.sentences?.length ?? analyses.length;
          alert(`✅ 직독직해 JSON 불러오기 완료. 문장 ${sentCount}개, 분석 ${analyses.length}개.`);
        } else if (Array.isArray(data.sentence_analyses)) {
          const analyses = data.sentence_analyses.map((a: DirectReadSentence | null) => {
            if (!a) return null;
            return {
              chunking: Array.isArray(a.chunking) ? a.chunking : [],
              main_sv: Array.isArray(a.main_sv) ? a.main_sv : [],
              grammar_tags: Array.isArray(a.grammar_tags) ? a.grammar_tags : [],
              role: a.role,
              grammar_note: a.grammar_note,
              reading_point: a.reading_point,
              vocab_point: a.vocab_point,
              blank_point: a.blank_point,
            };
          });
          setSentenceAnalyses((prev) => {
            const next = [...prev];
            for (let i = 0; i < analyses.length && i < next.length; i++) next[i] = analyses[i];
            return next;
          });
          alert(`✅ 직독직해 분석만 불러옴. ${analyses.length}개 (현재 문장 수에 맞춤).`);
        } else if (data.sentences && Array.isArray(data.sentences) && data.sentences.length > 0) {
          // 단어장 형식: 문장별 chunking / main_sv / grammar_tags + main_idea
          const raw = data.sentences as Array<{
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
          const hasAnalysis = raw.some((s) => Array.isArray(s.chunking) || Array.isArray(s.main_sv) || Array.isArray(s.grammar_tags));
          if (hasAnalysis) {
            const mapped: Sentence[] = raw.map((s) => ({
              id: s.id,
              source: s.source ?? '',
              sentence_en: s.sentence_en ?? s.english ?? '',
              sentence_kr: s.sentence_kr ?? s.korean ?? '',
            }));
            if (setSentences) setSentences(mapped);

            const mainIdea = (data as { main_idea?: Record<string, { sentences?: Array<{ role?: string; logic?: string; vocab_point?: unknown; blank_point?: unknown }> }> }).main_idea;
            const analyses: (DirectReadSentence | null)[] = raw.map((s, i) => {
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
              const src = mapped[i].source;
              const localIdx = mapped.slice(0, i).filter((x) => x.source === src).length;
              const mainSentences = mainIdea?.[src]?.sentences;
              const extra = mainSentences?.[localIdx];
              if (extra) {
                if (extra.role != null || extra.logic != null) {
                  base.reading_point = { role: extra.role ?? '', logic: extra.logic ?? '' };
                }
                if (extra.vocab_point != null && typeof extra.vocab_point === 'object') {
                  const v = extra.vocab_point as { word?: string; context_meaning?: string; antonyms?: string[]; exam_reason?: string };
                  base.vocab_point = { word: v.word ?? '', context_meaning: v.context_meaning ?? '', antonyms: v.antonyms, exam_reason: v.exam_reason };
                }
                if (extra.blank_point != null && typeof extra.blank_point === 'object') {
                  const b = extra.blank_point as { target_phrase?: string; paraphrases?: string[]; exam_reason?: string };
                  base.blank_point = { target_phrase: b.target_phrase ?? '', paraphrases: b.paraphrases, exam_reason: b.exam_reason };
                }
              }
              return base;
            });
            setSentenceAnalyses(analyses);
            alert(`✅ 단어장 형식 직독직해 불러오기 완료. 문장 ${mapped.length}개, 분석 ${analyses.filter(Boolean).length}개.`);
            return;
          }
          alert('직독직해 JSON 형식이 아닙니다. (sentence_analyses 배열 또는 문장별 chunking/main_sv/grammar_tags 필요)');
        } else {
          alert('직독직해 JSON 형식이 아닙니다. (sentence_analyses 배열 또는 문장별 chunking/main_sv/grammar_tags 필요)');
        }
      } catch {
        alert('JSON 파일 읽기 실패');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [setSentenceAnalyses, setSentences]
  );

  const countGenerated = sentenceAnalyses.filter(Boolean).length;
  const sourceGroups: Record<string, { sentence: Sentence; idx: number }[]> = {};
  sentences.forEach((s, i) => {
    const src = s.source || '기타';
    if (!sourceGroups[src]) sourceGroups[src] = [];
    sourceGroups[src].push({ sentence: s, idx: i });
  });

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <h2 style={{ color: '#0EA5E9', fontSize: '22px', margin: 0 }}>📖 직독직해</h2>
        <span style={{ color: '#6B7280', fontSize: '14px' }}>
          문장 {sentences.length}개 | 직독직해 생성됨 {countGenerated}개
        </span>
        <button
          type="button"
          onClick={() => void handleGenerateAll()}
          disabled={sentences.length === 0 || isGenerating}
          style={{
            padding: '10px 20px',
            borderRadius: '10px',
            border: 'none',
            background: sentences.length === 0 || isGenerating ? '#E5E7EB' : 'linear-gradient(135deg, #0EA5E9, #38BDF8)',
            color: 'white',
            fontWeight: 'bold',
            cursor: sentences.length === 0 || isGenerating ? 'not-allowed' : 'pointer',
            fontSize: '14px',
          }}
        >
          {isGenerating ? 'Gemini 연동 중...' : '직독직해 생성'}
        </button>
        <button
          type="button"
          onClick={handlePreview}
          disabled={countGenerated === 0}
          style={{
            padding: '10px 20px',
            borderRadius: '10px',
            border: '1px solid #0EA5E9',
            background: countGenerated === 0 ? '#F3F4F6' : 'white',
            color: countGenerated === 0 ? '#9CA3AF' : '#0EA5E9',
            fontWeight: 'bold',
            cursor: countGenerated === 0 ? 'not-allowed' : 'pointer',
            fontSize: '14px',
          }}
        >
          미리보기
        </button>
        <button
          type="button"
          onClick={handleSaveDirectReadJson}
          disabled={sentences.length === 0}
          style={{
            padding: '10px 20px',
            borderRadius: '10px',
            border: '1px solid #059669',
            background: sentences.length === 0 ? '#F3F4F6' : 'white',
            color: sentences.length === 0 ? '#9CA3AF' : '#059669',
            fontWeight: 'bold',
            cursor: sentences.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: '14px',
          }}
        >
          JSON 저장
        </button>
        <label
          style={{
            padding: '10px 20px',
            borderRadius: '10px',
            border: '1px solid #D97706',
            background: 'white',
            color: '#D97706',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'inline-block',
          }}
        >
          JSON 불러오기
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleLoadDirectReadJson}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      <p style={{ color: '#6B7280', fontSize: '13px', marginBottom: '16px' }}>
        「직독직해 생성」을 누르면 Gemini가 문장별로 직독직해·문장 성분(S/V/O/C)·문법 태그를 생성합니다. Settings에서 API Key를 설정한 뒤 사용하세요. 종합본에서 「분석본에 직독직해 포함」을 선택하면 이 직독직해가 분석본에 들어갑니다.
      </p>

      {sentences.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#9CA3AF' }}>
          입력 탭에서 문장을 추가한 뒤 여기서 직독직해를 생성하세요.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {Object.entries(sourceGroups).map(([source, items]) => (
            <div key={source} style={{ border: '1px solid #E5E7EB', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: '#4A6FA5', color: 'white', padding: '8px 12px', fontWeight: 700, fontSize: '13px' }}>
                {source}
              </div>
              <div style={{ padding: '12px' }}>
                {items.map(({ sentence, idx }) => {
                  const analysis = sentenceAnalyses[idx];
                  const tokens = tokenize(sentence.sentence_en);
                  const hasAnalysis = analysis && analysis.chunking.length === tokens.length;
                  return (
                    <div
                      key={idx}
                      style={{
                        marginBottom: '16px',
                        paddingBottom: '12px',
                        borderBottom: '1px solid #F3F4F6',
                      }}
                    >
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                        <div style={{ flex: '0 0 32px', textAlign: 'center', background: '#E0F2FE', color: '#0369A1', borderRadius: '4px', padding: '4px', fontWeight: 700, fontSize: '12px' }}>
                          {String(items.findIndex((x) => x.idx === idx) + 1).padStart(2, '0')}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                            <div style={{ fontSize: '13px', color: '#374151' }}>{sentence.sentence_en}</div>
                            {hasAnalysis && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (editingIndex === idx) {
                                    if (draftAnalysis) {
                                      setSentenceAnalyses((prev) => {
                                        const next = [...prev];
                                        next[idx] = draftAnalysis;
                                        return next;
                                      });
                                    }
                                    setEditingIndex(null);
                                    setDraftAnalysis(null);
                                  } else {
                                    setEditingIndex(idx);
                                    setDraftAnalysis({
                                      ...analysis!,
                                      chunking: [...(analysis!.chunking ?? [])],
                                      main_sv: [...(analysis!.main_sv ?? [])],
                                      grammar_tags: [...(analysis!.grammar_tags ?? [])],
                                    });
                                  }
                                }}
                                style={{
                                  flexShrink: 0,
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  border: '1px solid #0EA5E9',
                                  background: editingIndex === idx ? '#0EA5E9' : 'white',
                                  color: editingIndex === idx ? 'white' : '#0EA5E9',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                {editingIndex === idx ? '적용' : '편집'}
                              </button>
                            )}
                          </div>
                          <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '8px' }}>{sentence.sentence_kr}</div>
                          {hasAnalysis && editingIndex === idx && draftAnalysis && (
                            <div style={{ marginTop: '8px', padding: '12px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                              <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '8px' }}>토큰별 직독직해 · 성분(S/V/O 등) · 문법 태그 수정</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '280px', overflowY: 'auto' }}>
                                {tokens.map((t, i) => (
                                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 50px 1fr', gap: '6px', alignItems: 'center', fontSize: '12px' }}>
                                    <span style={{ color: '#475569', fontWeight: 600 }}>{t}</span>
                                    <input
                                      value={draftAnalysis.chunking[i] ?? ''}
                                      onChange={(e) => {
                                        const next = [...draftAnalysis.chunking];
                                        next[i] = e.target.value;
                                        setDraftAnalysis({ ...draftAnalysis, chunking: next });
                                      }}
                                      placeholder="직독직해"
                                      style={{ padding: '4px 6px', border: '1px solid #D1D5DB', borderRadius: '4px', fontSize: '11px' }}
                                    />
                                    <input
                                      value={draftAnalysis.main_sv[i] ?? ''}
                                      onChange={(e) => {
                                        const next = [...draftAnalysis.main_sv];
                                        next[i] = e.target.value;
                                        setDraftAnalysis({ ...draftAnalysis, main_sv: next });
                                      }}
                                      placeholder="S/V/O"
                                      style={{ padding: '4px 6px', border: '1px solid #D1D5DB', borderRadius: '4px', fontSize: '11px' }}
                                    />
                                    <input
                                      value={draftAnalysis.grammar_tags[i] ?? ''}
                                      onChange={(e) => {
                                        const next = [...draftAnalysis.grammar_tags];
                                        next[i] = e.target.value;
                                        setDraftAnalysis({ ...draftAnalysis, grammar_tags: next });
                                      }}
                                      placeholder="문법"
                                      style={{ padding: '4px 6px', border: '1px solid #D1D5DB', borderRadius: '4px', fontSize: '11px' }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {hasAnalysis && editingIndex !== idx && (
                            <>
                              <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {tokens.map((t, i) => {
                                  const gram = analysis!.grammar_tags[i];
                                  return (
                                    <span
                                      key={i}
                                      style={{
                                        display: 'inline-flex',
                                        flexDirection: 'column',
                                        alignItems: 'flex-start',
                                        background: gram ? GRAMMAR_HIGHLIGHT_COLOR : '#F8FAFC',
                                        padding: '4px 6px',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                      }}
                                    >
                                      <span style={{ color: '#64748B', fontSize: '10px' }}>{analysis!.chunking[i] || ''}</span>
                                      <span style={{ fontWeight: 600, color: '#1E293B' }}>{t}</span>
                                      {analysis!.main_sv[i] && (
                                        <span style={{ color: '#DC2626', fontSize: '9px', fontWeight: 700 }}>
                                          {analysis!.main_sv[i]}
                                        </span>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '40px' }}>
                                {analysis!.reading_point?.role != null || analysis!.reading_point?.logic != null ? (
                                  <div style={{ padding: '8px 12px', background: '#E0F2FE', borderRadius: '6px', borderLeft: '3px solid #0284C7', fontSize: '11px', color: '#1F2937', lineHeight: 1.5 }}>
                                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>[독해 포인트]</div>
                                    <div>{(analysis!.reading_point!.role ? `${analysis!.reading_point!.role} ` : '')}{analysis!.reading_point!.logic || ''}</div>
                                  </div>
                                ) : null}
                                {analysis!.grammar_tags.some((g) => g?.trim()) && (
                                  <div style={{ padding: '8px 12px', background: GRAMMAR_HIGHLIGHT_COLOR, borderRadius: '6px', borderLeft: '3px solid #D4A843', fontSize: '11px', color: '#1F2937', lineHeight: 1.5 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                      <span style={{ fontWeight: 700 }}>[문법 포인트]</span>
                                    {editingGrammarPointFor === idx ? (
                                      <span style={{ display: 'flex', gap: '6px' }}>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const next = [...(sentenceAnalyses[idx]!.grammar_tags ?? [])];
                                            grammarPointDraft.forEach((e) => { next[e.tokenIndex] = e.text; });
                                            setSentenceAnalyses((prev) => {
                                              const n = [...prev];
                                              n[idx] = { ...sentenceAnalyses[idx]!, grammar_tags: next };
                                              return n;
                                            });
                                            setEditingGrammarPointFor(null);
                                            setGrammarPointDraft([]);
                                          }}
                                          style={{ padding: '2px 8px', fontSize: '11px', fontWeight: 600, background: '#0EA5E9', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                        >
                                          적용
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => { setEditingGrammarPointFor(null); setGrammarPointDraft([]); }}
                                          style={{ padding: '2px 8px', fontSize: '11px', background: '#E5E7EB', color: '#374151', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                        >
                                          취소
                                        </button>
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const entries = (analysis!.grammar_tags ?? [])
                                            .map((g, i) => ({ tokenIndex: i, text: g ?? '' }))
                                            .filter((e) => e.text.trim());
                                          setEditingGrammarPointFor(idx);
                                          setGrammarPointDraft(entries.map((e) => ({ tokenIndex: e.tokenIndex, text: e.text })));
                                        }}
                                        style={{ padding: '2px 8px', fontSize: '11px', fontWeight: 600, background: 'white', color: '#0EA5E9', border: '1px solid #0EA5E9', borderRadius: '4px', cursor: 'pointer' }}
                                      >
                                        편집
                                      </button>
                                    )}
                                  </div>
                                  {editingGrammarPointFor === idx ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                      {grammarPointDraft.map((e, di) => (
                                        <div key={e.tokenIndex} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                          <span style={{ flexShrink: 0, fontSize: '10px', color: '#64748B', marginTop: '4px' }}>토큰 “{tokens[e.tokenIndex]}”:</span>
                                          <input
                                            value={e.text}
                                            onChange={(ev) => {
                                              setGrammarPointDraft((prev) => prev.map((x, i) => (i === di ? { ...x, text: ev.target.value } : x)));
                                            }}
                                            placeholder="문법 포인트 설명"
                                            style={{ flex: 1, padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: '4px', fontSize: '11px' }}
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <ol style={{ margin: 0, paddingLeft: '18px' }}>
                                      {analysis!.grammar_tags.filter((g) => g?.trim()).map((g, gi) => (
                                        <li key={gi}>{g}</li>
                                      ))}
                                    </ol>
                                  )}
                                </div>
                              )}
                                {analysis!.vocab_point?.word && (
                                  <div style={{ padding: '8px 12px', background: '#D1FAE5', borderRadius: '6px', borderLeft: '3px solid #059669', fontSize: '11px', color: '#1F2937', lineHeight: 1.5 }}>
                                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>[어휘 포인트]</div>
                                    <div><strong>{analysis!.vocab_point.word}</strong> {analysis!.vocab_point.context_meaning}{analysis!.vocab_point.antonyms?.length ? ` | 반의어: ${analysis!.vocab_point.antonyms.join(', ')}` : ''}</div>
                                    {analysis!.vocab_point.exam_reason && <div style={{ marginTop: '4px', fontSize: '10px', color: '#6B7280' }}>{analysis!.vocab_point.exam_reason}</div>}
                                  </div>
                                )}
                                {analysis!.blank_point?.target_phrase && (
                                  <div style={{ padding: '8px 12px', background: '#FCE7F3', borderRadius: '6px', borderLeft: '3px solid #DB2777', fontSize: '11px', color: '#1F2937', lineHeight: 1.5 }}>
                                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>[빈칸 포인트]</div>
                                    <div><strong>{analysis!.blank_point.target_phrase}</strong></div>
                                    {analysis!.blank_point.paraphrases?.length ? <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>{analysis!.blank_point.paraphrases.map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
                                    {analysis!.blank_point.exam_reason && <div style={{ marginTop: '4px', fontSize: '10px', color: '#6B7280' }}>{analysis!.blank_point.exam_reason}</div>}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                          {!hasAnalysis && (
                            <div style={{ marginTop: '6px', fontSize: '12px', color: '#9CA3AF' }}>
                              직독직해 미생성
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DirectReadTab;
