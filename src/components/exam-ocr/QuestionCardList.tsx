import { useQuestionStore } from '../../lib/exam-ocr/useQuestionStore.ts';
import QuestionCard from './QuestionCard.tsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { mergeAnswerIntoText, parseBatchAnswerResponse } from '../../lib/exam-ocr/answerMerge.ts';
import { getAnswer, getBatchAnswer } from '../../lib/exam-ocr/ocrApi.ts';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

export default function QuestionCardList() {
  // Manual subscription: bypasses useSyncExternalStore to fix
  // React 19 + Zustand v5 + StrictMode re-render issue
  const [questions, setQuestions] = useState(() => useQuestionStore.getState().questions);
  useEffect(() => {
    setQuestions(useQuestionStore.getState().questions);
    return useQuestionStore.subscribe((state) => {
      setQuestions(state.questions);
    });
  }, []);

  const updateQuestion = useQuestionStore.getState().updateQuestion;
  const deleteQuestion = useQuestionStore.getState().deleteQuestion;
  const deleteAllQuestions = useQuestionStore.getState().deleteAllQuestions;
  const reorderQuestions = useQuestionStore.getState().reorderQuestions;
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [loadingAnswerIndices, setLoadingAnswerIndices] = useState<Set<number>>(new Set());

  console.log('[CardList] 렌더링, questions:', questions.length);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortableIds = useMemo(
    () => questions.map((_q, i) => `card-${i}`),
    [questions]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortableIds.indexOf(active.id as string);
      const newIndex = sortableIds.indexOf(over.id as string);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderQuestions(oldIndex, newIndex);
        setSelectedIndices(new Set());
      }
    },
    [sortableIds, reorderQuestions]
  );

  const handleToggleSelect = useCallback((index: number, selected: boolean) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    if (selectedIndices.size === questions.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(questions.map((_q, i) => i)));
    }
  }, [selectedIndices.size, questions]);

  // 일괄 정답/해설
  const handleBatchGetAnswer = useCallback(async () => {
    if (selectedIndices.size === 0) return;

    const indices = Array.from(selectedIndices).sort((a, b) => a - b);
    const texts = indices.map((i) => questions[i].text);

    setIsBatchLoading(true);
    console.log('[BatchAnswer] 일괄 요청:', indices.length, '개 문제');

    try {
      const responseText = await getBatchAnswer(texts);
      console.log('[BatchAnswer] 응답 수신, 길이:', responseText?.length);

      if (responseText && responseText.trim()) {
        const parsed = parseBatchAnswerResponse(responseText, indices.length);
        console.log('[BatchAnswer] 파싱 결과:', parsed.length, '개');
        indices.forEach((cardIndex, i) => {
          if (parsed[i]) {
            const merged = mergeAnswerIntoText(questions[cardIndex].text, parsed[i]);
            updateQuestion(cardIndex, { text: merged });
          }
        });
      } else {
        console.warn('[BatchAnswer] 빈 응답 수신');
      }
    } catch (error) {
      console.error('일괄 정답/해설 가져오기 실패:', error);
      alert('일괄 정답/해설 가져오기에 실패했습니다.');
    } finally {
      setIsBatchLoading(false);
      setSelectedIndices(new Set());
    }
  }, [selectedIndices, questions, updateQuestion]);

  // 개별 정답/해설
  const handleGetAnswer = useCallback(
    async (index: number) => {
      setLoadingAnswerIndices((prev) => new Set(prev).add(index));

      try {
        const currentText = questions[index]?.text;
        if (!currentText) {
          console.warn('[Answer] 문제 텍스트가 비어있음, index:', index);
          return;
        }
        console.log('[Answer] 정답/해설 요청, index:', index, '텍스트 길이:', currentText.length);

        const responseText = await getAnswer(currentText);
        console.log('[Answer] 응답 수신, 길이:', responseText?.length);

        if (responseText && responseText.trim()) {
          const merged = mergeAnswerIntoText(currentText, responseText);
          console.log('[Answer] 병합 결과 길이:', merged.length);
          updateQuestion(index, { text: merged });
        } else {
          console.warn('[Answer] 빈 응답 수신');
        }
      } catch (error) {
        console.error('정답/해설 가져오기 실패:', error);
        alert('정답/해설 가져오기에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
      } finally {
        setLoadingAnswerIndices((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      }
    },
    [questions, updateQuestion]
  );

  if (questions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p className="text-lg mb-1">문제가 없습니다</p>
        <p className="text-sm">이미지에서 영역을 선택하여 OCR을 실행하세요</p>
      </div>
    );
  }

  const isAllSelected = selectedIndices.size === questions.length;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              총 <span className="font-bold text-blue-600">{questions.length}</span>개 문제
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                name="select-all-questions"
                checked={isAllSelected}
                onChange={handleToggleAll}
                className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-500">전체선택</span>
            </label>
          </div>
          <button
            onClick={() => {
              if (confirm('모든 문제를 삭제하시겠습니까?')) {
                deleteAllQuestions();
              }
            }}
            className="px-2 py-1 text-xs text-red-600 bg-red-50 rounded hover:bg-red-100"
          >
            전체 삭제
          </button>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {questions.map((q, i) => (
              <QuestionCard
                key={`card-${i}`}
                id={`card-${i}`}
                number={q.number}
                text={q.text}
                isLoading={q.isLoading}
                isSelected={selectedIndices.has(i)}
                onSelect={(selected) => handleToggleSelect(i, selected)}
                onUpdate={(text) => updateQuestion(i, { text })}
                onDelete={() => {
                  if (confirm(`문제 #${q.number}을 삭제하시겠습니까?`)) {
                    deleteQuestion(i);
                    setSelectedIndices((prev) => {
                      const next = new Set<number>();
                      prev.forEach((idx) => {
                        if (idx < i) next.add(idx);
                        else if (idx > i) next.add(idx - 1);
                      });
                      return next;
                    });
                  }
                }}
                onGetAnswer={() => handleGetAnswer(i)}
                isLoadingAnswer={(isBatchLoading && selectedIndices.has(i)) || loadingAnswerIndices.has(i)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {selectedIndices.size > 0 && (
        <button
          onClick={handleBatchGetAnswer}
          disabled={isBatchLoading}
          className="fixed bottom-6 right-6 z-50 px-5 py-3 text-sm font-bold text-white bg-green-600 rounded-full shadow-lg hover:bg-green-700 disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
        >
          {isBatchLoading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              분석중...
            </span>
          ) : (
            `선택 정답/해설 (${selectedIndices.size}개)`
          )}
        </button>
      )}
    </>
  );
}
