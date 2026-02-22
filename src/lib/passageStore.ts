/**
 * 📰 하루 한 지문 데이터 관리
 * 
 * localStorage 기반 CRUD
 * 영어 지문 입력 → 한글 번역 + 단어 추출
 */

export interface PassageVocab {
    word: string;       // 영어 단어/구동사/이디엄
    meaning: string;    // 한글 뜻
    type: 'word' | 'phrase' | 'idiom';
}

export interface PassageSentence {
    english: string;    // 영어 원문
    korean: string;     // 한글 번역
}

export interface PassageEntry {
    id: string;
    title: string;
    englishInput: string;       // 사용자가 입력한 영어 원문
    sentences: PassageSentence[];
    vocabulary: PassageVocab[];
    status: 'draft' | 'generated' | 'completed';
    createdAt: number;
    updatedAt: number;
}

const STORAGE_KEY = 'jaegeun_passage_entries';

export const getPassages = (): PassageEntry[] => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
        return JSON.parse(stored) as PassageEntry[];
    } catch {
        return [];
    }
};

export const savePassage = (passage: PassageEntry) => {
    const passages = getPassages();
    const index = passages.findIndex(p => p.id === passage.id);
    if (index >= 0) {
        passages[index] = passage;
    } else {
        passages.push(passage);
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(passages));
    } catch (e) {
        console.error('[PassageStore] localStorage 저장 실패:', e);
    }
    window.dispatchEvent(new Event('passages-changed'));
};

export const deletePassage = (id: string) => {
    const passages = getPassages().filter(p => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(passages));
    window.dispatchEvent(new Event('passages-changed'));
};

export const getPassageById = (id: string): PassageEntry | undefined => {
    return getPassages().find(p => p.id === id);
};

export const createNewPassage = (): PassageEntry => {
    const entry: PassageEntry = {
        id: crypto.randomUUID(),
        title: 'Daily Passage',
        englishInput: '',
        sentences: [],
        vocabulary: [],
        status: 'draft',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    savePassage(entry);
    return entry;
};
