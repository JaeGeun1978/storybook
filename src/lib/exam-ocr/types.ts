export interface Question {
  number: number;
  text: string;
  answer: string;
  explanation: string;
  page?: number;
  region?: [number, number, number, number];
  source?: string;
  saved_at?: string;
  isLoading?: boolean;
}

export interface QuestionData {
  metadata: {
    source_pdf: string;
    extraction_date: string;
    total_questions: number;
  };
  questions: Question[];
}

export interface UploadedImage {
  id: string;
  file?: File;
  dataUrl: string;
  name: string;
  type: 'image' | 'pdf';
  pdfPageCount?: number;
  currentPdfPage?: number;
}

export type SelectionMode = 'none' | 'single' | 'formatting' | 'multi';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QueuedImage {
  id: string;
  dataUrl: string;
  name: string;
}
