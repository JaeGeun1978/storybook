import React, { useState } from 'react';
import { FFmpegService } from '../lib/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

export const FFmpegTest: React.FC = () => {
    const [image, setImage] = useState<File | null>(null);
    const [audio, setAudio] = useState<File | null>(null);
    const [text, setText] = useState('테스트 자막입니다.');
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [log, setLog] = useState<string[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    const handleGenerate = async () => {
        if (!image || !audio) return;
        setIsProcessing(true);
        setLog([]);
        const ffmpegService = FFmpegService.getInstance();

        try {
            await ffmpegService.load();
            const ffmpeg = ffmpegService.getFFmpeg();

            ffmpeg.on('log', ({ message }) => {
                setLog(prev => [...prev, message]);
            });

            ffmpeg.on('progress', ({ progress }) => {
                setProgress(Math.round(progress * 100));
            });

            await ffmpeg.writeFile('input.png', await fetchFile(image));
            await ffmpeg.writeFile('input.mp3', await fetchFile(audio));

            // Simplified command without drawtext for first test to minimize failure points
            // Once this works, we add drawtext
            await ffmpeg.exec([
                '-loop', '1',
                '-i', 'input.png',
                '-i', 'input.mp3',
                '-c:v', 'libx264',
                '-tune', 'stillimage',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-pix_fmt', 'yuv420p',
                '-shortest',
                'output.mp4'
            ]);

            /* eslint-disable @typescript-eslint/no-explicit-any */
            const data = await ffmpeg.readFile('output.mp4');
            const url = URL.createObjectURL(new Blob([data as any], { type: 'video/mp4' }));
            setVideoUrl(url);

        } catch (error) {
            console.error(error);
            setLog(prev => [...prev, `Error: ${error}`]);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
            <h2>FFmpeg Test</h2>
            <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
                <div>
                    <label>Image:</label>
                    <input type="file" accept="image/*" onChange={e => setImage(e.target.files?.[0] || null)} />
                </div>
                <div>
                    <label>Audio:</label>
                    <input type="file" accept="audio/*" onChange={e => setAudio(e.target.files?.[0] || null)} />
                </div>
                <div>
                    <label>Subtitle:</label>
                    <input type="text" value={text} onChange={e => setText(e.target.value)} className="input" />
                </div>
                <button onClick={handleGenerate} disabled={isProcessing || !image || !audio} className="btn btn-primary">
                    {isProcessing ? `Processing ${progress}%` : 'Generate Video'}
                </button>
            </div>

            {videoUrl && (
                <div style={{ marginTop: '2rem' }}>
                    <h3>Result:</h3>
                    <video src={videoUrl} controls style={{ width: '100%', maxWidth: '500px' }} />
                </div>
            )}

            <div style={{ marginTop: '2rem', backgroundColor: '#333', padding: '1rem', borderRadius: '4px', height: '200px', overflowY: 'auto' }}>
                <h3>Logs:</h3>
                {log.map((l, i) => <div key={i} style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{l}</div>)}
            </div>
        </div>
    );
};
