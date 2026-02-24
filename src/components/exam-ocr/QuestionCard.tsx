import { useRef, useCallback, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface QuestionCardProps {
  id: string;
  number: number;
  text: string;
  isLoading?: boolean;
  isSelected?: boolean;
  onSelect?: (selected: boolean) => void;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  onGetAnswer?: () => void;
  isLoadingAnswer?: boolean;
}

const CIRCLE_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const CIRCLE_LETTERS = ['ⓐ', 'ⓑ', 'ⓒ', 'ⓓ', 'ⓔ', 'ⓕ', 'ⓖ', 'ⓗ', 'ⓘ', 'ⓙ'];
const CIRCLE_KOREAN = ['㉠', '㉡', '㉢', '㉣', '㉤'];

export default function QuestionCard({
  id,
  number,
  text,
  isLoading = false,
  isSelected = false,
  onSelect,
  onUpdate,
  onDelete,
  onGetAnswer,
  isLoadingAnswer = false,
}: QuestionCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: isLoading });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const insertChar = useCallback(
    (char: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newText = text.slice(0, start) + char + text.slice(end);
      onUpdate(newText);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(start + char.length, start + char.length);
      });
    },
    [text, onUpdate]
  );

  const applyFormat = useCallback(
    (format: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = text.slice(start, end);

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

      const newText = text.slice(0, start) + wrapped + text.slice(end);
      onUpdate(newText);
    },
    [text, onUpdate]
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border border-gray-200 rounded-lg bg-white shadow-sm ${isDragging ? 'shadow-lg' : ''}`}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
        <div className="flex items-center gap-2">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none"
            title="드래그하여 순서 변경"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="5" cy="3" r="1.5" />
              <circle cx="11" cy="3" r="1.5" />
              <circle cx="5" cy="8" r="1.5" />
              <circle cx="11" cy="8" r="1.5" />
              <circle cx="5" cy="13" r="1.5" />
              <circle cx="11" cy="13" r="1.5" />
            </svg>
          </button>
          {onSelect && (
            <input
              type="checkbox"
              name={`select-card-${id}`}
              checked={isSelected}
              disabled={isLoading}
              onChange={(e) => onSelect(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
            />
          )}
          <span className="font-bold text-blue-600 text-sm">#{number}</span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            {isExpanded ? '접기' : '펼치기'}
          </button>
        </div>

        <div className="flex items-center gap-1">
          {isLoadingAnswer ? (
            <span className="text-xs text-green-600 animate-pulse flex items-center gap-1">
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              분석중...
            </span>
          ) : onGetAnswer ? (
            <button
              onClick={onGetAnswer}
              disabled={isLoading}
              className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100 disabled:opacity-50"
              title="정답/해설"
            >
              정답/해설
            </button>
          ) : null}
          <button
            onClick={onDelete}
            disabled={isLoading}
            className="px-2 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200 disabled:opacity-50"
            title="삭제"
          >
            삭제
          </button>
        </div>
      </div>

      {isExpanded && (
        isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-gray-400">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">OCR 처리중...</span>
          </div>
        ) : (
          <>
            {/* 도구바 */}
            <div className="flex flex-wrap items-center gap-1 px-3 py-1.5 border-b border-gray-100 bg-gray-50/50">
              <div className="flex gap-0.5">
                {CIRCLE_NUMBERS.slice(0, 5).map((c) => (
                  <button key={c} onClick={() => insertChar(c)} className="w-6 h-6 text-xs rounded hover:bg-blue-100 text-center" title={c}>{c}</button>
                ))}
              </div>
              <span className="text-gray-300">|</span>
              <div className="flex gap-0.5">
                {CIRCLE_LETTERS.slice(0, 5).map((c) => (
                  <button key={c} onClick={() => insertChar(c)} className="w-6 h-6 text-xs rounded hover:bg-purple-100 text-center" title={c}>{c}</button>
                ))}
              </div>
              <span className="text-gray-300">|</span>
              <div className="flex gap-0.5">
                {CIRCLE_KOREAN.map((c) => (
                  <button key={c} onClick={() => insertChar(c)} className="w-6 h-6 text-xs rounded hover:bg-orange-100 text-center" title={c}>{c}</button>
                ))}
              </div>
              <span className="text-gray-300">|</span>
              <button onClick={() => applyFormat('underline')} className="px-1.5 py-0.5 text-xs rounded hover:bg-gray-200 underline" title="밑줄">U</button>
              <button onClick={() => applyFormat('bold')} className="px-1.5 py-0.5 text-xs rounded hover:bg-gray-200 font-bold" title="볼드">B</button>
              <button onClick={() => applyFormat('underline_bold')} className="px-1.5 py-0.5 text-xs rounded hover:bg-gray-200 underline font-bold" title="밑줄+볼드">UB</button>
              <button onClick={() => applyFormat('table')} className="px-1.5 py-0.5 text-xs rounded hover:bg-gray-200" title="표">표</button>
            </div>

            {/* 텍스트 에디터 */}
            <textarea
              ref={textareaRef}
              name={`question-text-${id}`}
              value={text}
              onChange={(e) => onUpdate(e.target.value)}
              className="w-full p-3 text-sm font-mono resize-y min-h-[120px] max-h-[400px] border-0 focus:outline-none focus:ring-0"
              placeholder="[문제] 문제 내용을 입력하세요..."
            />
          </>
        )
      )}
    </div>
  );
}
