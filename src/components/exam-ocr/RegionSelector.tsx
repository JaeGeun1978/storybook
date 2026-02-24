import { useRef, useState, useCallback, useEffect } from 'react';
import type { Region, SelectionMode } from '../../lib/exam-ocr/types.ts';

interface RegionSelectorProps {
  imageDataUrl: string;
  selectionMode: SelectionMode;
  onRegionSelected: (regions: Region[]) => void;
  pendingRegions?: Region[];
  onPendingRegionsChange?: (regions: Region[]) => void;
}

export default function RegionSelector({
  imageDataUrl,
  selectionMode,
  onRegionSelected,
  pendingRegions = [],
  onPendingRegionsChange,
}: RegionSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
    if (imageRef.current) {
      drawCanvas(imageRef.current, zoom, currentRect, pendingRegions);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, pendingRegions, currentRect]);

  const drawCanvas = useCallback(
    (img: HTMLImageElement, z: number, rect: Region | null, regions: Region[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const displayWidth = Math.round(img.width * z);
      const displayHeight = Math.round(img.height * z);

      canvas.width = displayWidth;
      canvas.height = displayHeight;

      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, displayWidth, displayHeight);
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

      for (const region of regions) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
        ctx.fillRect(region.x * z, region.y * z, region.width * z, region.height * z);
        ctx.strokeRect(region.x * z, region.y * z, region.width * z, region.height * z);
      }

      if (rect) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(rect.x * z, rect.y * z, rect.width * z, rect.height * z);
        ctx.strokeRect(rect.x * z, rect.y * z, rect.width * z, rect.height * z);
        ctx.setLineDash([]);
      }
    },
    []
  );

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / zoom,
        y: (e.clientY - rect.top) / zoom,
      };
    },
    [zoom]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (selectionMode === 'none') return;
      const coords = getCanvasCoords(e);
      setIsDragging(true);
      setDragStart(coords);
      setCurrentRect(null);
    },
    [selectionMode, getCanvasCoords]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !dragStart) return;
      const coords = getCanvasCoords(e);
      const rect: Region = {
        x: Math.min(dragStart.x, coords.x),
        y: Math.min(dragStart.y, coords.y),
        width: Math.abs(coords.x - dragStart.x),
        height: Math.abs(coords.y - dragStart.y),
      };
      setCurrentRect(rect);
    },
    [isDragging, dragStart, getCanvasCoords]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !currentRect) {
      setIsDragging(false);
      return;
    }

    setIsDragging(false);
    setDragStart(null);

    if (currentRect.width < 10 || currentRect.height < 10) {
      setCurrentRect(null);
      return;
    }

    if (selectionMode === 'multi') {
      const newRegions = [...pendingRegions, currentRect];
      onPendingRegionsChange?.(newRegions);
    } else {
      onRegionSelected([currentRect]);
    }

    setCurrentRect(null);
  }, [isDragging, currentRect, selectionMode, pendingRegions, onRegionSelected, onPendingRegionsChange]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        setZoom((prev) => Math.max(0.3, Math.min(5, prev * factor)));
      }
    },
    []
  );

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => setZoom((z) => Math.max(0.3, z * 0.8))}
          className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
        >
          축소
        </button>
        <span className="text-gray-600 min-w-[60px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
          className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
        >
          확대
        </button>
        <button
          onClick={() => setZoom(1)}
          className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
        >
          원본
        </button>
        {selectionMode !== 'none' && (
          <span className="ml-4 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
            {selectionMode === 'single'
              ? '영역 선택'
              : selectionMode === 'formatting'
              ? '포맷팅 영역 선택'
              : '여러 영역 선택'}
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="overflow-auto border border-gray-300 rounded-lg bg-gray-100 flex-1 min-h-0"
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          className={`${selectionMode !== 'none' ? 'cursor-crosshair' : 'cursor-default'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (isDragging) handleMouseUp();
          }}
        />
      </div>

      <div className="text-xs text-gray-400 flex gap-4">
        <span>원본: {imageSize.width} x {imageSize.height}px</span>
        <span>Ctrl + 스크롤로 확대/축소</span>
      </div>
    </div>
  );
}
