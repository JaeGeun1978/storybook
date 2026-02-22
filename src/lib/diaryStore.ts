/**
 * 📓 영어일기 데이터 관리
 * 
 * localStorage 기반 일기 CRUD
 */

export interface DiaryVocab {
    word: string;       // 영어 단어/구동사/이디엄
    meaning: string;    // 한글 뜻
    type: 'word' | 'phrase' | 'idiom'; // 유형
}

export interface DiarySentence {
    english: string;    // 영어 문장
    korean: string;     // 한글 번역
}

export interface DiaryEntry {
    id: string;
    title: string;
    koreanInput: string;       // 사용자가 입력한 한글 원문
    sentences: DiarySentence[]; // 변환된 영어 문장들 (최대 30문장)
    vocabulary: DiaryVocab[];   // 단어/구동사/이디엄 목록
    status: 'draft' | 'generated' | 'completed';
    createdAt: number;
    updatedAt: number;
}

const STORAGE_KEY = 'jaegeun_diary_entries';

export const getDiaries = (): DiaryEntry[] => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
        return JSON.parse(stored) as DiaryEntry[];
    } catch {
        return [];
    }
};

export const saveDiary = (diary: DiaryEntry) => {
    const diaries = getDiaries();
    const index = diaries.findIndex(d => d.id === diary.id);
    if (index >= 0) {
        diaries[index] = diary;
    } else {
        diaries.push(diary);
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(diaries));
    } catch (e) {
        console.error('[DiaryStore] localStorage 저장 실패:', e);
    }
    window.dispatchEvent(new Event('diaries-changed'));
};

export const deleteDiary = (id: string) => {
    const diaries = getDiaries().filter(d => d.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diaries));
    window.dispatchEvent(new Event('diaries-changed'));
};

export const getDiaryById = (id: string): DiaryEntry | undefined => {
    return getDiaries().find(d => d.id === id);
};

export const createNewDiary = (): DiaryEntry => {
    const entry: DiaryEntry = {
        id: crypto.randomUUID(),
        title: 'My English Diary',
        koreanInput: '',
        sentences: [],
        vocabulary: [],
        status: 'draft',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    saveDiary(entry);
    return entry;
};
