/**
 * Canvas + MediaRecorder 기반 영상 렌더러 v7
 * 
 * ✨ 자막: 2줄씩 끊어서 순차 표시 (글자 수 기반)
 * ✨ 자막-음성 싱크: 텍스트 길이 비례 타이밍 배분
 * ✨ 장면 전환: 효과 없이 깔끔한 컷 전환
 * ✨ 모든 장면을 하나의 MediaRecorder 세션에서 연속 렌더링
 */

// ── 타입 정의 ──

interface VocabItem {
  word: string;
  meaning: string;
}

interface SceneData {
  imageFile: Blob;
  audioFile: Blob;
  subtitleText: string;
  vocabulary?: VocabItem[]; // 영어 스토리: 어려운 단어 목록
}

interface RenderAllOptions {
  scenes: SceneData[];
  onProgress?: (progress: number, statusText?: string) => void;
}

interface RenderSingleOptions {
    imageFile: File | Blob;
    audioFile: File | Blob;
    subtitleText: string;
  outputName?: string;
    onProgress?: (progress: number) => void;
}

const WIDTH = 1280;
const HEIGHT = 720;
const FRAME_RATE = 30;

// ═══════════════════════════════════════════════════════════
// 🎬 전체 장면 연속 렌더링
// ═══════════════════════════════════════════════════════════

export const renderAllScenes = async ({
  scenes,
  onProgress,
}: RenderAllOptions): Promise<string> => {
  console.log(`[VideoRenderer] ===== 전체 ${scenes.length}개 장면 연속 렌더링 시작 =====`);

  // ── 1. 모든 리소스 사전 로딩 ──
  onProgress?.(0, '리소스 로딩 중...');

  const loadedScenes: {
    image: HTMLImageElement;
    audioBuffer: AudioBuffer | null;
    audioDuration: number;
    subtitle: string;
    subtitleChunks: { lines: string[]; charLen: number; startRatio: number; endRatio: number }[]; // 2줄씩 나눈 자막 + 시간 비율
    vocabulary?: VocabItem[];  // 어려운 단어 목록
  }[] = [];

  const audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    onProgress?.(Math.round((i / scenes.length) * 10), `장면 ${i + 1} 리소스 로딩...`);

    // 이미지 로드
    const image = await loadImage(scene.imageFile);
    console.log(`[VideoRenderer] ✅ 장면 ${i + 1} 이미지 로드 (${image.naturalWidth}x${image.naturalHeight})`);

    // 오디오 디코딩
    let audioBuffer: AudioBuffer | null = null;
    let audioDuration = 0;

    try {
      const arrayBuffer = await scene.audioFile.arrayBuffer();
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      audioDuration = audioBuffer.duration;
      console.log(`[VideoRenderer] ✅ 장면 ${i + 1} 오디오 디코딩 완료: ${audioDuration.toFixed(2)}s`);
    } catch (e) {
      console.warn(`[VideoRenderer] ⚠️ 장면 ${i + 1} 오디오 디코딩 실패:`, e);
      try {
        const tempAudio = new Audio();
        tempAudio.src = URL.createObjectURL(scene.audioFile);
        await new Promise<void>((resolve) => {
          tempAudio.onloadedmetadata = () => {
            if (isFinite(tempAudio.duration)) audioDuration = tempAudio.duration;
            URL.revokeObjectURL(tempAudio.src);
            resolve();
          };
          tempAudio.onerror = () => { URL.revokeObjectURL(tempAudio.src); resolve(); };
          setTimeout(resolve, 3000);
        });
      } catch { /* */ }
      if (audioDuration <= 0) {
        audioDuration = Math.max(scene.subtitleText.length * 0.12, 4);
      }
    }

    // 자막을 2줄씩 나누기 + 글자 수 비례 타이밍 계산
    const subtitleChunks = splitSubtitleIntoChunks(scene.subtitleText);

    loadedScenes.push({
      image,
      audioBuffer,
      audioDuration,
      subtitle: scene.subtitleText,
      subtitleChunks,
      vocabulary: scene.vocabulary,
    });
  }

  // ── 2. 전체 타임라인 계산 ──
  let totalDuration = 0;
  const sceneTimeline: { start: number; end: number; duration: number }[] = [];

  for (let i = 0; i < loadedScenes.length; i++) {
    const sceneDuration = loadedScenes[i].audioDuration + 0.3;
    const start = totalDuration;
    totalDuration += sceneDuration;
    sceneTimeline.push({ start, end: totalDuration, duration: sceneDuration });
  }

  console.log(`[VideoRenderer] 📐 총 재생 시간: ${totalDuration.toFixed(2)}s`);
  console.log(`[VideoRenderer] 📐 타임라인:`, sceneTimeline.map((t, i) =>
    `장면${i + 1}: ${t.start.toFixed(1)}s~${t.end.toFixed(1)}s`
  ).join(' | '));

  // ── 3. Canvas 설정 ──
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // ── 4. 오디오 믹싱 ──
  const audioDestination = audioCtx.createMediaStreamDestination();
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.0;
  gainNode.connect(audioDestination);
  gainNode.connect(audioCtx.destination);

  const audioSources: AudioBufferSourceNode[] = [];
  for (let i = 0; i < loadedScenes.length; i++) {
    const { audioBuffer } = loadedScenes[i];
    if (audioBuffer) {
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      audioSources.push(source);
    }
  }

  // 첫 프레임 미리 그리기
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawImageCover(ctx, loadedScenes[0].image, WIDTH, HEIGHT);

  // ── 5. MediaRecorder 설정 ──
  const canvasStream = canvas.captureStream(FRAME_RATE);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks()
  ]);

  return new Promise<string>((resolve, reject) => {
    try {
      const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
        .find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 2_500_000
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      let stopped = false;

      const cleanup = () => {
        audioSources.forEach(s => { try { s.stop(); } catch { /* */ } });
        try { audioCtx.close(); } catch { /* */ }
      };

      const stopRecording = () => {
        if (stopped) return;
        stopped = true;
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, 500);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        console.log(`[VideoRenderer] ✅ 최종 영상 완성! Size: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
        cleanup();
        onProgress?.(100, '완료!');
        resolve(url);
      };

      recorder.onerror = (e) => {
        cleanup();
        reject(new Error(`MediaRecorder 오류: ${e}`));
      };

      // ── 6. 녹화 + 애니메이션 시작 ──
      recorder.start(100);
      console.log('[VideoRenderer] 🎬 녹화 시작!');

      const audioStartTime = audioCtx.currentTime + 0.1;
      for (let i = 0; i < loadedScenes.length; i++) {
        if (audioSources[i]) {
          audioSources[i].start(audioStartTime + sceneTimeline[i].start);
        }
      }

      const renderStartTime = performance.now() + 100;
      const totalMs = totalDuration * 1000;

      const animate = () => {
        if (stopped) return;

        const elapsed = performance.now() - renderStartTime;
        const currentTime = elapsed / 1000;
        const overallProgress = Math.min(elapsed / totalMs, 1);

        // 현재 장면 찾기
        let currentSceneIndex = loadedScenes.length - 1;
        for (let i = 0; i < sceneTimeline.length; i++) {
          if (currentTime < sceneTimeline[i].end) {
            currentSceneIndex = i;
            break;
          }
        }

        const scene = loadedScenes[currentSceneIndex];
        const timeline = sceneTimeline[currentSceneIndex];
        const sceneElapsed = currentTime - timeline.start;

        // ── 이미지 그리기 (깔끔한 컷, 효과 없음) ──
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        drawImageCover(ctx, scene.image, WIDTH, HEIGHT);

        // ── 자막 그리기 (2줄씩, 텍스트 길이 비례 싱크) ──
        const chunks = scene.subtitleChunks;
        if (chunks.length > 0) {
          const timeRatio = sceneElapsed / timeline.duration; // 0~1
          
          // 현재 시간에 해당하는 자막 덩어리 찾기
          let chunkIndex = chunks.length - 1;
          for (let ci = 0; ci < chunks.length; ci++) {
            if (timeRatio < chunks[ci].endRatio) {
              chunkIndex = ci;
              break;
            }
          }

          const chunk = chunks[chunkIndex];
          const chunkStartTime = chunk.startRatio * timeline.duration;
          const chunkEndTime = chunk.endRatio * timeline.duration;
          const chunkDuration = chunkEndTime - chunkStartTime;
          const chunkElapsed = sceneElapsed - chunkStartTime;

          // 부드러운 페이드인/아웃
          const fadeIn = Math.min(0.3, chunkDuration * 0.15);
          const fadeOut = Math.min(0.3, chunkDuration * 0.15);
          let alpha = 1;
          if (chunkElapsed < fadeIn) {
            alpha = chunkElapsed / fadeIn;
          } else if (chunkDuration - chunkElapsed < fadeOut) {
            alpha = Math.max(0, (chunkDuration - chunkElapsed) / fadeOut);
          }

          drawSubtitle(ctx, chunk.lines, alpha);
        }

        // ── 어려운 단어 표시 (상단 좌측) ──
        if (scene.vocabulary && scene.vocabulary.length > 0) {
          drawVocabulary(ctx, scene.vocabulary);
        }

        // ── 장면 인디케이터 ──
        drawSceneIndicator(ctx, currentSceneIndex + 1, loadedScenes.length);

        onProgress?.(Math.round(10 + overallProgress * 85), `장면 ${currentSceneIndex + 1}/${loadedScenes.length} 렌더링...`);

        if (elapsed < totalMs) {
          requestAnimationFrame(animate);
        } else {
          stopRecording();
        }
      };

      setTimeout(animate, 100);

      // 안전장치
      setTimeout(() => {
        if (!stopped) {
          console.warn('[VideoRenderer] ⏰ 타임아웃 → 강제 종료');
          stopRecording();
        }
      }, totalMs + 5000);

    } catch (error) {
      try { audioCtx.close(); } catch { /* */ }
      reject(error);
    }
  });
};

// ═══════════════════════════════════════════════════════════
// 단일 장면 렌더링 (기존 호환)
// ═══════════════════════════════════════════════════════════

export const renderVideo = async ({
  imageFile,
  audioFile,
  subtitleText,
  onProgress
}: RenderSingleOptions): Promise<string> => {
  return renderAllScenes({
    scenes: [{ imageFile, audioFile, subtitleText }],
    onProgress: (p) => onProgress?.(p),
  });
};

// ═══════════════════════════════════════════════════════════
// 🎨 자막 처리
// ═══════════════════════════════════════════════════════════

/**
 * 텍스트를 2줄씩 끊어서 자막 덩어리로 분할하고,
 * 각 덩어리에 텍스트 길이 비례 타이밍(startRatio~endRatio)을 부여.
 * 
 * → 글자가 많은 덩어리에 더 긴 시간을 배분하여 음성-자막 싱크를 맞춤.
 */
function splitSubtitleIntoChunks(
  text: string
): { lines: string[]; charLen: number; startRatio: number; endRatio: number }[] {
  const MAX_CHARS_PER_LINE = 28;
  const LINES_PER_CHUNK = 2;

  // 1) 텍스트를 줄 단위로 분리
  const allLines: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHARS_PER_LINE) {
      allLines.push(remaining);
      break;
    }
    // 적절한 끊기 지점 찾기: 문장 부호 > 쉼표 > 공백
    let breakPoint = MAX_CHARS_PER_LINE;
    
    // 문장 끝(.!?。) 탐색
    const sentenceEnd = remaining.substring(0, MAX_CHARS_PER_LINE + 5).search(/[.!?。]\s/);
    if (sentenceEnd > 0 && sentenceEnd <= MAX_CHARS_PER_LINE + 2) {
      breakPoint = sentenceEnd + 1;
    } else {
      const commaIdx = remaining.lastIndexOf(',', MAX_CHARS_PER_LINE);
      const spaceIdx = remaining.lastIndexOf(' ', MAX_CHARS_PER_LINE);
      // 한글: 조사 앞에서 끊기
      const koBreak = remaining.substring(0, MAX_CHARS_PER_LINE).search(/[을를이가은는에서도의와과로] /);
      
      if (commaIdx > MAX_CHARS_PER_LINE * 0.35) {
        breakPoint = commaIdx + 1;
      } else if (koBreak > MAX_CHARS_PER_LINE * 0.35) {
        breakPoint = koBreak + 1;
      } else if (spaceIdx > MAX_CHARS_PER_LINE * 0.35) {
        breakPoint = spaceIdx + 1;
      }
    }

    allLines.push(remaining.substring(0, breakPoint).trim());
    remaining = remaining.substring(breakPoint).trim();
  }

  // 2) 줄들을 2줄씩 묶기
  const rawChunks: string[][] = [];
  for (let i = 0; i < allLines.length; i += LINES_PER_CHUNK) {
    rawChunks.push(allLines.slice(i, i + LINES_PER_CHUNK));
  }

  if (rawChunks.length === 0) {
    rawChunks.push([text.substring(0, MAX_CHARS_PER_LINE)]);
  }

  // 3) 각 덩어리의 글자 수 계산
  const chunkCharLens = rawChunks.map(lines => 
    lines.reduce((sum, line) => sum + line.length, 0)
  );
  const totalChars = chunkCharLens.reduce((a, b) => a + b, 0) || 1;

  // 4) 글자 수 비례로 시간 비율 배분
  const result: { lines: string[]; charLen: number; startRatio: number; endRatio: number }[] = [];
  let cumulative = 0;

  for (let i = 0; i < rawChunks.length; i++) {
    const ratio = chunkCharLens[i] / totalChars;
    const startRatio = cumulative;
    cumulative += ratio;
    const endRatio = cumulative;
    result.push({
      lines: rawChunks[i],
      charLen: chunkCharLens[i],
      startRatio,
      endRatio,
    });
  }

  // 마지막 endRatio를 정확히 1로 보정
  if (result.length > 0) {
    result[result.length - 1].endRatio = 1;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// 🎨 그리기 유틸리티
// ═══════════════════════════════════════════════════════════

/** 이미지를 캔버스에 cover 모드로 그리기 */
function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const canvasRatio = w / h;
  let drawW: number, drawH: number, drawX: number, drawY: number;

  if (imgRatio > canvasRatio) {
    drawH = h;
    drawW = h * imgRatio;
    drawX = (w - drawW) / 2;
    drawY = 0;
  } else {
    drawW = w;
    drawH = w / imgRatio;
    drawX = 0;
    drawY = (h - drawH) / 2;
  }
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

/** 자막 그리기 (2줄 덩어리, 하단 중앙) */
function drawSubtitle(ctx: CanvasRenderingContext2D, lines: string[], alpha: number) {
  if (!lines || lines.length === 0 || alpha <= 0) return;

  ctx.save();

  // 하단 그라데이션 오버레이
  const gradient = ctx.createLinearGradient(0, HEIGHT * 0.65, 0, HEIGHT);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.3, 'rgba(0,0,0,0.25)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, HEIGHT * 0.65, WIDTH, HEIGHT * 0.35);

  // 자막 텍스트
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.font = 'bold 40px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';

  const lineHeight = 56;
  const bottomMargin = 50;
  const startY = HEIGHT - bottomMargin - (lines.length - 1) * lineHeight;

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    // 외곽선 (가독성)
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 5;
    ctx.strokeText(line, WIDTH / 2, y);
    // 흰색 텍스트
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(line, WIDTH / 2, y);
  });

  ctx.restore();
}

/** 어려운 단어 표시 (상단 좌측, 장면 인디케이터 아래) */
function drawVocabulary(ctx: CanvasRenderingContext2D, vocabulary: VocabItem[]) {
  if (!vocabulary || vocabulary.length === 0) return;

  ctx.save();

  const startX = 20;
  const startY = 60; // 장면 인디케이터(20+30) 아래
  const lineHeight = 30;
  const padding = 10;

  // 배경 영역 크기 계산
  ctx.font = 'bold 16px "Noto Sans KR", sans-serif';
  let maxWidth = 0;
  for (const v of vocabulary) {
    const text = `${v.word}: ${v.meaning}`;
    maxWidth = Math.max(maxWidth, ctx.measureText(text).width);
  }

  const boxW = maxWidth + padding * 2 + 8;
  const boxH = vocabulary.length * lineHeight + padding * 2;

  // 반투명 배경
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  const r = 10;
  ctx.beginPath();
  ctx.moveTo(startX + r, startY);
  ctx.lineTo(startX + boxW - r, startY);
  ctx.arc(startX + boxW - r, startY + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(startX + r, startY + boxH);
  ctx.arc(startX + r, startY + r, r, Math.PI / 2, -Math.PI / 2);
  // simple rounded rect fallback for bottom corners
  ctx.closePath();
  ctx.fill();

  // 📖 아이콘 대용 헤더 라인
  ctx.fillStyle = 'rgba(255,200,50,0.8)';
  ctx.fillRect(startX + 4, startY, 3, boxH);

  // 단어 텍스트
  for (let i = 0; i < vocabulary.length; i++) {
    const v = vocabulary[i];
    const y = startY + padding + i * lineHeight + 16;

    // 영어 단어 (노란색)
    ctx.font = 'bold 17px "Noto Sans KR", sans-serif';
    ctx.fillStyle = '#FFD54F';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const wordText = v.word + ': ';
    ctx.fillText(wordText, startX + padding + 6, y);

    // 한글 뜻 (흰색)
    const wordWidth = ctx.measureText(wordText).width;
    ctx.font = '15px "Noto Sans KR", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(v.meaning, startX + padding + 6 + wordWidth, y);
  }

  ctx.restore();
}

/** 장면 인디케이터 (좌상단) */
function drawSceneIndicator(ctx: CanvasRenderingContext2D, current: number, total: number) {
  ctx.save();
  ctx.globalAlpha = 0.5;

  const text = `${current} / ${total}`;
  ctx.font = 'bold 16px "Noto Sans KR", sans-serif';
  const tw = ctx.measureText(text).width;
  const px = 14, h = 30, r = h / 2;
  const x = 20, y = 20, w = tw + px * 2;

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// 📓 영어일기 전용 비디오 렌더러
// ═══════════════════════════════════════════════════════════

interface DiarySceneData {
  englishLines: string[];    // 영어 문장들 (2문장)
  koreanLines: string[];     // 한글 번역 (2문장)
  audioFile: Blob;           // TTS 오디오
  vocabulary: VocabItem[];   // 해당 문장의 어려운 단어
}

interface DiaryVideoOptions {
  scenes: DiarySceneData[];
  onProgress?: (progress: number, statusText?: string) => void;
}

/** 매트 크림색 배경 */
const CREAM_BG = '#F5F0E8';
const CREAM_BG_DARK = '#EDE7DA';

export const renderDiaryVideo = async ({
  scenes,
  onProgress,
}: DiaryVideoOptions): Promise<string> => {
  console.log(`[DiaryVideo] ===== 영어일기 ${scenes.length}개 장면 렌더링 시작 =====`);

  // ── 1. 리소스 로딩 (오디오) ──
  onProgress?.(0, '🎧 오디오 리소스 로딩 중...');

  const audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const loadedScenes: {
    englishLines: string[];
    koreanLines: string[];
    audioBuffer: AudioBuffer | null;
    audioDuration: number;
    vocabulary: VocabItem[];
  }[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    onProgress?.(Math.round((i / scenes.length) * 10), `장면 ${i + 1} 오디오 로딩...`);

    let audioBuffer: AudioBuffer | null = null;
    let audioDuration = 0;

    try {
      const arrayBuffer = await scene.audioFile.arrayBuffer();
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      audioDuration = audioBuffer.duration;
      console.log(`[DiaryVideo] ✅ 장면 ${i + 1} 오디오: ${audioDuration.toFixed(2)}s`);
    } catch (e) {
      console.warn(`[DiaryVideo] ⚠️ 장면 ${i + 1} 오디오 디코딩 실패:`, e);
      try {
        const tempAudio = new Audio();
        tempAudio.src = URL.createObjectURL(scene.audioFile);
        await new Promise<void>((resolve) => {
          tempAudio.onloadedmetadata = () => {
            if (isFinite(tempAudio.duration)) audioDuration = tempAudio.duration;
            URL.revokeObjectURL(tempAudio.src);
            resolve();
          };
          tempAudio.onerror = () => { URL.revokeObjectURL(tempAudio.src); resolve(); };
          setTimeout(resolve, 3000);
        });
      } catch { /* */ }
      if (audioDuration <= 0) {
        audioDuration = Math.max(scene.englishLines.join(' ').length * 0.1, 4);
      }
    }

    loadedScenes.push({
      englishLines: scene.englishLines,
      koreanLines: scene.koreanLines,
      audioBuffer,
      audioDuration,
      vocabulary: scene.vocabulary,
    });
  }

  // ── 2. 타임라인 계산 ──
  let totalDuration = 0;
  const sceneTimeline: { start: number; end: number; duration: number }[] = [];

  for (let i = 0; i < loadedScenes.length; i++) {
    const sceneDuration = loadedScenes[i].audioDuration + 1.0; // 여유 1초
    const start = totalDuration;
    totalDuration += sceneDuration;
    sceneTimeline.push({ start, end: totalDuration, duration: sceneDuration });
  }

  console.log(`[DiaryVideo] 📐 총 재생 시간: ${totalDuration.toFixed(2)}s`);

  // ── 3. Canvas 설정 ──
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // ── 4. 오디오 믹싱 ──
  const audioDestination = audioCtx.createMediaStreamDestination();
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 1.0;
  gainNode.connect(audioDestination);
  gainNode.connect(audioCtx.destination);

  const audioSources: AudioBufferSourceNode[] = [];
  for (let i = 0; i < loadedScenes.length; i++) {
    const { audioBuffer } = loadedScenes[i];
    if (audioBuffer) {
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      audioSources.push(source);
    } else {
      audioSources.push(null as unknown as AudioBufferSourceNode);
    }
  }

  // 첫 프레임 그리기
  drawDiaryFrame(ctx, loadedScenes[0], 0, 1, loadedScenes.length);

  // ── 5. MediaRecorder 설정 ──
  const canvasStream = canvas.captureStream(FRAME_RATE);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks(),
  ]);

  return new Promise<string>((resolve, reject) => {
    try {
      const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
        .find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 2_500_000,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      let stopped = false;

      const cleanup = () => {
        audioSources.forEach(s => { try { s?.stop(); } catch { /* */ } });
        try { audioCtx.close(); } catch { /* */ }
      };

      const stopRecording = () => {
        if (stopped) return;
        stopped = true;
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, 500);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        console.log(`[DiaryVideo] ✅ 영상 완성! Size: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
        cleanup();
        onProgress?.(100, '완료!');
        resolve(url);
      };

      recorder.onerror = (e) => {
        cleanup();
        reject(new Error(`MediaRecorder 오류: ${e}`));
      };

      // ── 6. 녹화 + 애니메이션 ──
      recorder.start(100);
      console.log('[DiaryVideo] 🎬 녹화 시작!');

      const audioStartTime = audioCtx.currentTime + 0.1;
      for (let i = 0; i < loadedScenes.length; i++) {
        if (audioSources[i]) {
          audioSources[i].start(audioStartTime + sceneTimeline[i].start);
        }
      }

      const renderStartTime = performance.now() + 100;
      const totalMs = totalDuration * 1000;

      const animate = () => {
        if (stopped) return;

        const elapsed = performance.now() - renderStartTime;
        const currentTime = elapsed / 1000;
        const overallProgress = Math.min(elapsed / totalMs, 1);

        // 현재 장면 찾기
        let currentSceneIndex = loadedScenes.length - 1;
        for (let i = 0; i < sceneTimeline.length; i++) {
          if (currentTime < sceneTimeline[i].end) {
            currentSceneIndex = i;
            break;
          }
        }

        const scene = loadedScenes[currentSceneIndex];
        const timeline = sceneTimeline[currentSceneIndex];
        const sceneElapsed = currentTime - timeline.start;

        // 페이드 인/아웃
        let fadeAlpha = 1;
        const fadeInDuration = 0.4;
        const fadeOutDuration = 0.3;
        if (sceneElapsed < fadeInDuration) {
          fadeAlpha = sceneElapsed / fadeInDuration;
        } else if (timeline.duration - sceneElapsed < fadeOutDuration) {
          fadeAlpha = Math.max(0, (timeline.duration - sceneElapsed) / fadeOutDuration);
        }

        drawDiaryFrame(ctx, scene, fadeAlpha, currentSceneIndex + 1, loadedScenes.length);

        onProgress?.(Math.round(10 + overallProgress * 85), `장면 ${currentSceneIndex + 1}/${loadedScenes.length} 렌더링...`);

        if (elapsed < totalMs) {
          requestAnimationFrame(animate);
        } else {
          stopRecording();
        }
      };

      setTimeout(animate, 100);

      // 안전장치
      setTimeout(() => {
        if (!stopped) {
          console.warn('[DiaryVideo] ⏰ 타임아웃 → 강제 종료');
          stopRecording();
        }
      }, totalMs + 5000);

    } catch (error) {
      try { audioCtx.close(); } catch { /* */ }
      reject(error);
    }
  });
};

// ═══════════════════════════════════════════════════════════
// 🎨 일기 프레임 그리기
// ═══════════════════════════════════════════════════════════

function drawDiaryFrame(
  ctx: CanvasRenderingContext2D,
  scene: {
    englishLines: string[];
    koreanLines: string[];
    vocabulary: VocabItem[];
  },
  fadeAlpha: number,
  currentPage: number,
  totalPages: number,
) {
  const W = WIDTH;
  const H = HEIGHT;

  // ── 배경: 매트 크림색 ──
  ctx.fillStyle = CREAM_BG;
  ctx.fillRect(0, 0, W, H);

  // 미세한 텍스처 (옅은 줄무늬)
  ctx.fillStyle = CREAM_BG_DARK;
  for (let y = 0; y < H; y += 40) {
    ctx.fillRect(0, y, W, 1);
  }

  // 상단 장식 라인
  ctx.fillStyle = '#D4C9B8';
  ctx.fillRect(60, 50, W - 120, 2);
  ctx.fillRect(60, H - 50, W - 120, 2);

  // ── 콘텐츠 영역 (페이드 적용) ──
  ctx.globalAlpha = Math.max(0, Math.min(1, fadeAlpha));

  // ── 페이지 인디케이터 (우상단) ──
  ctx.font = 'bold 16px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#A09888';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`${currentPage} / ${totalPages}`, W - 70, 65);

  // ── 왼쪽 상단: 단어장 ──
  if (scene.vocabulary && scene.vocabulary.length > 0) {
    drawDiaryVocabulary(ctx, scene.vocabulary);
  }

  // ── 중앙: 영어 문장 (크게) ──
  const engFontSize = 32;
  ctx.font = `bold ${engFontSize}px "Noto Sans KR", sans-serif`;
  ctx.fillStyle = '#2D2A26';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const centerY = H * 0.42;
  const lineGap = engFontSize * 1.6;
  // 영어 문장 줄바꿈 처리
  const wrappedEngLines: string[] = [];
  for (const line of scene.englishLines) {
    const wrapped = wrapText(ctx, line, W - 200);
    wrappedEngLines.push(...wrapped);
  }

  const wrappedEngHeight = wrappedEngLines.length * lineGap;
  const engStartYAdjusted = centerY - wrappedEngHeight / 2 + lineGap / 2;

  wrappedEngLines.forEach((line, i) => {
    const y = engStartYAdjusted + i * lineGap;

    // 부드러운 텍스트 그림자
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
    ctx.fillText(line, W / 2 + 1, y + 2);

    // 본문 텍스트
    ctx.fillStyle = '#2D2A26';
    ctx.fillText(line, W / 2, y);
  });

  // ── 하단: 한글 번역 (자막) ──
  const koFontSize = 22;
  ctx.font = `500 ${koFontSize}px "Noto Sans KR", sans-serif`;
  ctx.fillStyle = '#7A756D';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const koLineGap = koFontSize * 1.5;
  const koBottomMargin = 70;

  // 한글 줄바꿈 처리
  const wrappedKoLines: string[] = [];
  for (const line of scene.koreanLines) {
    const wrapped = wrapText(ctx, line, W - 200);
    wrappedKoLines.push(...wrapped);
  }

  const koStartY = H - koBottomMargin - (wrappedKoLines.length - 1) * koLineGap;

  wrappedKoLines.forEach((line, i) => {
    const y = koStartY + i * koLineGap;
    ctx.fillText(line, W / 2, y);
  });

  // ── 하단 중앙 장식: 작은 점 ──
  ctx.fillStyle = '#C4B9A8';
  ctx.beginPath();
  ctx.arc(W / 2, H - 30, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

/** 일기 영상 단어장 (좌상단, 크림 배경에 맞는 스타일) */
function drawDiaryVocabulary(ctx: CanvasRenderingContext2D, vocabulary: VocabItem[]) {
  const maxDisplay = Math.min(vocabulary.length, 6); // 최대 6개 표시
  const startX = 70;
  const startY = 75;
  const lineHeight = 28;
  const padding = 12;

  // 배경 사각형 크기 계산
  ctx.font = 'bold 15px "Noto Sans KR", sans-serif';
  let maxWidth = 0;
  for (let i = 0; i < maxDisplay; i++) {
    const text = `${vocabulary[i].word}: ${vocabulary[i].meaning}`;
    maxWidth = Math.max(maxWidth, ctx.measureText(text).width);
  }

  const boxW = maxWidth + padding * 2 + 16;
  const boxH = maxDisplay * lineHeight + padding * 2;

  // 배경 (반투명 크림 + 테두리)
  ctx.fillStyle = 'rgba(237, 231, 218, 0.85)';
  roundRect(ctx, startX, startY, boxW, boxH, 10);
  ctx.fill();

  ctx.strokeStyle = '#D4C9B8';
  ctx.lineWidth = 1;
  roundRect(ctx, startX, startY, boxW, boxH, 10);
  ctx.stroke();

  // 왼쪽 악센트 라인
  ctx.fillStyle = '#C09050';
  ctx.fillRect(startX + 5, startY + 8, 3, boxH - 16);

  // 📖 헤더
  ctx.font = 'bold 12px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#A09080';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('📚 Words', startX + padding + 8, startY + 10);

  // 단어 텍스트
  for (let i = 0; i < maxDisplay; i++) {
    const v = vocabulary[i];
    const y = startY + padding + 16 + i * lineHeight;

    // 영어 단어 (진한 갈색)
    ctx.font = 'bold 15px "Noto Sans KR", sans-serif';
    ctx.fillStyle = '#6B4C30';
    const wordText = v.word + ': ';
    ctx.fillText(wordText, startX + padding + 8, y);

    // 한글 뜻 (회갈색)
    const wordWidth = ctx.measureText(wordText).width;
    ctx.font = '14px "Noto Sans KR", sans-serif';
    ctx.fillStyle = '#8A7A68';
    ctx.fillText(v.meaning, startX + padding + 8 + wordWidth, y);
  }

  if (vocabulary.length > maxDisplay) {
    ctx.font = '12px "Noto Sans KR", sans-serif';
    ctx.fillStyle = '#A09080';
    ctx.fillText(`+${vocabulary.length - maxDisplay}개 더`, startX + padding + 8, startY + padding + 16 + maxDisplay * lineHeight);
  }
}

/** 텍스트 줄바꿈 유틸리티 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine + (currentLine ? ' ' : '') + word;
    if (ctx.measureText(testLine).width > maxWidth && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  if (lines.length === 0) lines.push(text);
  return lines;
}

/** 둥근 사각형 그리기 유틸리티 */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}


// ═══════════════════════════════════════════════════════════
// 유틸리티
// ═══════════════════════════════════════════════════════════

function loadImage(source: Blob | File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(source);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const fallback = new Image();
      const c = document.createElement('canvas');
      c.width = WIDTH; c.height = HEIGHT;
      const cx = c.getContext('2d')!;
      const g = cx.createLinearGradient(0, 0, WIDTH, HEIGHT);
      g.addColorStop(0, '#1a1a2e');
      g.addColorStop(1, '#0f3460');
      cx.fillStyle = g;
      cx.fillRect(0, 0, WIDTH, HEIGHT);
      fallback.src = c.toDataURL();
      fallback.onload = () => resolve(fallback);
      fallback.onerror = () => reject(new Error('이미지 로드 실패'));
    };
    img.src = url;
  });
}
