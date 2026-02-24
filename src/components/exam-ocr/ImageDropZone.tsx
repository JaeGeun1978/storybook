import { useCallback, useRef, useState, useEffect } from 'react';
import type { QueuedImage } from '../../lib/exam-ocr/types.ts';

interface ImageDropZoneProps {
  images: QueuedImage[];
  onImagesChange: (images: QueuedImage[]) => void;
  onSubmit: () => void;
  onPdfSelect: (file: File) => void;
  isProcessing: boolean;
}

export default function ImageDropZone({
  images,
  onImagesChange,
  onSubmit,
  onPdfSelect,
  isProcessing,
}: ImageDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (files: File[]) => {
      const imageFiles: File[] = [];

      for (const file of files) {
        if (file.type === 'application/pdf') {
          onPdfSelect(file);
          return;
        }
        if (file.type.startsWith('image/')) {
          imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) return;

      const readPromises = imageFiles.map(
        (file) =>
          new Promise<QueuedImage>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                dataUrl: reader.result as string,
                name: file.name,
              });
            };
            reader.readAsDataURL(file);
          })
      );

      Promise.all(readPromises).then((newImages) => {
        onImagesChange([...images, ...newImages]);
      });
    },
    [images, onImagesChange, onPdfSelect]
  );

  // 클립보드 붙여넣기
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            imageFiles.push(
              new File([blob], `paste-${Date.now()}.png`, { type: blob.type })
            );
          }
        }
      }
      if (imageFiles.length > 0) {
        addFiles(imageFiles);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files: File[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        files.push(e.dataTransfer.files[i]);
      }
      addFiles(files);
    },
    [addFiles]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList) return;
      const files: File[] = [];
      for (let i = 0; i < fileList.length; i++) {
        files.push(fileList[i]);
      }
      addFiles(files);
      e.target.value = '';
    },
    [addFiles]
  );

  const removeImage = useCallback(
    (id: string) => {
      onImagesChange(images.filter((img) => img.id !== id));
    },
    [images, onImagesChange]
  );

  const clearAll = useCallback(() => {
    onImagesChange([]);
  }, [onImagesChange]);

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`
          relative flex flex-col items-center justify-center
          border-2 border-dashed rounded-xl p-6 cursor-pointer
          transition-all duration-200
          ${images.length > 0 ? 'min-h-[100px]' : 'min-h-[200px]'}
          ${
            isDragging
              ? 'border-blue-500 bg-blue-50 scale-[1.01]'
              : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50'
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          name="ocr-file-input"
          type="file"
          accept="image/*,.pdf"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <svg
          className={`w-8 h-8 mb-2 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>

        <p className="text-sm font-medium text-gray-700 mb-1">
          {isDragging
            ? '여기에 놓으세요!'
            : images.length > 0
            ? '이미지 추가하기'
            : '이미지를 가져오세요'}
        </p>
        <p className="text-xs text-gray-500 text-center">
          <span className="font-medium text-blue-600">Ctrl+V</span> 붙여넣기 |{' '}
          <span className="font-medium text-blue-600">드래그앤드롭</span> |{' '}
          <span className="font-medium text-blue-600">클릭</span> 파일선택
          <span className="text-gray-400 ml-2">| PNG, JPG, PDF</span>
        </p>
      </div>

      {images.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">
              <span className="font-bold text-blue-600">{images.length}</span>장 선택됨
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
              className="text-xs text-red-500 hover:text-red-700"
            >
              전체 삭제
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
            {images.map((img, idx) => (
              <div
                key={img.id}
                className="relative group aspect-square rounded-lg overflow-hidden border border-gray-200 bg-white"
              >
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-full h-full object-cover"
                />
                <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                  {idx + 1}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeImage(img.id);
                  }}
                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                >
                  x
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onSubmit();
            }}
            disabled={isProcessing}
            className={`
              w-full py-3 rounded-xl text-white font-bold text-base transition-all
              ${
                isProcessing
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.99]'
              }
            `}
          >
            {isProcessing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                OCR 처리중...
              </span>
            ) : (
              `전송 (${images.length}장)`
            )}
          </button>
        </div>
      )}
    </div>
  );
}
