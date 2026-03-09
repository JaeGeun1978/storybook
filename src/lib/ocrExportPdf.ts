/**
 * OCR 문제 PDF 내보내기
 * past-exam-web의 exportPdf.ts를 웹(storybook) 환경으로 포팅
 * Electron 없이 window.print() 방식만 사용
 */
import type { OcrQuestion } from './ocrStore';
import { normalizeQuestionText } from './ocrStore';

/* ─── HTML 이스케이프 ─── */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── 마크다운 서식 → HTML ─── */
function applyFormatting(text: string): string {
  const parts = text.split(/(\*\*\*.*?\*\*\*|\*\*.*?\*\*|##.*?##)/g);
  return parts
    .map((p) => {
      if (p.startsWith('***') && p.endsWith('***')) return `<b>${esc(p.slice(3, -3))}</b>`;
      if (p.startsWith('**') && p.endsWith('**')) return `<u>${esc(p.slice(2, -2))}</u>`;
      if (p.startsWith('##') && p.endsWith('##')) return `<u><b>${esc(p.slice(2, -2))}</b></u>`;
      return esc(p);
    })
    .join('');
}

function fmtLine(line: string): string {
  return applyFormatting(line);
}

function fmtLines(lines: string[]): string {
  return lines.map(fmtLine).join('<br>');
}

/* ─── [이미지N] 마커 → <img> ─── */
function replaceImageMarkers(html: string, images: OcrQuestion['images']): string {
  if (!images) return html;
  let result = html;
  for (const img of images) {
    const markerEscaped = img.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(
      new RegExp(markerEscaped, 'g'),
      `<img src="${img.dataUrl}" class="q-image" alt="${img.marker}">`
    );
  }
  return result;
}

/* ─── 문제 텍스트 파싱 ─── */
interface ParsedQ {
  questionText: string;
  answer: string;
  explanation: string;
}

function parseQuestionParts(text: string): ParsedQ {
  let questionText = text;
  let answer = '';
  let explanation = '';

  const answerMatch = text.match(/\[정답\]\s*(.*?)(?=\[해설\]|$)/s);
  const explanationMatch = text.match(/\[해설\]\s*(.*?)$/s);

  if (answerMatch) {
    answer = answerMatch[1].trim();
    questionText = text.slice(0, answerMatch.index).trim();
  }
  if (explanationMatch) {
    explanation = explanationMatch[1].trim();
    if (!answerMatch) {
      questionText = text.slice(0, explanationMatch.index).trim();
    }
  }

  return { questionText, answer, explanation };
}

/* ─── 실제 문제 번호 추출 ─── */
function extractQuestionNumber(text: string, fallback: number): number {
  const m1 = text.match(/\[문제\]\s*(\d+)\./);
  if (m1) return parseInt(m1[1], 10);
  const m2 = text.trim().match(/^(\d+)\.\s/);
  if (m2) return parseInt(m2[1], 10);
  return fallback;
}

/* ─── 지문/보기 구조 파싱 ─── */
function parseStructure(text: string): { header: string; passage: string; options: string } {
  let processed = text.replace(/\r\n/g, '\n');

  // <table> 보호
  const tablePH: Record<string, string> = {};
  let tblCnt = 0;
  processed = processed.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (m) => {
    const ph = `__TBL_${tblCnt++}__`;
    tablePH[ph] = m;
    return ph;
  });

  // [정답]/[해설] 제거
  processed = processed.split('\n')
    .filter((l) => !l.trim().startsWith('[정답]') && !l.trim().startsWith('[해설]'))
    .join('\n');

  // [문제] 태그 제거
  processed = processed.replace(/\[문제\]\s*/g, '');

  // [지문]...[/지문] 추출
  let passage = '';
  let rest = processed;
  const passageMatch = processed.match(/\[지문\]([\s\S]*?)\[\/지문\]/);
  if (passageMatch && passageMatch.index !== undefined) {
    passage = passageMatch[1].trim();
    rest = processed.slice(0, passageMatch.index) +
      processed.slice(passageMatch.index + passageMatch[0].length);
  }

  // 남은 [지문]/[/지문] 태그 제거
  rest = rest.replace(/\[지문\]/g, '').replace(/\[\/지문\]/g, '');
  passage = passage.replace(/\[지문\]/g, '').replace(/\[\/지문\]/g, '');

  // 선택지(①②③④⑤) 분리
  const lines = rest.split('\n').filter((l) => l.trim());
  let optStart = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[①②③④⑤⑥⑦⑧⑨⑩]/.test(lines[i])) {
      optStart = i;
      break;
    }
  }
  const header = lines.slice(0, optStart).join('\n');
  const options = lines.slice(optStart).join('\n');

  // <table> 복원
  const restore = (s: string) => {
    let r = s;
    for (const [ph, orig] of Object.entries(tablePH)) {
      r = r.split(ph).join(orig);
    }
    return r;
  };

  return {
    header: restore(header).trim(),
    passage: restore(passage).trim(),
    options: restore(options).trim(),
  };
}

/* ─── 지문 렌더 ─── */
function renderPassage(passage: string): string {
  if (!passage.trim()) return '';
  const segments = passage.split(/(<table[^>]*>[\s\S]*?<\/table>)/gi);
  const parts: string[] = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const tblMatch = trimmed.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (tblMatch) {
      const content = tblMatch[1].trim();
      if (content) parts.push(`<div class="shaded-box">${fmtLines(content.split('\n'))}</div>`);
      continue;
    }
    const lines = trimmed.split('\n').filter(Boolean);
    if (lines.length > 0) parts.push(`<div class="passage">${fmtLines(lines)}</div>`);
  }
  return parts.join('');
}

/* ─── 보기 렌더 ─── */
function renderOptions(options: string): string {
  if (!options.trim()) return '';
  const lines = options.split('\n').filter(Boolean);
  const merged: string[] = [];
  for (const line of lines) {
    const cm = line.match(/^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.*)/);
    if (cm && cm[2].trim().length < 3 && merged.length > 0 && /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(merged[merged.length - 1])) {
      merged[merged.length - 1] += '\u2003' + line.trim();
      continue;
    }
    merged.push(line);
  }
  return `<div class="options">${fmtLines(merged)}</div>`;
}

/* ─── HTML 문서 생성 ─── */
function generateExamHtml(questions: OcrQuestion[], examTitle: string): string {
  // 문제 HTML
  const questionsHtml = questions.map((q) => {
    const normalized = normalizeQuestionText(q.text);
    const parsed = parseQuestionParts(normalized);
    const structure = parseStructure(parsed.questionText);

    let body = '';
    if (structure.header) body += `<div class="q-header">${fmtLines(structure.header.split('\n'))}</div>`;
    if (structure.passage) body += renderPassage(structure.passage);
    if (structure.options) body += renderOptions(structure.options);

    if (q.images && q.images.length > 0) {
      body = replaceImageMarkers(body, q.images);
    }

    return `<div class="question">${body}</div>`;
  }).join('\n');

  // 정답/해설 섹션
  interface AnswerEntry { number: number; answer: string; explanation: string }
  const allAnswers: AnswerEntry[] = [];
  for (const q of questions) {
    const normalized = normalizeQuestionText(q.text);
    const parsed = parseQuestionParts(normalized);
    const realNum = extractQuestionNumber(normalized, q.number);
    if (parsed.answer || q.answer) {
      allAnswers.push({
        number: realNum,
        answer: parsed.answer || q.answer,
        explanation: parsed.explanation || q.explanation,
      });
    }
  }
  allAnswers.sort((a, b) => a.number - b.number);

  let answersSection = '';
  if (allAnswers.length > 0) {
    const quickAnswers = allAnswers
      .filter((a) => a.answer)
      .map((a) => `${a.number}) ${esc(a.answer)}`)
      .join('\u2003\u2003');

    const items = allAnswers
      .filter((a) => a.answer || a.explanation)
      .map((a) => {
        const explHtml = a.explanation
          ? `<div class="a-detail">${fmtLines(a.explanation.split('\n'))}</div>`
          : '';
        return `<div class="answer-item">
          <div class="a-header">${a.number}) ${applyFormatting(a.answer)}</div>
          ${explHtml}
        </div>`;
      }).join('\n');

    answersSection = `
    <div class="page-break"></div>
    <div class="section-title">정답 및 해설</div>
    <div class="quick-answers">${quickAnswers}</div>
    <div class="answers-content">${items}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${esc(examTitle)}</title>
<style>
@page { size: A4; margin: 12mm 10mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: '맑은 고딕', 'Malgun Gothic', 'Noto Sans KR', sans-serif;
  font-size: 10pt; line-height: 1.6; color: #000; text-align: justify;
}
.exam-title {
  text-align: center; font-size: 16pt; font-weight: bold;
  padding-bottom: 8px; margin-bottom: 12px; border-bottom: 2px solid #000;
}
.questions-content { column-count: 2; column-gap: 20px; column-rule: 1px dashed #ccc; }
.question { break-inside: avoid; margin-bottom: 14px; }
.q-header { font-size: 10pt; font-weight: bold; line-height: 1.6; margin-bottom: 4px; }
.passage {
  margin: 6px 0 10px 0; padding: 10px 12px; text-align: justify;
  line-height: 1.6; font-size: 9.5pt; border: 1px solid #999;
  border-radius: 4px; background-color: #fafafa;
}
.shaded-box {
  background-color: #f0f0f0; padding: 8px 12px; margin: 6px 0;
  border-radius: 4px; font-size: 9.5pt; line-height: 1.6;
}
.options {
  margin-top: 6px; font-size: 9.5pt; line-height: 1.55;
  padding-left: 0.3em; white-space: pre-wrap;
}
.q-image { display: block; max-width: 90%; margin: 8px auto; border: 1px solid #ddd; border-radius: 4px; }
.page-break { break-before: page; height: 0; }
.section-title {
  text-align: center; font-size: 14pt; font-weight: bold;
  padding-bottom: 6px; margin-bottom: 10px; border-bottom: 2px solid #000;
}
.quick-answers {
  font-size: 9pt; line-height: 1.8; margin-bottom: 14px;
  padding: 8px 10px; background: #f9f9f9; border-radius: 4px;
}
.answers-content { column-count: 2; column-gap: 20px; }
.answer-item { break-inside: avoid; margin-bottom: 12px; }
.a-header { font-weight: bold; font-size: 10pt; }
.a-detail { font-size: 9pt; line-height: 1.55; margin-top: 3px; padding-left: 1.2em; word-break: break-word; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
@media screen { body { max-width: 210mm; margin: 10mm auto; padding: 15mm 13mm; background: #fff; box-shadow: 0 0 12px rgba(0,0,0,0.15); } }
</style>
</head>
<body>
<div class="exam-title">${esc(examTitle)}</div>
<div class="questions-content">
${questionsHtml}
</div>
${answersSection}
</body>
</html>`;
}

/**
 * 문제 목록을 PDF로 내보내기 (새 창에서 인쇄)
 */
export function exportAsPdf(questions: OcrQuestion[], fileName?: string): void {
  const title = fileName || '시험 문제';
  const html = generateExamHtml(questions, title);

  const w = window.open('', '_blank');
  if (!w) {
    alert('팝업이 차단되었습니다. 팝업을 허용해주세요.');
    return;
  }
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 500);
}
