import { create } from 'zustand';
import type { Question, UploadedImage } from './types.ts';
import { normalizeQuestionText } from './normalizeQuestion.ts';

interface QuestionStore {
  questions: Question[];
  currentImage: UploadedImage | null;
  hasUnsavedChanges: boolean;

  setCurrentImage: (image: UploadedImage | null) => void;
  addQuestion: (question: Omit<Question, 'number'>) => void;
  addPlaceholders: (count: number) => number;
  updateQuestion: (index: number, question: Partial<Question>) => void;
  deleteQuestion: (index: number) => void;
  deleteAllQuestions: () => void;
  setQuestions: (questions: Question[]) => void;
  reorderQuestions: (fromIndex: number, toIndex: number) => void;
  mergeQuestions: (newQuestions: Question[]) => void;
  markSaved: () => void;
}

// persist 없이 순수 Zustand 스토어 (React 19 + Zustand 5 호환 문제 해결)
export const useQuestionStore = create<QuestionStore>()(
  (set, get) => ({
      questions: [],
      currentImage: null,
      hasUnsavedChanges: false,

      setCurrentImage: (image) => set({ currentImage: image }),

      addQuestion: (question) => {
        const { questions } = get();
        const newQuestion: Question = {
          ...question,
          text: normalizeQuestionText(question.text),
          number: questions.length + 1,
          saved_at: new Date().toISOString(),
        };
        console.log('[Store] addQuestion - 새 문제 추가, #' + newQuestion.number, '텍스트 길이:', newQuestion.text.length);
        const newQuestions = [...questions, newQuestion];
        set({ questions: newQuestions, hasUnsavedChanges: true });
        console.log('[Store] addQuestion 후 확인 - get().questions.length:', get().questions.length);
      },

      addPlaceholders: (count: number) => {
        const { questions } = get();
        const startIndex = questions.length;
        const placeholders: Question[] = Array.from({ length: count }, (_, i) => ({
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
        if (index < 0 || index >= questions.length) {
          console.error('[Store] updateQuestion - 잘못된 인덱스:', index, '(전체:', questions.length, '개)');
          return;
        }
        const updated = questions.map((q, i) =>
          i === index ? { ...q, ...updates } : q
        );
        console.log('[Store] updateQuestion - #' + (index + 1), 'isLoading:', updates.isLoading, '텍스트 길이:', updates.text?.length);
        set({ questions: updated, hasUnsavedChanges: true });
      },

      deleteQuestion: (index) => {
        const { questions } = get();
        const filtered = questions
          .filter((_, i) => i !== index)
          .map((q, i) => ({ ...q, number: i + 1 }));
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
        const merged = [...questions, ...newQuestions].map((q, i) => ({
          ...q,
          number: i + 1,
        }));
        set({ questions: merged, hasUnsavedChanges: true });
      },

      markSaved: () => set({ hasUnsavedChanges: false }),
    })
);

// localStorage 수동 persist (persist 미들웨어 대체)
const STORAGE_KEY = 'exam-questions-storage';

// 하이드레이션: 앱 시작 시 localStorage에서 복원
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    if (parsed?.state?.questions?.length > 0) {
      useQuestionStore.setState({ questions: parsed.state.questions });
      console.log('[Store] localStorage에서 복원:', parsed.state.questions.length, '개');
    }
  }
} catch (e) {
  console.warn('[Store] localStorage 복원 실패:', e);
}

// 상태 변경 시 localStorage에 저장
useQuestionStore.subscribe((state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { questions: state.questions } }));
  } catch (e) {
    console.warn('[Store] localStorage 저장 실패:', e);
  }
});

// 디버깅용: 브라우저 콘솔에서 __store.getState().questions 으로 확인 가능
(window as unknown as Record<string, unknown>).__store = useQuestionStore;
