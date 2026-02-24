import { useState, useEffect, useCallback, useRef } from 'react';

interface PdfViewerProps {
  file: File;
  onPageImage: (dataUrl: string, pageNum: number, totalPages: number) => void;
}

export default function PdfViewer({ file, onPageImage }: PdfViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const pdfDocRef = useRef<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setIsLoading(true);

      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      if (cancelled) return;

      pdfDocRef.current = pdf;
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
      setIsLoading(false);

      await renderPage(pdf, 1);
    }

    loadPdf();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const renderPage = useCallback(
    async (pdf: unknown, pageNum: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfDoc = pdf as any;
      const page = await pdfDoc.getPage(pageNum);
      const scale = 2;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const dataUrl = canvas.toDataURL('image/png');
      onPageImage(dataUrl, pageNum, pdfDoc.numPages);
    },
    [onPageImage]
  );

  const goToPage = useCallback(
    async (pageNum: number) => {
      if (!pdfDocRef.current || pageNum < 1 || pageNum > totalPages) return;
      setCurrentPage(pageNum);
      await renderPage(pdfDocRef.current, pageNum);
    },
    [totalPages, renderPage]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-500">
        <svg className="animate-spin w-5 h-5 mr-2" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        PDF 로딩 중...
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage <= 1}
        className="px-3 py-1.5 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        이전
      </button>
      <span className="text-gray-600 min-w-[80px] text-center">
        {currentPage} / {totalPages} 페이지
      </span>
      <button
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="px-3 py-1.5 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        다음
      </button>
    </div>
  );
}
