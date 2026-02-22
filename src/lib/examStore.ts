/**
 * 📝 영어지문설명 데이터 관리
 * 
 * 고등학생 모의고사 영어 지문 분석 & 영상 제작
 * localStorage 기반 CRUD
 */

export interface ExamSegment {
    id: string;
    segmentId: number;              // 1~5
    segmentRole: string;            // "Introduction", "Development 1", etc.
    imagePrompt: string;            // 이미지 생성용 프롬프트
    imageUrl?: string;              // 생성된 이미지 (메모리 전용)
    scriptMaleOriginal: string;     // 남자 선생님: 원문 읽기 (영어)
    scriptFemaleSimplified: string; // 여자 선생님: 쉬운 설명 (영어)
    scriptMaleExplanation: string;  // 남자 선생님: 어휘/문법 해설 (영어)
    audioMaleOriginal?: string;     // TTS blob URL (메모리 전용)
    audioFemaleSimplified?: string;
    audioMaleExplanation?: string;
    koreanTranslation?: string;     // PDF 한줄해석용 한글 번역
}

export interface ExamEntry {
    id: string;
    title: string;
    passage: string;                // 원본 영어 지문
    segments: ExamSegment[];
    characterGuide?: string;
    status: 'draft' | 'analyzing' | 'completed';
    createdAt: number;
    updatedAt: number;
    finalVideoUrl?: string;         // 메모리 전용
}

const STORAGE_KEY = 'jaegeun_exam_entries';

/** 저장 시 미디어 URL 제거 (localStorage 용량 절약) */
function stripMedia(entry: ExamEntry): ExamEntry {
    return {
        ...entry,
        finalVideoUrl: undefined,
        segments: entry.segments.map(seg => ({
            ...seg,
            imageUrl: undefined,
            audioMaleOriginal: undefined,
            audioFemaleSimplified: undefined,
            audioMaleExplanation: undefined,
        })),
    };
}

export const getExams = (): ExamEntry[] => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
        return JSON.parse(stored) as ExamEntry[];
    } catch {
        return [];
    }
};

export const saveExam = (entry: ExamEntry) => {
    const exams = getExams();
    const idx = exams.findIndex(e => e.id === entry.id);
    const lightweight = stripMedia(entry);

    if (idx >= 0) {
        exams[idx] = lightweight;
    } else {
        exams.push(lightweight);
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(exams));
    } catch (e) {
        console.error('[ExamStore] localStorage 저장 실패:', e);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify([lightweight]));
            console.warn('[ExamStore] 기존 항목 삭제 후 현재만 저장됨');
        } catch {
            console.error('[ExamStore] localStorage 완전 실패');
        }
    }
    window.dispatchEvent(new Event('exams-changed'));
};

export const deleteExam = (id: string) => {
    const exams = getExams().filter(e => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exams));
    window.dispatchEvent(new Event('exams-changed'));
};

export const getExamById = (id: string): ExamEntry | undefined => {
    return getExams().find(e => e.id === id);
};

export const createNewExam = (): ExamEntry => {
    const entry: ExamEntry = {
        id: crypto.randomUUID(),
        title: 'New Passage Analysis',
        passage: '',
        segments: [],
        status: 'draft',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    saveExam(entry);
    return entry;
};
