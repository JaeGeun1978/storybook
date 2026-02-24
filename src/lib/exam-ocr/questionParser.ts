import type { Question } from './types.ts';
import { normalizeQuestionText } from './normalizeQuestion.ts';

/**
 * 통합 텍스트에서 [정답]과 [해설] 태그를 파싱하여 분리
 */
export function parseQuestionText(fullText: string): {
  text: string;
  answer: string;
  explanation: string;
} {
  const problemCount = (fullText.match(/\[문제\]/g) || []).length;

  if (problemCount > 1) {
    return { text: fullText, answer: '', explanation: '' };
  }

  let text = fullText;
  let answer = '';
  let explanation = '';

  const answerMatch = fullText.match(/\[정답\]\s*(.*?)(?=\[해설\]|$)/s);
  const explanationMatch = fullText.match(/\[해설\]\s*(.*?)$/s);

  if (answerMatch) {
    answer = answerMatch[1].trim();
    text = fullText.slice(0, answerMatch.index).trim();
  }

  if (explanationMatch) {
    explanation = explanationMatch[1].trim();
    if (!answerMatch) {
      text = fullText.slice(0, explanationMatch.index).trim();
    }
  }

  return { text, answer, explanation };
}

/**
 * Question 배열을 JSON 내보내기 형식으로 변환
 */
export function questionsToExportJson(
  questions: Question[],
  sourcePdf: string = ''
): object {
  return {
    metadata: {
      source_pdf: sourcePdf,
      extraction_date: new Date().toISOString(),
      total_questions: questions.length,
    },
    questions: questions.map((q) => {
      const normalized = normalizeQuestionText(q.text);
      const parsed = parseQuestionText(normalized);
      return {
        number: q.number,
        text: parsed.text || normalized,
        answer: parsed.answer || q.answer,
        explanation: parsed.explanation || q.explanation,
        page: q.page ?? 1,
        region: q.region ?? null,
        source: q.source ?? '',
        saved_at: q.saved_at ?? new Date().toISOString(),
      };
    }),
  };
}

/**
 * JSON 가져오기: 내보내기 형식 → Question 배열
 */
export function importJsonToQuestions(json: Record<string, unknown>): Question[] {
  const data = json as { questions?: Array<Record<string, unknown>> };
  const questions = data.questions ?? [];

  return questions.map((q, i) => {
    const text = (q.text as string) ?? '';
    const answer = (q.answer as string) ?? '';
    const explanation = (q.explanation as string) ?? '';

    const problemCount = (text.match(/\[문제\]/g) || []).length;
    let fullText = text;
    if (problemCount <= 1 && (answer || explanation)) {
      if (answer) fullText += `\n\n[정답] ${answer}`;
      if (explanation) fullText += `\n[해설] ${explanation}`;
    }

    return {
      number: i + 1,
      text: fullText,
      answer: answer,
      explanation: explanation,
      page: (q.page as number) ?? 1,
      region: (q.region as [number, number, number, number]) ?? undefined,
      source: (q.source as string) ?? '',
      saved_at: (q.saved_at as string) ?? new Date().toISOString(),
    };
  });
}
