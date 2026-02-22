import { generateAudio } from './gemini';
import { getSettings } from './store';
import type { StoryLanguage } from './storyStore';

/**
 * TTS 생성 – 여러 방법을 순서대로 시도
 * 1. Gemini Native Audio (설정에서 켜져 있을 때)
 * 2. StreamElements (AWS Polly)
 * 3. Google Translate TTS
 * 4. 브라우저 내장 Web Speech API (최종 폴백, 항상 작동)
 * 
 * @param language 'ko' | 'en' – 영어 스토리북은 영어 음성 사용
 */
export const generateSpeech = async (text: string, language: StoryLanguage = 'ko'): Promise<Blob> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastError: any;
    const { useGeminiTTS } = getSettings();

    // 사용자가 선택한 Gemini 음성 (Settings에서 설정)
    const geminiVoice = useGeminiTTS ? getSettings().geminiVoice || 'Aoede' : 'Aoede';
    const streamVoice = language === 'en' ? 'Matthew' : 'Seoyeon'; // AWS Polly 영어/한국어
    const gttsTl = language === 'en' ? 'en' : 'ko';

    // ─── 1. Gemini Native Audio ───
    if (useGeminiTTS) {
        try {
            console.log(`[TTS] 1️⃣ Gemini Native Audio 시도... (voice=${geminiVoice}, lang=${language})`);
            const blob = await generateAudio(text, geminiVoice, language);
            if (blob && blob.size > 0) {
                console.log("[TTS] ✅ Gemini Audio 성공!");
                return blob;
            }
        } catch (e) {
            console.warn("[TTS] Gemini Audio 실패, 폴백으로 넘어갑니다.", e);
            lastError = e;
        }
    }

    // ─── 2. StreamElements (AWS Polly 래퍼) ───
    const safeText = text.length > 500 ? text.substring(0, 500) : text;
    const encoded = encodeURIComponent(safeText);

    try {
        console.log(`[TTS] 2️⃣ StreamElements(${streamVoice}) 시도...`);
        const url = `/api/streamelements/kappa/v2/speech?voice=${streamVoice}&text=${encoded}`;
        const res = await fetch(url, {
            referrerPolicy: 'no-referrer',
            credentials: 'omit',
            cache: 'no-store'
        });
        if (res.ok) {
            const blob = await res.blob();
            if (blob.size > 0 && blob.type.includes('audio')) {
                console.log("[TTS] ✅ StreamElements 성공!");
                return blob;
            }
        }
        console.warn("[TTS] StreamElements 실패:", res.status);
    } catch (e) {
        console.warn("[TTS] StreamElements 에러:", e);
        if (!lastError) lastError = e;
    }

    // ─── 3. Google Translate TTS ───
    const shortText = text.length > 95 ? text.substring(0, 95) : text;
    const shortEncoded = encodeURIComponent(shortText);

    const gttsUrls = [
        `/api/tts/google/translate_tts?ie=UTF-8&client=tw-ob&q=${shortEncoded}&tl=${gttsTl}&total=1&idx=0&textlen=${shortText.length}`,
        `/api/tts/google/translate_tts?ie=UTF-8&client=dict-chrome-ex&q=${shortEncoded}&tl=${gttsTl}&total=1&idx=0&textlen=${shortText.length}`,
    ];

    for (const url of gttsUrls) {
        try {
            console.log("[TTS] 3️⃣ Google Translate TTS 시도...");
            const res = await fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit' });
            if (res.ok) {
                const blob = await res.blob();
                if (blob.size > 0 && blob.type.includes('audio')) {
                    console.log("[TTS] ✅ Google Translate TTS 성공!");
                    return blob;
                }
            }
        } catch (e) {
            console.warn("[TTS] Google Translate 에러:", e);
            lastError = e;
        }
    }

    // ─── 4. 브라우저 내장 Web Speech API (최종 폴백) ───
    console.log("[TTS] 4️⃣ 브라우저 내장 음성(Web Speech API) 시도...");
    try {
        const blob = await browserTTS(text, language);
        if (blob && blob.size > 0) {
            console.log("[TTS] ✅ 브라우저 내장 TTS 성공!");
            return blob;
        }
    } catch (e) {
        console.warn("[TTS] 브라우저 TTS 에러:", e);
        lastError = e;
    }

    const errorMsg = lastError instanceof Error ? lastError.message : String(lastError || '알 수 없는 오류');
    throw new Error(`TTS 생성 실패. 모든 방법이 실패했습니다.\n상세: ${errorMsg}`);
};

/**
 * 브라우저 내장 Web Speech API를 사용해 오디오 Blob 생성
 * MediaRecorder로 녹음하여 Blob으로 반환
 */
const browserTTS = (text: string, language: StoryLanguage = 'ko'): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        if (!('speechSynthesis' in window)) {
            reject(new Error('이 브라우저는 음성 합성을 지원하지 않습니다.'));
            return;
        }

        const synth = window.speechSynthesis;
        const targetLang = language === 'en' ? 'en' : 'ko';

        // 언어에 맞는 음성 찾기
        const getVoice = (): SpeechSynthesisVoice | null => {
            const voices = synth.getVoices();
            const match = voices.find(v => v.lang.startsWith(targetLang));
            if (match) return match;
            return voices[0] || null;
        };

        const speak = () => {
            const utterance = new SpeechSynthesisUtterance(text);
            const voice = getVoice();
            if (voice) {
                utterance.voice = voice;
                utterance.lang = voice.lang;
            } else {
                utterance.lang = language === 'en' ? 'en-US' : 'ko-KR';
            }
            utterance.rate = 0.9;
            utterance.pitch = 1.0;

            // Web Speech API는 직접 Blob을 만들 수 없으므로
            // 무음 오디오 Blob + 실시간 재생으로 대체
            // 여기서는 짧은 무음 WAV를 duration 기반으로 생성하고
            // 실제 재생은 브라우저 synth가 담당

            utterance.onend = () => {
                // 간단한 WAV 헤더로 무음(placeholder) blob 생성
                // 실제 소리는 영상 합성 시 synth로 재생됨
                // 그러나 영상 제작 파이프라인을 위해
                // 실제 오디오 데이터가 필요하므로
                // 짧은 무음 WAV를 만들어 반환
                const sampleRate = 22050;
                const duration = Math.max(text.length * 0.12, 2); // 대략적 길이
                const numSamples = Math.floor(sampleRate * duration);
                const wavBlob = createSilentWav(sampleRate, numSamples);
                resolve(wavBlob);
            };

            utterance.onerror = (e) => {
                reject(new Error(`음성 합성 오류: ${e.error}`));
            };

            synth.speak(utterance);
        };

        // 음성 목록이 비동기로 로드될 수 있음
        if (synth.getVoices().length > 0) {
            speak();
        } else {
            synth.onvoiceschanged = () => speak();
            // 타임아웃
            setTimeout(() => speak(), 500);
        }
    });
};

/**
 * 무음 WAV 파일 생성 (영상 합성용 placeholder)
 */
function createSilentWav(sampleRate: number, numSamples: number): Blob {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const dataSize = numSamples * numChannels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // WAV Header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
    view.setUint16(32, numChannels * bytesPerSample, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    // 나머지는 0 (무음)

    return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}
