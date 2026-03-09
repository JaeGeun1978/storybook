/**
 * 기출문제 OCR 페이지
 * past-exam-web의 핵심 기능을 storybook(Vite+React) 환경으로 포팅
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload, FileText, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  RotateCcw, RotateCw, Trash2, Download, FolderOpen, Search,
  Loader2, X, GripVertical, BarChart3, CheckCircle2,
  PanelRightOpen, PanelRightClose,
} from 'lucide-react';
import { useOcrStore, normalizeQuestionText, questionsToExportJson, importJsonToQuestions } from '../lib/ocrStore';
import type { OcrQuestion } from '../lib/ocrStore';
import { runOcr, getAnswerExplanation, analyzeExam } from '../lib/ocrGemini';
import type { OcrMode } from '../lib/ocrGemini';
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
}> = ({ question, isEditing, onEdit, onUpdate, onDelete, onGetAnswer, isLoadingAnswer }) => {
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
    <div className={`rounded-xl bg-surface border transition-all duration-200 ${
      isEditing ? 'border-primary-500/30 ring-1 ring-primary-500/20' : 'border-white/5 hover:border-white/10'
    }`}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <GripVertical size={14} className="text-slate-600" />
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
            className="w-full min-h-[200px] p-3 text-sm font-mono leading-relaxed rounded-lg bg-dark border border-white/10 text-slate-200 resize-y
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
//  분석 모달
// ═══════════════════════════════════════
const AnalysisModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  data: AnalysisResult | null;
  examName: string;
  isLoading: boolean;
}> = ({ isOpen, onClose, data, examName, isLoading }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl max-h-[85vh] mx-4 rounded-2xl bg-surface border border-white/10 shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <BarChart3 size={20} className="text-primary-400" />
            <h3 className="text-lg font-bold text-white">{examName} 분석</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 size={32} className="animate-spin text-primary-400" />
              <p className="text-sm text-slate-400">AI가 시험지를 분석하고 있습니다...</p>
            </div>
          ) : data ? (
            <div className="space-y-6">
              {/* 요약 */}
              <div className="rounded-xl bg-dark/50 p-5">
                <h4 className="text-sm font-bold text-white mb-2">📊 전체 요약</h4>
                <div className="grid grid-cols-3 gap-4 mb-3">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary-400">{data.summary.total_questions}</div>
                    <div className="text-[10px] text-slate-500">총 문항</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-amber-400">{data.summary.overall_difficulty}</div>
                    <div className="text-[10px] text-slate-500">전체 난이도</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-emerald-400">
                      {data.difficulty_distribution.high}:{data.difficulty_distribution.mid}:{data.difficulty_distribution.low}
                    </div>
                    <div className="text-[10px] text-slate-500">상:중:하</div>
                  </div>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{data.summary.trend_analysis}</p>
              </div>

              {/* 유형 분류 */}
              <div>
                <h4 className="text-sm font-bold text-white mb-3">📋 유형별 분류</h4>
                <div className="grid gap-2">
                  {data.type_classification.map((tc, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg bg-dark/30 px-4 py-2.5">
                      <span className="text-xs font-bold text-slate-300 min-w-[120px]">{tc.type}</span>
                      <span className="text-xs text-primary-400 font-medium">{tc.count}문항</span>
                      <span className="text-[10px] text-slate-500">
                        ({tc.question_numbers.join(', ')}번)
                      </span>
                      <span className="ml-auto text-[10px] text-slate-500">난이도: {tc.difficulty_avg}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 킬러 문항 */}
              {data.killer_questions.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-white mb-3">🔥 킬러 문항</h4>
                  <div className="space-y-2">
                    {data.killer_questions.map((kq, i) => (
                      <div key={i} className="rounded-lg bg-red-500/5 border border-red-500/10 p-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-red-400">{kq.q_number}번</span>
                          <span className="text-[10px] text-slate-500">{kq.type}</span>
                        </div>
                        <p className="text-xs text-slate-400 mb-1">{kq.reason}</p>
                        <p className="text-xs text-emerald-400">💡 {kq.strategy}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 학습 계획 */}
              <div>
                <h4 className="text-sm font-bold text-white mb-3">📚 학습 계획</h4>
                <div className="space-y-2">
                  {data.study_plan.map((sp, i) => (
                    <div key={i} className="rounded-lg bg-dark/30 p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-xs font-bold">
                          {sp.priority}
                        </span>
                        <span className="text-xs font-bold text-white">{sp.area}</span>
                      </div>
                      <p className="text-xs text-slate-400 ml-8">{sp.content}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 분석 결과 저장 */}
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${examName}_분석결과.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-primary-500/10 text-primary-400 hover:bg-primary-500/20"
                >
                  <Download size={14} className="inline mr-1" />
                  분석 결과 저장
                </button>
              </div>
            </div>
          ) : (
            <p className="text-center text-sm text-slate-500 py-16">분석 데이터가 없습니다.</p>
          )}
        </div>
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
    setQuestions, mergeQuestions, markSaved, deleteAllQuestions,
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

  // 분석 모달
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisResult | null>(null);
  const [analysisExamName, setAnalysisExamName] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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
            <button onClick={handleImportJson}
              className="px-2.5 py-1.5 text-[10px] font-medium bg-white/5 text-slate-400 rounded-lg hover:bg-white/10">
              <FolderOpen size={12} className="inline mr-1" />JSON 가져오기
            </button>
            <button onClick={handleExportJson}
              className="px-2.5 py-1.5 text-[10px] font-medium bg-white/5 text-slate-400 rounded-lg hover:bg-white/10">
              <Download size={12} className="inline mr-1" />JSON 저장
            </button>
            {/* HWP 내보내기는 웹에서 비활성 (향후 별도 EXE로 제공 예정) */}
            <button disabled title="HWP 내보내기는 데스크톱 버전에서만 지원됩니다"
              className="px-2.5 py-1.5 text-[10px] font-medium bg-white/5 text-slate-600 rounded-lg opacity-40 cursor-not-allowed">
              HWP
            </button>
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
                <button onClick={() => {
                  if (confirm('모든 문제를 삭제하시겠습니까?')) deleteAllQuestions();
                }}
                  className="px-2 py-1 text-[10px] text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20">
                  전체 삭제
                </button>
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
                <QuestionCard
                  key={`${q.number}-${i}`}
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
                />
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
    </div>
  );
};
