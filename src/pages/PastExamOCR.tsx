/**
 * 기출문제 OCR 페이지
 * past-exam-web의 핵심 기능을 storybook(Vite+React) 환경으로 포팅
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload, FileText, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  RotateCcw, RotateCw, Trash2, Download, FolderOpen, Search,
  Loader2, X, GripVertical, BarChart3, CheckCircle2,
  PanelRightOpen, PanelRightClose, ClipboardCheck, FileDown,
} from 'lucide-react';
import { useOcrStore, normalizeQuestionText, questionsToExportJson, importJsonToQuestions } from '../lib/ocrStore';
import type { OcrQuestion } from '../lib/ocrStore';
import { runOcr, getAnswerExplanation, analyzeExam } from '../lib/ocrGemini';
import type { OcrMode } from '../lib/ocrGemini';
import { exportAsPdf, DEFAULT_PDF_OPTIONS } from '../lib/ocrExportPdf';
import type { PdfExportOptions } from '../lib/ocrExportPdf';
import { getSettings } from '../lib/store';

// ─── 타입 ───
type SelectionMode = 'none' | 'single' | 'formatting' | 'multi' | 'multi_formatting';
interface Region { x: number; y: number; width: number; height: number; }

// ─── 이미지 유틸 ───
function cropCanvasRegion(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return c.toDataURL('image/png').split(',')[1];
}

// ─── JSON 다운로드 ───
function downloadJson(questions: OcrQuestion[], filename?: string) {
  const data = questionsToExportJson(questions);
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `exam_questions_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── 분석 결과 타입 ───
interface AnalysisResult {
  summary: {
    total_questions: number;
    overall_difficulty: string;
    exam_name: string;
    trend_analysis: string;
  };
  type_classification: Array<{
    type: string;
    count: number;
    question_numbers: number[];
    difficulty_avg: string;
  }>;
  difficulty_distribution: { high: number; mid: number; low: number };
  killer_questions: Array<{
    q_number: number;
    type: string;
    reason: string;
    strategy: string;
  }>;
  study_plan: Array<{
    priority: number;
    area: string;
    content: string;
    target_types: string[];
  }>;
}

// ═══════════════════════════════════════
//  PDF 뷰어 (인라인 컴포넌트)
// ═══════════════════════════════════════
const PdfViewer: React.FC<{
  file: File;
  onPageImage: (dataUrl: string) => void;
}> = ({ file, onPageImage }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      try {
        setIsLoading(true);
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
        setIsLoading(false);
        await renderPage(pdf, 1);
      } catch (err) {
        if (cancelled) return;
        console.error('PDF 로딩 실패:', err);
        setIsLoading(false);
      }
    }

    async function renderPage(pdf: unknown, pageNum: number) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = pdf as any;
      const page = await p.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      onPageImage(canvas.toDataURL('image/png'));
    }

    loadPdf();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const goToPage = useCallback(async (pageNum: number) => {
    if (!pdfDocRef.current || pageNum < 1 || pageNum > totalPages) return;
    setCurrentPage(pageNum);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf = pdfDocRef.current as any;
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    onPageImage(canvas.toDataURL('image/png'));
  }, [totalPages, onPageImage]);

  if (isLoading) return (
    <div className="flex items-center gap-2 text-sm text-slate-400">
      <Loader2 size={16} className="animate-spin" /> PDF 로딩 중...
    </div>
  );

  return (
    <div className="flex items-center gap-2 text-sm">
      <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}
        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300">
        <ChevronLeft size={16} />
      </button>
      <span className="text-slate-400 min-w-[80px] text-center">
        {currentPage} / {totalPages} 페이지
      </span>
      <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}
        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300">
        <ChevronRight size={16} />
      </button>
    </div>
  );
};

// ═══════════════════════════════════════
//  영역 선택 캔버스
// ═══════════════════════════════════════
const RegionSelector: React.FC<{
  imageDataUrl: string;
  selectionMode: SelectionMode;
  onRegionSelected: (regions: Region[]) => void;
  pendingRegions: Region[];
  onPendingRegionsChange: (regions: Region[]) => void;
  onImageRotated: (dataUrl: string) => void;
}> = ({ imageDataUrl, selectionMode, onRegionSelected, pendingRegions, onPendingRegionsChange, onImageRotated }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<Region | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImageSize({ width: img.width, height: img.height });
      drawCanvas(img, zoom, null, pendingRegions);
    };
    img.src = imageDataUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageDataUrl]);

  useEffect(() => {
    if (imageRef.current) drawCanvas(imageRef.current, zoom, currentRect, pendingRegions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, pendingRegions, currentRect]);

  const drawCanvas = useCallback((img: HTMLImageElement, z: number, rect: Region | null, regions: Region[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dw = Math.round(img.width * z);
    const dh = Math.round(img.height * z);
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(img, 0, 0, dw, dh);

    for (const r of regions) {
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2;
      ctx.fillStyle = 'rgba(34,197,94,0.15)';
      ctx.fillRect(r.x * z, r.y * z, r.width * z, r.height * z);
      ctx.strokeRect(r.x * z, r.y * z, r.width * z, r.height * z);
    }
    if (rect) {
      ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.fillStyle = 'rgba(96,165,250,0.2)';
      ctx.fillRect(rect.x * z, rect.y * z, rect.width * z, rect.height * z);
      ctx.strokeRect(rect.x * z, rect.y * z, rect.width * z, rect.height * z);
      ctx.setLineDash([]);
    }
  }, []);

  const getCoords = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  }, [zoom]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (selectionMode === 'none') return;
    setIsDragging(true);
    setDragStart(getCoords(e));
    setCurrentRect(null);
  }, [selectionMode, getCoords]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !dragStart) return;
    const c = getCoords(e);
    setCurrentRect({
      x: Math.min(dragStart.x, c.x),
      y: Math.min(dragStart.y, c.y),
      width: Math.abs(c.x - dragStart.x),
      height: Math.abs(c.y - dragStart.y),
    });
  }, [isDragging, dragStart, getCoords]);

  const onMouseUp = useCallback(() => {
    if (!isDragging || !currentRect) { setIsDragging(false); return; }
    setIsDragging(false); setDragStart(null);
    if (currentRect.width < 10 || currentRect.height < 10) { setCurrentRect(null); return; }
    if (selectionMode === 'multi' || selectionMode === 'multi_formatting') {
      onPendingRegionsChange([...pendingRegions, currentRect]);
    } else {
      onRegionSelected([currentRect]);
    }
    setCurrentRect(null);
  }, [isDragging, currentRect, selectionMode, pendingRegions, onRegionSelected, onPendingRegionsChange]);

  const handleRotate = useCallback((cw: boolean) => {
    const img = imageRef.current;
    if (!img) return;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    c.width = img.height; c.height = img.width;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(cw ? Math.PI / 2 : -Math.PI / 2);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    onImageRotated(c.toDataURL('image/png'));
  }, [onImageRotated]);

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="flex items-center gap-1.5 text-xs">
        <button onClick={() => setZoom(z => Math.max(0.3, z * 0.8))}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300" title="축소">
          <ZoomOut size={14} />
        </button>
        <span className="text-slate-500 min-w-[40px] text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(5, z * 1.2))}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300" title="확대">
          <ZoomIn size={14} />
        </button>
        <button onClick={() => setZoom(1)}
          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400">원본</button>
        <div className="w-px h-4 bg-white/10 mx-1" />
        <button onClick={() => handleRotate(false)}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300" title="좌회전">
          <RotateCcw size={14} />
        </button>
        <button onClick={() => handleRotate(true)}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300" title="우회전">
          <RotateCw size={14} />
        </button>
        {selectionMode !== 'none' && (
          <span className="ml-2 px-2 py-0.5 bg-primary-500/10 text-primary-400 rounded text-[10px] font-medium">
            {selectionMode === 'single' ? '영역 선택' : selectionMode === 'formatting' ? '포맷팅 포함' : '여러 영역'}
          </span>
        )}
      </div>
      <div className="overflow-auto rounded-xl border border-white/10 bg-dark flex-1 min-h-0"
        onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(z => Math.max(0.3, Math.min(5, z * (e.deltaY < 0 ? 1.1 : 0.9)))); } }}>
        <canvas ref={canvasRef}
          className={selectionMode !== 'none' ? 'cursor-crosshair' : 'cursor-default'}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
          onMouseLeave={() => { if (isDragging) onMouseUp(); }} />
      </div>
      <div className="text-[10px] text-slate-600 flex gap-3">
        <span>원본: {imageSize.width}×{imageSize.height}px</span>
        <span>Ctrl+스크롤로 확대/축소</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════
//  문제 카드
// ═══════════════════════════════════════
const QuestionCard: React.FC<{
  question: OcrQuestion;
  index: number;
  isEditing: boolean;
  onEdit: () => void;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  onGetAnswer: () => void;
  isLoadingAnswer: boolean;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
}> = ({ question, index, isEditing, onEdit, onUpdate, onDelete, onGetAnswer, isLoadingAnswer, onDragStart, onDragOver, onDrop, onDragEnd }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  if (question.isLoading) {
    return (
      <div className="rounded-xl bg-surface border border-white/5 p-4 animate-pulse">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 size={14} className="animate-spin" />
          <span>OCR 처리중...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={onDragEnd}
      className={`rounded-xl bg-surface border transition-all duration-200 ${
        isEditing ? 'border-primary-500/30 ring-1 ring-primary-500/20' : 'border-white/5 hover:border-white/10'
      }`}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <GripVertical size={14} className="text-slate-600 cursor-grab active:cursor-grabbing" />
          <span className="text-xs font-bold text-primary-400">#{question.number}</span>
        </div>
        <div className="flex items-center gap-1">
          {isLoadingAnswer ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Loader2 size={12} className="animate-spin" /> 분석중...
            </span>
          ) : (
            <button onClick={onGetAnswer}
              className="px-2 py-1 text-[10px] rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20">
              정답/해설
            </button>
          )}
          {!isEditing && (
            <button onClick={onEdit}
              className="px-2 py-1 text-[10px] rounded-lg bg-white/5 text-slate-400 hover:bg-white/10">
              편집
            </button>
          )}
          <button onClick={onDelete}
            className="p-1 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="p-4">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={question.text}
            onChange={(e) => onUpdate(e.target.value)}
            className="w-full min-h-[200px] p-3 text-sm font-mono leading-relaxed rounded-lg bg-dark border border-white/10 text-slate-200 caret-white resize-y
              focus:outline-none focus:ring-1 focus:ring-primary-500/50"
          />
        ) : (
          <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono leading-relaxed max-h-[300px] overflow-y-auto">
            {question.text || '(빈 문제)'}
          </pre>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════
//  분석 모달 (원본 밝은 테마 + 전체 기능)
// ═══════════════════════════════════════
const difficultyColor = (d: string) => {
  if (d.includes('상')) return 'text-red-600 bg-red-50';
  if (d.includes('하')) return 'text-green-600 bg-green-50';
  return 'text-yellow-600 bg-yellow-50';
};

function toArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string') return val.split(/[,\s]+/).filter(Boolean);
  if (val != null) return [String(val)];
  return [];
}

function toMarkdown(data: AnalysisResult, examName: string): string {
  const lines: string[] = [];
  lines.push(`# ${examName} 시험 분석`);
  lines.push('');
  lines.push('## 종합 총평');
  lines.push(`- **총 문항:** ${data.summary.total_questions}문제`);
  lines.push(`- **전체 난이도:** ${data.summary.overall_difficulty}`);
  lines.push('');
  lines.push(data.summary.trend_analysis);
  lines.push('');
  lines.push('## 유형별 분류');
  lines.push('| 유형 | 문항수 | 난이도 | 문항 번호 |');
  lines.push('|------|--------|--------|-----------|');
  for (const t of data.type_classification) {
    lines.push(`| ${t.type} | ${t.count} | ${t.difficulty_avg} | ${toArray(t.question_numbers).join(', ')} |`);
  }
  lines.push('');
  const total = data.summary.total_questions || 1;
  lines.push('## 난이도 분포');
  lines.push(`- **상:** ${data.difficulty_distribution.high}문제 (${Math.round((data.difficulty_distribution.high / total) * 100)}%)`);
  lines.push(`- **중:** ${data.difficulty_distribution.mid}문제 (${Math.round((data.difficulty_distribution.mid / total) * 100)}%)`);
  lines.push(`- **하:** ${data.difficulty_distribution.low}문제 (${Math.round((data.difficulty_distribution.low / total) * 100)}%)`);
  lines.push('');
  if (data.killer_questions.length > 0) {
    lines.push('## 킬러문항');
    for (const kq of data.killer_questions) {
      lines.push(`### ${kq.q_number}번 (${kq.type})`);
      lines.push(`- **이유:** ${kq.reason}`);
      lines.push(`- **전략:** ${kq.strategy}`);
      lines.push('');
    }
  }
  if (data.study_plan.length > 0) {
    lines.push('## 학습 계획');
    for (const sp of data.study_plan) {
      lines.push(`### ${sp.priority}. ${sp.area}`);
      lines.push(sp.content);
      const types = toArray(sp.target_types);
      if (types.length > 0) lines.push(`- 관련 유형: ${types.join(', ')}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function toPlainText(data: AnalysisResult, examName: string): string {
  const lines: string[] = [];
  lines.push(`[ ${examName} 시험 분석 ]`);
  lines.push('');
  lines.push(`[종합 총평]`);
  lines.push(`총 문항: ${data.summary.total_questions}문제`);
  lines.push(`전체 난이도: ${data.summary.overall_difficulty}`);
  lines.push(data.summary.trend_analysis);
  lines.push('');
  lines.push(`[유형별 분류]`);
  for (const t of data.type_classification) {
    lines.push(`  ${t.type}: ${t.count}문제 (난이도 ${t.difficulty_avg}) - ${toArray(t.question_numbers).join(', ')}번`);
  }
  lines.push('');
  const total = data.summary.total_questions || 1;
  lines.push(`[난이도 분포]`);
  lines.push(`  상: ${data.difficulty_distribution.high}문제 (${Math.round((data.difficulty_distribution.high / total) * 100)}%)`);
  lines.push(`  중: ${data.difficulty_distribution.mid}문제 (${Math.round((data.difficulty_distribution.mid / total) * 100)}%)`);
  lines.push(`  하: ${data.difficulty_distribution.low}문제 (${Math.round((data.difficulty_distribution.low / total) * 100)}%)`);
  lines.push('');
  if (data.killer_questions.length > 0) {
    lines.push(`[킬러문항]`);
    for (const kq of data.killer_questions) {
      lines.push(`  ${kq.q_number}번 (${kq.type})`);
      lines.push(`    이유: ${kq.reason}`);
      lines.push(`    전략: ${kq.strategy}`);
    }
    lines.push('');
  }
  if (data.study_plan.length > 0) {
    lines.push(`[학습 계획]`);
    for (const sp of data.study_plan) {
      lines.push(`  ${sp.priority}. ${sp.area}`);
      lines.push(`    ${sp.content}`);
      const types = toArray(sp.target_types);
      if (types.length > 0) lines.push(`    관련 유형: ${types.join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const AnalysisModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  data: AnalysisResult | null;
  examName: string;
  isLoading: boolean;
}> = ({ isOpen, onClose, data, examName, isLoading }) => {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [isPdfGenerating, _setIsPdfGenerating] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handleSavePdf = () => {
    if (!data) return;

    const total = data.summary.total_questions || 1;
    const diffColor = (d: string) => {
      if (d.includes('상')) return 'color:#dc2626; background:#fef2f2; border:1px solid #fecaca;';
      if (d.includes('하')) return 'color:#16a34a; background:#f0fdf4; border:1px solid #bbf7d0;';
      return 'color:#ca8a04; background:#fefce8; border:1px solid #fef08a;';
    };

    // 유형 분류 테이블 행
    const typeRows = data.type_classification.map(t =>
      `<tr style="break-inside:avoid;">
        <td style="padding:8px 12px; font-weight:500; color:#1f2937;">${t.type}</td>
        <td style="padding:8px 12px; text-align:center; color:#4b5563;">${t.count}</td>
        <td style="padding:8px 12px; text-align:center;">
          <span style="padding:2px 8px; border-radius:9999px; font-size:11px; font-weight:500; ${diffColor(t.difficulty_avg)}">${t.difficulty_avg}</span>
        </td>
        <td style="padding:8px 12px; color:#6b7280; font-size:12px;">${toArray(t.question_numbers).join(', ')}</td>
      </tr>`
    ).join('');

    // 난이도 분포 바
    const diffBars = [
      { label: '상', count: data.difficulty_distribution.high, color: '#ef4444' },
      { label: '중', count: data.difficulty_distribution.mid, color: '#eab308' },
      { label: '하', count: data.difficulty_distribution.low, color: '#22c55e' },
    ].map(d => {
      const pct = Math.round((d.count / total) * 100);
      return `<div style="flex:1;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span style="font-size:13px; font-weight:500; color:#374151;">${d.label}</span>
          <span style="font-size:11px; color:#6b7280;">${d.count}문제 (${pct}%)</span>
        </div>
        <div style="width:100%; background:#e5e7eb; border-radius:9999px; height:12px;">
          <div style="width:${pct}%; background:${d.color}; border-radius:9999px; height:12px;"></div>
        </div>
      </div>`;
    }).join('');

    // 킬러문항
    const killerHtml = data.killer_questions.length > 0 ? `
      <div style="page-break-before: always;">
        <h3 style="font-size:15px; font-weight:700; color:#374151; margin:0 0 12px 0; display:flex; align-items:center; gap:8px;">
          <span style="width:6px; height:20px; background:#dc2626; border-radius:9999px; display:inline-block;"></span>
          킬러문항
        </h3>
        ${data.killer_questions.map(kq => `
          <div style="background:#fef2f2; border-radius:12px; padding:16px; border:1px solid #fecaca; margin-bottom:12px; break-inside:avoid;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
              <span style="padding:2px 10px; background:#dc2626; color:white; font-size:11px; font-weight:700; border-radius:9999px;">${kq.q_number}번</span>
              <span style="font-size:12px; color:#dc2626; font-weight:500;">${kq.type}</span>
            </div>
            <p style="font-size:13px; color:#374151; margin:0 0 4px 0;"><b>이유:</b> ${kq.reason}</p>
            <p style="font-size:13px; color:#374151; margin:0;"><b>전략:</b> ${kq.strategy}</p>
          </div>
        `).join('')}
      </div>` : '';

    // 학습 계획
    const studyHtml = data.study_plan.length > 0 ? `
      <div style="margin-top:24px; break-before:avoid;">
        <h3 style="font-size:15px; font-weight:700; color:#374151; margin:0 0 12px 0; display:flex; align-items:center; gap:8px;">
          <span style="width:6px; height:20px; background:#16a34a; border-radius:9999px; display:inline-block;"></span>
          학습 계획
        </h3>
        ${data.study_plan.map(sp => `
          <div style="display:flex; gap:12px; background:#f0fdf4; border-radius:12px; padding:16px; border:1px solid #bbf7d0; margin-bottom:12px; break-inside:avoid;">
            <div style="flex-shrink:0; width:32px; height:32px; background:#16a34a; color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700;">
              ${sp.priority}
            </div>
            <div style="flex:1;">
              <p style="font-size:13px; font-weight:700; color:#1f2937; margin:0 0 4px 0;">${sp.area}</p>
              <p style="font-size:13px; color:#374151; margin:0; line-height:1.6;">${sp.content}</p>
              ${toArray(sp.target_types).length > 0 ? `
                <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:8px;">
                  ${toArray(sp.target_types).map(t =>
                    `<span style="padding:2px 8px; background:#bbf7d0; color:#166534; font-size:11px; border-radius:9999px;">${t}</span>`
                  ).join('')}
                </div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>` : '';

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${examName} 분석결과</title>
<style>
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; color: #1f2937; margin: 0; padding: 0; line-height: 1.5; }
  table { border-collapse: collapse; width: 100%; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head><body>

<!-- 헤더 -->
<div style="border-bottom:2px solid #2563eb; padding-bottom:12px; margin-bottom:24px;">
  <h1 style="font-size:20px; font-weight:700; color:#1e40af; margin:0;">시험지 분석 결과</h1>
  <p style="font-size:12px; color:#6b7280; margin:4px 0 0 0;">${examName}</p>
</div>

<!-- 종합 총평 -->
<div style="margin-bottom:24px; break-inside:avoid;">
  <h3 style="font-size:15px; font-weight:700; color:#374151; margin:0 0 12px 0; display:flex; align-items:center; gap:8px;">
    <span style="width:6px; height:20px; background:#2563eb; border-radius:9999px; display:inline-block;"></span>
    종합 총평
  </h3>
  <div style="background:#eff6ff; border-radius:12px; padding:16px;">
    <div style="display:flex; align-items:center; gap:16px; font-size:13px; margin-bottom:8px;">
      <span style="color:#4b5563;">총 문항: <b style="color:#1d4ed8;">${data.summary.total_questions}문제</b></span>
      <span style="padding:2px 8px; border-radius:9999px; font-size:11px; font-weight:500; ${diffColor(data.summary.overall_difficulty)}">
        난이도: ${data.summary.overall_difficulty}
      </span>
    </div>
    <p style="font-size:13px; color:#374151; margin:0; line-height:1.7;">${data.summary.trend_analysis}</p>
  </div>
</div>

<!-- 유형별 분류 -->
<div style="margin-bottom:24px; break-inside:avoid;">
  <h3 style="font-size:15px; font-weight:700; color:#374151; margin:0 0 12px 0; display:flex; align-items:center; gap:8px;">
    <span style="width:6px; height:20px; background:#9333ea; border-radius:9999px; display:inline-block;"></span>
    유형별 분류
  </h3>
  <div style="border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
    <table>
      <thead style="background:#f9fafb;">
        <tr>
          <th style="text-align:left; padding:8px 12px; font-weight:500; color:#4b5563; font-size:13px;">유형</th>
          <th style="text-align:center; padding:8px 12px; font-weight:500; color:#4b5563; font-size:13px;">문항수</th>
          <th style="text-align:center; padding:8px 12px; font-weight:500; color:#4b5563; font-size:13px;">난이도</th>
          <th style="text-align:left; padding:8px 12px; font-weight:500; color:#4b5563; font-size:13px;">문항 번호</th>
        </tr>
      </thead>
      <tbody>${typeRows}</tbody>
    </table>
  </div>
</div>

<!-- 난이도 분포 -->
<div style="margin-bottom:24px; break-inside:avoid;">
  <h3 style="font-size:15px; font-weight:700; color:#374151; margin:0 0 12px 0; display:flex; align-items:center; gap:8px;">
    <span style="width:6px; height:20px; background:#eab308; border-radius:9999px; display:inline-block;"></span>
    난이도 분포
  </h3>
  <div style="display:flex; align-items:center; gap:16px;">
    ${diffBars}
  </div>
</div>

<!-- 킬러문항 (page-break-before: always) -->
${killerHtml}

<!-- 학습 계획 -->
${studyHtml}

</body></html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.print(); }, 300);
  };

  const handleSaveJson = () => {
    if (!data) return;
    const dataWithName = {
      ...data,
      summary: { ...data.summary, exam_name: examName || data.summary.exam_name || '시험' },
    };
    const jsonStr = JSON.stringify(dataWithName, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${examName || '시험분석'}_분석결과.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async (format: 'markdown' | 'text') => {
    if (!data) return;
    const content = format === 'markdown'
      ? toMarkdown(data, examName)
      : toPlainText(data, examName);
    await navigator.clipboard.writeText(content);
    setCopyStatus(format === 'markdown' ? '마크다운 복사됨!' : '텍스트 복사됨!');
    setTimeout(() => setCopyStatus(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-[720px] max-h-[85vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-800">시험지 분석 결과</h2>
            {examName && <p className="text-xs text-gray-500 mt-0.5">{examName}</p>}
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 size={32} className="animate-spin text-blue-600" />
              <p className="text-sm text-gray-500">Gemini가 시험지를 분석하고 있습니다...</p>
            </div>
          )}
          {!isLoading && !data && (
            <div className="text-center py-16 text-gray-400">
              <p>분석 결과가 없습니다.</p>
            </div>
          )}
          {!isLoading && data && (
            <>
              {/* 종합 총평 */}
              <section>
                <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-blue-600 rounded-full inline-block" />
                  종합 총평
                </h3>
                <div className="bg-blue-50 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-600">총 문항: <span className="font-bold text-blue-700">{data.summary.total_questions}문제</span></span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${difficultyColor(data.summary.overall_difficulty)}`}>
                      난이도: {data.summary.overall_difficulty}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{data.summary.trend_analysis}</p>
                </div>
              </section>

              {/* 유형 분류 */}
              <section>
                <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-purple-600 rounded-full inline-block" />
                  유형별 분류
                </h3>
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-gray-600">유형</th>
                        <th className="text-center px-4 py-2 font-medium text-gray-600">문항수</th>
                        <th className="text-center px-4 py-2 font-medium text-gray-600">난이도</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-600">문항 번호</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.type_classification.map((t, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-800">{t.type}</td>
                          <td className="px-4 py-2 text-center text-gray-600">{t.count}</td>
                          <td className="px-4 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${difficultyColor(t.difficulty_avg)}`}>
                              {t.difficulty_avg}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-gray-500 text-xs">
                            {toArray(t.question_numbers).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 난이도 분포 */}
              <section>
                <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-yellow-500 rounded-full inline-block" />
                  난이도 분포
                </h3>
                <div className="flex items-center gap-4">
                  {[
                    { label: '상', count: data.difficulty_distribution.high, color: 'bg-red-500' },
                    { label: '중', count: data.difficulty_distribution.mid, color: 'bg-yellow-500' },
                    { label: '하', count: data.difficulty_distribution.low, color: 'bg-green-500' },
                  ].map((d) => {
                    const tot = data.summary.total_questions || 1;
                    const pct = Math.round((d.count / tot) * 100);
                    return (
                      <div key={d.label} className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">{d.label}</span>
                          <span className="text-xs text-gray-500">{d.count}문제 ({pct}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div className={`${d.color} rounded-full h-3 transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 킬러문항 — PDF 저장 시 여기서 강제 페이지 브레이크 */}
              {data.killer_questions.length > 0 && (
                <section data-page-break="true">
                  <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-5 bg-red-600 rounded-full inline-block" />
                    킬러문항
                  </h3>
                  <div className="space-y-3">
                    {data.killer_questions.map((kq, i) => (
                      <div key={i} className="bg-red-50 rounded-xl p-4 border border-red-100">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded-full">{kq.q_number}번</span>
                          <span className="text-xs text-red-600 font-medium">{kq.type}</span>
                        </div>
                        <p className="text-sm text-gray-700 mb-1"><span className="font-medium text-gray-800">이유:</span> {kq.reason}</p>
                        <p className="text-sm text-gray-700"><span className="font-medium text-gray-800">전략:</span> {kq.strategy}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 학습 계획 */}
              {data.study_plan.length > 0 && (
                <section>
                  <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-5 bg-green-600 rounded-full inline-block" />
                    학습 계획
                  </h3>
                  <div className="space-y-3">
                    {data.study_plan.map((sp, i) => (
                      <div key={i} className="flex gap-3 bg-green-50 rounded-xl p-4 border border-green-100">
                        <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                          {sp.priority}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-bold text-gray-800 mb-1">{sp.area}</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{sp.content}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {toArray(sp.target_types).map((t, j) => (
                              <span key={j} className="px-2 py-0.5 bg-green-200 text-green-800 text-xs rounded-full">{t}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* 하단 */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            {data && (
              <>
                <button onClick={handleSaveJson}
                  className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100">
                  JSON 저장
                </button>
                <button onClick={() => handleCopy('markdown')}
                  className="px-3 py-1.5 text-sm bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100">
                  마크다운 복사
                </button>
                <button onClick={() => handleCopy('text')}
                  className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                  텍스트 복사
                </button>
                <button onClick={handleSavePdf} disabled={isPdfGenerating}
                  className="px-3 py-1.5 text-sm bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
                  {isPdfGenerating ? (
                    <><Loader2 size={14} className="animate-spin" /> 생성중...</>
                  ) : 'PDF 저장'}
                </button>
                {copyStatus && (
                  <span className="text-xs text-green-600 font-medium">{copyStatus}</span>
                )}
              </>
            )}
          </div>
          <button onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════
//  검수 패널 (풀스크린 오버레이)
// ═══════════════════════════════════════
const CIRCLE_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const CIRCLE_LETTERS = ['ⓐ', 'ⓑ', 'ⓒ', 'ⓓ', 'ⓔ', 'ⓕ', 'ⓖ', 'ⓗ', 'ⓘ', 'ⓙ'];
const CIRCLE_KOREAN = ['㉠', '㉡', '㉢', '㉣', '㉤'];

const ReviewPanel: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  sessionName: string;
  pdfOptions?: PdfExportOptions;
}> = ({ isOpen, onClose, sessionName, pdfOptions }) => {
  const { questions, updateQuestion, deleteQuestion, markSaved } = useOcrStore();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editText, setEditText] = useState('');
  const [isLoadingAnswer, setIsLoadingAnswer] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSyncedIndex = useRef(-1);

  const total = questions.length;
  const safeIndex = total === 0 ? -1 : Math.min(currentIndex, total - 1);
  const question = safeIndex >= 0 ? questions[safeIndex] : undefined;

  // editText 동기화
  useEffect(() => {
    if (safeIndex !== lastSyncedIndex.current) {
      lastSyncedIndex.current = safeIndex;
      setEditText(question?.text ?? '');
    }
  }, [safeIndex, question?.text]);

  // 외부 업데이트 감지 (정답/해설 등)
  useEffect(() => {
    if (question?.text !== undefined && question.text !== editText && safeIndex === lastSyncedIndex.current) {
      setEditText(question.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.text]);

  // currentIndex 범위 보정
  useEffect(() => {
    if (isOpen && total > 0 && currentIndex > total - 1) setCurrentIndex(total - 1);
  }, [isOpen, currentIndex, total]);

  // 키보드 단축키
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === textareaRef.current) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentIndex((prev) => Math.min(total - 1, prev + 1));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, total]);

  // textarea onChange
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setEditText(newText);
    if (safeIndex >= 0) updateQuestion(safeIndex, { text: newText });
  }, [safeIndex, updateQuestion]);

  // 삭제
  const handleDelete = useCallback(() => {
    if (safeIndex < 0 || total === 0) return;
    if (!confirm(`문제 #${question?.number || safeIndex + 1}을 삭제하시겠습니까?`)) return;
    deleteQuestion(safeIndex);
    const newLen = total - 1;
    const newIdx = newLen > 0 ? Math.min(safeIndex, newLen - 1) : 0;
    setCurrentIndex(newIdx);
    lastSyncedIndex.current = -1; // 강제 리싱크
  }, [safeIndex, total, question?.number, deleteQuestion]);

  // 정답/해설
  const handleGetAnswer = useCallback(async () => {
    if (safeIndex < 0 || !question) return;
    setIsLoadingAnswer(true);
    try {
      const result = await getAnswerExplanation(question.text);
      if (result) {
        updateQuestion(safeIndex, { text: result });
        setEditText(result);
      }
    } catch (error) {
      console.error('정답/해설 실패:', error);
    } finally {
      setIsLoadingAnswer(false);
    }
  }, [safeIndex, question, updateQuestion]);

  // JSON 저장
  const handleExportJson = useCallback(() => {
    if (questions.length === 0) return;
    const data = questionsToExportJson(questions);
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sessionName || 'exam_questions'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markSaved();
  }, [questions, sessionName, markSaved]);

  // PDF 내보내기
  const handleExportPdf = useCallback(() => {
    if (questions.length === 0) return;
    exportAsPdf(questions, sessionName || `exam_${new Date().toISOString().slice(0, 10)}`, pdfOptions);
  }, [questions, sessionName, pdfOptions]);

  // 원문자 삽입
  const insertChar = useCallback((char: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = editText.slice(0, start) + char + editText.slice(end);
    setEditText(newText);
    if (safeIndex >= 0) updateQuestion(safeIndex, { text: newText });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + char.length, start + char.length);
    });
  }, [editText, safeIndex, updateQuestion]);

  // 서식 적용
  const applyFormat = useCallback((format: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = editText.slice(start, end);
    if (!selected) return;
    let wrapped: string;
    switch (format) {
      case 'underline': wrapped = `**${selected}**`; break;
      case 'bold': wrapped = `***${selected}***`; break;
      case 'underline_bold': wrapped = `##${selected}##`; break;
      default: return;
    }
    const newText = editText.slice(0, start) + wrapped + editText.slice(end);
    setEditText(newText);
    if (safeIndex >= 0) updateQuestion(safeIndex, { text: newText });
  }, [editText, safeIndex, updateQuestion]);

  if (!isOpen) return null;

  if (total === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-dark flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-slate-400 mb-4">검수할 문제가 없습니다</p>
          <button onClick={onClose}
            className="px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600">
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-dark flex flex-col">
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-6 py-3 bg-surface border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose}
            className="px-3 py-1.5 text-sm text-slate-300 bg-white/5 rounded-lg hover:bg-white/10">
            돌아가기
          </button>
          <h1 className="text-base font-bold text-white">검수 모드</h1>
          <button onClick={handleExportJson}
            className="px-3 py-1.5 text-xs text-primary-400 bg-primary-500/10 rounded-lg hover:bg-primary-500/20">
            JSON 저장
          </button>
          <button onClick={handleExportPdf}
            className="px-3 py-1.5 text-xs text-emerald-400 bg-emerald-500/10 rounded-lg hover:bg-emerald-500/20">
            PDF 내보내기
          </button>
        </div>

        {/* 네비게이션 */}
        <div className="flex items-center gap-3">
          <button onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={safeIndex <= 0}
            className="px-4 py-1.5 text-sm bg-white/5 text-slate-300 rounded-lg hover:bg-white/10 disabled:opacity-30">
            이전
          </button>
          <span className="text-sm text-slate-400 min-w-[80px] text-center">
            <span className="text-primary-400 font-bold text-lg">{safeIndex + 1}</span>
            <span className="text-slate-600 mx-1">/</span>
            <span>{total}</span>
          </span>
          <button onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
            disabled={safeIndex >= total - 1}
            className="px-4 py-1.5 text-sm bg-white/5 text-slate-300 rounded-lg hover:bg-white/10 disabled:opacity-30">
            다음
          </button>
        </div>

        {/* 도구 */}
        <div className="flex items-center gap-2">
          {isLoadingAnswer ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Loader2 size={14} className="animate-spin" /> 분석중...
            </span>
          ) : (
            <button onClick={handleGetAnswer}
              className="px-3 py-1.5 text-xs text-emerald-400 bg-emerald-500/10 rounded-lg hover:bg-emerald-500/20">
              정답/해설
            </button>
          )}
          <button onClick={handleDelete}
            className="px-3 py-1.5 text-xs text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20">
            삭제
          </button>
          <button onClick={onClose}
            className="ml-2 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg" title="닫기 (Esc)">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 문제 번호 네비게이션 */}
      <div className="flex items-center gap-1 px-6 py-2 bg-surface/50 border-b border-white/5 overflow-x-auto flex-shrink-0">
        {questions.map((_, i) => (
          <button key={i} onClick={() => setCurrentIndex(i)}
            className={`w-8 h-8 rounded-full text-xs font-medium transition-all flex-shrink-0 ${
              i === safeIndex
                ? 'bg-primary-500 text-white scale-110'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}>
            {i + 1}
          </button>
        ))}
      </div>

      {/* 원문자 & 서식 도구바 */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-2 bg-surface/30 border-b border-white/5 flex-shrink-0">
        <div className="flex gap-0.5">
          {CIRCLE_NUMBERS.slice(0, 5).map((c) => (
            <button key={c} onClick={() => insertChar(c)}
              className="w-8 h-8 text-sm rounded hover:bg-primary-500/20 text-slate-300 text-center">{c}</button>
          ))}
        </div>
        <span className="text-white/10">|</span>
        <div className="flex gap-0.5">
          {CIRCLE_LETTERS.slice(0, 5).map((c) => (
            <button key={c} onClick={() => insertChar(c)}
              className="w-8 h-8 text-sm rounded hover:bg-violet-500/20 text-slate-300 text-center">{c}</button>
          ))}
        </div>
        <span className="text-white/10">|</span>
        <div className="flex gap-0.5">
          {CIRCLE_KOREAN.map((c) => (
            <button key={c} onClick={() => insertChar(c)}
              className="w-8 h-8 text-sm rounded hover:bg-amber-500/20 text-slate-300 text-center">{c}</button>
          ))}
        </div>
        <span className="text-white/10">|</span>
        <button onClick={() => applyFormat('underline')}
          className="px-2 py-1 text-sm rounded hover:bg-white/10 text-slate-400 underline">U</button>
        <button onClick={() => applyFormat('bold')}
          className="px-2 py-1 text-sm rounded hover:bg-white/10 text-slate-400 font-bold">B</button>
        <button onClick={() => applyFormat('underline_bold')}
          className="px-2 py-1 text-sm rounded hover:bg-white/10 text-slate-400 underline font-bold">UB</button>
        <span className="text-xs text-slate-600 ml-4">방향키로 문제 이동 | Esc로 닫기</span>
      </div>

      {/* 문제 편집 영역 */}
      <div className="flex-1 p-6 min-h-0 flex flex-col">
        <textarea
          ref={textareaRef}
          value={editText}
          onChange={handleTextChange}
          className="w-full flex-1 p-6 text-sm font-mono leading-relaxed rounded-xl
            border border-white/10 bg-surface text-slate-200 caret-white resize-none
            focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-transparent"
          placeholder="[문제] 문제 내용..."
        />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════
//  메인 페이지
// ═══════════════════════════════════════
export const PastExamOCRPage: React.FC = () => {
  // 스토어
  const {
    questions, addQuestion, addPlaceholders, updateQuestion, deleteQuestion,
    setQuestions, mergeQuestions, markSaved, deleteAllQuestions, reorderQuestions,
  } = useOcrStore();

  // UI 상태
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none');
  const [pendingRegions, setPendingRegions] = useState<Region[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [loadingAnswerIndex, setLoadingAnswerIndex] = useState<number | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  // 이미지 큐
  const [queuedImages, setQueuedImages] = useState<{ dataUrl: string; name: string }[]>([]);

  // 드래그앤드롭
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    // 드래그 시작 시 약간 투명하게
    const el = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => { el.style.opacity = '0.4'; });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnter = useCallback((_e: React.DragEvent, index: number) => {
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = dragIndexRef.current;
    if (fromIndex !== null && fromIndex !== toIndex) {
      reorderQuestions(fromIndex, toIndex);
      // 편집 중인 인덱스도 조정
      if (editingIndex !== null) {
        if (editingIndex === fromIndex) {
          setEditingIndex(toIndex);
        } else if (fromIndex < editingIndex && toIndex >= editingIndex) {
          setEditingIndex(editingIndex - 1);
        } else if (fromIndex > editingIndex && toIndex <= editingIndex) {
          setEditingIndex(editingIndex + 1);
        }
      }
    }
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, [reorderQuestions, editingIndex]);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1';
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, []);

  // 분석 모달
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisResult | null>(null);
  const [analysisExamName, setAnalysisExamName] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // 검수 패널
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  // PDF 내보내기 옵션
  const [pdfOptions, setPdfOptions] = useState<PdfExportOptions>({ ...DEFAULT_PDF_OPTIONS });

  // API 키 확인
  const hasApiKey = !!getSettings().geminiApiKey;

  // ─── PDF 선택 ───
  const handlePdfSelect = useCallback((file: File) => {
    setPdfFile(file);
    setImageDataUrl(null);
    setQueuedImages([]);
    const name = file.name.replace(/\.pdf$/i, '');
    setSessionName(name);
    setSelectionMode('single');
  }, []);

  // ─── PDF 페이지 이미지 수신 ───
  const handlePdfPageImage = useCallback((dataUrl: string) => {
    setImageDataUrl(dataUrl);
    setSelectionMode(prev => prev === 'none' ? 'single' : prev);
  }, []);

  // ─── 이미지 회전 ───
  const handleImageRotated = useCallback((rotatedUrl: string) => {
    setImageDataUrl(rotatedUrl);
    setPendingRegions([]);
  }, []);

  // ─── 영역 선택 → OCR ───
  const handleRegionSelected = useCallback(async (regions: Region[]) => {
    if (!imageDataUrl || regions.length === 0) return;
    setIsProcessing(true);
    try {
      const img = new Image();
      await new Promise<void>(resolve => { img.onload = () => resolve(); img.src = imageDataUrl; });
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const images: string[] = [];
      for (const r of regions) {
        images.push(cropCanvasRegion(canvas, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)));
      }

      const mode: OcrMode =
        selectionMode === 'formatting' ? 'extract_formatting'
        : selectionMode === 'multi_formatting' ? 'multi_formatting'
        : images.length > 1 ? 'multi' : 'extract';

      const text = await runOcr(images, mode);
      if (text) {
        addQuestion({
          text,
          answer: '',
          explanation: '',
          region: [Math.round(regions[0].x), Math.round(regions[0].y),
                   Math.round(regions[0].x + regions[0].width), Math.round(regions[0].y + regions[0].height)],
        });
        setRightPanelOpen(true); // 문제 추가 시 패널 자동 열기
      }
    } catch (error) {
      console.error('OCR 처리 실패:', error);
      alert('OCR 처리 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  }, [imageDataUrl, selectionMode, addQuestion]);

  // ─── 여러 영역 완료 ───
  const handleProcessMultiRegions = useCallback(() => {
    if (pendingRegions.length === 0) return;
    handleRegionSelected(pendingRegions);
    setPendingRegions([]);
    setSelectionMode('single');
  }, [pendingRegions, handleRegionSelected]);

  // ─── 이미지 큐 전송 ───
  const handleSubmitImages = useCallback(async () => {
    if (queuedImages.length === 0) return;
    setIsProcessing(true);
    const startIndex = addPlaceholders(queuedImages.length);
    const imagesToProcess = [...queuedImages];
    setQueuedImages([]);

    const promises = imagesToProcess.map((img, i) => {
      const base64 = img.dataUrl.split(',')[1];
      if (!base64) return Promise.resolve();
      return runOcr([base64], 'extract')
        .then((text) => {
          updateQuestion(startIndex + i, {
            text: normalizeQuestionText(text),
            isLoading: false,
          });
        })
        .catch(() => {
          updateQuestion(startIndex + i, {
            text: '[OCR 오류] 요청 실패',
            isLoading: false,
          });
        });
    });

    await Promise.allSettled(promises);
    setIsProcessing(false);
  }, [queuedImages, addPlaceholders, updateQuestion]);

  // ─── 파일 드롭/선택 ───
  const handleFileDrop = useCallback((files: FileList) => {
    for (const file of Array.from(files)) {
      if (file.type === 'application/pdf') {
        handlePdfSelect(file);
        return;
      }
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          setQueuedImages(prev => [...prev, { dataUrl: reader.result as string, name: file.name }]);
        };
        reader.readAsDataURL(file);
      }
    }
  }, [handlePdfSelect]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── JSON 가져오기 ───
  const handleImportJson = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const imported = importJsonToQuestions(json);
        if (imported.length > 0) {
          if (questions.length > 0) {
            if (confirm('기존 문제에 병합하시겠습니까?\n확인: 병합 / 취소: 대체')) {
              mergeQuestions(imported);
            } else {
              setQuestions(imported);
            }
          } else {
            setQuestions(imported);
          }
        }
      } catch {
        alert('JSON 파일을 읽을 수 없습니다.');
      }
    };
    input.click();
  }, [questions.length, setQuestions, mergeQuestions]);

  // ─── JSON 내보내기 ───
  const handleExportJson = useCallback(() => {
    if (questions.length === 0) { alert('내보낼 문제가 없습니다.'); return; }
    const name = prompt('저장할 파일 이름을 입력하세요:', sessionName || `exam_questions_${new Date().toISOString().slice(0, 10)}`);
    if (name === null) return;
    downloadJson(questions, `${name || 'exam_questions'}.json`);
    markSaved();
  }, [questions, sessionName, markSaved]);

  // ─── 시험지 분석 ───
  const handleAnalyzeExam = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const defaultName = file.name.replace(/\.json$/i, '');
      const examName = prompt('시험 이름을 입력하세요:', defaultName);
      if (examName === null) return;

      const text = await file.text();
      setIsAnalysisOpen(true);
      setIsAnalyzing(true);
      setAnalysisData(null);
      setAnalysisExamName(examName || defaultName);

      try {
        JSON.parse(text); // 유효성 확인
        const result = await analyzeExam(text, examName || defaultName);
        let jsonStr = result;
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1];
        const parsed = JSON.parse(jsonStr.trim()) as AnalysisResult;
        setAnalysisData(parsed);
      } catch (error) {
        console.error('시험지 분석 실패:', error);
        alert('시험지 분석 중 오류가 발생했습니다.');
        setIsAnalysisOpen(false);
      } finally {
        setIsAnalyzing(false);
      }
    };
    input.click();
  }, []);

  // ─── 분석 불러오기 (이전에 저장한 분석 JSON 로드) ───
  const handleLoadAnalysis = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as AnalysisResult;
        if (!parsed.summary || typeof parsed.summary.total_questions !== 'number') {
          alert('유효한 시험지 분석 JSON 파일이 아닙니다.');
          return;
        }
        const name = parsed.summary.exam_name
          || file.name.replace(/_분석결과\.json$/i, '').replace(/\.json$/i, '')
          || '시험';
        setAnalysisData(parsed);
        setAnalysisExamName(name);
        setIsAnalysisOpen(true);
        setIsAnalyzing(false);
      } catch {
        alert('JSON 파일을 파싱할 수 없습니다. 올바른 분석 결과 파일인지 확인해주세요.');
      }
    };
    input.click();
  }, []);

  // ─── 정답/해설 ───
  const handleGetAnswer = useCallback(async (index: number) => {
    const q = questions[index];
    if (!q) return;
    setLoadingAnswerIndex(index);
    try {
      const result = await getAnswerExplanation(q.text);
      if (result) {
        updateQuestion(index, { text: result });
      }
    } catch (error) {
      console.error('정답/해설 가져오기 실패:', error);
    } finally {
      setLoadingAnswerIndex(null);
    }
  }, [questions, updateQuestion]);

  // ─── 모드 토글 ───
  const modeButton = (mode: SelectionMode, label: string) => {
    const isActive = selectionMode === mode;
    return (
      <button
        onClick={() => setSelectionMode(isActive ? 'none' : mode)}
        className={`px-2.5 py-1.5 text-[11px] rounded-lg font-medium transition-all ${
          isActive
            ? 'bg-primary-500/20 text-primary-400 ring-1 ring-primary-500/30'
            : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-300'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] -m-4 lg:-m-8">
      {/* ── 상단 도구바 ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-surface/50 border-b border-white/5 flex-shrink-0">
        {/* 영역 선택 모드 */}
        <div className="flex items-center gap-1">
          {modeButton('single', '범위 설정')}
          {modeButton('formatting', '포맷팅 포함')}
          {modeButton('multi', '여러 영역')}
          {modeButton('multi_formatting', '여러+포맷팅')}
        </div>

        {(selectionMode === 'multi' || selectionMode === 'multi_formatting') && (
          <button onClick={handleProcessMultiRegions}
            disabled={pendingRegions.length === 0 || isProcessing}
            className="px-3 py-1.5 text-[11px] font-medium bg-emerald-500/20 text-emerald-400 rounded-lg
              hover:bg-emerald-500/30 disabled:opacity-30">
            {isProcessing ? 'OCR 처리중...' : `영역 완료 (${pendingRegions.length}개)`}
          </button>
        )}

        {isProcessing && (
          <span className="flex items-center gap-1.5 text-xs text-primary-400">
            <Loader2 size={14} className="animate-spin" /> OCR 처리중...
          </span>
        )}

        <div className="flex-1" />

        {/* 문제 패널 토글 */}
        <button
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all ${
            rightPanelOpen
              ? 'bg-primary-500/20 text-primary-400 ring-1 ring-primary-500/30'
              : 'bg-white/5 text-slate-400 hover:bg-white/10'
          }`}
        >
          {rightPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          문제 목록 {questions.length > 0 && `(${questions.length})`}
        </button>
      </div>

      {/* ── 메인 영역 ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* 왼쪽: 이미지/PDF 영역 — 패널 닫히면 전체 너비 사용 */}
        <div className="flex-1 flex flex-col p-4 overflow-auto min-w-0">
          {/* PDF 네비게이션 */}
          {pdfFile && (
            <div className="mb-3 flex items-center gap-3">
              <PdfViewer file={pdfFile} onPageImage={handlePdfPageImage} />
              <button onClick={() => { setPdfFile(null); setImageDataUrl(null); setPendingRegions([]); setSelectionMode('none'); }}
                className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10">
                <X size={14} />
              </button>
            </div>
          )}

          {imageDataUrl ? (
            <RegionSelector
              imageDataUrl={imageDataUrl}
              selectionMode={selectionMode}
              onRegionSelected={handleRegionSelected}
              pendingRegions={pendingRegions}
              onPendingRegionsChange={setPendingRegions}
              onImageRotated={handleImageRotated}
            />
          ) : (
            /* 드롭존 */
            <div
              className="flex-1 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/10 hover:border-primary-500/30 transition-colors bg-dark/30 min-h-[400px]"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleFileDrop(e.dataTransfer.files); }}
            >
              {queuedImages.length > 0 ? (
                <div className="w-full p-6 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    {queuedImages.map((img, i) => (
                      <div key={i} className="relative rounded-lg overflow-hidden border border-white/10">
                        <img src={img.dataUrl} alt={img.name} className="w-full h-32 object-cover" />
                        <button onClick={() => setQueuedImages(prev => prev.filter((_, j) => j !== i))}
                          className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white/60 hover:text-red-400">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={handleSubmitImages} disabled={isProcessing}
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white
                        bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-400 hover:to-primary-500
                        disabled:opacity-50 shadow-lg shadow-primary-500/20 transition-all">
                      {isProcessing ? (
                        <><Loader2 size={16} className="inline animate-spin mr-1" /> 처리중...</>
                      ) : (
                        <><Search size={16} className="inline mr-1" /> OCR 실행 ({queuedImages.length}장)</>
                      )}
                    </button>
                    <button onClick={() => setQueuedImages([])}
                      className="px-4 py-2.5 rounded-xl text-sm text-slate-400 bg-white/5 hover:bg-white/10">
                      초기화
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-primary-500/10 flex items-center justify-center mx-auto mb-4">
                    <Upload size={28} className="text-primary-400" />
                  </div>
                  <h3 className="text-base font-bold text-white mb-1">PDF 또는 이미지를 드래그하세요</h3>
                  <p className="text-xs text-slate-400 mb-4">
                    PDF 파일을 열면 페이지별로 영역을 선택하여 OCR할 수 있습니다
                  </p>
                  {!hasApiKey && (
                    <p className="text-xs text-amber-400 mb-4">
                      ⚠️ 설정 페이지에서 Gemini API 키를 먼저 등록해주세요
                    </p>
                  )}
                  <button onClick={() => fileInputRef.current?.click()}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white
                      bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-400 hover:to-primary-500
                      shadow-lg shadow-primary-500/20 transition-all hover:scale-105">
                    <FileText size={16} className="inline mr-1.5" />
                    파일 선택
                  </button>
                  <input ref={fileInputRef} type="file" accept=".pdf,image/*" multiple className="hidden"
                    onChange={(e) => { if (e.target.files) handleFileDrop(e.target.files); }} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* 오른쪽: 문제 카드 목록 (접기/펴기 가능) */}
        <div className={`border-l border-white/5 bg-surface/30 flex flex-col flex-shrink-0 transition-all duration-300 ${
          rightPanelOpen ? 'w-[420px]' : 'w-0 overflow-hidden border-l-0'
        }`}>
          {/* 파일 작업 도구 */}
          <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-white/5 bg-surface/50">
            <button onClick={handleAnalyzeExam}
              className="px-2.5 py-1.5 text-[10px] font-medium bg-violet-500/15 text-violet-400 rounded-lg hover:bg-violet-500/25">
              <BarChart3 size={12} className="inline mr-1" />시험지 분석
            </button>
            <button onClick={handleLoadAnalysis}
              className="px-2.5 py-1.5 text-[10px] font-medium bg-violet-500/10 text-violet-300 rounded-lg hover:bg-violet-500/20">
              분석 불러오기
            </button>
            <button onClick={handleImportJson}
              className="px-2.5 py-1.5 text-[10px] font-medium bg-white/5 text-slate-400 rounded-lg hover:bg-white/10">
              <FolderOpen size={12} className="inline mr-1" />JSON 가져오기
            </button>
            <button onClick={handleExportJson}
              className="px-2.5 py-1.5 text-[10px] font-medium bg-white/5 text-slate-400 rounded-lg hover:bg-white/10">
              <Download size={12} className="inline mr-1" />JSON 저장
            </button>
            <button onClick={() => {
                if (questions.length === 0) { alert('내보낼 문제가 없습니다.'); return; }
                exportAsPdf(questions, sessionName || `exam_${new Date().toISOString().slice(0, 10)}`, pdfOptions);
              }}
              className="px-2.5 py-1.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-400 rounded-lg hover:bg-emerald-500/25">
              <FileDown size={12} className="inline mr-1" />PDF 내보내기
            </button>
            {/* HWP 내보내기는 웹에서 비활성 (향후 별도 EXE로 제공 예정) */}
            <button disabled title="HWP 내보내기는 데스크톱 버전에서만 지원됩니다"
              className="px-2.5 py-1.5 text-[10px] font-medium bg-white/5 text-slate-600 rounded-lg opacity-40 cursor-not-allowed">
              HWP
            </button>
          </div>
          {/* 인쇄 옵션 체크박스 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border-b border-white/5 bg-surface/30">
            <span className="text-[10px] text-slate-500 font-medium">인쇄옵션</span>
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input type="checkbox" checked={pdfOptions.showPageNumbers}
                onChange={(e) => setPdfOptions(prev => ({ ...prev, showPageNumbers: e.target.checked }))}
                className="w-3 h-3 rounded border-slate-600 bg-surface text-primary-500 focus:ring-primary-500/30 accent-primary-500" />
              <span className="text-[10px] text-slate-400">페이지 표시</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input type="checkbox" checked={pdfOptions.includeAnswers}
                onChange={(e) => setPdfOptions(prev => ({ ...prev, includeAnswers: e.target.checked }))}
                className="w-3 h-3 rounded border-slate-600 bg-surface text-primary-500 focus:ring-primary-500/30 accent-primary-500" />
              <span className="text-[10px] text-slate-400">정답/해설</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer select-none">
              <input type="checkbox" checked={pdfOptions.twoColumns}
                onChange={(e) => setPdfOptions(prev => ({ ...prev, twoColumns: e.target.checked }))}
                className="w-3 h-3 rounded border-slate-600 bg-surface text-primary-500 focus:ring-primary-500/30 accent-primary-500" />
              <span className="text-[10px] text-slate-400">2단 레이아웃</span>
            </label>
          </div>
          {/* 문제 목록 헤더 */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white">문제 목록</h2>
              {questions.length > 0 && (
                <span className="text-[10px] text-slate-500">{questions.length}개</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {questions.length > 0 && (
                <>
                  <button onClick={() => setIsReviewOpen(true)}
                    className="px-2 py-1 text-[10px] text-primary-400 bg-primary-500/10 rounded-lg hover:bg-primary-500/20">
                    <ClipboardCheck size={11} className="inline mr-0.5" />검수
                  </button>
                  <button onClick={() => {
                    if (confirm('모든 문제를 삭제하시겠습니까?')) deleteAllQuestions();
                  }}
                    className="px-2 py-1 text-[10px] text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20">
                    전체 삭제
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {questions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                  <FileText size={20} className="text-slate-600" />
                </div>
                <p className="text-sm text-slate-500 mb-1">추출된 문제가 없습니다</p>
                <p className="text-[10px] text-slate-600">
                  PDF를 열고 영역을 선택하거나<br />이미지를 드래그하여 OCR을 실행하세요
                </p>
              </div>
            ) : (
              questions.map((q, i) => (
                <div
                  key={`${q.number}-${i}`}
                  onDragEnter={(e) => handleDragEnter(e, i)}
                  className={`transition-all duration-150 ${
                    dragOverIndex === i && dragIndexRef.current !== i
                      ? 'border-t-2 border-primary-400 pt-1'
                      : ''
                  }`}
                >
                  <QuestionCard
                    question={q}
                    index={i}
                    isEditing={editingIndex === i}
                    onEdit={() => setEditingIndex(editingIndex === i ? null : i)}
                    onUpdate={(text) => updateQuestion(i, { text })}
                    onDelete={() => {
                      if (confirm(`문제 #${q.number}을 삭제하시겠습니까?`)) {
                        deleteQuestion(i);
                        if (editingIndex === i) setEditingIndex(null);
                      }
                    }}
                    onGetAnswer={() => handleGetAnswer(i)}
                    isLoadingAnswer={loadingAnswerIndex === i}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onDragEnd={handleDragEnd}
                  />
                </div>
              ))
            )}
          </div>

          {/* 하단 상태바 */}
          {questions.length > 0 && (
            <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between">
              <span className="text-[10px] text-slate-600">
                {questions.filter(q => !q.isLoading).length}개 완료
              </span>
              <div className="flex items-center gap-1">
                <CheckCircle2 size={10} className="text-emerald-500" />
                <span className="text-[10px] text-slate-500">자동 저장됨</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 분석 모달 */}
      <AnalysisModal
        isOpen={isAnalysisOpen}
        onClose={() => setIsAnalysisOpen(false)}
        data={analysisData}
        examName={analysisExamName}
        isLoading={isAnalyzing}
      />

      {/* 검수 패널 (풀스크린 오버레이) */}
      <ReviewPanel
        isOpen={isReviewOpen}
        onClose={() => setIsReviewOpen(false)}
        sessionName={sessionName}
        pdfOptions={pdfOptions}
      />
    </div>
  );
};
