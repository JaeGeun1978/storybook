import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

export const useQuestionStore = create<QuestionStore>()(
  persist(
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
        set({ questions: [...questions, newQuestion], hasUnsavedChanges: true });
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
    }),
    {
      name: 'exam-questions-storage',
      partialize: (state) => ({ questions: state.questions }),
    }
  )
);
