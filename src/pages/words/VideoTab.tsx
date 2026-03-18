import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { Word, Sentence, DirectReadSentence } from '../../types/words';
import { getSettings } from '../../lib/store';
import { generateSpeechAudio } from '../../lib/wordsGemini';

interface VideoTabProps {
  wordList: Word[];
  sentences: Sentence[];
  sentenceAnalyses?: (DirectReadSentence | null)[];
}

/** 문법 포인트용 배경색 (영문 단어 + [문법 포인트] 박스 동일) */
const GRAMMAR_POINT_BG = '#FFE8A0';
/** 어휘 포인트용 배경색 */
const VOCAB_POINT_BG = '#D1FAE5';
/** 빈칸 포인트용 배경색 */
const BLANK_POINT_BG = '#FCE7F3';

function tokenizeEn(english: string): string[] {
  return english.trim().split(/\s+/).filter(Boolean);
}

/** 구절(단어 또는 여러 단어)이 문장 토큰에서 시작하는 인덱스와 끝 인덱스 [start, end) 반환. 없으면 null */
function findTokenRangeForPhrase(tokens: string[], phrase: string): [number, number] | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[.,;:'"?!()]/g, '').trim();
  const phraseWords = phrase.trim().split(/\s+/).map(normalize).filter(Boolean);
  if (phraseWords.length === 0) return null;
  for (let i = 0; i <= tokens.length - phraseWords.length; i++) {
    const match = phraseWords.every((pw, j) => normalize(tokens[i + j]) === pw);
    if (match) return [i, i + phraseWords.length];
  }
  return null;
}

// ─── 문장별 단어 매핑 ────────────────────────────
function buildWordMap(sentences: Sentence[], wordList: Word[]): Record<number, Word[]> {
  const map: Record<number, Word[]> = {};
  for (let i = 0; i < sentences.length; i++) {
    map[i] = [];
    const s = sentences[i];
    for (const w of wordList) {
      if (
        w.source === s.source &&
        (w.example_en === s.sentence_en || s.sentence_en?.toLowerCase().includes(w.word.toLowerCase()))
      ) {
        if (!map[i].some((x) => x.word === w.word)) map[i].push(w);
      }
    }
  }
  return map;
}

// ─── 음성 옵션 ───────────────────────────────────
const VOICES = [
  { value: 'Kore', label: 'Kore (차분한)' },
  { value: 'Puck', label: 'Puck (밝은)' },
  { value: 'Charon', label: 'Charon (깊은)' },
  { value: 'Fenrir', label: 'Fenrir (강한)' },
  { value: 'Aoede', label: 'Aoede (따뜻한)' },
  { value: 'Leda', label: 'Leda (부드러운)' },
  { value: 'Orus', label: 'Orus (또렷한)' },
  { value: 'Zephyr', label: 'Zephyr (가벼운)' },
];

const BATCH_SIZE = 5;    // 5문장씩 배치 요청
const MAX_RETRIES = 4;   // 429/500 재시도
const BATCH_DELAY = 2000; // 배치 간 2초 딜레이
const CANVAS_W = 1280;
const CANVAS_H = 720;

// ─── 유틸 ────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function backoffMs(retry: number): number {
  return Math.min(2000 * Math.pow(2, retry) + Math.random() * 1000, 20000);
}

// ─── 배치 데이터 ─────────────────────────────────
interface AudioBatch {
  startIdx: number;          // 포함 (생성 시점 인덱스)
  endIdx: number;            // 미포함
  /** 배치에 포함된 문장 ID 순서 (문장·음성 정확 매칭용) */
  sentenceIds: string[];
  blob: Blob;
  duration: number;          // 총 오디오 길이 (초)
  slideDurations: number[];  // 문장별 추정 길이 (초)
  slideOffsets: number[];    // 문장별 시작 오프셋 (초)
}

// ─── 배치 음성 생성 (5문장 묶어서 1 API 호출) ────
async function generateBatchedAudio(
  sentences: Sentence[],
  apiKey: string,
  voice: string,
  onProgress: (done: number, total: number, msg: string) => void
): Promise<AudioBatch[]> {
  const total = sentences.length;
  const numBatches = Math.ceil(total / BATCH_SIZE);
  const batches: AudioBatch[] = [];

  for (let b = 0; b < numBatches; b++) {
    const startIdx = b * BATCH_SIZE;
    const endIdx = Math.min(startIdx + BATCH_SIZE, total);
    const count = endIdx - startIdx;

    // 배치 스크립트 빌드 — 영어만 전송 (속도 최적화)
    let script = '';
    const textLengths: number[] = [];

    for (let i = startIdx; i < endIdx; i++) {
      const s = sentences[i];
      const enText = s.sentence_en || '';
      textLengths.push(enText.length);
      script += enText;
      if (i < endIdx - 1) script += '\n\n...\n\n'; // 문장 사이 쉼
    }

    // API 호출 (재시도 + 백오프)
    let blob: Blob | null = null;
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        const retryMsg = retry > 0 ? ` (재시도 ${retry}/${MAX_RETRIES})` : '';
        onProgress(b, numBatches,
          `🎤 배치 ${b + 1}/${numBatches} (문장 ${startIdx + 1}~${endIdx}) 생성 중...${retryMsg}`
        );

        const result = await generateSpeechAudio(apiKey, script, voice);

        if (result.size > 100) {
          blob = result;
          break;
        }

        // 빈 데이터 → 대기 후 재시도
        if (retry < MAX_RETRIES) {
          const waitMs = backoffMs(retry);
          onProgress(b, numBatches, `⏳ 배치 ${b + 1} 빈 데이터, ${(waitMs / 1000).toFixed(1)}초 후 재시도...`);
          await sleep(waitMs);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '';
        const isRateLimit = errMsg.includes('429') || errMsg.includes('Too Many') || errMsg.includes('RESOURCE_EXHAUSTED');
        const isServer = errMsg.includes('500') || errMsg.includes('internal') || errMsg.includes('Internal');

        if ((isRateLimit || isServer) && retry < MAX_RETRIES) {
          const waitMs = backoffMs(retry);
          onProgress(b, numBatches,
            `⏳ 배치 ${b + 1} ${isRateLimit ? '속도 제한(429)' : '서버 오류(500)'}, ${(waitMs / 1000).toFixed(1)}초 후 재시도...`
          );
          await sleep(waitMs);
          continue;
        }
        if (retry < MAX_RETRIES) {
          await sleep(3000);
          continue;
        }
        throw new Error(`배치 ${b + 1} (문장 ${startIdx + 1}~${endIdx}) 음성 생성 실패: ${errMsg}`);
      }
    }

    if (!blob) throw new Error(`배치 ${b + 1}: ${MAX_RETRIES + 1}회 시도 후 실패`);

    // 오디오 길이 측정
    const audioCtx = new AudioContext();
    const arrBuf = await blob.arrayBuffer();
    // arrayBuffer()는 blob을 소모하므로 새 Blob 저장
    const audioBuffer = await audioCtx.decodeAudioData(arrBuf.slice(0));
    const duration = audioBuffer.duration;
    await audioCtx.close();

    // 텍스트 길이 비례로 문장별 시간 추정
    const totalLen = textLengths.reduce((a, b) => a + b, 0);
    const slideDurations = textLengths.map((len) => duration * (len / totalLen));
    const slideOffsets: number[] = [];
    let offset = 0;
    for (let i = 0; i < count; i++) {
      slideOffsets.push(offset);
      offset += slideDurations[i];
    }

    // blob을 다시 만들어 저장 (arrayBuffer 소모 대응)
    const freshBlobArr = await (new Blob([arrBuf])).arrayBuffer();
    const freshBlob = new Blob([freshBlobArr], { type: blob.type || 'audio/wav' });

    const sentenceIds = sentences.slice(startIdx, endIdx).map((s, j) => s.id || `idx-${startIdx + j}`);
    batches.push({ startIdx, endIdx, sentenceIds, blob: freshBlob, duration, slideDurations, slideOffsets });
    onProgress(b + 1, numBatches, `✅ 배치 ${b + 1}/${numBatches} 완료 (${count}문장, ${duration.toFixed(1)}초)`);

    // 배치 간 딜레이 (속도 제한 방지)
    if (b < numBatches - 1) await sleep(BATCH_DELAY);
  }

  return batches;
}

// ─── 캔버스에 텍스트 줄바꿈 ──────────────────────
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number,
  maxWidth: number, lineHeight: number
): number {
  const words = text.split(' ');
  let line = '';
  let curY = y;

  for (const word of words) {
    const test = line + (line ? ' ' : '') + word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = word;
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  return curY;
}

// ─── 둥근 사각형 ────────────────────────────────
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** 문장 ID (id 없으면 인덱스 기반 폴백) */
function getSentenceId(s: Sentence, index: number): string {
  return s.id ?? `idx-${index}`;
}

// ─── 슬라이드 그리기 (사진과 동일: 번호 파란칸, 왼쪽 3단 직독직해, 오른쪽 한글 해석, 아래 [문법 포인트]) ───
/** sourceLocalNum: 해당 출처 내에서의 번호(1부터), sourceLocalTotal: 해당 출처 문장 수 */
function drawSlide(
  ctx: CanvasRenderingContext2D,
  sentence: Sentence,
  sourceLocalNum: number,
  sourceLocalTotal: number,
  _words: Word[],
  analysis: DirectReadSentence | null = null
) {
  const W = CANVAS_W, H = CANVAS_H;
  const krBoxX = W * 0.72;
  const krBoxW = W - krBoxX - 24;
  const engX = 100;
  const engY = 78;
  const engMaxW = krBoxX - engX - 24;
  const numLeft = 32;
  const numTop = 78;
  const numW = 52;
  const numH = 36;
  const chunkFont = '11px "Noto Sans KR", sans-serif';
  const wordFont = '16px "Noto Sans", sans-serif';
  const tagFont = 'bold 11px "Noto Sans KR", sans-serif';
  const chunkH = 14;
  const chunkWordGap = 2;
  const wordH = 20;
  const wordTagGap = 0;
  const tagH = 14;
  const tokenGapX = 10;
  const lineBottomGap = 28;
  const tokenLineH = chunkH + chunkWordGap + wordH + wordTagGap + tagH + lineBottomGap;
  const tokens = tokenizeEn(sentence.sentence_en || '');
  const hasAnalysis = analysis && analysis.chunking.length === tokens.length;

  // 배경
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // 출처 바
  ctx.fillStyle = '#F3F4F6';
  ctx.fillRect(0, 0, W, 56);
  ctx.fillStyle = '#1F2937';
  ctx.font = 'bold 22px "Noto Sans KR", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(sentence.source || '', 24, 28);

  // 번호 뱃지 (출처마다 01부터 시작)
  const numStr = String(sourceLocalNum).padStart(2, '0');
  ctx.fillStyle = '#4A6FA5';
  roundRect(ctx, numLeft, numTop, numW, numH, 8);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 18px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(numStr, numLeft + numW / 2, numTop + numH / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  let contentBottom = engY;

  const vocabTokenRange = hasAnalysis && analysis!.vocab_point?.word
    ? findTokenRangeForPhrase(tokens, analysis!.vocab_point.word)
    : null;
  const blankTokenRange = hasAnalysis && analysis!.blank_point?.target_phrase
    ? findTokenRangeForPhrase(tokens, analysis!.blank_point.target_phrase)
    : null;

  if (hasAnalysis && tokens.length > 0) {
    const startX = engX;
    const startY = engY;
    let cx = startX;
    let cy = startY;
    const maxX = krBoxX - 16;

    ctx.font = chunkFont;
    ctx.font = wordFont;
    ctx.font = tagFont;

    for (let i = 0; i < tokens.length; i++) {
      const chunk = analysis!.chunking[i] ?? '';
      const word = tokens[i];
      const tag = analysis!.main_sv[i] ?? '';
      const hasGram = !!analysis!.grammar_tags[i]?.trim();
      const inVocab = vocabTokenRange != null && i >= vocabTokenRange[0] && i < vocabTokenRange[1];
      const inBlank = blankTokenRange != null && i >= blankTokenRange[0] && i < blankTokenRange[1];
      const space = i === 0 ? '' : ' ';

      ctx.font = chunkFont;
      const wChunk = ctx.measureText((chunk || ' ') + space).width;
      ctx.font = wordFont;
      const wWord = ctx.measureText(space + word).width;
      ctx.font = tagFont;
      const wTag = tag ? ctx.measureText(space + tag).width : 0;
      const tokenW = Math.max(wChunk, wWord, wTag) + 8;

      if (cx + tokenW > maxX && cx > startX) {
        cx = startX;
        cy += tokenLineH;
      }
      contentBottom = Math.max(contentBottom, cy + tokenLineH);

      const chunkBaseline = cy + chunkH - 2;
      const wordRowY = cy + chunkH + chunkWordGap;
      const wordDrawX = cx + 2;
      const wordTop = wordRowY + wordH - 2;
      const wordBoxH = 16;
      if (inVocab) {
        ctx.fillStyle = VOCAB_POINT_BG;
        ctx.fillRect(wordDrawX, wordTop, wWord + 6, wordBoxH);
      } else if (inBlank) {
        ctx.fillStyle = BLANK_POINT_BG;
        ctx.fillRect(wordDrawX, wordTop, wWord + 6, wordBoxH);
      } else if (hasGram) {
        ctx.fillStyle = GRAMMAR_POINT_BG;
        ctx.fillRect(wordDrawX, wordTop, wWord + 6, wordBoxH);
      }

      ctx.fillStyle = '#4B5563';
      ctx.font = chunkFont;
      ctx.fillText((chunk || '') + space, wordDrawX, chunkBaseline);
      ctx.fillStyle = '#1F2937';
      ctx.font = wordFont;
      ctx.fillText(space + word, wordDrawX, wordTop);
      if (tag) {
        ctx.fillStyle = '#DC2626';
        ctx.font = tagFont;
        ctx.fillText(space + tag, wordDrawX, wordTop + wordBoxH + wordTagGap + tagH - 2);
      }

      cx += tokenW + tokenGapX;
    }
  } else {
    ctx.font = '22px "Noto Sans", sans-serif';
    ctx.fillStyle = '#1F2937';
    contentBottom = wrapText(ctx, sentence.sentence_en || '', engX, engY, engMaxW, 32);
  }

  const krBoxH = Math.max(140, contentBottom - 70);
  ctx.fillStyle = '#F9FAFB';
  roundRect(ctx, krBoxX, 70, krBoxW, krBoxH, 8);
  ctx.fill();
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#374151';
  ctx.font = '15px "Noto Sans KR", sans-serif';
  wrapText(ctx, sentence.sentence_kr || '', krBoxX + 14, 84, krBoxW - 28, 24);

  contentBottom = Math.max(contentBottom + 12, 72 + krBoxH);

  const boxX = 100;
  const boxW = krBoxX - boxX - 20;
  const boxPadding = 14;
  const titleContentGap = 14;
  const lineHeight = 20;
  const gapBetweenBoxes = 10;

  const drawPointBox = (title: string, lines: string[], bgColor: string, borderColor: string): number => {
    if (lines.length === 0) return 0;
    const boxH = Math.min(220, boxPadding * 2 + 18 + titleContentGap + lines.length * (lineHeight + 4));
    const boxY = contentBottom + gapBetweenBoxes;
    ctx.fillStyle = bgColor;
    roundRect(ctx, boxX, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(boxX, boxY + 8);
    ctx.lineTo(boxX, boxY + boxH - 8);
    ctx.stroke();
    ctx.fillStyle = '#1F2937';
    ctx.font = 'bold 13px "Noto Sans KR", sans-serif';
    ctx.fillText(title, boxX + boxPadding, boxY + boxPadding + 14);
    ctx.font = '11px "Noto Sans KR", sans-serif';
    let gy = boxY + boxPadding + 18 + titleContentGap;
    for (const text of lines) {
      gy = wrapText(ctx, text, boxX + boxPadding + 8, gy, boxW - boxPadding * 2 - 8, lineHeight) + 4;
    }
    contentBottom = boxY + boxH;
    return boxH;
  };

  if (hasAnalysis && analysis!) {
    if (analysis.reading_point?.role != null || analysis.reading_point?.logic != null) {
      const r = analysis.reading_point!;
      const readingLines = [r.role ? `${r.role} ${r.logic || ''}` : (r.logic || '')].filter(Boolean);
      if (readingLines[0]) drawPointBox('[독해 포인트]', readingLines, '#E0F2FE', '#0284C7');
    }
    const grammarPoints = analysis.grammar_tags.filter((g) => g?.trim());
    if (grammarPoints.length > 0) {
      drawPointBox('[문법 포인트]', grammarPoints.map((g, i) => `${i + 1}. ${g}`), GRAMMAR_POINT_BG, '#D4A843');
    }
    if (analysis.vocab_point?.word) {
      const v = analysis.vocab_point;
      const vocabLines = [`${v.word} ${v.context_meaning || ''}`.trim(), v.antonyms?.length ? `반의어: ${v.antonyms.join(', ')}` : '', v.exam_reason || ''].filter(Boolean);
      if (vocabLines[0]) drawPointBox('[어휘 포인트]', vocabLines, '#D1FAE5', '#059669');
    }
    if (analysis.blank_point?.target_phrase) {
      const b = analysis.blank_point;
      const blankLines = [b.target_phrase, ...(b.paraphrases || []), b.exam_reason || ''].filter(Boolean);
      if (blankLines[0]) drawPointBox('[빈칸 포인트]', blankLines, '#FCE7F3', '#DB2777');
    }
  }

  // 슬라이드 번호 (우하단, 출처 내 번호)
  ctx.fillStyle = '#9CA3AF';
  ctx.font = '13px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${sourceLocalNum} / ${sourceLocalTotal}`, W - 16, H - 12);
  ctx.textAlign = 'left';
}

// ═══════════════════════════════════════════════
// VideoTab 컴포넌트
// ═══════════════════════════════════════════════
const VideoTab: React.FC<VideoTabProps> = ({ wordList, sentences, sentenceAnalyses = [] }) => {
  const apiKey = getSettings().geminiApiKey;

  // ── 상태 ───
  const [voice, setVoice] = useState('Kore');
  const [batches, setBatches] = useState<AudioBatch[]>([]);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [progress, setProgress] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playAbortRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  // ★ 디코딩된 AudioBuffer 캐시 (배치 인덱스 → AudioBuffer)
  const decodedCacheRef = useRef<Map<number, AudioBuffer>>(new Map());

  // ★ wordMap을 useMemo로 캐싱 (sentences/wordList가 변할 때만 재계산)
  const wordMap = useMemo(() => buildWordMap(sentences, wordList), [sentences, wordList]);
  const total = sentences.length;
  const numBatches = Math.ceil(total / BATCH_SIZE);
  const audioReady = batches.length === numBatches && numBatches > 0;

  // 출처별 번호 (출처가 바뀌면 1부터 다시)
  const { sourceLocalNum, sourceLocalTotal } = useMemo(() => {
    const num: number[] = [];
    const tot: number[] = [];
    const countBySource: Record<string, number> = {};
    for (const s of sentences) {
      countBySource[s.source] = (countBySource[s.source] || 0) + 1;
    }
    const runBySource: Record<string, number> = {};
    for (let i = 0; i < sentences.length; i++) {
      const src = sentences[i].source;
      runBySource[src] = (runBySource[src] || 0) + 1;
      num.push(runBySource[src]);
      tot.push(countBySource[src]);
    }
    return { sourceLocalNum: num, sourceLocalTotal: tot };
  }, [sentences]);

  // 문장 ID → 현재 인덱스 (음성 매칭용)
  const sentenceIdToIndex = useMemo(() => {
    const m: Record<string, number> = {};
    sentences.forEach((s, i) => {
      m[getSentenceId(s, i)] = i;
    });
    return m;
  }, [sentences]);

  // 슬라이드(문장 인덱스) → 배치·로컬인덱스 (ID 기준 매칭, 구 배치는 인덱스 폴백)
  const getBatchForSlide = useCallback((slideIdx: number): { batch: AudioBatch; localIdx: number } | null => {
    if (slideIdx < 0 || slideIdx >= sentences.length) return null;
    const sentenceId = getSentenceId(sentences[slideIdx], slideIdx);
    for (const b of batches) {
      if (b.sentenceIds?.length) {
        const localIdx = b.sentenceIds.indexOf(sentenceId);
        if (localIdx >= 0) return { batch: b, localIdx };
      } else if (slideIdx >= b.startIdx && slideIdx < b.endIdx) {
        return { batch: b, localIdx: slideIdx - b.startIdx };
      }
    }
    return null;
  }, [batches, sentences]);

  // 정리
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      sourceNodeRef.current?.stop();
      audioCtxRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 슬라이드 바뀌면 캔버스 그리기
  useEffect(() => {
    if (!canvasRef.current || sentences.length === 0) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const n = sourceLocalNum[currentSlide] ?? 1;
    const t = sourceLocalTotal[currentSlide] ?? 1;
    drawSlide(ctx, sentences[currentSlide], n, t, wordMap[currentSlide] || [], sentenceAnalyses[currentSlide] ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlide, sentences, wordList, sentenceAnalyses, sourceLocalNum, sourceLocalTotal]);

  // ── STEP 1: 배치 음성 생성 ────
  const handleGenerateAudio = async () => {
    if (!apiKey) { alert('Settings에서 API Key를 먼저 설정해주세요.'); return; }
    if (total === 0) { alert('문장이 없습니다.'); return; }

    setIsGeneratingAudio(true);
    setProgress('🔄 음성 생성 시작...');
    setBatches([]);
    setVideoUrl(null);
    decodedCacheRef.current.clear();

    try {
      const result = await generateBatchedAudio(
        sentences, apiKey, voice,
        (_done, _total, msg) => setProgress(msg)
      );
      // ★ 미리 디코딩해서 캐시 (재생 시 즉시 사용)
      setProgress('🔊 오디오 디코딩 중...');
      for (let i = 0; i < result.length; i++) {
        const ctx = new AudioContext();
        const buf = await result[i].blob.arrayBuffer();
        const bufCopy = buf.slice(0);
        const decoded = await ctx.decodeAudioData(bufCopy);
        decodedCacheRef.current.set(i, decoded);
        await ctx.close();
      }

      setBatches(result);
      const totalDuration = result.reduce((s, b) => s + b.duration, 0);
      setProgress(`✅ 전체 ${total}문장 → ${result.length}배치 완료! (총 ${totalDuration.toFixed(1)}초)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      setProgress(`❌ 오류: ${msg}`);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  // ── 오디오 재생 중지 ────
  const stopAudio = useCallback(() => {
    playAbortRef.current = true;
    try { sourceNodeRef.current?.stop(); } catch { /* ignore */ }
    sourceNodeRef.current = null;
    setIsPlaying(false);
  }, []);

  // ★ 디코딩된 AudioBuffer 가져오기 (캐시 활용, ArrayBuffer 복사본으로 디코딩)
  const getDecodedBuffer = useCallback(async (batchIdx: number, blob: Blob, audioCtx: AudioContext): Promise<AudioBuffer> => {
    const cached = decodedCacheRef.current.get(batchIdx);
    if (cached) return cached;

    const arrBuf = await blob.arrayBuffer();
    const audioBuf = await audioCtx.decodeAudioData(arrBuf.slice(0)); // ★ 복사본 사용
    decodedCacheRef.current.set(batchIdx, audioBuf);
    return audioBuf;
  }, []);

  // ── 특정 슬라이드 한 문장만 재생 ────
  const handlePlayCurrent = useCallback(async () => {
    const info = getBatchForSlide(currentSlide);
    if (!info) return;

    stopAudio();
    await sleep(50);

    try {
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      // ★ 캐시된 AudioBuffer 사용
      const batchIdx = batches.indexOf(info.batch);
      const audioBuf = await getDecodedBuffer(batchIdx, info.batch.blob, audioCtx);

      const offset = info.batch.slideOffsets[info.localIdx];
      const dur = info.batch.slideDurations[info.localIdx];

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(audioCtx.destination);
      sourceNodeRef.current = source;
      setIsPlaying(true);

      source.start(0, offset, dur);
      source.onended = () => {
        setIsPlaying(false);
        sourceNodeRef.current = null;
      };
    } catch (e) {
      console.error('재생 오류:', e);
      setIsPlaying(false);
    }
  }, [currentSlide, getBatchForSlide, stopAudio, batches, getDecodedBuffer]);

  // ── 전체 순차 재생 ────
  const handlePlayAll = useCallback(async () => {
    if (!audioReady) return;
    stopAudio();
    await sleep(50);
    playAbortRef.current = false;
    setIsPlaying(true);

    try {
      for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        if (playAbortRef.current) break;
        const batch = batches[bIdx];

        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;

        // ★ 캐시된 AudioBuffer 사용
        const audioBuf = await getDecodedBuffer(bIdx, batch.blob, audioCtx);

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuf;
        source.connect(audioCtx.destination);
        sourceNodeRef.current = source;
        source.start();

        // 슬라이드 자동 전환 (ID 기준 매칭)
        const slideCount = batch.sentenceIds?.length ?? batch.endIdx - batch.startIdx;
        let elapsed = 0;
        for (let i = 0; i < slideCount; i++) {
          if (playAbortRef.current) break;
          const sentenceId = batch.sentenceIds?.[i];
          const slideIdx = sentenceId != null ? (sentenceIdToIndex[sentenceId] ?? batch.startIdx + i) : batch.startIdx + i;
          setCurrentSlide(slideIdx);

          const dur = batch.slideDurations[i];
          await sleep(dur * 1000);
          elapsed += dur;
        }

        // 배치 오디오 끝 대기
        const remaining = batch.duration - elapsed;
        if (remaining > 0 && !playAbortRef.current) {
          await sleep(remaining * 1000);
        }

        source.stop();
        await audioCtx.close();

        // 배치 간 0.3초 쉼
        if (!playAbortRef.current) await sleep(300);
      }
    } catch (e) {
      console.error('전체 재생 오류:', e);
    } finally {
      setIsPlaying(false);
      sourceNodeRef.current = null;
    }
  }, [audioReady, batches, stopAudio, getDecodedBuffer, sentenceIdToIndex]);

  // ── STEP 3: WebM 동영상 녹화 ────
  const handleRecordVideo = async () => {
    if (!audioReady || !canvasRef.current) return;

    setIsRecording(true);
    setProgress('🎬 동영상 녹화 준비 중...');

    try {
      await document.fonts.ready;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d')!;
      const audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();

      // Canvas Stream + Audio 합치기
      const canvasStream = canvas.captureStream(30);
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ]);

      // MediaRecorder 설정
      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

      const recorder = new MediaRecorder(combinedStream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.start(100);

      // 배치별 순서대로 녹화
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        setProgress(`🎬 녹화 중... 배치 ${b + 1}/${batches.length}`);

        // ★ 캐시에서 디코딩된 AudioBuffer 가져오거나, 없으면 새로 디코딩
        let audioBuf = decodedCacheRef.current.get(b);
        if (!audioBuf) {
          const arrBuf = await batch.blob.arrayBuffer();
          audioBuf = await audioCtx.decodeAudioData(arrBuf.slice(0));
        }

        // 오디오 재생 (녹화 트랙 + 스피커)
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuf;
        source.connect(dest);
        source.connect(audioCtx.destination);

        // ★ onended를 start() 전에 등록 (안 놓치도록)
        const audioEndPromise = new Promise<void>((resolve) => {
          source.onended = () => resolve();
          // 안전장치: 배치 길이 + 3초 후 강제 resolve
          setTimeout(() => resolve(), (batch.duration + 3) * 1000);
        });

        source.start();

        // 슬라이드 자동 전환 (ID 기준 매칭)
        const slideCount = batch.sentenceIds?.length ?? batch.endIdx - batch.startIdx;
        let keepAlive = true;
        const redrawLoop = () => {
          if (!keepAlive) return;
          ctx.fillRect(CANVAS_W - 1, CANVAS_H - 1, 1, 1);
          requestAnimationFrame(redrawLoop);
        };

        for (let i = 0; i < slideCount; i++) {
          const sentenceId = batch.sentenceIds?.[i];
          const slideIdx = sentenceId != null ? (sentenceIdToIndex[sentenceId] ?? batch.startIdx + i) : batch.startIdx + i;
          setCurrentSlide(slideIdx);

          const n = sourceLocalNum[slideIdx] ?? 1;
          const t = sourceLocalTotal[slideIdx] ?? 1;
          drawSlide(ctx, sentences[slideIdx], n, t, wordMap[slideIdx] || [], sentenceAnalyses[slideIdx] ?? null);

          keepAlive = true;
          requestAnimationFrame(redrawLoop);

          await sleep(batch.slideDurations[i] * 1000);
          keepAlive = false;
        }

        // ★ 오디오 끝 대기 (이미 끝났으면 즉시 통과)
        await audioEndPromise;

        // 배치 간 0.5초
        if (b < batches.length - 1) {
          await sleep(500);
        }
      }

      recorder.stop();
      const videoBlob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });

      await audioCtx.close();

      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(videoBlob);
      setVideoUrl(url);
      setProgress(`✅ 동영상 생성 완료! (${(videoBlob.size / 1024 / 1024).toFixed(1)}MB)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      setProgress(`❌ 녹화 오류: ${msg}`);
    } finally {
      setIsRecording(false);
    }
  };

  // ── 빈 상태 ────
  if (sentences.length === 0) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: '#9CA3AF', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ fontSize: '72px', marginBottom: '18px' }}>🎬</div>
        <h2 style={{ color: '#6B7280', marginBottom: '10px', fontSize: '22px' }}>동영상</h2>
        <p style={{ fontSize: '15px' }}>입력 탭에서 문장을 먼저 준비하세요.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', height: '100%', gap: '10px' }}>
      {/* ── 상단: 설정 + 음성생성 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
        padding: '12px 16px', background: '#F5F3FF', borderRadius: '10px',
        flexShrink: 0,
      }}>
        {/* 음성 선택 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ fontSize: '13px', color: '#6B7280', whiteSpace: 'nowrap' }}>🎤 음성</label>
          <select
            value={voice}
            onChange={(e) => { setVoice(e.target.value); setBatches([]); }}
            style={{ padding: '6px 9px', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '13px', background: 'white' }}
          >
            {VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>

        {/* 전체 음성 생성 */}
        <button
          onClick={handleGenerateAudio}
          disabled={isGeneratingAudio || isRecording}
          style={{
            padding: '7px 16px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: 'bold',
            cursor: isGeneratingAudio ? 'not-allowed' : 'pointer',
            background: audioReady ? '#D1FAE5' : '#7C3AED', color: audioReady ? '#065F46' : 'white',
            fontFamily: "'Noto Sans KR', sans-serif",
          }}
        >
          {isGeneratingAudio ? '⏳ 생성 중...' : audioReady ? `✅ 음성 완료 (${batches.length}배치)` : `🔄 전체 음성 생성 (${total}문장 → ${numBatches}배치)`}
        </button>

        {/* 동영상 녹화 */}
        <button
          onClick={handleRecordVideo}
          disabled={!audioReady || isRecording || isGeneratingAudio}
          style={{
            padding: '7px 16px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: 'bold',
            cursor: !audioReady || isRecording ? 'not-allowed' : 'pointer',
            background: !audioReady || isRecording ? '#E5E7EB' : '#EF4444', color: !audioReady || isRecording ? '#9CA3AF' : 'white',
            fontFamily: "'Noto Sans KR', sans-serif",
          }}
        >
          {isRecording ? '⏺ 녹화 중...' : '🎬 동영상 생성 (WebM)'}
        </button>

        <div style={{ flex: 1 }} />

        {/* 진행 */}
        {progress && <span style={{ fontSize: '11px', color: '#6B7280', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{progress}</span>}

        {/* 슬라이드 카운터 */}
        <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#7C3AED' }}>
          {currentSlide + 1} / {total}
        </span>
      </div>

      {/* ── 캔버스 (슬라이드 미리보기) ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        border: '2px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden', background: '#F9FAFB',
        minHeight: '300px',
      }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ width: '100%', maxHeight: '100%', objectFit: 'contain', background: 'white' }}
        />
      </div>

      {/* ── 재생 컨트롤 ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '6px 0',
      }}>
        <CtrlBtn icon="⏮" tip="처음" onClick={() => setCurrentSlide(0)} />
        <CtrlBtn icon="⏪" tip="이전" onClick={() => setCurrentSlide((p) => Math.max(0, p - 1))} disabled={currentSlide === 0} />
        <CtrlBtn icon="🔊" tip="이 문장 재생" onClick={handlePlayCurrent} disabled={!getBatchForSlide(currentSlide)} small />

        {isPlaying ? (
          <button onClick={stopAudio} style={playBtnStyle('#DC2626', '#EF4444')}>⏸</button>
        ) : (
          <button onClick={handlePlayAll} disabled={!audioReady} style={playBtnStyle(audioReady ? '#7C3AED' : '#D1D5DB', audioReady ? '#A78BFA' : '#D1D5DB')}>▶</button>
        )}

        <CtrlBtn icon="⏩" tip="다음" onClick={() => setCurrentSlide((p) => Math.min(total - 1, p + 1))} disabled={currentSlide === total - 1} />
        <CtrlBtn icon="⏭" tip="끝" onClick={() => setCurrentSlide(total - 1)} />
      </div>

      {/* ── 섬네일 바 ── */}
      <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', padding: '4px 0', scrollbarWidth: 'thin' }}>
        {sentences.map((s, i) => {
          const hasBatch = !!getBatchForSlide(i);
          const localNum = sourceLocalNum[i] ?? i + 1;
          return (
            <button
              key={s.id ?? i}
              onClick={() => setCurrentSlide(i)}
              style={{
                flexShrink: 0, width: '78px', padding: '5px', borderRadius: '6px',
                border: i === currentSlide ? '2px solid #7C3AED' : '1px solid #E5E7EB',
                background: i === currentSlide ? '#F5F3FF' : hasBatch ? '#F0FDF4' : 'white',
                cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#7C3AED' }}>
                {String(localNum).padStart(2, '0')}
                {hasBatch && <span style={{ color: '#10B981' }}> ✓</span>}
              </div>
              <div style={{ fontSize: '8px', color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.sentence_en?.slice(0, 18)}...
              </div>
            </button>
          );
        })}
      </div>

      {/* ── 동영상 결과 ── */}
      {videoUrl && (
        <div style={{
          padding: '12px', background: '#F0FDF4', borderRadius: '10px', border: '1px solid #BBF7D0',
          display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#065F46' }}>🎬 동영상 생성 완료!</span>
          <video
            src={videoUrl}
            controls
            style={{ maxWidth: '400px', maxHeight: '200px', borderRadius: '8px', border: '1px solid #E5E7EB' }}
          />
          <a
            href={videoUrl}
            download={`단어장_동영상_${new Date().toISOString().slice(0, 10)}.webm`}
            style={{
              padding: '8px 18px', borderRadius: '8px', background: '#10B981', color: 'white',
              fontWeight: 'bold', fontSize: '13px', textDecoration: 'none',
              fontFamily: "'Noto Sans KR', sans-serif",
            }}
          >
            📥 다운로드 (WebM)
          </a>
        </div>
      )}
    </div>
  );
};

// ── 작은 컨트롤 버튼 ────
function CtrlBtn({ icon, tip, onClick, disabled, small }: {
  icon: string; tip: string; onClick: () => void; disabled?: boolean; small?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={tip}
      style={{
        width: small ? '34px' : '38px', height: small ? '34px' : '38px',
        borderRadius: '50%', border: '1px solid #E5E7EB',
        background: disabled ? '#F3F4F6' : 'white',
        color: disabled ? '#D1D5DB' : '#4B5563',
        fontSize: small ? '13px' : '15px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >{icon}</button>
  );
}

// ── 재생 버튼 스타일 ────
function playBtnStyle(c1: string, c2: string): React.CSSProperties {
  return {
    width: '52px', height: '52px', borderRadius: '50%', border: 'none',
    background: `linear-gradient(135deg, ${c1}, ${c2})`, color: 'white',
    fontSize: '22px', cursor: 'pointer', boxShadow: `0 4px 12px rgba(0,0,0,0.2)`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

export default VideoTab;
