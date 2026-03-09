/**
 * 기출문제OCR 전용 Zustand 스토어
 * past-exam-web의 useQuestionStore를 포팅
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface QuestionImage {
  id: string;
  dataUrl: string;
  marker: string;
}

export interface OcrQuestion {
  number: number;
  text: string;
  answer: string;
  explanation: string;
  page?: number;
  region?: [number, number, number, number];
  source?: string;
  saved_at?: string;
  isLoading?: boolean;
  images?: QuestionImage[];
}

interface OcrStore {
  questions: OcrQuestion[];
  hasUnsavedChanges: boolean;

  addQuestion: (question: Omit<OcrQuestion, 'number'>) => void;
  addPlaceholders: (count: number) => number;
  updateQuestion: (index: number, updates: Partial<OcrQuestion>) => void;
  deleteQuestion: (index: number) => void;
  deleteAllQuestions: () => void;
  setQuestions: (questions: OcrQuestion[]) => void;
  reorderQuestions: (fromIndex: number, toIndex: number) => void;
  mergeQuestions: (newQuestions: OcrQuestion[]) => void;
  markSaved: () => void;
}

/**
 * 문제 텍스트에 [문제] 태그가 없으면 자동으로 붙여주는 정규화 함수
 */
export function normalizeQuestionText(text: string): string {
  if (!text.trim()) return text;
  if (/\[문제\]/.test(text)) return text;
  return '[문제] ' + text.trimStart();
}

/**
 * 통합 텍스트에서 [정답]과 [해설] 태그를 파싱하여 분리
 */
export function parseQuestionText(fullText: string): {
  text: string;
  answer: string;
  explanation: string;
} {
  const problemCount = (fullText.match(/\[문제\]/g) || []).length;
  if (problemCount > 1) {
    return { text: fullText, answer: '', explanation: '' };
  }

  let text = fullText;
  let answer = '';
  let explanation = '';

  const answerMatch = fullText.match(/\[정답\]\s*(.*?)(?=\[해설\]|$)/s);
  const explanationMatch = fullText.match(/\[해설\]\s*(.*?)$/s);

  if (answerMatch) {
    answer = answerMatch[1].trim();
    text = fullText.slice(0, answerMatch.index).trim();
  }

  if (explanationMatch) {
    explanation = explanationMatch[1].trim();
    if (!answerMatch) {
      text = fullText.slice(0, explanationMatch.index).trim();
    }
  }

  return { text, answer, explanation };
}

/**
 * Question 배열을 JSON 내보내기 형식으로 변환
 */
export function questionsToExportJson(questions: OcrQuestion[], sourcePdf: string = ''): object {
  return {
    metadata: {
      source_pdf: sourcePdf,
      extraction_date: new Date().toISOString(),
      total_questions: questions.length,
    },
    questions: questions.map((q) => {
      const normalized = normalizeQuestionText(q.text);
      const parsed = parseQuestionText(normalized);
      const result: Record<string, unknown> = {
        number: q.number,
        text: parsed.text || normalized,
        answer: parsed.answer || q.answer,
        explanation: parsed.explanation || q.explanation,
        page: q.page ?? 1,
        region: q.region ?? null,
        source: q.source ?? '',
        saved_at: q.saved_at ?? new Date().toISOString(),
      };
      if (q.images && q.images.length > 0) {
        result.images = q.images.map((img) => ({
          id: img.id,
          marker: img.marker,
          dataUrl: img.dataUrl,
        }));
      }
      return result;
    }),
  };
}

/**
 * JSON 가져오기: 내보내기 형식 → Question 배열
 */
export function importJsonToQuestions(json: Record<string, unknown>): OcrQuestion[] {
  const data = json as { questions?: Array<Record<string, unknown>> };
  const questions = data.questions ?? [];

  return questions.map((q, i) => {
    const text = (q.text as string) ?? '';
    const answer = (q.answer as string) ?? '';
    const explanation = (q.explanation as string) ?? '';

    const problemCount = (text.match(/\[문제\]/g) || []).length;
    let fullText = text;
    if (problemCount <= 1 && (answer || explanation)) {
      if (answer) fullText += `\n\n[정답] ${answer}`;
      if (explanation) fullText += `\n[해설] ${explanation}`;
    }

    const result: OcrQuestion = {
      number: i + 1,
      text: fullText,
      answer,
      explanation,
      page: (q.page as number) ?? 1,
      region: (q.region as [number, number, number, number]) ?? undefined,
      source: (q.source as string) ?? '',
      saved_at: (q.saved_at as string) ?? new Date().toISOString(),
    };

    const images = q.images as Array<{ id: string; marker: string; dataUrl: string }> | undefined;
    if (images && images.length > 0) {
      result.images = images.map((img) => ({
        id: img.id,
        marker: img.marker,
        dataUrl: img.dataUrl,
      }));
    }

    return result;
  });
}

export const useOcrStore = create<OcrStore>()(
  persist(
    (set, get) => ({
      questions: [],
      hasUnsavedChanges: false,

      addQuestion: (question) => {
        const { questions } = get();
        const newQuestion: OcrQuestion = {
          ...question,
          text: normalizeQuestionText(question.text),
          number: questions.length + 1,
          saved_at: new Date().toISOString(),
        };
        set({ questions: [...questions, newQuestion], hasUnsavedChanges: true });
      },

      addPlaceholders: (count: number) => {
        const { questions } = get();
        const startIndex = questions.length;
        const placeholders: OcrQuestion[] = Array.from({ length: count }, (_, i) => ({
          number: startIndex + i + 1,
          text: '',
          answer: '',
          explanation: '',
          isLoading: true,
          saved_at: new Date().toISOString(),
        }));
        set({ questions: [...questions, ...placeholders] });
        return startIndex;
      },

      updateQuestion: (index, updates) => {
        const { questions } = get();
        const updated = questions.map((q, i) => (i === index ? { ...q, ...updates } : q));
        set({ questions: updated, hasUnsavedChanges: true });
      },

      deleteQuestion: (index) => {
        const { questions } = get();
        const filtered = questions.filter((_, i) => i !== index).map((q, i) => ({ ...q, number: i + 1 }));
        set({ questions: filtered, hasUnsavedChanges: true });
      },

      deleteAllQuestions: () => {
        set({ questions: [], hasUnsavedChanges: true });
      },

      setQuestions: (questions) => {
        const numbered = questions.map((q, i) => ({ ...q, number: i + 1 }));
        set({ questions: numbered, hasUnsavedChanges: true });
      },

      reorderQuestions: (fromIndex, toIndex) => {
        const { questions } = get();
        const updated = [...questions];
        const [moved] = updated.splice(fromIndex, 1);
        updated.splice(toIndex, 0, moved);
        const renumbered = updated.map((q, i) => ({ ...q, number: i + 1 }));
        set({ questions: renumbered, hasUnsavedChanges: true });
      },

      mergeQuestions: (newQuestions) => {
        const { questions } = get();
        const merged = [...questions, ...newQuestions].map((q, i) => ({ ...q, number: i + 1 }));
        set({ questions: merged, hasUnsavedChanges: true });
      },

      markSaved: () => set({ hasUnsavedChanges: false }),
    }),
    {
      name: 'ocr-questions-storage',
      partialize: (state) => ({ questions: state.questions }),
    }
  )
);
