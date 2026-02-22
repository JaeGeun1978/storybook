import React, { useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { getTTSService } from '../services/tts';
import { useFFmpeg } from '../hooks/useFFmpeg';
import { generateVideo } from '../services/video';

const Dashboard: React.FC = () => {
    const { apiKey, ttsEngine, systemInstruction } = useSettings();
    const { ffmpeg, loaded, load, isLoading: isFfmpegLoading, messageRef } = useFFmpeg();

    const [text, setText] = useState('');
    const [images, setImages] = useState<string[]>([]);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);

    const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
    const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
    const [logs, setLogs] = useState<string>('');

    // Helper to log to UI
    const log = (msg: string) => setLogs(prev => prev + '\n' + msg);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const url = URL.createObjectURL(file);
            setImages([url]); // Single image for MVP
        }
    };

    const handleGenerateAudio = async () => {
        if (!apiKey) {
            alert("Please set API Key in Settings first.");
            return;
        }
        if (!text) return;

        setIsGeneratingAudio(true);
        try {
            const ttsService = getTTSService(ttsEngine);
            const audio = await ttsService.generateAudio(text, apiKey, systemInstruction);
            setAudioBlob(audio);
            log("Audio generated successfully.");
        } catch (err: any) {
            console.error(err);
            log(`Error generating audio: ${err.message}`);
            alert(`Error: ${err.message}`);
        } finally {
            setIsGeneratingAudio(false);
        }
    };

    const handleGenerateVideo = async () => {
        if (!loaded) {
            await load();
        }
        if (!audioBlob || images.length === 0) {
            alert("Need both Audio and Image to generate video.");
            return;
        }

        setIsGeneratingVideo(true);
        log("Starting video generation...");
        try {
            const url = await generateVideo({
                ffmpeg,
                images,
                audioBlob,
                subtitles: text, // Use full text as subtitle for MVP
            });
            setVideoUrl(url);
            log("Video generated successfully!");
        } catch (err: any) {
            console.error(err);
            log(`Error generating video: ${err.message}`);
        } finally {
            setIsGeneratingVideo(false);
        }
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1>Create Story</h1>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* Left Column: Inputs */}
                <div>
                    <section style={{ marginBottom: '20px' }}>
                        <h3>1. Story Text</h3>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Enter your story text here..."
                            rows={5}
                            style={{ width: '100%', padding: '10px' }}
                        />
                    </section>

                    <section style={{ marginBottom: '20px' }}>
                        <h3>2. Image</h3>
                        <input type="file" accept="image/*" onChange={handleImageUpload} />
                        {images.length > 0 && (
                            <img src={images[0]} alt="Preview" style={{ width: '100%', marginTop: '10px', borderRadius: '8px' }} />
                        )}
                    </section>

                    <section style={{ marginBottom: '20px' }}>
                        <h3>3. Audio</h3>
                        <button
                            onClick={handleGenerateAudio}
                            disabled={isGeneratingAudio || !text}
                            style={{ padding: '10px 20px', cursor: 'pointer' }}
                        >
                            {isGeneratingAudio ? 'Generating...' : 'Generate Audio'}
                        </button>
                        {audioBlob && (
                            <audio controls src={URL.createObjectURL(audioBlob)} style={{ display: 'block', marginTop: '10px', width: '100%' }} />
                        )}
                    </section>
                </div>

                {/* Right Column: Video & Output */}
                <div>
                    <section style={{ marginBottom: '20px' }}>
                        <h3>4. Video</h3>
                        <button
                            onClick={handleGenerateVideo}
                            disabled={isGeneratingVideo || !audioBlob || images.length === 0}
                            style={{
                                padding: '10px 20px',
                                cursor: 'pointer',
                                backgroundColor: '#28a745',
                                color: 'white',
                                border: 'none',
                                borderRadius: '5px',
                                fontSize: '16px'
                            }}
                        >
                            {isGeneratingVideo || isFfmpegLoading ? 'Rendering Video...' : 'Render Video (Browser-side)'}
                        </button>
                        <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
                            <p ref={messageRef}></p>
                            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '100px', overflowY: 'auto', background: '#eee', padding: '5px' }}>{logs}</pre>
                        </div>

                        {videoUrl && (
                            <div style={{ marginTop: '20px' }}>
                                <h4>Result:</h4>
                                <video controls src={videoUrl} style={{ width: '100%', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }} />
                                <a href={videoUrl} download="story.mp4" style={{ display: 'block', marginTop: '10px', textAlign: 'center' }}>Download MP4</a>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
