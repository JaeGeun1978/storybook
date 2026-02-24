import type { SelectionMode } from '../../lib/exam-ocr/types.ts';

interface OcrToolbarProps {
  selectionMode: SelectionMode;
  onSelectionModeChange: (mode: SelectionMode) => void;
  onProcessMultiRegions: () => void;
  pendingRegionCount: number;
  onAnalyzeExam: () => void;
  onImportJson: () => void;
  onExportJson: () => void;
  isProcessing: boolean;
}

export default function OcrToolbar({
  selectionMode,
  onSelectionModeChange,
  onProcessMultiRegions,
  pendingRegionCount,
  onAnalyzeExam,
  onImportJson,
  onExportJson,
  isProcessing,
}: OcrToolbarProps) {
  const modeButton = (mode: SelectionMode, label: string) => {
    const isActive = selectionMode === mode;
    return (
      <button
        onClick={() => onSelectionModeChange(isActive ? 'none' : mode)}
        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
          isActive
            ? 'bg-blue-600 text-white'
            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-white border-b border-gray-200">
      {/* 영역 선택 모드 */}
      <div className="flex items-center gap-1">
        {modeButton('single', '범위 설정')}
        {modeButton('formatting', '포맷팅 포함')}
        {modeButton('multi', '여러 영역')}
      </div>

      {/* 여러 영역 완료 버튼 */}
      {selectionMode === 'multi' && (
        <button
          onClick={onProcessMultiRegions}
          disabled={pendingRegionCount === 0 || isProcessing}
          className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing
            ? 'OCR 처리중...'
            : `영역 완료 (${pendingRegionCount}개)`}
        </button>
      )}

      {isProcessing && selectionMode !== 'multi' && (
        <span className="text-sm text-blue-600 flex items-center gap-1">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          OCR 처리중...
        </span>
      )}

      <div className="flex-1" />

      {/* 파일 작업 */}
      <div className="flex items-center gap-1">
        <button
          onClick={onAnalyzeExam}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          시험지 분석
        </button>
        <button
          onClick={onImportJson}
          className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          JSON 가져오기
        </button>
        <button
          onClick={onExportJson}
          className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          JSON 저장
        </button>
      </div>
    </div>
  );
}
