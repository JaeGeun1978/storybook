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

        // ── 자막 그리기 (한 문장씩, 글자수 비례 타이밍 싱크) ──
        const chunks = scene.subtitleChunks;
        if (chunks.length > 0) {
          const timeRatio = sceneElapsed / timeline.duration; // 0~1

          // 현재 시간에 해당하는 문장 찾기
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

          // 부드러운 페이드인(0.3초) + 페이드아웃(0.2초)
          const fadeIn = Math.min(0.3, chunkDuration * 0.12);
          const fadeOut = Math.min(0.2, chunkDuration * 0.08);
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
 * 텍스트를 문장 단위로 분리하여 한 문장씩 표시.
 * 각 문장의 글자 수에 비례하여 시간을 배분 → TTS 음성과 자막 싱크 최적화.
 * 긴 문장은 40자 기준으로 자동 줄바꿈.
 */
function splitSubtitleIntoChunks(
  text: string
): { lines: string[]; charLen: number; startRatio: number; endRatio: number }[] {
  const MAX_CHARS_PER_LINE = 40;

  // 1) 문장 단위로 분리 (.!?。 뒤에 공백 또는 끝)
  const sentences = text.trim().match(/[^.!?。]*[.!?。]+[\s]*/g) || [text.trim()];
  // 빈 문장 제거 & trim
  const cleanSentences = sentences.map(s => s.trim()).filter(s => s.length > 0);

  if (cleanSentences.length === 0) {
    cleanSentences.push(text.trim());
  }

  // 2) 각 문장을 줄바꿈 처리하여 청크 생성
  const rawChunks: { lines: string[]; charLen: number }[] = [];

  for (const sentence of cleanSentences) {
    const lines: string[] = [];
    let remaining = sentence;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_CHARS_PER_LINE) {
        lines.push(remaining);
        break;
      }

      let breakPoint = MAX_CHARS_PER_LINE;

      // 쉼표/공백/한글 조사에서 끊기
      const commaIdx = remaining.lastIndexOf(',', MAX_CHARS_PER_LINE);
      const spaceIdx = remaining.lastIndexOf(' ', MAX_CHARS_PER_LINE);
      const koBreak = remaining.substring(0, MAX_CHARS_PER_LINE).search(/[을를이가은는에서도의와과로] /);

      if (commaIdx > MAX_CHARS_PER_LINE * 0.35) {
        breakPoint = commaIdx + 1;
      } else if (koBreak > MAX_CHARS_PER_LINE * 0.35) {
        breakPoint = koBreak + 1;
      } else if (spaceIdx > MAX_CHARS_PER_LINE * 0.35) {
        breakPoint = spaceIdx + 1;
      }

      lines.push(remaining.substring(0, breakPoint).trim());
      remaining = remaining.substring(breakPoint).trim();
    }

    if (lines.length === 0) lines.push(sentence.substring(0, MAX_CHARS_PER_LINE));

    rawChunks.push({
      lines,
      charLen: sentence.length,
    });
  }

  // 3) 글자 수 비례로 시간 비율 배분 → TTS 싱크
  const totalChars = rawChunks.reduce((sum, c) => sum + c.charLen, 0) || 1;
  const result: { lines: string[]; charLen: number; startRatio: number; endRatio: number }[] = [];
  let cumulative = 0;

  for (const chunk of rawChunks) {
    const ratio = chunk.charLen / totalChars;
    result.push({
      lines: chunk.lines,
      charLen: chunk.charLen,
      startRatio: cumulative,
      endRatio: cumulative + ratio,
    });
    cumulative += ratio;
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

/** 자막 그리기 (한 문장씩 표시, 하단 중앙) */
function drawSubtitle(ctx: CanvasRenderingContext2D, lines: string[], alpha: number) {
  if (!lines || lines.length === 0 || alpha <= 0) return;

  ctx.save();

  // 하단 그라데이션 오버레이 (자막 줄 수에 따라 높이 조정)
  const gradientStart = Math.min(0.50, 0.65 - lines.length * 0.03);
  const gradient = ctx.createLinearGradient(0, HEIGHT * gradientStart, 0, HEIGHT);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.25, 'rgba(0,0,0,0.3)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, HEIGHT * gradientStart, WIDTH, HEIGHT * (1 - gradientStart));

  // 자막 텍스트 — 폰트 축소 (40px → 28px)
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.font = 'bold 28px "Noto Sans KR", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';

  const lineHeight = 40;
  const bottomMargin = 36;
  const startY = HEIGHT - bottomMargin - (lines.length - 1) * lineHeight;

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    // 외곽선 (가독성)
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 4;
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

  // 배경 영역 크기 계산 (20% 여유)
  ctx.font = 'bold 16px "Noto Sans KR", sans-serif';
  let maxWidth = 0;
  for (const v of vocabulary) {
    const text = `${v.word}: ${v.meaning}`;
    maxWidth = Math.max(maxWidth, ctx.measureText(text).width);
  }

  const boxW = (maxWidth + padding * 2 + 8) * 1.2;
  const boxH = (vocabulary.length * lineHeight + padding * 2) * 1.2;

  // 반투명 배경 (둥근 사각형)
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const r = 12;
  ctx.beginPath();
  ctx.moveTo(startX + r, startY);
  ctx.lineTo(startX + boxW - r, startY);
  ctx.arcTo(startX + boxW, startY, startX + boxW, startY + r, r);
  ctx.lineTo(startX + boxW, startY + boxH - r);
  ctx.arcTo(startX + boxW, startY + boxH, startX + boxW - r, startY + boxH, r);
  ctx.lineTo(startX + r, startY + boxH);
  ctx.arcTo(startX, startY + boxH, startX, startY + boxH - r, r);
  ctx.lineTo(startX, startY + r);
  ctx.arcTo(startX, startY, startX + r, startY, r);
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
// 🎨 일기 프레임 그리기 (상하 분할: 위=단어, 아래=영어+한글)
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

  // ── 콘텐츠 영역 (페이드 적용) ──
  ctx.globalAlpha = Math.max(0, Math.min(1, fadeAlpha));

  // 화면 분할: 위쪽 50% = 단어, 아래쪽 50% = 문장
  const dividerY = H * 0.48;

  // ── 구분선 ──
  ctx.fillStyle = '#D4C9B8';
  ctx.fillRect(60, dividerY, W - 120, 1.5);

  // ── 페이지 인디케이터 (우상단) ──
  ctx.font = 'bold 16px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#A09888';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`${currentPage} / ${totalPages}`, W - 50, 20);

  // ═══════════════════════════════════════
  // 위쪽: 단어장 (3열 레이아웃)
  // ═══════════════════════════════════════
  if (scene.vocabulary && scene.vocabulary.length > 0) {
    drawDiaryVocabulary3Col(ctx, scene.vocabulary, dividerY);
  } else {
    // 단어가 없으면 안내 텍스트
    ctx.font = '18px "Noto Sans KR", sans-serif';
    ctx.fillStyle = '#B0A898';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📚 No vocabulary for this sentence', W / 2, dividerY / 2);
  }

  // ═══════════════════════════════════════
  // 아래쪽: 영어 문장 + 한글 해석
  // ═══════════════════════════════════════
  const bottomAreaTop = dividerY + 20;
  const bottomAreaHeight = H - bottomAreaTop - 40;
  const bottomCenterY = bottomAreaTop + bottomAreaHeight / 2;

  // 영어 문장 (크게, 진한 색)
  const engFontSize = 30;
  ctx.font = `bold ${engFontSize}px "Noto Sans KR", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const engText = scene.englishLines[0] || '';
  const wrappedEng = wrapText(ctx, engText, W - 160);
  const engLineGap = engFontSize * 1.5;
  const totalEngHeight = wrappedEng.length * engLineGap;

  // 한글 번역 준비
  const koFontSize = 22;
  ctx.font = `500 ${koFontSize}px "Noto Sans KR", sans-serif`;
  const koText = scene.koreanLines[0] || '';
  const wrappedKo = wrapText(ctx, koText, W - 160);
  const koLineGap = koFontSize * 1.4;
  const totalKoHeight = wrappedKo.length * koLineGap;

  // 영어+한글 전체 높이 계산 (간격 포함)
  const gapBetween = 24;
  const totalTextHeight = totalEngHeight + gapBetween + totalKoHeight;
  const textStartY = bottomCenterY - totalTextHeight / 2;

  // 영어 문장 그리기
  ctx.font = `bold ${engFontSize}px "Noto Sans KR", sans-serif`;
  wrappedEng.forEach((line, i) => {
    const y = textStartY + i * engLineGap + engLineGap / 2;

    // 부드러운 텍스트 그림자
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
    ctx.fillText(line, W / 2 + 1, y + 2);

    // 본문 텍스트
    ctx.fillStyle = '#2D2A26';
    ctx.fillText(line, W / 2, y);
  });

  // 한글 번역 그리기
  ctx.font = `500 ${koFontSize}px "Noto Sans KR", sans-serif`;
  ctx.fillStyle = '#7A756D';
  const koStartY = textStartY + totalEngHeight + gapBetween;
  wrappedKo.forEach((line, i) => {
    const y = koStartY + i * koLineGap + koLineGap / 2;
    ctx.fillText(line, W / 2, y);
  });

  // ── 하단 장식: 작은 점 ──
  ctx.fillStyle = '#C4B9A8';
  ctx.beginPath();
  ctx.arc(W / 2, H - 20, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

/**
 * 일기 영상 단어장 (3열 레이아웃: 왼쪽 / 중간 / 오른쪽)
 * 열당 최대 5개, 총 최대 15개 단어 표시
 */
function drawDiaryVocabulary3Col(
  ctx: CanvasRenderingContext2D,
  vocabulary: VocabItem[],
  dividerY: number,
) {
  const W = WIDTH;
  const maxPerCol = 5;
  const maxTotal = maxPerCol * 3; // 15개
  const displayVocab = vocabulary.slice(0, maxTotal);

  // 3열로 나누기
  const col1 = displayVocab.slice(0, maxPerCol);
  const col2 = displayVocab.slice(maxPerCol, maxPerCol * 2);
  const col3 = displayVocab.slice(maxPerCol * 2, maxPerCol * 3);
  const columns = [col1, col2, col3].filter(c => c.length > 0);

  // 레이아웃 설정
  const topMargin = 50;
  const areaHeight = dividerY - topMargin - 20;
  const lineHeight = 30;
  const padding = 16;
  const colGap = 20;

  // 각 열의 너비 계산
  const totalWidth = W - 100; // 좌우 여백 50px씩
  const colWidth = columns.length > 1
    ? (totalWidth - colGap * (columns.length - 1)) / columns.length
    : totalWidth * 0.5;

  // 열 시작 X 좌표 계산 (중앙 정렬)
  const totalColsWidth = colWidth * columns.length + colGap * (columns.length - 1);
  const startXBase = (W - totalColsWidth) / 2;

  // 📚 헤더
  ctx.font = 'bold 15px "Noto Sans KR", sans-serif';
  ctx.fillStyle = '#A09080';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('📚 Vocabulary', W / 2, topMargin - 30);

  // 각 열 그리기
  columns.forEach((colVocab, colIdx) => {
    const colX = startXBase + colIdx * (colWidth + colGap);
    const maxRows = Math.min(colVocab.length, maxPerCol);
    const boxH = maxRows * lineHeight + padding * 2;
    const boxY = topMargin + (areaHeight - boxH) / 2; // 수직 중앙 정렬

    // 열 배경 (반투명 크림 + 둥근 모서리)
    ctx.fillStyle = 'rgba(237, 231, 218, 0.8)';
    roundRect(ctx, colX, boxY, colWidth, boxH, 10);
    ctx.fill();

    ctx.strokeStyle = '#D4C9B8';
    ctx.lineWidth = 1;
    roundRect(ctx, colX, boxY, colWidth, boxH, 10);
    ctx.stroke();

    // 왼쪽 악센트 라인
    ctx.fillStyle = '#C09050';
    ctx.fillRect(colX + 5, boxY + 8, 3, boxH - 16);

    // 단어 텍스트
    for (let i = 0; i < maxRows; i++) {
      const v = colVocab[i];
      const y = boxY + padding + i * lineHeight + lineHeight / 2;

      // 영어 단어 (진한 갈색, 볼드)
      ctx.font = 'bold 14px "Noto Sans KR", sans-serif';
      ctx.fillStyle = '#6B4C30';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const wordText = v.word;
      ctx.fillText(wordText, colX + padding + 8, y);

      // 한글 뜻 (회갈색)
      const wordWidth = ctx.measureText(wordText + ' ').width;
      ctx.font = '13px "Noto Sans KR", sans-serif';
      ctx.fillStyle = '#8A7A68';

      // 뜻이 열 너비를 초과하면 잘라내기
      const meaningMaxWidth = colWidth - padding * 2 - 8 - wordWidth - 4;
      let meaningText = v.meaning;
      if (ctx.measureText(meaningText).width > meaningMaxWidth && meaningMaxWidth > 20) {
        while (ctx.measureText(meaningText + '…').width > meaningMaxWidth && meaningText.length > 1) {
          meaningText = meaningText.slice(0, -1);
        }
        meaningText += '…';
      }
      ctx.fillText(meaningText, colX + padding + 8 + wordWidth + 4, y);
    }
  });

  // 표시하지 못한 단어가 있으면 안내
  if (vocabulary.length > maxTotal) {
    ctx.font = '12px "Noto Sans KR", sans-serif';
    ctx.fillStyle = '#A09080';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`+${vocabulary.length - maxTotal}개 더`, W / 2, dividerY - 18);
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
