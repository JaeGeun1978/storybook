export type GeminiVoice = 'Aoede' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir';

export interface AppSettings {
    geminiApiKey: string;
    firebaseConfig?: string; // JSON string for flexibility
    useGeminiTTS: boolean;
    geminiVoice: GeminiVoice; // Gemini TTS 음성 선택
}

const STORAGE_KEY = 'jaegeun_storybook_settings';

export const defaultSettings: AppSettings = {
    geminiApiKey: '',
    useGeminiTTS: true,
    geminiVoice: 'Aoede',
};

export const getSettings = (): AppSettings => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultSettings;
    try {
        return { ...defaultSettings, ...JSON.parse(stored) };
    } catch (e) {
        console.error('Failed to parse settings', e);
        return defaultSettings;
    }
};

export const saveSettings = (settings: AppSettings) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // Dispatch a custom event to notify components of changes
    window.dispatchEvent(new Event('settings-changed'));
};

export const useSettingsSubscription = (_callback: (settings: AppSettings) => void) => {
    // Simple subscription implementation if needed, or just rely on React state in the Settings page
    // For now, components can just read on mount or update.
    // A better approach for React is a Context or a Hook.
};
