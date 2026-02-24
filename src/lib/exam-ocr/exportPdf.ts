import type { Question } from './types.ts';
import { parseQuestionText } from './questionParser.ts';

/**
 * 스타일 마커를 HTML로 변환
 * ##텍스트## → 밑줄+볼드, ***텍스트*** → 밑줄+볼드, **텍스트** → 밑줄
 * <table>텍스트</table> → 회색 박스
 */
function processStyleMarkers(text: string): string {
  // ##...## → 밑줄+볼드
  text = text.replace(/##([^#]+)##/g, '<u><b>$1</b></u>');
  // ***...*** → 밑줄+볼드 (순서 중요: *** 먼저)
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<u><b>$1</b></u>');
  // **...** → 밑줄
  text = text.replace(/\*\*([^*]+)\*\*/g, '<u>$1</u>');
  // <table>...</table> → 회색 박스
  text = text.replace(/<table>([\s\S]*?)<\/table>/gi, '<div class="shaded-box">$1</div>');
  return text;
}

/**
 * 문제 텍스트에서 지시문, 지문, 보기를 분리
 */
function parseQuestionParts(rawText: string): {
  instruction: string;
  passage: string;
  options: string;
} {
  const lines = rawText.split('\n');
  let instruction = '';
  const passageLines: string[] = [];
  const optionLines: string[] = [];
  let inOptions = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // [문제] 태그 제거
    if (trimmed.startsWith('[문제]')) {
      instruction = trimmed.replace('[문제]', '').trim();
      continue;
    }
    // 보기 시작 감지 (원문자 ① ~ ⑩)
    if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(trimmed)) {
      inOptions = true;
    }
    if (inOptions) {
      optionLines.push(trimmed);
    } else {
      passageLines.push(line);
    }
  }

  return {
    instruction: instruction || '',
    passage: passageLines.join('\n').trim(),
    options: optionLines.join('\n').trim(),
  };
}

/**
 * 문제 텍스트를 HTML로 변환
 */
function questionToHtml(q: Question, index: number): string {
  const parsed = parseQuestionText(q.text);
  const parts = parseQuestionParts(parsed.text);
  const answer = parsed.answer || q.answer || '';
  const explanation = parsed.explanation || q.explanation || '';

  const styledInstruction = processStyleMarkers(parts.instruction);
  const styledPassage = processStyleMarkers(parts.passage)
    .split('\n')
    .filter((l) => l.trim())
    .join('<br>');
  const styledOptions = parts.options
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `<div class="option-line">${processStyleMarkers(l)}</div>`)
    .join('');

  let html = `<div class="question-block">`;
  html += `<div class="q-number">${index + 1}.</div>`;

  if (styledInstruction) {
    html += `<div class="q-instruction">${styledInstruction}</div>`;
  }

  if (styledPassage) {
    html += `<div class="passage">${styledPassage}</div>`;
  }

  if (styledOptions) {
    html += `<div class="options">${styledOptions}</div>`;
  }

  html += `</div>`;

  return {
    questionHtml: html,
    answerHtml:
      answer || explanation
        ? `<div class="answer-item"><b>${index + 1}번</b> 정답: ${answer || '-'}${explanation ? ` | 해설: ${processStyleMarkers(explanation)}` : ''}</div>`
        : '',
  } as unknown as string; // 아래에서 별도로 처리
}

interface QuestionHtmlParts {
  questionHtml: string;
  answerHtml: string;
}

function questionToHtmlParts(q: Question, index: number): QuestionHtmlParts {
  const parsed = parseQuestionText(q.text);
  const parts = parseQuestionParts(parsed.text);
  const answer = parsed.answer || q.answer || '';
  const explanation = parsed.explanation || q.explanation || '';

  const styledInstruction = processStyleMarkers(parts.instruction);
  const styledPassage = processStyleMarkers(parts.passage)
    .split('\n')
    .filter((l) => l.trim())
    .join('<br>');
  const styledOptions = parts.options
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `<div class="option-line">${processStyleMarkers(l)}</div>`)
    .join('');

  let qHtml = `<div class="question-block">`;
  qHtml += `<div class="q-number">${index + 1}.</div>`;

  if (styledInstruction) {
    qHtml += `<div class="q-instruction">${styledInstruction}</div>`;
  }

  if (styledPassage) {
    qHtml += `<div class="passage">${styledPassage}</div>`;
  }

  if (styledOptions) {
    qHtml += `<div class="options">${styledOptions}</div>`;
  }

  qHtml += `</div>`;

  const aHtml =
    answer || explanation
      ? `<div class="answer-item"><b>${index + 1}번</b> 정답: ${answer || '-'}${explanation ? `<br><span class="explanation-text">해설: ${processStyleMarkers(explanation)}</span>` : ''}</div>`
      : '';

  return { questionHtml: qHtml, answerHtml: aHtml };
}

/**
 * 전체 시험지 HTML 생성
 */
function generateExamHtml(questions: Question[], title?: string): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  const headerTitle = title || '기출문제 정리';

  const parts = questions.map((q, i) => questionToHtmlParts(q, i));
  const questionBlocks = parts.map((p) => p.questionHtml).join('');
  const answerBlocks = parts
    .map((p) => p.answerHtml)
    .filter(Boolean)
    .join('');

  // 빠른 정답 목록
  const quickAnswers = questions
    .map((q, i) => {
      const parsed = parseQuestionText(q.text);
      const answer = parsed.answer || q.answer || '-';
      return `<span class="quick-answer">${i + 1}) ${answer}</span>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${headerTitle}</title>
<style>
  @page {
    size: A4;
    margin: 12mm 10mm;
  }

  @media print {
    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .no-print { display: none !important; }
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif;
    font-size: 10pt;
    line-height: 1.55;
    color: #222;
    background: #fff;
  }

  /* ── 헤더 ── */
  .header-wrap {
    text-align: center;
    padding-bottom: 10px;
    margin-bottom: 12px;
    border-bottom: 2px solid #333;
  }
  .header-title {
    font-size: 16pt;
    font-weight: 800;
    letter-spacing: 2px;
    color: #111;
    margin-bottom: 2px;
  }
  .header-date {
    font-size: 8pt;
    color: #777;
  }

  /* ── 2단 레이아웃 ── */
  .two-column {
    column-count: 2;
    column-gap: 22px;
    column-rule: 1px dashed #ccc;
  }

  /* ── 문제 블록 ── */
  .question-block {
    break-inside: avoid;
    page-break-inside: avoid;
    margin-bottom: 16px;
    padding-bottom: 10px;
    border-bottom: 1px dotted #ddd;
  }

  .q-number {
    font-size: 11pt;
    font-weight: 800;
    color: #1a56db;
    margin-bottom: 3px;
  }

  .q-instruction {
    font-size: 10pt;
    font-weight: 600;
    color: #333;
    margin-bottom: 6px;
    line-height: 1.5;
  }

  .passage {
    margin: 6px 0;
    padding: 10px 12px;
    text-align: justify;
    line-height: 1.65;
    font-size: 10pt;
    border: 1px solid #bbb;
    border-radius: 4px;
    background-color: #fafafa;
  }

  .options {
    margin-top: 6px;
    padding-left: 4px;
  }
  .option-line {
    margin: 2px 0;
    font-size: 10pt;
    line-height: 1.55;
  }

  /* ── 회색 박스 (표 대용) ── */
  .shaded-box {
    background-color: #f0f0f0;
    padding: 8px 12px;
    margin: 8px 0;
    border-radius: 4px;
    font-size: 10pt;
    line-height: 1.6;
  }

  /* ── 정답/해설 섹션 ── */
  .answer-section {
    page-break-before: always;
    margin-top: 0;
  }
  .answer-section-title {
    font-size: 14pt;
    font-weight: 800;
    text-align: center;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid #333;
    color: #111;
  }
  .quick-answer-wrap {
    margin-bottom: 20px;
    padding: 10px 14px;
    background: #f7f7ff;
    border: 1px solid #ccd;
    border-radius: 6px;
  }
  .quick-answer-wrap h3 {
    font-size: 10pt;
    font-weight: 700;
    margin-bottom: 6px;
    color: #444;
  }
  .quick-answer {
    display: inline-block;
    min-width: 64px;
    margin: 2px 4px;
    font-size: 9.5pt;
    color: #333;
  }
  .answer-item {
    padding: 6px 0;
    border-bottom: 1px dotted #ddd;
    font-size: 9.5pt;
    line-height: 1.55;
  }
  .answer-item b {
    color: #1a56db;
  }
  .explanation-text {
    color: #555;
    font-size: 9pt;
  }

  /* ── 인쇄 버튼 (화면에서만 보임) ── */
  .print-controls {
    position: fixed;
    top: 16px;
    right: 16px;
    display: flex;
    gap: 8px;
    z-index: 1000;
  }
  .print-controls button {
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,.15);
    transition: transform .15s;
  }
  .print-controls button:hover {
    transform: translateY(-1px);
  }
  .btn-print {
    background: #1a56db;
    color: #fff;
  }
  .btn-close {
    background: #eee;
    color: #333;
  }
</style>
</head>
<body>

<!-- 인쇄/닫기 버튼 (화면에서만 보임) -->
<div class="print-controls no-print">
  <button class="btn-print" onclick="window.print()">📥 PDF로 저장 (Ctrl+P)</button>
  <button class="btn-close" onclick="window.close()">닫기</button>
</div>

<!-- 헤더 -->
<div class="header-wrap">
  <div class="header-title">${headerTitle}</div>
  <div class="header-date">${dateStr} | 총 ${questions.length}문제</div>
</div>

<!-- 문제 영역 (2단) -->
<div class="two-column">
${questionBlocks}
</div>

<!-- 정답/해설 영역 -->
${
  answerBlocks
    ? `
<div class="answer-section">
  <div class="answer-section-title">정답 및 해설</div>
  <div class="quick-answer-wrap">
    <h3>◈ 빠른 정답</h3>
    ${quickAnswers}
  </div>
  ${answerBlocks}
</div>
`
    : ''
}

</body>
</html>`;
}

/**
 * 문제 데이터를 PDF로 내보내기
 * (브라우저 새 탭에서 HTML을 열어 인쇄 다이얼로그 표시)
 */
export function exportQuestionsPdf(questions: Question[], title?: string): void {
  if (questions.length === 0) {
    alert('내보낼 문제가 없습니다.');
    return;
  }

  const html = generateExamHtml(questions, title);

  // Blob URL로 새 탭에서 열기
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const newWindow = window.open(url, '_blank');

  if (!newWindow) {
    // 팝업 차단 시 다운로드 폴백
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || '기출문제'}_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    alert('팝업이 차단되었습니다. 다운로드된 HTML 파일을 브라우저에서 열어 Ctrl+P로 PDF 저장하세요.');
  }

  // 메모리 해제 (약간 지연)
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// unused import 방지
void questionToHtml;
