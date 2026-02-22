/**
 * 📖 PDF 동화책 생성기
 * 
 * jsPDF + Canvas 기반 한글 텍스트 렌더링
 * 
 * 구성:
 *  - 표지 (제목 + 첫 번째 장면 이미지)
 *  - 장면별 페이지 (왼쪽 이미지 + 오른쪽 텍스트 카드)
 *  - 엔딩 페이지
 */

import jsPDF from 'jspdf';

interface SceneForPdf {
  text: string;
  imageUrl?: string;
  imagePrompt?: string;
  translation?: string; // 영어 스토리: 한글 번역
}

interface PdfOptions {
  title: string;
  scenes: SceneForPdf[];
  language?: 'ko' | 'en';
  onProgress?: (progress: number, status: string) => void;
}

// A4 가로(landscape) = 297mm × 210mm
const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 18;
const DPR = 2; // renderText에서 사용하는 고해상도 배율
const MM_PER_PX = 0.264583; // 1 논리 픽셀 = 0.264583mm (96dpi 기준)
const PX_TO_MM = MM_PER_PX / DPR; // 캔버스 2x 픽셀 → mm 변환 (dpr 보정 포함)

export const generateStoryBookPdf = async ({
  title,
  scenes,
  language = 'ko',
  onProgress,
}: PdfOptions): Promise<Blob> => {
  console.log(`[PDF] 📖 동화책 PDF 생성 시작: "${title}", ${scenes.length}개 장면`);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  onProgress?.(5, '표지 생성 중...');

  // ═══ 표지 ═══
  await drawCoverPage(doc, title, language, scenes[0]?.imageUrl);

  // ═══ 장면 페이지 ═══
  for (let i = 0; i < scenes.length; i++) {
    const progress = Math.round(10 + (i / scenes.length) * 80);
    onProgress?.(progress, `페이지 ${i + 1}/${scenes.length} 생성 중...`);
    doc.addPage();
    await drawScenePage(doc, scenes[i], i, scenes.length);
  }

  // ═══ 한줄해석 (영어 스토리북만) ═══
  if (language === 'en') {
    const scenesWithTranslation = scenes.filter(s => s.translation);
    if (scenesWithTranslation.length > 0) {
      onProgress?.(90, '한줄해석 페이지 생성 중...');
      doc.addPage();
      await drawTranslationPages(doc, scenes);
    }
  }

  // ═══ 엔딩 ═══
  onProgress?.(95, '마무리 중...');
  doc.addPage();
  await drawEndingPage(doc, title, language);

  onProgress?.(100, 'PDF 생성 완료!');
  console.log('[PDF] ✅ PDF 생성 완료');

  return doc.output('blob');
};

// ═══════════════════════════════════════════════════════════
// 페이지 그리기
// ═══════════════════════════════════════════════════════════

/** 표지 */
async function drawCoverPage(doc: jsPDF, title: string, language: 'ko' | 'en' = 'ko', imageUrl?: string) {
  // 배경
  doc.setFillColor(12, 12, 24);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // 배경 이미지 (어둡게)
  if (imageUrl) {
    try {
      const imgData = await urlToDataUrl(imageUrl);
      if (imgData) {
        doc.addImage(imgData, 'PNG', 0, 0, PAGE_W, PAGE_H);
        doc.setFillColor(0, 0, 0);
        doc.setGState(new (doc as any).GState({ opacity: 0.5 }));
        doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
        doc.setGState(new (doc as any).GState({ opacity: 1 }));
      }
    } catch (e) {
      console.warn('[PDF] 표지 이미지 실패:', e);
    }
  }

  // 상단 장식선
  doc.setDrawColor(180, 160, 255);
  doc.setLineWidth(0.3);
  doc.line(PAGE_W * 0.35, PAGE_H * 0.28, PAGE_W * 0.65, PAGE_H * 0.28);

  // 제목
  const titleCanvas = renderText(title, {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FFFFFF',
    maxWidth: 750,
    lineHeight: 1.4,
    textAlign: 'center',
  });
  placeCanvas(doc, titleCanvas, PAGE_H * 0.32, 'center');

  // 하단 장식선
  const titleBottom = PAGE_H * 0.32 + titleCanvas.height * PX_TO_MM / 2 + 8;
  doc.setDrawColor(180, 160, 255);
  doc.line(PAGE_W * 0.35, titleBottom, PAGE_W * 0.65, titleBottom);

  // 부제  
  const brandText = language === 'en' ? "Jaegeun's Storybook" : '재근쌤 스토리북';
  const subCanvas = renderText(brandText, {
    fontSize: 18,
    fontWeight: 'normal',
    color: 'rgba(255,255,255,0.55)',
    maxWidth: 500,
    lineHeight: 1.3,
    textAlign: 'center',
  });
  placeCanvas(doc, subCanvas, titleBottom + 10, 'center');
}

/** 장면 페이지 */
async function drawScenePage(doc: jsPDF, scene: SceneForPdf, index: number, _total: number) {
  // 전체 배경: 밝은 회백색
  doc.setFillColor(248, 248, 250);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  const imgAreaW = PAGE_W * 0.52;
  const textAreaX = imgAreaW + 4;
  const textAreaW = PAGE_W - textAreaX - MARGIN;

  // ── 왼쪽: 이미지 ──
  const imgX = MARGIN;
  const imgY = MARGIN;
  const imgW = imgAreaW - MARGIN - 4;
  const imgH = PAGE_H - MARGIN * 2;

  if (scene.imageUrl) {
    try {
      const imgData = await urlToDataUrl(scene.imageUrl);
      if (imgData) {
        // 이미지 영역 클리핑용 배경 (둥근 느낌)
        doc.setFillColor(240, 240, 242);
        doc.roundedRect(imgX - 1, imgY - 1, imgW + 2, imgH + 2, 2, 2, 'F');
        doc.addImage(imgData, 'PNG', imgX, imgY, imgW, imgH);
      } else {
        drawPlaceholder(doc, imgX, imgY, imgW, imgH, index);
      }
    } catch {
      drawPlaceholder(doc, imgX, imgY, imgW, imgH, index);
    }
  } else {
    drawPlaceholder(doc, imgX, imgY, imgW, imgH, index);
  }

  // ── 오른쪽: 텍스트 카드 ──
  const cardX = textAreaX;
  const cardY = MARGIN;
  const cardW = textAreaW;
  const cardH = PAGE_H - MARGIN * 2;

  // 텍스트 카드 배경 (연한 크림색)
  doc.setFillColor(255, 253, 248);
  doc.roundedRect(cardX, cardY, cardW, cardH, 2, 2, 'F');

  // 카드 테두리 (아주 연하게)
  doc.setDrawColor(235, 232, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(cardX, cardY, cardW, cardH, 2, 2, 'S');

  // 텍스트 영역 패딩
  const textPadX = 10;
  const textPadY = 14;
  const innerW = cardW - textPadX * 2;

  // 본문 텍스트 (전체 동일 크기, dpr 보정)
  const maxWidthPx = innerW / MM_PER_PX; // mm → 논리 픽셀 (1x)
  const bodyCanvas = renderText(scene.text, {
    fontSize: 19,
    fontWeight: 'normal',
    color: '#3A3A4A',
    maxWidth: maxWidthPx,
    lineHeight: 2.0,
    textAlign: 'left',
  });

  const bodyW = Math.min(bodyCanvas.width * PX_TO_MM, innerW);
  const bodyH = bodyCanvas.height * PX_TO_MM;
  doc.addImage(
    bodyCanvas.toDataURL('image/png'), 'PNG',
    cardX + textPadX, cardY + textPadY,
    bodyW, bodyH
  );

  // ── 하단: 페이지 번호 (미니멀) ──
  const pageCanvas = renderText(`${index + 1}`, {
    fontSize: 11,
    fontWeight: 'normal',
    color: '#C0C0C0',
    maxWidth: 100,
    lineHeight: 1,
    textAlign: 'center',
  });
  placeCanvas(doc, pageCanvas, PAGE_H - 9, 'center');
}

/** 엔딩 페이지 */
async function drawEndingPage(doc: jsPDF, title: string, language: 'ko' | 'en' = 'ko') {
  doc.setFillColor(12, 12, 24);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  const endText = language === 'en' ? '— The End —' : '— 끝 —';
  const endCanvas = renderText(endText, {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#FFFFFF',
    maxWidth: 500,
    lineHeight: 1.3,
    textAlign: 'center',
  });
  placeCanvas(doc, endCanvas, PAGE_H * 0.38, 'center');

  const creditText = language === 'en'
    ? `"${title}"\nMade with Jaegeun's Storybook`
    : `"${title}"\n재근쌤 스토리북으로 제작됨`;
  const creditCanvas = renderText(creditText, {
    fontSize: 15,
    fontWeight: 'normal',
    color: 'rgba(255,255,255,0.45)',
    maxWidth: 500,
    lineHeight: 1.7,
    textAlign: 'center',
  });
  placeCanvas(doc, creditCanvas, PAGE_H * 0.55, 'center');
}

/**
 * 한줄해석 페이지 (영어 스토리북 전용)
 * 
 * 📌 장면 단위로 영어 전체 + 한글 전체를 쌍으로 표시
 * 📌 폰트 크기 고정 (영어 13px, 한글 13px), 자연스러운 줄바꿈
 * 📌 영문 단어는 중간에 끊기지 않음
 */
async function drawTranslationPages(doc: jsPDF, scenes: SceneForPdf[]) {
  const EN_FONT_SIZE = 13;
  const KO_FONT_SIZE = 13;
  const contentMaxW = PAGE_W - MARGIN * 2 - 16;
  const maxWidthPx = contentMaxW / MM_PER_PX; // mm → 논리 픽셀 (1x)

  // 새 페이지 시작 헬퍼
  const startNewPage = (isFirst: boolean): number => {
    if (!isFirst) doc.addPage();
    doc.setFillColor(252, 251, 248);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

    if (isFirst) {
      // 제목 (첫 페이지만)
      const titleCanvas = renderText('📖 Line-by-Line Translation  한줄해석', {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#3A3A4A',
        maxWidth: 800,
        lineHeight: 1.3,
        textAlign: 'center',
      });
      placeCanvas(doc, titleCanvas, MARGIN, 'center');

      const lineY = MARGIN + titleCanvas.height * PX_TO_MM + 5;
      doc.setDrawColor(200, 195, 185);
      doc.setLineWidth(0.3);
      doc.line(MARGIN + 30, lineY, PAGE_W - MARGIN - 30, lineY);
      return lineY + 7;
    }
    return MARGIN + 5;
  };

  let currentY = startNewPage(true);

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene.translation) continue;

    // ── 장면 번호 라벨 ──
    const labelCanvas = renderText(`Scene ${i + 1}`, {
      fontSize: 11,
      fontWeight: 'bold',
      color: '#9090A0',
      maxWidth: maxWidthPx,
      lineHeight: 1.2,
      textAlign: 'left',
    });
    const labelH = labelCanvas.height * PX_TO_MM;

    // ── 영어 텍스트 ──
    const enCanvas = renderText(scene.text, {
      fontSize: EN_FONT_SIZE,
      fontWeight: 'bold',
      color: '#2D2D3F',
      maxWidth: maxWidthPx,
      lineHeight: 1.7,
      textAlign: 'left',
    });
    const enH = enCanvas.height * PX_TO_MM;
    const enW = Math.min(enCanvas.width * PX_TO_MM, contentMaxW);

    // ── 한글 번역 ──
    const koCanvas = renderText(scene.translation, {
      fontSize: KO_FONT_SIZE,
      fontWeight: 'normal',
      color: '#6A6A7A',
      maxWidth: maxWidthPx,
      lineHeight: 1.7,
      textAlign: 'left',
    });
    const koH = koCanvas.height * PX_TO_MM;
    const koW = Math.min(koCanvas.width * PX_TO_MM, contentMaxW);

    // 이 장면에 필요한 총 높이
    const blockH = labelH + 2 + enH + 2 + koH + 10;

    // 페이지 넘침 체크
    if (currentY + blockH > PAGE_H - 15) {
      currentY = startNewPage(false);
    }

    // 장면 번호
    const labelW = Math.min(labelCanvas.width * PX_TO_MM, contentMaxW);
    doc.addImage(labelCanvas.toDataURL('image/png'), 'PNG', MARGIN + 8, currentY, labelW, labelH);
    currentY += labelH + 2;

    // 영어 (진한 색, bold)
    doc.addImage(enCanvas.toDataURL('image/png'), 'PNG', MARGIN + 8, currentY, enW, enH);
    currentY += enH + 2;

    // 한글 (연한 색)
    doc.addImage(koCanvas.toDataURL('image/png'), 'PNG', MARGIN + 8, currentY, koW, koH);
    currentY += koH + 5;

    // 장면 구분선 (마지막 장면 제외)
    if (i < scenes.length - 1) {
      doc.setDrawColor(230, 225, 218);
      doc.setLineWidth(0.2);
      doc.line(MARGIN + 30, currentY, PAGE_W - MARGIN - 30, currentY);
      currentY += 7;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 유틸리티
// ═══════════════════════════════════════════════════════════

/** Placeholder 사각형 */
function drawPlaceholder(doc: jsPDF, x: number, y: number, w: number, h: number, index: number) {
  const colors = [[26, 26, 46], [13, 27, 42], [45, 27, 105], [27, 40, 56]];
  const c = colors[index % colors.length];
  doc.setFillColor(c[0], c[1], c[2]);
  doc.roundedRect(x, y, w, h, 2, 2, 'F');
}

/**
 * Canvas로 텍스트 렌더링 (Noto Sans KR)
 * 
 * 📌 영문 단어는 중간에 끊기지 않고 단어 전체를 다음 줄로 넘김
 * 📌 한글은 단어(공백 기준) 단위로 줄바꿈
 */
function renderText(text: string, options: {
  fontSize: number;
  fontWeight: string;
  color: string;
  maxWidth: number;
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right';
}): HTMLCanvasElement {
  const { fontSize, fontWeight, color, maxWidth, lineHeight, textAlign } = options;
  const dpr = 2;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `${fontWeight} ${fontSize * dpr}px "Noto Sans KR", sans-serif`;
  ctx.font = font;

  const maxW_px = maxWidth * dpr;

  // ── 단어 단위 줄바꿈 (영문 단어 중간 끊김 방지) ──
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (para.trim() === '') { lines.push(''); continue; }

    // 공백 기준으로 토큰 분리
    const words = para.split(/(\s+)/); // 공백도 보존
    let currentLine = '';

    for (const word of words) {
      if (word.trim() === '' && currentLine === '') continue; // 줄 시작 공백 무시

      const testLine = currentLine + word;
      const testWidth = ctx.measureText(testLine).width;

      if (testWidth > maxW_px && currentLine.trim().length > 0) {
        // 현재 줄 확정, 새 줄 시작
        lines.push(currentLine.trimEnd());
        currentLine = word.trimStart(); // 다음 줄은 앞 공백 제거
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trimEnd());
  }

  if (lines.length === 0) lines.push('');

  // ── 캔버스 크기 계산 ──
  const lh = fontSize * dpr * lineHeight;
  let measuredMaxW = 0;
  for (const l of lines) measuredMaxW = Math.max(measuredMaxW, ctx.measureText(l).width);

  canvas.width = Math.ceil(Math.min(measuredMaxW + 20, maxW_px + 20));
  canvas.height = Math.ceil(lines.length * lh + fontSize * dpr * 0.4);

  // 다시 폰트 (resize 후 초기화됨)
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = textAlign;

  const xPos = textAlign === 'center' ? canvas.width / 2
    : textAlign === 'right' ? canvas.width - 10 : 10;

  lines.forEach((line, i) => {
    ctx.fillText(line, xPos, i * lh);
  });

  return canvas;
}

/** Canvas 이미지를 PDF 페이지에 배치 (dpr 보정 포함) */
function placeCanvas(doc: jsPDF, canvas: HTMLCanvasElement, y: number, align: 'center' | 'left' | 'right') {
  const data = canvas.toDataURL('image/png');
  const w = Math.min(canvas.width * PX_TO_MM, PAGE_W - MARGIN * 2);
  const h = canvas.height * PX_TO_MM;
  let x: number;
  if (align === 'center') x = (PAGE_W - w) / 2;
  else if (align === 'right') x = PAGE_W - MARGIN - w;
  else x = MARGIN;
  doc.addImage(data, 'PNG', x, y, w, h);
}

/** URL → data:URL 변환 */
async function urlToDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 📝 영어지문설명 PDF 생성 (한줄해석 포함)
// ═══════════════════════════════════════════════════════════

interface ExamSegmentForPdf {
  segmentId: number;
  segmentRole: string;
  scriptMaleOriginal: string;
  scriptFemaleSimplified: string;
  scriptMaleExplanation: string;
  koreanTranslation?: string;
  imageUrl?: string;
}

interface ExamPdfOptions {
  title: string;
  passage: string;
  segments: ExamSegmentForPdf[];
  onProgress?: (progress: number, status: string) => void;
}

export const generateExamPdf = async ({
  title,
  passage,
  segments,
  onProgress,
}: ExamPdfOptions): Promise<Blob> => {
  console.log(`[PDF] 📝 영어지문설명 PDF: "${title}"`);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const PW = 210;
  const PH = 297;
  const M = 16;
  const PX = PX_TO_MM; // canvas px → mm (dpr 보정 포함)
  const contentW = PW - M * 2;
  const maxWpx = contentW / MM_PER_PX; // mm → 논리 픽셀 (1x)

  // ── 표지 ──
  onProgress?.(5, '표지 생성 중...');
  doc.setFillColor(10, 15, 30);
  doc.rect(0, 0, PW, PH, 'F');

  // 장식
  doc.setDrawColor(80, 180, 220);
  doc.setLineWidth(0.5);
  doc.line(PW * 0.3, PH * 0.25, PW * 0.7, PH * 0.25);

  const coverT = renderText('📝 English Passage Analysis', {
    fontSize: 32, fontWeight: 'bold', color: '#FFFFFF',
    maxWidth: 650, lineHeight: 1.5, textAlign: 'center',
  });
  placeCanvas(doc, coverT, PH * 0.28, 'center');

  const coverST = renderText(title, {
    fontSize: 16, fontWeight: 'normal', color: 'rgba(255,255,255,0.5)',
    maxWidth: 550, lineHeight: 1.4, textAlign: 'center',
  });
  placeCanvas(doc, coverST, PH * 0.28 + coverT.height * PX + 8, 'center');

  const brandT = renderText("재근쌤 스토리북  ·  Passage Guide", {
    fontSize: 13, fontWeight: 'normal', color: 'rgba(255,255,255,0.3)',
    maxWidth: 400, lineHeight: 1.3, textAlign: 'center',
  });
  placeCanvas(doc, brandT, PH * 0.72, 'center');

  doc.setDrawColor(80, 180, 220);
  doc.line(PW * 0.3, PH * 0.7, PW * 0.7, PH * 0.7);

  // ── 원문 전체 페이지 ──
  onProgress?.(15, '원문 페이지...');
  doc.addPage();
  doc.setFillColor(252, 251, 248);
  doc.rect(0, 0, PW, PH, 'F');

  const origTitle = renderText('📋 Original Passage', {
    fontSize: 22, fontWeight: 'bold', color: '#2D2D3F',
    maxWidth: maxWpx, lineHeight: 1.3, textAlign: 'center',
  });
  placeCanvas(doc, origTitle, M, 'center');

  let oy = M + origTitle.height * PX + 8;
  doc.setDrawColor(200, 195, 185);
  doc.setLineWidth(0.2);
  doc.line(M + 20, oy, PW - M - 20, oy);
  oy += 6;

  const passageCanvas = renderText(passage, {
    fontSize: 12, fontWeight: 'normal', color: '#3A3A4A',
    maxWidth: maxWpx, lineHeight: 1.9, textAlign: 'left',
  });
  const passW = Math.min(passageCanvas.width * PX, contentW);
  const passH_raw = passageCanvas.height * PX;
  const passH = Math.min(passH_raw, PH - oy - 15);
  const passFinalW = passH < passH_raw ? passW * (passH / passH_raw) : passW;
  doc.addImage(passageCanvas.toDataURL('image/png'), 'PNG', M, oy, passFinalW, passH);

  // ── 세그먼트별 분석 + 한줄해석 ──
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const pct = Math.round(20 + (i / segments.length) * 60);
    onProgress?.(pct, `Segment ${i + 1} 생성 중...`);

    doc.addPage();
    doc.setFillColor(252, 251, 248);
    doc.rect(0, 0, PW, PH, 'F');

    let cy = M;

    // 세그먼트 헤더
    const segHeader = renderText(`Segment ${seg.segmentId}   —   ${seg.segmentRole}`, {
      fontSize: 18, fontWeight: 'bold', color: '#1A6B8A',
      maxWidth: maxWpx, lineHeight: 1.3, textAlign: 'left',
    });
    const shW = Math.min(segHeader.width * PX, contentW);
    const shH = segHeader.height * PX;
    doc.addImage(segHeader.toDataURL('image/png'), 'PNG', M, cy, shW, shH);
    cy += shH + 3;

    doc.setDrawColor(26, 107, 138);
    doc.setLineWidth(0.3);
    doc.line(M, cy, PW - M, cy);
    cy += 6;

    // 이미지 (있으면)
    if (seg.imageUrl) {
      try {
        const imgData = await urlToDataUrl(seg.imageUrl);
        if (imgData) {
          const imgH = 52;
          doc.addImage(imgData, 'PNG', M, cy, contentW, imgH);
          cy += imgH + 5;
        }
      } catch { /* skip */ }
    }

    // 📖 Original
    const origLabel = renderText('📖 Original', {
      fontSize: 10, fontWeight: 'bold', color: '#3B82F6',
      maxWidth: maxWpx, lineHeight: 1.2, textAlign: 'left',
    });
    doc.addImage(origLabel.toDataURL('image/png'), 'PNG', M, cy, Math.min(origLabel.width * PX, contentW), origLabel.height * PX);
    cy += origLabel.height * PX + 2;

    const origText = renderText(seg.scriptMaleOriginal, {
      fontSize: 11, fontWeight: 'normal', color: '#2D2D3F',
      maxWidth: maxWpx, lineHeight: 1.7, textAlign: 'left',
    });
    const otW = Math.min(origText.width * PX, contentW);
    const otH = origText.height * PX;
    doc.addImage(origText.toDataURL('image/png'), 'PNG', M + 2, cy, otW, otH);
    cy += otH + 5;

    // 💡 Simplified
    if (cy < PH - 50) {
      const simpLabel = renderText('💡 Simplified Explanation', {
        fontSize: 10, fontWeight: 'bold', color: '#EC4899',
        maxWidth: maxWpx, lineHeight: 1.2, textAlign: 'left',
      });
      doc.addImage(simpLabel.toDataURL('image/png'), 'PNG', M, cy, Math.min(simpLabel.width * PX, contentW), simpLabel.height * PX);
      cy += simpLabel.height * PX + 2;

      const simpText = renderText(seg.scriptFemaleSimplified, {
        fontSize: 11, fontWeight: 'normal', color: '#4A4A5A',
        maxWidth: maxWpx, lineHeight: 1.7, textAlign: 'left',
      });
      const stW = Math.min(simpText.width * PX, contentW);
      const stH = simpText.height * PX;
      doc.addImage(simpText.toDataURL('image/png'), 'PNG', M + 2, cy, stW, stH);
      cy += stH + 5;
    }

    // 📚 Vocabulary & Grammar
    if (cy < PH - 50) {
      const vocLabel = renderText('📚 Vocabulary & Grammar', {
        fontSize: 10, fontWeight: 'bold', color: '#F59E0B',
        maxWidth: maxWpx, lineHeight: 1.2, textAlign: 'left',
      });
      doc.addImage(vocLabel.toDataURL('image/png'), 'PNG', M, cy, Math.min(vocLabel.width * PX, contentW), vocLabel.height * PX);
      cy += vocLabel.height * PX + 2;

      const vocText = renderText(seg.scriptMaleExplanation, {
        fontSize: 11, fontWeight: 'normal', color: '#4A4A5A',
        maxWidth: maxWpx, lineHeight: 1.7, textAlign: 'left',
      });
      const vtW = Math.min(vocText.width * PX, contentW);
      const vtH = vocText.height * PX;
      doc.addImage(vocText.toDataURL('image/png'), 'PNG', M + 2, cy, vtW, vtH);
      cy += vtH + 5;
    }

    // 📋 한줄해석
    if (seg.koreanTranslation && cy < PH - 40) {
      doc.setDrawColor(230, 225, 218);
      doc.setLineWidth(0.15);
      doc.line(M + 10, cy, PW - M - 10, cy);
      cy += 4;

      const koLabel = renderText('📋 한줄해석', {
        fontSize: 10, fontWeight: 'bold', color: '#6B7280',
        maxWidth: maxWpx, lineHeight: 1.2, textAlign: 'left',
      });
      doc.addImage(koLabel.toDataURL('image/png'), 'PNG', M, cy, Math.min(koLabel.width * PX, contentW), koLabel.height * PX);
      cy += koLabel.height * PX + 2;

      const koText = renderText(seg.koreanTranslation, {
        fontSize: 11, fontWeight: 'normal', color: '#7A7A8A',
        maxWidth: maxWpx, lineHeight: 1.8, textAlign: 'left',
      });
      const ktW = Math.min(koText.width * PX, contentW);
      const ktH = koText.height * PX;
      doc.addImage(koText.toDataURL('image/png'), 'PNG', M + 2, cy, ktW, ktH);
    }
  }

  // ── 한줄해석 전체 모아보기 ──
  onProgress?.(85, '한줄해석 모아보기 생성 중...');
  doc.addPage();
  doc.setFillColor(252, 251, 248);
  doc.rect(0, 0, PW, PH, 'F');

  const transTitle = renderText('📖 한줄해석 모아보기   Line-by-Line Translation', {
    fontSize: 20, fontWeight: 'bold', color: '#2D2D3F',
    maxWidth: maxWpx, lineHeight: 1.3, textAlign: 'center',
  });
  placeCanvas(doc, transTitle, M, 'center');

  let ty = M + transTitle.height * PX + 4;
  doc.setDrawColor(200, 195, 185);
  doc.setLineWidth(0.2);
  doc.line(M + 20, ty, PW - M - 20, ty);
  ty += 7;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.koreanTranslation) continue;

    // 번호
    const numCanvas = renderText(`${seg.segmentId}`, {
      fontSize: 10, fontWeight: 'bold', color: '#9CA3AF',
      maxWidth: 100, lineHeight: 1.2, textAlign: 'left',
    });
    const numH = numCanvas.height * PX;

    // 영어 원문
    const enCanvas = renderText(seg.scriptMaleOriginal, {
      fontSize: 11, fontWeight: 'bold', color: '#2D2D3F',
      maxWidth: maxWpx - 20, lineHeight: 1.7, textAlign: 'left',
    });
    const enH = enCanvas.height * PX;
    const enW = Math.min(enCanvas.width * PX, contentW);

    // 한글 번역
    const koCanvas = renderText(seg.koreanTranslation, {
      fontSize: 11, fontWeight: 'normal', color: '#7A7A8A',
      maxWidth: maxWpx - 20, lineHeight: 1.7, textAlign: 'left',
    });
    const koH = koCanvas.height * PX;
    const koW = Math.min(koCanvas.width * PX, contentW);

    const blockH = numH + 1 + enH + 2 + koH + 8;

    // 페이지 넘김
    if (ty + blockH > PH - 15) {
      doc.addPage();
      doc.setFillColor(252, 251, 248);
      doc.rect(0, 0, PW, PH, 'F');
      ty = M;
    }

    // 번호
    doc.addImage(numCanvas.toDataURL('image/png'), 'PNG', M, ty, Math.min(numCanvas.width * PX, 30), numH);
    ty += numH + 1;

    // 영어
    doc.addImage(enCanvas.toDataURL('image/png'), 'PNG', M + 4, ty, enW, enH);
    ty += enH + 2;

    // 한글
    doc.addImage(koCanvas.toDataURL('image/png'), 'PNG', M + 4, ty, koW, koH);
    ty += koH + 4;

    // 구분선
    if (i < segments.length - 1) {
      doc.setDrawColor(230, 225, 218);
      doc.setLineWidth(0.15);
      doc.line(M + 15, ty, PW - M - 15, ty);
      ty += 6;
    }
  }

  // ── 엔딩 ──
  onProgress?.(95, '마무리 중...');
  doc.addPage();
  doc.setFillColor(10, 15, 30);
  doc.rect(0, 0, PW, PH, 'F');

  const endCanvas = renderText('— Analysis Complete —\n\nKeep Studying! 📝', {
    fontSize: 26, fontWeight: 'bold', color: '#FFFFFF',
    maxWidth: 500, lineHeight: 1.8, textAlign: 'center',
  });
  placeCanvas(doc, endCanvas, PH * 0.38, 'center');

  const creditCanvas = renderText("재근쌤 스토리북  ·  Passage Analysis", {
    fontSize: 13, fontWeight: 'normal', color: 'rgba(255,255,255,0.35)',
    maxWidth: 400, lineHeight: 1.3, textAlign: 'center',
  });
  placeCanvas(doc, creditCanvas, PH * 0.58, 'center');

  onProgress?.(100, '완료!');
  console.log('[PDF] ✅ 영어지문설명 PDF 완료');
  return doc.output('blob');
};

// ═══════════════════════════════════════════════════════════
// 📓 영어일기 PDF 생성
// ═══════════════════════════════════════════════════════════

interface DiaryPdfOptions {
  title: string;
  sentences: { english: string; korean: string }[];
  vocabulary: { word: string; meaning: string; type: 'word' | 'phrase' | 'idiom' }[];
}

export const generateDiaryPdf = async ({
  title,
  sentences,
  vocabulary,
}: DiaryPdfOptions): Promise<Blob> => {
  console.log(`[PDF] 📓 영어일기 PDF 생성: "${title}", ${sentences.length}문장`);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const PW = 210; // A4 세로 너비
  const PH = 297; // A4 세로 높이
  const M = 18;   // 마진
  const PX = PX_TO_MM; // canvas px → mm (dpr 보정 포함)
  const contentW = PW - M * 2;
  const maxWpx = contentW / MM_PER_PX; // mm → 논리 픽셀 (1x)

  // ═══ 표지 ═══
  doc.setFillColor(30, 25, 45);
  doc.rect(0, 0, PW, PH, 'F');

  const coverTitle = renderText(title, {
    fontSize: 32, fontWeight: 'bold', color: '#FFFFFF',
    maxWidth: 600, lineHeight: 1.5, textAlign: 'center',
  });
  const coverTitleW = Math.min(coverTitle.width * PX, contentW);
  const coverTitleH = coverTitle.height * PX;
  doc.addImage(coverTitle.toDataURL('image/png'), 'PNG',
    (PW - coverTitleW) / 2, PH * 0.35, coverTitleW, coverTitleH);

  const coverSub = renderText('📓 English Diary\n재근쌤 스토리북', {
    fontSize: 16, fontWeight: 'normal', color: 'rgba(255,255,255,0.5)',
    maxWidth: 400, lineHeight: 1.6, textAlign: 'center',
  });
  const coverSubW = Math.min(coverSub.width * PX, contentW);
  const coverSubH = coverSub.height * PX;
  doc.addImage(coverSub.toDataURL('image/png'), 'PNG',
    (PW - coverSubW) / 2, PH * 0.35 + coverTitleH + 10, coverSubW, coverSubH);

  // ═══ 단어장 페이지 (표 형태: No. | Word | Meaning) ═══
  // 제목+표를 함께 배치하기 위해 먼저 캔버스를 생성하고 높이를 계산
  {
    const vocabTitleCanvas = renderText('Vocabulary · 단어장', {
      fontSize: 22, fontWeight: 'bold', color: '#3A3A4A',
      maxWidth: maxWpx, lineHeight: 1.3, textAlign: 'center',
    });
    const vtW = Math.min(vocabTitleCanvas.width * PX, contentW);
    const vtH = vocabTitleCanvas.height * PX;
    const tableGap = 8; // 제목과 표 사이 간격 (mm)

    const useDoubleCol = vocabulary.length > 20;

    // 표 캔버스를 먼저 생성하여 높이 파악
    let leftCanvas: HTMLCanvasElement | null = null;
    let rightCanvas: HTMLCanvasElement | null = null;
    let singleCanvas: HTMLCanvasElement | null = null;
    let tableH = 0;

    if (useDoubleCol) {
      const half = Math.ceil(vocabulary.length / 2);
      const leftItems = vocabulary.slice(0, half);
      const rightItems = vocabulary.slice(half);
      const colW = (contentW - 6) / 2;
      const colWpx = colW / MM_PER_PX;

      leftCanvas = renderDiaryVocabTable(leftItems, 1, colWpx);
      rightCanvas = renderDiaryVocabTable(rightItems, half + 1, colWpx);
      tableH = Math.max(leftCanvas.height * PX, rightCanvas.height * PX);
    } else {
      const tableWpx = Math.min(maxWpx, 550);
      singleCanvas = renderDiaryVocabTable(vocabulary, 1, tableWpx);
      tableH = singleCanvas.height * PX;
    }

    // 새 페이지 생성 헬퍼
    const newVocabPage = () => {
      doc.addPage();
      doc.setFillColor(252, 251, 248);
      doc.rect(0, 0, PW, PH, 'F');
    };

    const totalNeeded = vtH + tableGap + tableH;

    // 제목+표가 한 페이지에 들어가는지 확인
    if (totalNeeded <= PH - M * 2) {
      // ✅ 한 페이지에 제목+표 모두 배치
      newVocabPage();
      doc.addImage(vocabTitleCanvas.toDataURL('image/png'), 'PNG', (PW - vtW) / 2, M, vtW, vtH);
      const vy = M + vtH + tableGap;

      if (useDoubleCol && leftCanvas && rightCanvas) {
        const colW = (contentW - 6) / 2;
        doc.addImage(leftCanvas.toDataURL('image/png'), 'PNG', M, vy, leftCanvas.width * PX, leftCanvas.height * PX);
        doc.addImage(rightCanvas.toDataURL('image/png'), 'PNG', M + colW + 6, vy, rightCanvas.width * PX, rightCanvas.height * PX);
      } else if (singleCanvas) {
        const tW = singleCanvas.width * PX;
        doc.addImage(singleCanvas.toDataURL('image/png'), 'PNG', (PW - tW) / 2, vy, tW, singleCanvas.height * PX);
      }
    } else {
      // ⚠️ 한 페이지에 안 들어감 → 제목 페이지 + 표 페이지 분리
      // 제목만 있는 페이지보다는 제목+표를 같은 페이지 상단부터 배치
      newVocabPage();
      doc.addImage(vocabTitleCanvas.toDataURL('image/png'), 'PNG', (PW - vtW) / 2, M, vtW, vtH);
      let vy = M + vtH + tableGap;

      if (useDoubleCol && leftCanvas && rightCanvas) {
        const colW = (contentW - 6) / 2;
        const lH = leftCanvas.height * PX;
        const rH = rightCanvas.height * PX;
        // 표가 현재 페이지 하단을 넘으면 새 페이지에 제목+표 함께 배치
        if (vy + Math.max(lH, rH) > PH - M) {
          newVocabPage();
          // 새 페이지에 제목 다시 배치
          doc.addImage(vocabTitleCanvas.toDataURL('image/png'), 'PNG', (PW - vtW) / 2, M, vtW, vtH);
          vy = M + vtH + tableGap;
        }
        doc.addImage(leftCanvas.toDataURL('image/png'), 'PNG', M, vy, leftCanvas.width * PX, lH);
        doc.addImage(rightCanvas.toDataURL('image/png'), 'PNG', M + colW + 6, vy, rightCanvas.width * PX, rH);
      } else if (singleCanvas) {
        const tW = singleCanvas.width * PX;
        const tH = singleCanvas.height * PX;
        if (vy + tH > PH - M) {
          newVocabPage();
          doc.addImage(vocabTitleCanvas.toDataURL('image/png'), 'PNG', (PW - vtW) / 2, M, vtW, vtH);
          vy = M + vtH + tableGap;
        }
        doc.addImage(singleCanvas.toDataURL('image/png'), 'PNG', (PW - tW) / 2, vy, tW, tH);
      }
    }
  }

  // ═══ 한줄해석 페이지 (좌: 영문 / 우: 한글 해석) ═══
  {
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PW, PH, 'F');

    const sentTitle = renderText('한줄해석 · Line by Line', {
      fontSize: 22, fontWeight: 'bold', color: '#3A3A4A',
      maxWidth: maxWpx, lineHeight: 1.3, textAlign: 'center',
    });
    const stW = Math.min(sentTitle.width * PX, contentW);
    const stH = sentTitle.height * PX;
    doc.addImage(sentTitle.toDataURL('image/png'), 'PNG', (PW - stW) / 2, M, stW, stH);

    let sy = M + stH + 10;

    // 좌우 분할: 영문(좌 70%) | 한글(우 30%)
    const gap = 4; // mm, 중간 간격
    const engW = (contentW - gap) * 0.7;
    const koW_col = (contentW - gap) * 0.3;
    const engWpx = engW / MM_PER_PX;
    const koWpx = koW_col / MM_PER_PX;
    const leftX = M;
    const rightX = M + engW + gap;

    // 중앙 세로선
    const dividerX = M + engW + gap / 2;

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];

      // 영어 문장 (좌측, 70% 너비, 폰트 20% 확대)
      const enCanvas = renderText(`${i + 1}. ${s.english}`, {
        fontSize: 14, fontWeight: 'bold', color: '#2D2D3F',
        maxWidth: engWpx - 8, lineHeight: 1.7, textAlign: 'left',
      });
      const enH = enCanvas.height * PX;
      const enW = Math.min(enCanvas.width * PX, engW);

      // 한글 번역 (우측, 30% 너비, 폰트 유지)
      const koCanvas = renderText(s.korean, {
        fontSize: 11, fontWeight: 'normal', color: '#555555',
        maxWidth: koWpx - 8, lineHeight: 1.7, textAlign: 'left',
      });
      const koH = koCanvas.height * PX;
      const koW = Math.min(koCanvas.width * PX, koW_col);

      const pairH = Math.max(enH, koH) + 4;

      // 페이지 넘침 체크
      if (sy + pairH > PH - M) {
        doc.addPage();
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, PW, PH, 'F');
        sy = M;
      }

      // 영어 (좌)
      doc.addImage(enCanvas.toDataURL('image/png'), 'PNG', leftX, sy, enW, enH);
      // 한글 (우)
      doc.addImage(koCanvas.toDataURL('image/png'), 'PNG', rightX, sy, koW, koH);

      // 구분선 (아래)
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(leftX, sy + pairH - 2, rightX + koW_col, sy + pairH - 2);

      // 중앙 세로선
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.line(dividerX, sy - 1, dividerX, sy + pairH - 3);

      sy += pairH;
    }
  }

  // ═══ 엔딩 ═══
  doc.addPage();
  doc.setFillColor(30, 25, 45);
  doc.rect(0, 0, PW, PH, 'F');

  const endCanvas = renderText('— The End —\nKeep writing every day! 📓', {
    fontSize: 26, fontWeight: 'bold', color: '#FFFFFF',
    maxWidth: 500, lineHeight: 1.8, textAlign: 'center',
  });
  const endW = Math.min(endCanvas.width * PX, contentW);
  const endH = endCanvas.height * PX;
  doc.addImage(endCanvas.toDataURL('image/png'), 'PNG',
    (PW - endW) / 2, PH * 0.4, endW, endH);

  console.log('[PDF] ✅ 영어일기 PDF 생성 완료');
  return doc.output('blob');
};

/**
 * 📊 단어장 표를 Canvas로 렌더링
 * No. | Word | Meaning 형태의 깔끔한 테이블
 */
function renderDiaryVocabTable(
  items: { word: string; meaning: string }[],
  startNo: number,
  logicalWidth: number,
): HTMLCanvasElement {
  const dpr = 2;
  const noColW = Math.round(logicalWidth * 0.1);
  const wordColW = Math.round(logicalWidth * 0.35);
  const meanColW = logicalWidth - noColW - wordColW;
  const rowH = 26;
  const headerH = 30;
  const rows = items.length;
  const totalH = headerH + rows * rowH + 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(logicalWidth * dpr);
  canvas.height = Math.ceil(totalH * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const font = (weight: string, size: number) =>
    `${weight} ${size}px "Noto Sans KR", sans-serif`;

  // ── 헤더 배경 ──
  ctx.fillStyle = '#F0F0F0';
  ctx.fillRect(0, 0, logicalWidth, headerH);

  // ── 헤더 텍스트 ──
  ctx.font = font('bold', 11);
  ctx.fillStyle = '#333333';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('No.', noColW / 2, headerH / 2);
  ctx.fillText('Word', noColW + wordColW / 2, headerH / 2);
  ctx.fillText('Meaning', noColW + wordColW + meanColW / 2, headerH / 2);

  // ── 데이터 행 ──
  for (let i = 0; i < rows; i++) {
    const y = headerH + i * rowH;

    // 줄무늬 배경
    if (i % 2 === 1) {
      ctx.fillStyle = '#F9F9F9';
      ctx.fillRect(0, y, logicalWidth, rowH);
    }

    const v = items[i];

    // No.
    ctx.font = font('normal', 10);
    ctx.fillStyle = '#888888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(startNo + i).padStart(2, '0'), noColW / 2, y + rowH / 2);

    // Word (볼드, 진한 색)
    ctx.font = font('bold', 11);
    ctx.fillStyle = '#222222';
    ctx.textAlign = 'left';
    // 클리핑: 단어가 열 너비를 초과하면 잘라내기
    let wordText = v.word;
    const maxWordW = wordColW - 16;
    if (ctx.measureText(wordText).width > maxWordW) {
      while (ctx.measureText(wordText + '…').width > maxWordW && wordText.length > 1) {
        wordText = wordText.slice(0, -1);
      }
      wordText += '…';
    }
    ctx.fillText(wordText, noColW + 8, y + rowH / 2);

    // Meaning (한글)
    ctx.font = font('normal', 10);
    ctx.fillStyle = '#555555';
    let meaningText = v.meaning;
    const maxMeanW = meanColW - 16;
    if (ctx.measureText(meaningText).width > maxMeanW) {
      while (ctx.measureText(meaningText + '…').width > maxMeanW && meaningText.length > 1) {
        meaningText = meaningText.slice(0, -1);
      }
      meaningText += '…';
    }
    ctx.fillText(meaningText, noColW + wordColW + 8, y + rowH / 2);
  }

  // ── 테두리 그리기 ──
  const totalDrawnH = headerH + rows * rowH;

  // 외곽선
  ctx.strokeStyle = '#CCCCCC';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, logicalWidth - 1, totalDrawnH - 1);

  // 헤더 하단선 (두껍게)
  ctx.strokeStyle = '#AAAAAA';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, headerH);
  ctx.lineTo(logicalWidth, headerH);
  ctx.stroke();

  // 열 구분선
  ctx.strokeStyle = '#DDDDDD';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(noColW, 0);
  ctx.lineTo(noColW, totalDrawnH);
  ctx.moveTo(noColW + wordColW, 0);
  ctx.lineTo(noColW + wordColW, totalDrawnH);
  ctx.stroke();

  // 행 구분선
  for (let i = 1; i < rows; i++) {
    ctx.beginPath();
    ctx.moveTo(0, headerH + i * rowH);
    ctx.lineTo(logicalWidth, headerH + i * rowH);
    ctx.stroke();
  }

  return canvas;
}
