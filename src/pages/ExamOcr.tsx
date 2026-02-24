import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ImageDropZone from '../components/exam-ocr/ImageDropZone.tsx';
import PdfViewer from '../components/exam-ocr/PdfViewer.tsx';
import RegionSelector from '../components/exam-ocr/RegionSelector.tsx';
import QuestionCardList from '../components/exam-ocr/QuestionCardList.tsx';
import OcrToolbar from '../components/exam-ocr/OcrToolbar.tsx';
import AnalysisModal from '../components/exam-ocr/AnalysisModal.tsx';
import type { AnalysisResult } from '../components/exam-ocr/AnalysisModal.tsx';
import { useQuestionStore } from '../lib/exam-ocr/useQuestionStore.ts';
import { cropCanvasRegion } from '../lib/exam-ocr/imageUtils.ts';
import { downloadJson, loadJsonFile } from '../lib/exam-ocr/exportJson.ts';
import { questionsToExportJson } from '../lib/exam-ocr/questionParser.ts';
import { normalizeQuestionText } from '../lib/exam-ocr/normalizeQuestion.ts';
import { ocrExtract, analyzeExam } from '../lib/exam-ocr/ocrApi.ts';
import { exportQuestionsPdf } from '../lib/exam-ocr/exportPdf.ts';
import type { SelectionMode, Region, QueuedImage, Question } from '../lib/exam-ocr/types.ts';

export function ExamOcrPage() {
  const navigate = useNavigate();
  const [queuedImages, setQueuedImages] = useState<QueuedImage[]>([]);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none');
  const [pendingRegions, setPendingRegions] = useState<Region[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisResult | null>(null);
  const [analysisExamName, setAnalysisExamName] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // ★ 수동 구독: useSyncExternalStore 우회 (React 19 + Zustand 5 호환 문제 해결)
  const [questions, setLocalQuestions] = useState<Question[]>(() => useQuestionStore.getState().questions);
  const questionsRef = useRef(questions);

  useEffect(() => {
    // 마운트 시 최신 상태 동기화
    const current = useQuestionStore.getState().questions;
    setLocalQuestions(current);
    questionsRef.current = current;

    const unsub = useQuestionStore.subscribe((state) => {
      // 참조가 실제로 바뀌었을 때만 setState 호출
      if (state.questions !== questionsRef.current) {
        console.log('[ExamOcr] 스토어 구독 → questions 변경 감지, 길이:', state.questions.length);
        questionsRef.current = state.questions;
        setLocalQuestions(state.questions);
      }
    });
    return unsub;
  }, []);

  // 스토어 액션은 getState()로 직접 접근 (안정적인 참조)
  const addQuestion = useCallback(
    (q: Omit<Question, 'number'>) => useQuestionStore.getState().addQuestion(q), []
  );
  const addPlaceholders = useCallback(
    (count: number) => useQuestionStore.getState().addPlaceholders(count), []
  );
  const updateQuestion = useCallback(
    (index: number, updates: Partial<Question>) => useQuestionStore.getState().updateQuestion(index, updates), []
  );
  const setQuestions = useCallback(
    (qs: Question[]) => useQuestionStore.getState().setQuestions(qs), []
  );
  const mergeQuestions = useCallback(
    (qs: Question[]) => useQuestionStore.getState().mergeQuestions(qs), []
  );
  const markSaved = useCallback(
    () => useQuestionStore.getState().markSaved(), []
  );

  console.log('[ExamOcr RENDER] questions:', questions.length);

  // 이미지 큐 전송 → 이미지별 개별 OCR 병렬 처리
  const handleSubmitImages = useCallback(async () => {
    if (queuedImages.length === 0) return;

    setIsProcessing(true);
    const startIndex = addPlaceholders(queuedImages.length);
    const imagesToProcess = [...queuedImages];
    setQueuedImages([]);

    const promises = imagesToProcess.map((img, i) => {
      const base64 = img.dataUrl.split(',')[1];
      if (!base64) return Promise.resolve();

      return ocrExtract([base64], 'extract')
        .then((text) => {
          console.log('[ExamOcr] 이미지', i, 'OCR 결과 수신, 길이:', text.length);

          if (!text.trim()) {
            console.warn('[ExamOcr] 이미지', i, 'OCR 결과가 비어있음');
            updateQuestion(startIndex + i, {
              text: '[OCR 결과 없음] Gemini가 빈 응답을 반환했습니다.',
              isLoading: false,
            });
            return;
          }

          // 여러 [문제]가 포함된 경우 분리
          const questionParts = text.split(/(?=\[문제\])/).filter((p: string) => p.trim());

          if (questionParts.length > 1) {
            let preamble = '';
            let questions = questionParts;
            if (!questionParts[0].startsWith('[문제]')) {
              preamble = questionParts[0].trim();
              questions = questionParts.slice(1);
            }

            // 첫 번째 문제는 플레이스홀더 업데이트
            const firstText = preamble
              ? preamble + '\n\n' + questions[0].trim()
              : questions[0].trim();
            updateQuestion(startIndex + i, {
              text: normalizeQuestionText(firstText),
              isLoading: false,
            });

            // 나머지 문제는 새 카드로 추가
            for (let j = 1; j < questions.length; j++) {
              const fullText = preamble
                ? preamble + '\n\n' + questions[j].trim()
                : questions[j].trim();
              addQuestion({
                text: fullText,
                answer: '',
                explanation: '',
              });
            }
          } else {
            updateQuestion(startIndex + i, {
              text: normalizeQuestionText(text),
              isLoading: false,
            });
          }
          console.log('[ExamOcr] 이미지', i, '카드 업데이트 완료');
        })
        .catch((err) => {
          console.error('[ExamOcr] 이미지', i, 'OCR 실패:', err);
          updateQuestion(startIndex + i, {
            text: '[OCR 오류] 요청 실패: ' + (err instanceof Error ? err.message : String(err)),
            isLoading: false,
          });
        });
    });

    await Promise.allSettled(promises);
    setIsProcessing(false);
  }, [queuedImages, addPlaceholders, updateQuestion]);

  // PDF 파일 선택 처리
  const handlePdfSelect = useCallback((file: File) => {
    setPdfFile(file);
    setImageDataUrl(null);
  }, []);

  // PDF 페이지 이미지 수신
  const handlePdfPageImage = useCallback((dataUrl: string) => {
    setImageDataUrl(dataUrl);
  }, []);

  // 영역 선택 완료 → OCR 실행
  const handleRegionSelected = useCallback(
    async (regions: Region[]) => {
      if (!imageDataUrl || regions.length === 0) return;

      setIsProcessing(true);

      try {
        const img = new Image();
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.src = imageDataUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);

        const images: string[] = [];
        for (const region of regions) {
          const base64 = cropCanvasRegion(
            canvas,
            Math.round(region.x),
            Math.round(region.y),
            Math.round(region.width),
            Math.round(region.height)
          );
          images.push(base64);
        }

        const mode =
          selectionMode === 'formatting'
            ? 'extract_formatting'
            : images.length > 1
            ? 'multi'
            : 'extract';

        const text = await ocrExtract(images, mode);

        console.log('[ExamOcr] 영역 OCR 결과 수신, 길이:', text?.length, '| 앞부분:', text?.substring(0, 100));

        if (text && text.trim()) {
          const regionCoords: [number, number, number, number] = [
            Math.round(regions[0].x),
            Math.round(regions[0].y),
            Math.round(regions[0].x + regions[0].width),
            Math.round(regions[0].y + regions[0].height),
          ];

          // 여러 [문제]가 포함된 경우 개별 카드로 분리
          const questionParts = text.split(/(?=\[문제\])/).filter((p: string) => p.trim());

          if (questionParts.length > 1) {
            // [문제]로 시작하지 않는 앞부분은 지문(공통 텍스트)
            let preamble = '';
            let questions = questionParts;
            if (!questionParts[0].startsWith('[문제]')) {
              preamble = questionParts[0].trim();
              questions = questionParts.slice(1);
            }

            for (const q of questions) {
              const fullText = preamble ? preamble + '\n\n' + q.trim() : q.trim();
              addQuestion({
                text: fullText,
                answer: '',
                explanation: '',
                region: regionCoords,
              });
            }
          } else {
            addQuestion({
              text: text,
              answer: '',
              explanation: '',
              region: regionCoords,
            });
          }
          console.log('[ExamOcr] 영역 OCR → 카드 추가 완료');
        } else {
          console.warn('[ExamOcr] 영역 OCR 결과가 비어있음');
          alert('OCR 결과가 비어있습니다. 다시 시도해주세요.');
        }
      } catch (error) {
        console.error('OCR 처리 실패:', error);
        alert('OCR 처리 중 오류가 발생했습니다.');
      } finally {
        setIsProcessing(false);
      }
    },
    [imageDataUrl, selectionMode, addQuestion]
  );

  // 여러 영역 처리
  const handleProcessMultiRegions = useCallback(() => {
    if (pendingRegions.length === 0) return;
    handleRegionSelected(pendingRegions);
    setPendingRegions([]);
    setSelectionMode('none');
  }, [pendingRegions, handleRegionSelected]);

  // JSON 가져오기
  const handleImportJson = useCallback(async () => {
    try {
      const imported = await loadJsonFile();
      if (imported.length > 0) {
        if (questions.length > 0) {
          const choice = confirm('기존 문제에 병합하시겠습니까?\n확인: 병합 / 취소: 대체');
          if (choice) {
            mergeQuestions(imported);
          } else {
            setQuestions(imported);
          }
        } else {
          setQuestions(imported);
        }
      }
    } catch (error) {
      console.error('JSON 가져오기 실패:', error);
      alert('JSON 파일을 읽을 수 없습니다.');
    }
  }, [questions, setQuestions, mergeQuestions]);

  // JSON 내보내기
  const handleExportJson = useCallback(() => {
    if (questions.length === 0) {
      alert('내보낼 문제가 없습니다.');
      return;
    }
    const name = prompt('저장할 파일 이름을 입력하세요:', `exam_questions_${new Date().toISOString().slice(0, 10)}`);
    if (name === null) return;
    downloadJson(questions, name ? `${name}.json` : undefined);
    markSaved();
  }, [questions, markSaved]);

  // 시험지 분석
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

      setIsAnalysisOpen(true);
      setIsAnalyzing(true);
      setAnalysisData(null);
      setAnalysisExamName(examName || defaultName);

      try {
        const text = await file.text();
        JSON.parse(text); // 유효성 확인

        const resultText = await analyzeExam(text, examName || defaultName);

        if (resultText) {
          let jsonStr = resultText;
          const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1];
          }
          const parsed = JSON.parse(jsonStr.trim()) as AnalysisResult;
          setAnalysisData(parsed);
        }
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

  // PDF 내보내기
  const handleExportPdf = useCallback(() => {
    if (questions.length === 0) {
      alert('내보낼 문제가 없습니다.');
      return;
    }
    const title = prompt('시험지 제목을 입력하세요:', '기출문제 정리');
    if (title === null) return;
    exportQuestionsPdf(questions, title || undefined);
  }, [questions]);

  // questionsToExportJson 사용 안 됨 경고 방지
  void questionsToExportJson;

  return (
    <div className="flex flex-col h-[calc(100vh)] bg-gray-50 text-gray-900 overflow-hidden">
      {/* 도구바 */}
      <OcrToolbar
        selectionMode={selectionMode}
        onSelectionModeChange={setSelectionMode}
        onProcessMultiRegions={handleProcessMultiRegions}
        pendingRegionCount={pendingRegions.length}
        onAnalyzeExam={handleAnalyzeExam}
        onImportJson={handleImportJson}
        onExportJson={handleExportJson}
        onExportPdf={handleExportPdf}
        isProcessing={isProcessing}
      />

      {/* 메인 영역 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 왼쪽: 이미지 영역 */}
        <div className="flex-1 flex flex-col p-4 overflow-auto">
          {pdfFile && (
            <div className="mb-3">
              <PdfViewer file={pdfFile} onPageImage={handlePdfPageImage} />
            </div>
          )}

          {imageDataUrl && selectionMode !== 'none' ? (
            <div className="flex flex-col gap-3 flex-1 min-h-0">
              <div className="flex items-center justify-between flex-shrink-0">
                <h2 className="text-sm font-medium text-gray-700">영역 선택 모드</h2>
                <button
                  onClick={() => {
                    setImageDataUrl(null);
                    setPdfFile(null);
                    setPendingRegions([]);
                    setSelectionMode('none');
                  }}
                  className="text-xs text-gray-500 hover:text-red-500"
                >
                  닫기
                </button>
              </div>
              <RegionSelector
                imageDataUrl={imageDataUrl}
                selectionMode={selectionMode}
                onRegionSelected={handleRegionSelected}
                pendingRegions={pendingRegions}
                onPendingRegionsChange={setPendingRegions}
              />
            </div>
          ) : (
            <ImageDropZone
              images={queuedImages}
              onImagesChange={setQueuedImages}
              onSubmit={handleSubmitImages}
              onPdfSelect={handlePdfSelect}
              isProcessing={isProcessing}
            />
          )}
        </div>

        {/* 오른쪽: 문제 카드 목록 */}
        <div className="w-[480px] border-l border-gray-200 bg-white flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h2 className="font-bold text-gray-800">문제 목록</h2>
            <button
              onClick={() => navigate('/exam-review')}
              disabled={questions.length === 0}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              검수
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <QuestionCardList questions={questions} />
          </div>
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
}
