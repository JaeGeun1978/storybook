import { deleteProjectMedia } from './mediaStore';

export interface VocabItem {
    word: string;
    meaning: string;
}

export interface StoryScene {
    id: string;
    text: string; // The script text
    imagePrompt?: string; // Image generation prompt (English)
    imageUrl?: string; // Generated image URL (data URL or blob URL) — 메모리 전용, localStorage 저장 안됨
    audioUrl?: string; // TTS audio URL — 메모리 전용, localStorage 저장 안됨
    duration?: number; // Duration in seconds
    vocabulary?: VocabItem[]; // 영어 스토리: 어려운 단어 목록
    translation?: string;     // 영어 스토리: 한글 번역 (한줄해석용)
}

export type StoryLanguage = 'ko' | 'en';

export interface StoryProject {
    id: string;
    title: string;
    language: StoryLanguage;
    createdAt: number;
    updatedAt: number;
    scenes: StoryScene[];
    status: 'draft' | 'generating' | 'completed';
    thumbnailUrl?: string;
    finalVideoUrl?: string; // 메모리 전용, localStorage 저장 안됨
    characterGuide?: string; // AI가 생성한 캐릭터 외형 가이드 (이미지 일관성용)
}

const STORAGE_KEY = 'jaegeun_storybook_projects';

/**
 * localStorage 저장 전 대용량 미디어 데이터 제거
 * data:URL, blob:URL은 IndexedDB에 따로 저장됨
 */
function stripMediaForStorage(project: StoryProject): StoryProject {
    return {
        ...project,
        finalVideoUrl: undefined,
        thumbnailUrl: project.thumbnailUrl?.startsWith('data:') ? undefined : project.thumbnailUrl,
        scenes: project.scenes.map(scene => ({
            ...scene,
            // data: URL과 blob: URL 모두 제거 (IndexedDB에서 불러옴)
            imageUrl: undefined,
            audioUrl: undefined,
        })),
    };
}

export const getProjects = (): StoryProject[] => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    try {
        const projects = JSON.parse(stored) as StoryProject[];
        // 기존 프로젝트 하위 호환 (language 필드 없는 경우 기본값 'ko')
        return projects.map(p => ({
            ...p,
            language: p.language || 'ko',
        }));
    } catch (e) {
        console.error('Failed to parse projects', e);
        return [];
    }
};

export const saveProject = (project: StoryProject) => {
    const projects = getProjects();
    const index = projects.findIndex(p => p.id === project.id);

    // 저장할 때는 미디어 데이터 제거 (localStorage 용량 보호)
    const lightweight = stripMediaForStorage(project);

    if (index >= 0) {
        projects[index] = lightweight;
    } else {
        projects.push(lightweight);
    }

    try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch (e) {
        console.error('[StoryStore] localStorage 저장 실패:', e);
        // 기존 데이터가 너무 큰 경우, 해당 프로젝트만 교체 시도
        try {
            const freshProjects = [lightweight];
            localStorage.setItem(STORAGE_KEY, JSON.stringify(freshProjects));
            console.warn('[StoryStore] 기존 프로젝트 삭제 후 현재 프로젝트만 저장됨');
        } catch {
            console.error('[StoryStore] localStorage 완전 실패');
        }
    }
    window.dispatchEvent(new Event('projects-changed'));
};

export const deleteProject = (id: string) => {
    const projects = getProjects().filter(p => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    // IndexedDB에서도 미디어 삭제
    deleteProjectMedia(id).catch(e => console.warn('[StoryStore] 미디어 삭제 실패:', e));
    window.dispatchEvent(new Event('projects-changed'));
};

export const createNewProject = (language: StoryLanguage = 'ko'): StoryProject => {
    const newProject: StoryProject = {
        id: crypto.randomUUID(),
        title: language === 'ko' ? '새로운 이야기' : 'New Story',
        language,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scenes: [],
        status: 'draft'
    };
    saveProject(newProject);
    return newProject;
};

export const getProjectById = (id: string): StoryProject | undefined => {
    return getProjects().find(p => p.id === id);
};
