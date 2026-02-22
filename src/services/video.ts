import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

interface VideoGenParams {
    ffmpeg: FFmpeg;
    images: string[]; // URLs or Base64
    audioBlob: Blob;
    subtitles: string; // Text to display
    onProgress?: (ratio: number) => void;
}

export const generateVideo = async ({
    ffmpeg,
    images,
    audioBlob,
    subtitles,
    onProgress
}: VideoGenParams): Promise<string> => {

    if (!ffmpeg.loaded) throw new Error("FFmpeg not loaded");

    const fontUrl = 'https://fonts.gstatic.com/s/notosanskr/v27/PbykFmXiEBPT4ITbgNA5Cgm203Tq4JJWq209pU0DPdWuqxJXL163qwxV.ttf'; // Noto Sans KR Bold (example URL)

    // 1. Write Font
    await ffmpeg.writeFile('font.ttf', await fetchFile(fontUrl));

    // 2. Write Audio
    await ffmpeg.writeFile('audio.mp3', await fetchFile(audioBlob));

    // 3. Write Images (assuming 1 image strictly for now, or loop 1 image)
    // For multiple images, we'd need complex filter_complex or concat
    // Requirement: "Generated images and narration" -> implies 1 image per scene or slideshow.
    // Simplified MVP: 1 Image + 1 Audio track

    const imageFiles: string[] = [];
    for (let i = 0; i < images.length; i++) {
        const fname = `image${i}.jpg`;
        await ffmpeg.writeFile(fname, await fetchFile(images[i]));
        imageFiles.push(fname);
    }

    // 4. Execute FFmpeg Command
    // Simple loop of single image for duration of audio
    // + Drawtext for subtitles
    // Subtitle styling: Bottom Center, Pure White, Noto Sans KR Bold

    const subtitleFilter = `drawtext=fontfile=font.ttf:text='${subtitles}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-th-50:box=1:boxcolor=black@0.5:boxborderw=5`;

    // Get duration of audio to match video length?
    // FFmpeg can loop image to match audio duration with -shortest (but needs cautious ordering)

    // Complex filter to:
    // 1. Loop image
    // 2. Add subtitles
    // 3. Mix with audio

    await ffmpeg.exec([
        '-loop', '1',
        '-i', 'image0.jpg',
        '-i', 'audio.mp3',
        '-vf', subtitleFilter,
        '-c:v', 'libx264',
        '-tune', 'stillimage',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-pix_fmt', 'yuv420p',
        '-shortest',
        'output.mp4'
    ]);

    // 5. Read Output
    const data = await ffmpeg.readFile('output.mp4');
    return URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
};
