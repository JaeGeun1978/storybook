/**
 * OCR 문제 PDF 내보내기
 * past-exam-web의 exportPdf.ts를 웹(storybook) 환경으로 충실하게 포팅
 * Electron 없이 window.print() 방식만 사용
 */
import type { OcrQuestion, QuestionImage } from './ocrStore';
import { normalizeQuestionText, parseQuestionText } from './ocrStore';

/* ═══════════════════════════════════════════════════════
   내부 타입
   ═══════════════════════════════════════════════════════ */
interface PreparedQuestion {
  number: number;
  questionText: string;
  answer: string;
  explanation: string;
  source: string;
  images: QuestionImage[];
  /** 복합 문제([문제] 여러 개)인 경우 개별 정답/해설 */
  subAnswers?: { number: number; answer: string; explanation: string }[];
}

/** 개별 문제 파싱 결과 */
interface SubQuestion {
  headerTop: string;     // 문제 지시문 (볼드) - "3. 다음 글을 읽고..."
  passage: string;       // [지문] 내용 (음영 박스)
  headerBottom: string;  // [/지문] 후 세부 질문 (볼드) - "윗글의 제목으로 적절한 것은?"
  options: string;       // 보기 (①②③④⑤)
  gapBeforeOptions: number;  // headerBottom과 options 사이 빈 줄 수 (사용자 의도 공백)
}

/** 전체 파싱 결과 (공유 지문 + 개별 문제들) */
interface ParsedQuestion {
  sharedHeader: string;    // [n~m] 공유 지문 헤더
  sharedPassage: string;   // 공유 지문 텍스트
  subQuestions: SubQuestion[];
}

/* ═══════════════════════════════════════════════════════
   유틸리티 – HTML 이스케이프
   ═══════════════════════════════════════════════════════ */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════════════════════
   마크다운 서식 처리
   HWP 변환기(insert_text_with_formatting) + 가이드라인과 동일:
     ***텍스트*** → 볼드        (<b>)
     **텍스트**  → 밑줄         (<u>)
     ##텍스트##  → 밑줄+볼드    (<u><b>)
     <table>     → 회색 박스    (.shaded-box)
   ═══════════════════════════════════════════════════════ */
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

/**
 * 텍스트 내 [이미지N] 마커를 <img> 태그로 교체
 */
function replaceImageMarkers(html: string, images: QuestionImage[]): string {
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

/* ═══════════════════════════════════════════════════════
   복합 문제(여러 [문제] 포함)에서 개별 정답/해설 추출
   HWP 변환기의 split_multiple_questions와 동일 역할
   ═══════════════════════════════════════════════════════ */
function extractSubAnswers(text: string): { number: number; answer: string; explanation: string }[] {
  const results: { number: number; answer: string; explanation: string }[] = [];

  // [문제]로 분리
  const sections = text.split(/\[문제\]\s*/);

  for (const section of sections) {
    if (!section.trim()) continue;

    // 문제 번호 추출 (예: "13. ..." 또는 "14. ...")
    const numMatch = section.match(/^(\d+)\./);
    if (!numMatch) continue;

    const num = parseInt(numMatch[1], 10);

    // [정답] 추출
    const answerMatch = section.match(/\[정답\]\s*(.*?)(?:\n|$)/);
    const answer = answerMatch ? answerMatch[1].trim() : '';

    // [해설] 추출 (다음 [문제] 또는 텍스트 끝까지)
    const expMatch = section.match(/\[해설\]\s*([\s\S]*?)$/);
    const explanation = expMatch ? expMatch[1].trim() : '';

    if (answer) {
      results.push({ number: num, answer, explanation });
    }
  }

  return results;
}

/**
 * 텍스트에서 실제 문제 번호 추출
 * JSON의 number(순서 인덱스)가 아닌, 시험지 원본의 문제 번호를 사용
 * 예: "[문제] 15. 다음 글의..." → 15
 */
function extractQuestionNumber(text: string, fallback: number): number {
  const m1 = text.match(/\[문제\]\s*(\d+)\./);
  if (m1) return parseInt(m1[1], 10);
  const m2 = text.trim().match(/^(\d+)\.\s/);
  if (m2) return parseInt(m2[1], 10);
  return fallback;
}

/* ═══════════════════════════════════════════════════════
   데이터 준비
   ═══════════════════════════════════════════════════════ */
function prepareQuestions(questions: OcrQuestion[]): PreparedQuestion[] {
  return questions.map((q) => {
    const normalized = normalizeQuestionText(q.text);
    const parsed = parseQuestionText(normalized);

    // 복합 문제 감지 (여러 [문제] 포함)
    const problemCount = (normalized.match(/\[문제\]/g) || []).length;
    let subAnswers: { number: number; answer: string; explanation: string }[] | undefined;

    if (problemCount > 1) {
      subAnswers = extractSubAnswers(normalized);
    }

    // 실제 문제 번호 추출 (JSON number ≠ 실제 시험 문제 번호일 수 있음)
    const realNumber = extractQuestionNumber(normalized, q.number);

    return {
      number: realNumber,
      questionText: parsed.text || normalized,
      answer: parsed.answer || q.answer || '',
      explanation: parsed.explanation || q.explanation || '',
      source: q.source || '',
      images: q.images || [],
      subAnswers,
    };
  });
}

/* ═══════════════════════════════════════════════════════
   메인 파서 – [지문] 태그 기반 구조 분석

   파싱 전략 (새로운 [지문] 태그 기반):
   1. <table> 태그 보호 (임시 마커)
   2. [정답]/[해설] 줄 제거
   3. [n~m] 공유 지문 패턴 감지 → sharedHeader
   4. 첫 [문제] 전의 [지문]...[/지문] → sharedPassage
   5. [문제]로 개별 문제 분할
   6. 각 개별 문제에서 [지문] 태그로 passage 추출
   7. <table> 플레이스홀더 복원
   ═══════════════════════════════════════════════════════ */
function parseQuestionStructure(text: string): ParsedQuestion {
  // 줄바꿈 정규화
  let processed = text.replace(/\r\n/g, '\n');

  // 1. <table> 태그 보호
  const tablePH: Record<string, string> = {};
  let tblCnt = 0;
  processed = processed.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (m) => {
    const ph = `__TBL_${tblCnt++}__`;
    tablePH[ph] = m;
    return ph;
  });

  // 2. [정답]/[해설] 줄 제거
  processed = processed
    .split('\n')
    .filter((l) => {
      const s = l.trim();
      return !s.startsWith('[정답]') && !s.startsWith('[해설]');
    })
    .join('\n');

  // 3. [n~m] 공유 지문 패턴 감지
  // 주의: \s*[^\n]* → [^\n]* 로 변경.
  // \s*가 줄바꿈(\n)까지 매칭하여 다음 줄의 [지문] 태그를 삼키는 버그 수정
  const sharedMarkerRe = /\[\d+[번]?\s*[~\-]\s*\d+[번]?\][^\n]*/;
  const sharedMatch = processed.match(sharedMarkerRe);

  let sharedHeader = '';
  let sharedPassage = '';
  let rest = processed;

  if (sharedMatch && sharedMatch.index !== undefined) {
    sharedHeader = sharedMatch[0].trim();
    rest = processed.slice(0, sharedMatch.index) +
           processed.slice(sharedMatch.index + sharedMatch[0].length);
    rest = rest.trim();
  }

  // 4. 첫 [문제] 전의 [지문]...[/지문] → sharedPassage
  const firstQIdx = rest.indexOf('[문제]');
  const preContent = firstQIdx >= 0 ? rest.slice(0, firstQIdx) : rest;
  const sharedPassageMatch = preContent.match(/\[지문\]([\s\S]*?)\[\/지문\]/);
  if (sharedPassageMatch) {
    sharedPassage = sharedPassageMatch[1].trim();
  }

  // 5. [문제]로 개별 문제 분할
  let questionSections: string[] = [];
  if (firstQIdx >= 0) {
    const qContent = rest.slice(firstQIdx);
    questionSections = qContent.split(/\[문제\]\s*/).filter(Boolean);
  } else if (!sharedPassageMatch) {
    // [문제] 태그도 [지문] 태그도 없는 경우 → 전체를 단일 문제로
    const cleaned = rest.replace(/\[문제\]\s*/g, '').trim();
    if (cleaned) {
      questionSections = [cleaned];
    }
  }

  // 6. 각 섹션 파싱
  const subQuestions = questionSections
    .map((s) => parseSingleSection(s.trim()))
    .filter((sq) => sq.headerTop || sq.options || sq.passage);

  // 폴백: 아무것도 파싱 못했으면 전체를 하나의 문제로
  if (subQuestions.length === 0 && !sharedPassage) {
    const cleaned = processed.replace(/\[문제\]\s*/g, '').replace(/\[지문\]/g, '').replace(/\[\/지문\]/g, '').trim();
    if (cleaned) subQuestions.push(parseSingleSection(cleaned));
  }

  // 7. <table> 플레이스홀더 복원 + [지문] 태그 잔여 제거
  const restore = (s: string) => {
    let r = s;
    for (const [ph, orig] of Object.entries(tablePH)) {
      r = r.split(ph).join(orig);
    }
    // 안전 조치: 남아있는 [지문]/[/지문] 태그 제거
    r = r.replace(/\[지문\]/g, '').replace(/\[\/지문\]/g, '');
    return r;
  };
  sharedHeader = restore(sharedHeader).trim();
  sharedPassage = restore(sharedPassage).trim();
  for (const sq of subQuestions) {
    sq.headerTop = restore(sq.headerTop);
    sq.passage = restore(sq.passage);
    sq.headerBottom = restore(sq.headerBottom);
    sq.options = restore(sq.options);
  }

  return { sharedHeader, sharedPassage, subQuestions };
}

/* ═══════════════════════════════════════════════════════
   개별 문제 섹션 파싱 – [지문] 태그 기반

   [문제] 태그 제거 후의 텍스트를 받아서:
   1. [지문]...[/지문] 추출 → passage
   2. [지문] 앞 텍스트 → headerTop (문제 지시문)
   3. [/지문] 뒤 텍스트에서:
      a. ①②③④⑤로 시작하는 줄부터 → options
      b. 그 앞 줄들 → headerBottom (세부 질문)
   4. [지문] 태그가 없으면:
      a. ①②③④⑤ 앞까지 → headerTop
      b. ①②③④⑤부터 → options
   ═══════════════════════════════════════════════════════ */
function parseSingleSection(text: string): SubQuestion {
  let passage = '';
  let prePassage = text;
  let postPassage = '';

  // [지문]...[/지문] 블록 추출
  const passageMatch = text.match(/\[지문\]([\s\S]*?)\[\/지문\]/);
  if (passageMatch && passageMatch.index !== undefined) {
    passage = passageMatch[1].trim();
    prePassage = text.slice(0, passageMatch.index).trim();
    // 앞뒤 빈 줄만 제거, 줄 앞 공백(인덴트)은 보존
    postPassage = text.slice(passageMatch.index + passageMatch[0].length)
      .replace(/^\n+/, '').replace(/\n+$/, '');
  }

  // [요약문] 처리: passage가 [요약문]으로 시작하면 한 줄로 합침
  if (passage.trim().startsWith('[요약문]')) {
    passage = passage.split('\n').join(' ');
  }

  // 빈 줄을 제거하는 버전 (문제 헤더용)
  const cleanLines = (t: string) =>
    t.split('\n').map((l) => l.trim()).filter(Boolean);

  // 빈 줄/공백을 그대로 보존하는 버전 (사용자 편집 의도 유지)
  const rawLines = (t: string) => t.split('\n');

  let headerTop = '';
  let headerBottom = '';
  let options = '';
  let gapBeforeOptions = 0;  // headerBottom↔options 사이 빈 줄 수

  if (passage) {
    // ── [지문] 태그가 있는 경우 ──
    headerTop = cleanLines(prePassage).join('\n');

    // postPassage에서 선택지(①②③④⑤) 시작 찾기
    // 원본 줄을 그대로 보존 (앞쪽 공백 포함)
    const postLines = rawLines(postPassage);
    let optStart = postLines.length;
    for (let i = 0; i < postLines.length; i++) {
      if (/^\s*[①②③④⑤⑥⑦⑧⑨⑩]/.test(postLines[i])) {
        optStart = i;
        break;
      }
    }
    // headerBottom: 빈줄 제거하되 줄 내 공백은 보존 (사용자가 넣은 간격 유지)
    headerBottom = postLines.slice(0, optStart).filter((l) => l.trim()).join('\n');

    // optStart 바로 위의 빈 줄 개수 카운트 (사용자가 넣은 의도적 공백)
    for (let i = optStart - 1; i >= 0; i--) {
      if (postLines[i].trim() === '') gapBeforeOptions++;
      else break;
    }

    // options: 선택지는 빈줄 제거하되 줄 내 공백은 보존
    options = postLines.slice(optStart).filter((l) => l.trim()).join('\n');
  } else {
    // ── [지문] 태그가 없는 경우 ──
    // 선택지 시작점으로 headerTop과 options 분리
    const lines = cleanLines(prePassage);
    let optStart = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(lines[i])) {
        optStart = i;
        break;
      }
    }
    headerTop = lines.slice(0, optStart).join('\n');
    options = lines.slice(optStart).join('\n');
  }

  // 최종 안전 조치: 남아있는 [지문]/[/지문] 태그 제거 (줄 앞 공백은 보존)
  const stripPassageTags = (s: string) =>
    s.replace(/\[지문\]/g, '').replace(/\[\/지문\]/g, '');
  headerTop = stripPassageTags(headerTop);
  passage = stripPassageTags(passage);
  headerBottom = stripPassageTags(headerBottom);
  options = stripPassageTags(options);

  return { headerTop, passage, headerBottom, options, gapBeforeOptions };
}

/* ═══════════════════════════════════════════════════════
   지문(passage) 텍스트 평탄화 (Flatten)

   OCR이 만든 불필요한 줄바꿈을 제거하여 자연스러운 문단으로 만든다.
   단, 구조적 의미가 있는 줄바꿈은 보존한다.

   ── 평탄화 규칙 ──
   일반 텍스트 줄: 줄바꿈 제거 → 공백으로 이어붙임
   빈 줄(단락 구분): 보존

   ── 예외 (줄바꿈 보존) ──
   (A), (B), (C) … 등 영문 순서 표시 앞에서 줄바꿈
   (가), (나), (다) … 등 한글 순서 표시 앞에서 줄바꿈
   ⓐ ⓑ ⓒ … 원문자 알파벳 앞에서 줄바꿈
   ㉠ ㉡ ㉢ … 원문자 한글 앞에서 줄바꿈
   ① ② ③ … 원문자 숫자(선택지) 앞에서 줄바꿈
   ─ · • 등 리스트 아이템 앞에서 줄바꿈
   1) 2) 3) 등 번호 목록 앞에서 줄바꿈
   ═══════════════════════════════════════════════════════ */

/** 해당 줄이 "줄바꿈 보존" 패턴으로 시작하는지 판별 */
const BREAK_BEFORE_PATTERNS: RegExp[] = [
  /^\s*\([A-Za-z]\)/,           // (A), (B), (a), (b)…
  /^\s*\([가-힣]\)/,            // (가), (나), (다)…
  /^\s*[ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙ]/,  // 원문자 알파벳
  /^\s*[㉠㉡㉢㉣㉤]/,          // 원문자 한글
  /^\s*[①②③④⑤⑥⑦⑧⑨⑩]/,  // 원문자 숫자 (선택지)
  /^\s*[-─·•]\s/,               // 리스트 아이템
  /^\s*\d+[.)]\s/,              // 번호 목록 (1. 2) 등)
];

function flattenPassage(text: string): string {
  if (!text.trim()) return text;

  const lines = text.split('\n');
  const result: string[] = [];
  let paragraph = '';

  const flushParagraph = () => {
    if (paragraph) {
      result.push(paragraph);
      paragraph = '';
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // 빈 줄 → 단락 구분 보존
    if (!trimmed) {
      flushParagraph();
      result.push(''); // 빈 줄 유지
      continue;
    }

    // 줄바꿈 보존 패턴 확인
    const needsBreak = BREAK_BEFORE_PATTERNS.some((p) => p.test(trimmed));

    if (needsBreak) {
      flushParagraph();
      paragraph = trimmed; // 새 문단 시작
    } else {
      // 일반 텍스트: 이전 줄에 공백으로 이어붙임 (평탄화)
      paragraph = paragraph ? paragraph + ' ' + trimmed : trimmed;
    }
  }
  flushParagraph();

  return result.join('\n');
}

/* ═══════════════════════════════════════════════════════
   지문(passage) HTML 렌더링
   가이드라인: .passage (테두리 + 연한 배경)
              .shaded-box (<table> 태그 OCR 컨텐츠)
   ═══════════════════════════════════════════════════════ */
function renderPassage(passage: string): string {
  if (!passage.trim()) return '';

  // <table> 태그 분리
  const segments = passage.split(/(<table[^>]*>[\s\S]*?<\/table>)/gi);
  const parts: string[] = [];

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    // <table> 태그 → 회색 박스 (.shaded-box) — 가이드라인 규칙 (평탄화 미적용)
    const tblMatch = trimmed.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (tblMatch) {
      const content = tblMatch[1].trim();
      if (content) {
        parts.push(
          `<div class="shaded-box">${fmtLines(content.split('\n'))}</div>`
        );
      }
      continue;
    }

    // 일반 지문 → 평탄화 적용 후 .passage 박스 렌더링
    const flattened = flattenPassage(trimmed);
    const lines = flattened.split('\n').filter(Boolean);
    if (lines.length > 0) {
      parts.push(`<div class="passage">${fmtLines(lines)}</div>`);
    }
  }

  return parts.join('');
}

/* ═══════════════════════════════════════════════════════
   보기문(options) HTML 렌더링
   HWP 변환기와 동일: 짧은 보기(3글자 미만) 가로 배열
   ═══════════════════════════════════════════════════════ */
function renderOptions(options: string): string {
  if (!options.trim()) return '';

  const lines = options.split('\n').filter(Boolean);
  const merged: string[] = [];

  for (const line of lines) {
    const cm = line.match(/^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.*)/);
    if (
      cm &&
      cm[2].trim().length < 3 &&
      merged.length > 0 &&
      /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(merged[merged.length - 1])
    ) {
      merged[merged.length - 1] += '\u2003' + line.trim(); // em space
      continue;
    }
    merged.push(line);
  }

  return `<div class="options">${fmtLines(merged)}</div>`;
}

/* ═══════════════════════════════════════════════════════
   전체 문제 HTML 조립
   ParsedQuestion → HTML 블록
   ═══════════════════════════════════════════════════════ */
function formatQuestionHtml(pq: ParsedQuestion, source: string): string {
  const chunks: string[] = [];

  // 출처
  if (source) {
    chunks.push(`<div class="source">${applyFormatting(source)}</div>`);
  }

  // 공유 지문 헤더
  if (pq.sharedHeader) {
    chunks.push(
      `<div class="q-header">${fmtLines(pq.sharedHeader.split('\n'))}</div>`
    );
  }

  // 공유 지문 (음영 박스)
  if (pq.sharedPassage) {
    chunks.push(renderPassage(pq.sharedPassage));
  }

  // 개별 문제 블록
  for (const sq of pq.subQuestions) {
    if (sq.headerTop) {
      chunks.push(
        `<div class="q-header">${fmtLines(sq.headerTop.split('\n'))}</div>`
      );
    }
    if (sq.passage) {
      chunks.push(renderPassage(sq.passage));
    }
    if (sq.headerBottom && sq.headerBottom.trim()) {
      chunks.push(
        `<div class="q-header q-sub">${fmtLines(sq.headerBottom.split('\n'))}</div>`
      );
    }
    // 사용자가 넣은 빈 줄만큼 간격 추가 (각 빈 줄 = 1em 높이)
    if (sq.gapBeforeOptions > 0) {
      chunks.push(`<div style="height:${sq.gapBeforeOptions}em"></div>`);
    }
    if (sq.options) {
      chunks.push(renderOptions(sq.options));
    }
  }

  return chunks.join('');
}

/* ═══════════════════════════════════════════════════════
   HTML 문서 생성
   가이드라인 CSS 참고 + HWP 양식 반영
   ═══════════════════════════════════════════════════════ */
function generateExamHtml(
  questions: PreparedQuestion[],
  examTitle: string,
  options: PdfExportOptions = DEFAULT_PDF_OPTIONS
): string {
  // ── 문제 섹션 ──
  const questionsHtml = questions
    .map((q) => {
      const pq = parseQuestionStructure(q.questionText);

      // 복합 문제 (공유 지문 + 다수 sub-question) 인 경우
      // 지문이 너무 길어 break-inside:avoid 때문에 페이지 밖으로 밀리지 않도록
      // 공유 헤더+지문과 개별 문제를 분리된 HTML 블록으로 생성한다.
      const isComplex = pq.sharedPassage && pq.subQuestions.length > 1;

      if (isComplex) {
        const contextChunks: string[] = [];

        // 출처
        if (q.source) {
          contextChunks.push(`<div class="source">${applyFormatting(q.source)}</div>`);
        }
        // 공유 지문 헤더
        if (pq.sharedHeader) {
          contextChunks.push(
            `<div class="q-header">${fmtLines(pq.sharedHeader.split('\n'))}</div>`
          );
        }
        // 공유 지문 (페이지 넘김 허용)
        contextChunks.push(renderPassage(pq.sharedPassage!));

        // 공유 지문 영역: break-inside 제한 없이 (긴 지문도 안전하게 페이지 넘김)
        let html = `<div class="question-context">${contextChunks.join('')}</div>\n`;

        // 개별 sub-question: 각각 break-inside:avoid 적용
        for (const sq of pq.subQuestions) {
          const sqChunks: string[] = [];
          if (sq.headerTop) {
            sqChunks.push(
              `<div class="q-header">${fmtLines(sq.headerTop.split('\n'))}</div>`
            );
          }
          if (sq.passage) {
            sqChunks.push(renderPassage(sq.passage));
          }
          if (sq.headerBottom && sq.headerBottom.trim()) {
            sqChunks.push(
              `<div class="q-header q-sub">${fmtLines(sq.headerBottom.split('\n'))}</div>`
            );
          }
          if (sq.gapBeforeOptions > 0) {
            sqChunks.push(`<div style="height:${sq.gapBeforeOptions}em"></div>`);
          }
          if (sq.options) {
            sqChunks.push(renderOptions(sq.options));
          }
          html += `<div class="question">${sqChunks.join('')}</div>\n`;
        }

        // [이미지N] 마커를 <img> 태그로 교체
        if (q.images && q.images.length > 0) {
          html = replaceImageMarkers(html, q.images);
        }
        return html;
      }

      // 단순 문제: 기존 로직 (전체를 한 블록에)
      let body = formatQuestionHtml(pq, q.source);
      // [이미지N] 마커를 <img> 태그로 교체
      if (q.images && q.images.length > 0) {
        body = replaceImageMarkers(body, q.images);
      }
      return `<div class="question">${body}</div>`;
    })
    .join('\n');

  // ── 빠른 정답 + 정답/해설 섹션 (옵션에 따라 포함) ──
  let answersSection = '';

  if (options.includeAnswers) {
    // 복합 문제의 subAnswers를 평탄화하여 전체 정답 목록 생성
    interface AnswerEntry { number: number; answer: string; explanation: string }
    const allAnswers: AnswerEntry[] = [];
    for (const q of questions) {
      if (q.subAnswers && q.subAnswers.length > 0) {
        allAnswers.push(...q.subAnswers);
      } else if (q.answer) {
        allAnswers.push({ number: q.number, answer: q.answer, explanation: q.explanation });
      }
    }

    allAnswers.sort((a, b) => a.number - b.number);

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
        })
        .join('\n');

      answersSection = `
      <div class="page-break"></div>
      <div class="section-title">정답 및 해설</div>
      <div class="quick-answers">${quickAnswers}</div>
      <div class="answers-content">${items}</div>`;
    }
  }

  // ── 페이지 번호 CSS (옵션) ──
  const pageNumberCss = options.showPageNumbers ? `
@page {
  @bottom-center {
    content: "- " counter(page) " -";
    font-size: 9pt;
    font-family: '맑은 고딕', 'Malgun Gothic', sans-serif;
    color: #555;
  }
}
/* 페이지 번호 fallback (CSS @page margin boxes 미지원 브라우저) */
.page-number-footer {
  display: none;
}
@media print {
  .page-number-footer {
    display: block;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 9pt;
    color: #555;
    padding-bottom: 2mm;
  }
}` : '';

  // ── 2단 레이아웃 CSS (옵션) ──
  const columnCss = options.twoColumns
    ? `column-count: 2; column-gap: 20px; column-rule: 1px dashed #ccc;`
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${esc(examTitle)}</title>
<style>
/* ── 페이지 설정 ── */
@page { size: A4; margin: 12mm 10mm${options.showPageNumbers ? ' 18mm 10mm' : ''}; }
* { margin: 0; padding: 0; box-sizing: border-box; }
${pageNumberCss}

body {
  font-family: '맑은 고딕', 'Malgun Gothic', 'Noto Sans KR', sans-serif;
  font-size: 10pt;
  line-height: 1.6;
  color: #000;
  text-align: justify;
}

/* ── 제목 ── */
.exam-title {
  text-align: center;
  font-size: 16pt;
  font-weight: bold;
  padding-bottom: 8px;
  margin-bottom: 12px;
  border-bottom: 2px solid #000;
}

/* ── 레이아웃 ── */
.questions-content {
  ${columnCss}
}

/* ── 문제 블록 ── */
.question {
  break-inside: avoid;
  margin-bottom: 14px;
}
/* 복합 문제의 공유 헤더+지문 영역: 페이지 넘김 허용 */
.question-context {
  margin-bottom: 6px;
}
.source {
  font-size: 8.5pt;
  font-weight: bold;
  color: #333;
  margin-bottom: 3px;
}

/* ── 문제 헤더 (볼드) ── */
.q-header {
  font-size: 10pt;
  font-weight: bold;
  line-height: 1.6;
  margin-bottom: 4px;
}
/* 지문 뒤 세부 질문/헤더 – 지문 박스와 충분한 간격 확보 */
.q-sub {
  margin-top: 12px;
  margin-bottom: 10px;
  font-weight: bold;
  white-space: pre-wrap;  /* 사용자가 넣은 연속 공백 보존 */
}

/* ── 지문 박스 (가이드라인 .passage) ── */
.passage {
  margin: 6px 0 10px 0;
  padding: 10px 12px;
  text-align: justify;
  line-height: 1.6;
  font-size: 9.5pt;
  border: 1px solid #999;
  border-radius: 4px;
  background-color: #fafafa;
}

/* ── 회색 박스 (<table> OCR 컨텐츠, 가이드라인 .shaded-box) ── */
.shaded-box {
  background-color: #f0f0f0;
  padding: 8px 12px;
  margin: 6px 0;
  border-radius: 4px;
  font-size: 9.5pt;
  line-height: 1.6;
}

/* ── 보기문 ── */
.options {
  margin-top: 6px;
  font-size: 9.5pt;
  line-height: 1.55;
  padding-left: 0.3em;
  white-space: pre-wrap;  /* 사용자가 넣은 연속 공백 보존 */
}

/* ── 삽입 이미지 ── */
.q-image {
  display: block;
  max-width: 90%;
  margin: 8px auto;
  border: 1px solid #ddd;
  border-radius: 4px;
}

/* ── 정답/해설 섹션 ── */
.page-break { break-before: page; height: 0; }
.section-title {
  text-align: center;
  font-size: 14pt;
  font-weight: bold;
  padding-bottom: 6px;
  margin-bottom: 10px;
  border-bottom: 2px solid #000;
}
.quick-answers {
  font-size: 9pt;
  line-height: 1.8;
  margin-bottom: 14px;
  padding: 8px 10px;
  background: #f9f9f9;
  border-radius: 4px;
}
.answers-content {
  ${columnCss}
}
.answer-item {
  break-inside: avoid;
  margin-bottom: 12px;
}
.a-header {
  font-weight: bold;
  font-size: 10pt;
}
.a-detail {
  font-size: 9pt;
  line-height: 1.55;
  margin-top: 3px;
  padding-left: 1.2em;
  word-break: break-word;
}

/* ── 인쇄 설정 ── */
@media print {
  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
@media screen {
  body {
    max-width: 210mm;
    margin: 10mm auto;
    padding: 15mm 13mm;
    background: #fff;
    box-shadow: 0 0 12px rgba(0,0,0,0.15);
  }
}
</style>
</head>
<body>
<div class="exam-title">${esc(examTitle)}</div>
<div class="questions-content">
${questionsHtml}
</div>
${answersSection}
${options.showPageNumbers ? '<div class="page-number-footer" id="pageNumFooter"></div>' : ''}
${options.showPageNumbers ? `<script>
// 페이지 번호 fallback: CSS @page margin boxes 미지원 시 JS로 처리
(function() {
  var footer = document.getElementById('pageNumFooter');
  if (!footer) return;
  // @page @bottom-center 지원 여부 감지 (지원되면 fallback 숨기기)
  var testStyle = document.createElement('style');
  testStyle.textContent = '@page { @bottom-center { content: "test"; } }';
  document.head.appendChild(testStyle);
  // Chrome 131+ 은 @page margin boxes 지원 → fallback 불필요
  // 그 외 브라우저는 fallback 사용
  try {
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules = sheets[i].cssRules;
      for (var j = 0; j < rules.length; j++) {
        if (rules[j].cssText && rules[j].cssText.indexOf('@bottom-center') !== -1) {
          footer.style.display = 'none';
          document.head.removeChild(testStyle);
          return;
        }
      }
    }
  } catch(e) {}
  document.head.removeChild(testStyle);
})();
</script>` : ''}
</body>
</html>`;
}

/* ═══════════════════════════════════════════════════════
   공개 API
   ═══════════════════════════════════════════════════════ */

/** PDF 내보내기 옵션 */
export interface PdfExportOptions {
  showPageNumbers: boolean;   // 페이지 표시 (기본: ON)
  includeAnswers: boolean;    // 정답/해설 포함 (기본: OFF)
  twoColumns: boolean;        // 2단 레이아웃 (기본: OFF)
}

export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  showPageNumbers: true,
  includeAnswers: true,
  twoColumns: true,
};

/**
 * 문제 목록을 PDF로 내보내기 (새 창에서 인쇄)
 */
export function exportAsPdf(
  questions: OcrQuestion[],
  fileName?: string,
  options?: Partial<PdfExportOptions>
): void {
  const opts: PdfExportOptions = { ...DEFAULT_PDF_OPTIONS, ...options };
  const title = fileName || '시험 문제';
  const prepared = prepareQuestions(questions);
  const html = generateExamHtml(prepared, title, opts);

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
