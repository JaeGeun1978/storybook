export interface TTSService {
    generateAudio(text: string, apiKey: string, systemInstruction?: string): Promise<Blob>;
}

export class GeminiTTSService implements TTSService {
    async generateAudio(text: string, apiKey: string, systemInstruction?: string): Promise<Blob> {
        if (!apiKey) throw new Error("API Key is required for Gemini TTS");

        // Placeholder for actual Gemini API call
        // Note: Gemini Multimodal Live API might be needed for direct audio-to-audio or specific TTS endpoints
        // For now, we'll simulate or use a standard endpoint if available.
        // IF the standard generates text, we might need a different approach.
        // However, assuming we use a hypothetical or actual TTS capability:

        console.log("Generating audio with Gemini...", { text, systemInstruction });

        // TODO: Implement actual API call
        // verification note: user asked for "Gemini Live Voice" toggle.

        return new Blob(["placeholder-audio-data"], { type: 'audio/mp3' });
    }
}

export class CloudTTSService implements TTSService {
    async generateAudio(text: string, apiKey: string): Promise<Blob> {
        if (!apiKey) throw new Error("API Key is required for Google Cloud TTS");

        console.log("Generating audio with Cloud TTS...", { text });

        const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
        const data = {
            input: { text },
            voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-A' },
            audioConfig: { audioEncoding: 'MP3' }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Cloud TTS Error: ${error.error?.message || response.statusText}`);
        }

        const result = await response.json();
        const audioContent = result.audioContent;

        // Decode base64 to Blob
        const byteCharacters = atob(audioContent);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: 'audio/mp3' });
    }
}

export const getTTSService = (engine: 'gemini' | 'cloud'): TTSService => {
    if (engine === 'gemini') return new GeminiTTSService();
    return new CloudTTSService();
};
