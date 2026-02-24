import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuestionStore } from '../lib/exam-ocr/useQuestionStore.ts';
import { downloadJson } from '../lib/exam-ocr/exportJson.ts';
import { mergeAnswerIntoText } from '../lib/exam-ocr/answerMerge.ts';
import { getAnswer } from '../lib/exam-ocr/ocrApi.ts';

const CIRCLE_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const CIRCLE_LETTERS = ['ⓐ', 'ⓑ', 'ⓒ', 'ⓓ', 'ⓔ', 'ⓕ', 'ⓖ', 'ⓗ', 'ⓘ', 'ⓙ'];
const CIRCLE_KOREAN = ['㉠', '㉡', '㉢', '㉣', '㉤'];

export function ExamReviewPage() {
  const navigate = useNavigate();

  // ★ 수동 구독: useSyncExternalStore 우회 (React 19 + Zustand 5 호환)
  const [questions, setLocalQuestions] = useState(() => useQuestionStore.getState().questions);
  useEffect(() => {
    setLocalQuestions(useQuestionStore.getState().questions);
    return useQuestionStore.subscribe((state) => {
      setLocalQuestions(state.questions);
    });
  }, []);

  const updateQuestion = useCallback(
    (index: number, updates: Partial<import('../lib/exam-ocr/types.ts').Question>) =>
      useQuestionStore.getState().updateQuestion(index, updates), []
  );
  const deleteQuestion = useCallback(
    (index: number) => useQuestionStore.getState().deleteQuestion(index), []
  );
  const markSaved = useCallback(
    () => useQuestionStore.getState().markSaved(), []
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoadingAnswer, setIsLoadingAnswer] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const question = questions[currentIndex];
  const total = questions.length;

  // 키보드 단축키
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement === textareaRef.current) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentIndex((prev) => Math.min(total - 1, prev + 1));
      } else if (e.key === 'Escape') {
        navigate('/exam-ocr');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [total, navigate]);

  const handleUpdate = useCallback(
    (text: string) => {
      updateQuestion(currentIndex, { text });
    },
    [currentIndex, updateQuestion]
  );

  const handleDelete = useCallback(() => {
    if (!confirm(`문제 #${question?.number}을 삭제하시겠습니까?`)) return;
    deleteQuestion(currentIndex);
    if (currentIndex >= questions.length - 1 && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex, question, deleteQuestion, questions.length]);

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

  const handleGetAnswer = useCallback(async () => {
    if (!question) return;
    setIsLoadingAnswer(true);

    try {
      const responseText = await getAnswer(question.text);
      if (responseText) {
        const merged = mergeAnswerIntoText(question.text, responseText);
        updateQuestion(currentIndex, { text: merged });
      }
    } catch (error) {
      console.error('정답/해설 가져오기 실패:', error);
    } finally {
      setIsLoadingAnswer(false);
    }
  }, [question, currentIndex, updateQuestion]);

  const insertChar = useCallback(
    (char: string) => {
      const textarea = textareaRef.current;
      if (!textarea || !question) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = question.text;
      const newText = text.slice(0, start) + char + text.slice(end);
      handleUpdate(newText);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start + char.length, start + char.length);
      });
    },
    [question, handleUpdate]
  );

  const applyFormat = useCallback(
    (format: string) => {
      const textarea = textareaRef.current;
      if (!textarea || !question) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = question.text.slice(start, end);
      if (!selected) return;

      let wrapped: string;
      switch (format) {
        case 'underline':
          wrapped = `**${selected}**`;
          break;
        case 'bold':
          wrapped = `***${selected}***`;
          break;
        case 'underline_bold':
          wrapped = `##${selected}##`;
          break;
        case 'table':
          wrapped = `<table>${selected}</table>`;
          break;
        default:
          return;
      }

      const newText = question.text.slice(0, start) + wrapped + question.text.slice(end);
      handleUpdate(newText);
    },
    [question, handleUpdate]
  );

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 text-gray-900">
        <div className="text-center">
          <p className="text-xl text-gray-500 mb-4">검수할 문제가 없습니다</p>
          <button
            onClick={() => navigate('/exam-ocr')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900">
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/exam-ocr')} className="px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">돌아가기</button>
          <h1 className="text-lg font-bold text-gray-800">검수 모드</h1>
          <button onClick={handleExportJson} className="px-3 py-1.5 text-sm text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100">JSON 저장</button>
        </div>

        {/* 네비게이션 */}
        <div className="flex items-center gap-3">
          <button onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))} disabled={currentIndex <= 0} className="px-4 py-1.5 text-sm bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed">이전</button>
          <span className="text-sm font-medium text-gray-700 min-w-[100px] text-center">
            <span className="text-blue-600 font-bold text-lg">{currentIndex + 1}</span>
            <span className="text-gray-400 mx-1">/</span>
            <span>{total}</span>
          </span>
          <button onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))} disabled={currentIndex >= total - 1} className="px-4 py-1.5 text-sm bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed">다음</button>
        </div>

        {/* 도구 */}
        <div className="flex items-center gap-2">
          {isLoadingAnswer ? (
            <span className="px-3 py-1.5 text-sm text-green-600 flex items-center gap-1.5">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              분석중...
            </span>
          ) : (
            <button onClick={handleGetAnswer} className="px-3 py-1.5 text-sm text-green-700 bg-green-50 rounded-lg hover:bg-green-100">정답/해설</button>
          )}
          <button onClick={handleDelete} className="px-3 py-1.5 text-sm bg-red-100 text-red-600 rounded-lg hover:bg-red-200">삭제</button>
        </div>
      </div>

      {/* 문제 번호 점 네비게이션 */}
      <div className="flex items-center gap-1 px-6 py-2 bg-gray-50 border-b border-gray-100 overflow-x-auto flex-shrink-0">
        {questions.map((_q, i) => (
          <button
            key={i}
            onClick={() => setCurrentIndex(i)}
            className={`w-8 h-8 rounded-full text-xs font-medium transition-all flex-shrink-0 ${
              i === currentIndex ? 'bg-blue-600 text-white scale-110' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* 도구바: 원문자 & 서식 */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-2 bg-white border-b border-gray-100 flex-shrink-0">
        <div className="flex gap-0.5">
          {CIRCLE_NUMBERS.slice(0, 5).map((c) => (
            <button key={c} onClick={() => insertChar(c)} className="w-8 h-8 text-sm rounded hover:bg-blue-100 text-center">{c}</button>
          ))}
        </div>
        <span className="text-gray-300">|</span>
        <div className="flex gap-0.5">
          {CIRCLE_LETTERS.slice(0, 5).map((c) => (
            <button key={c} onClick={() => insertChar(c)} className="w-8 h-8 text-sm rounded hover:bg-purple-100 text-center">{c}</button>
          ))}
        </div>
        <span className="text-gray-300">|</span>
        <div className="flex gap-0.5">
          {CIRCLE_KOREAN.map((c) => (
            <button key={c} onClick={() => insertChar(c)} className="w-8 h-8 text-sm rounded hover:bg-orange-100 text-center">{c}</button>
          ))}
        </div>
        <span className="text-gray-300">|</span>
        <button onClick={() => applyFormat('underline')} className="px-2 py-1 text-sm rounded hover:bg-gray-200 underline">U</button>
        <button onClick={() => applyFormat('bold')} className="px-2 py-1 text-sm rounded hover:bg-gray-200 font-bold">B</button>
        <button onClick={() => applyFormat('underline_bold')} className="px-2 py-1 text-sm rounded hover:bg-gray-200 underline font-bold">UB</button>
        <button onClick={() => applyFormat('table')} className="px-2 py-1 text-sm rounded hover:bg-gray-200">표</button>
        <span className="text-xs text-gray-400 ml-4">방향키로 문제 이동 | Esc로 돌아가기</span>
      </div>

      {/* 문제 편집 영역 */}
      <div className="flex-1 p-6 min-h-0">
        <textarea
          ref={textareaRef}
          name="review-question-text"
          value={question?.text ?? ''}
          onChange={(e) => handleUpdate(e.target.value)}
          className="w-full h-full p-6 text-base font-mono leading-relaxed rounded-xl border border-gray-200 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="[문제] 문제 내용..."
        />
      </div>
    </div>
  );
}
