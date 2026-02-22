import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type TSSEngine = 'gemini' | 'cloud';

interface SettingsContextType {
    apiKey: string;
    setApiKey: (key: string) => void;
    ttsEngine: TSSEngine;
    setTtsEngine: (engine: TSSEngine) => void;
    systemInstruction: string;
    setSystemInstruction: (instruction: string) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const STORAGE_KEY_API = 'storybook_api_key';
const STORAGE_KEY_ENGINE = 'storybook_tts_engine';
const STORAGE_KEY_INSTRUCTION = 'storybook_system_instruction';

const DEFAULT_INSTRUCTION = `You are a professional storyteller. 
Your voice should be emotional, engaging, and suitable for a storybook narration.
Vary your tone and pace to match the mood of the story.`;

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
    const [apiKey, setApiKeyState] = useState('');
    const [ttsEngine, setTtsEngineState] = useState<TSSEngine>('gemini');
    const [systemInstruction, setSystemInstructionState] = useState(DEFAULT_INSTRUCTION);

    useEffect(() => {
        const storedApi = localStorage.getItem(STORAGE_KEY_API);
        const storedEngine = localStorage.getItem(STORAGE_KEY_ENGINE) as TSSEngine;
        const storedInstruction = localStorage.getItem(STORAGE_KEY_INSTRUCTION);

        if (storedApi) setApiKeyState(storedApi);
        if (storedEngine) setTtsEngineState(storedEngine);
        if (storedInstruction) setSystemInstructionState(storedInstruction);
    }, []);

    const setApiKey = (key: string) => {
        setApiKeyState(key);
        localStorage.setItem(STORAGE_KEY_API, key);
    };

    const setTtsEngine = (engine: TSSEngine) => {
        setTtsEngineState(engine);
        localStorage.setItem(STORAGE_KEY_ENGINE, engine);
    };

    const setSystemInstruction = (instruction: string) => {
        setSystemInstructionState(instruction);
        localStorage.setItem(STORAGE_KEY_INSTRUCTION, instruction);
    };

    return (
        <SettingsContext.Provider value={{
            apiKey, setApiKey,
            ttsEngine, setTtsEngine,
            systemInstruction, setSystemInstruction
        }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};
