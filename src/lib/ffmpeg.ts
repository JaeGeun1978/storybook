import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

export class FFmpegService {
    private static instance: FFmpegService;
    private ffmpeg: FFmpeg;
    private loaded: boolean = false;
    private loading: Promise<void> | null = null;

    private constructor() {
        this.ffmpeg = new FFmpeg();
    }

    public static getInstance(): FFmpegService {
        if (!FFmpegService.instance) {
            FFmpegService.instance = new FFmpegService();
        }
        return FFmpegService.instance;
    }

    public async load() {
        if (this.loaded) return;
        // 중복 로딩 방지
        if (this.loading) return this.loading;

        this.loading = this._doLoad();
        return this.loading;
    }

    private async _doLoad() {
        // @ffmpeg/ffmpeg@0.12.x 에 맞는 core 버전 목록 (순서대로 시도)
        const cdnSources = [
            'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
            'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
        ];

        for (const baseURL of cdnSources) {
            try {
                console.log(`[FFmpeg] Loading from: ${baseURL}`);

                const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
                const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');

                await this.ffmpeg.load({ coreURL, wasmURL });

                this.loaded = true;
                console.log('[FFmpeg] ✅ Loaded successfully');
                return;
            } catch (error) {
                console.warn(`[FFmpeg] ❌ Failed from ${baseURL}:`, error);
            }
        }

        this.loading = null;
        throw new Error(
            'FFmpeg 로딩 실패. 브라우저가 SharedArrayBuffer를 지원하는지 확인하세요.\n' +
            '(Chrome/Edge에서 HTTPS 또는 localhost로 접속해야 합니다)'
        );
    }

    public isLoaded(): boolean {
        return this.loaded;
    }

    public getFFmpeg(): FFmpeg {
        return this.ffmpeg;
    }

    public async writeFile(path: string, data: Uint8Array | string) {
        if (!this.loaded) await this.load();
        await this.ffmpeg.writeFile(path, data);
    }

    public async readFile(path: string): Promise<Uint8Array | string> {
        if (!this.loaded) await this.load();
        return await this.ffmpeg.readFile(path);
    }

    public async exec(args: string[]) {
        if (!this.loaded) await this.load();
        return await this.ffmpeg.exec(args);
    }

    public onProgress(callback: (progress: { progress: number; time: number }) => void) {
        this.ffmpeg.on('progress', callback);
    }

    public onLog(callback: (log: { message: string }) => void) {
        this.ffmpeg.on('log', callback);
    }
}

export const ffmpegService = FFmpegService.getInstance();
