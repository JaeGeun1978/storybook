/**
 * 일괄 정답/해설 응답을 "--- 문제 N ---" 구분자로 파싱
 */
export function parseBatchAnswerResponse(
  response: string,
  count: number
): string[] {
  const parts = response.split(/---\s*문제\s*\d+\s*---/).filter((p) => p.trim());

  if (parts.length === count) {
    return parts.map((p) => p.trim());
  }

  const byTag = response.split(/(?=\[문제\])/).filter((p) => p.trim());
  if (byTag.length === count) {
    return byTag.map((p) => p.trim());
  }

  const result = new Array(count).fill('');
  result[0] = response.trim();
  return result;
}

/**
 * GPT 정답/해설 응답을 기존 문제 텍스트에 병합
 */
export function mergeAnswerIntoText(
  originalText: string,
  gptResponse: string
): string {
  const originalQuestionCount = (originalText.match(/\[문제\]/g) || []).length;
  const responseQuestionCount = (gptResponse.match(/\[문제\]/g) || []).length;

  if (originalQuestionCount > 1 && responseQuestionCount > 1) {
    return gptResponse.trim();
  }

  const answerMatch = gptResponse.match(/\[정답\][\s\S]*/);
  if (answerMatch) {
    const cleanedOriginal = originalText
      .replace(/\n*\[정답\][\s\S]*$/, '')
      .trimEnd();
    return cleanedOriginal + '\n\n' + answerMatch[0].trim();
  }

  const cleanedOriginal = originalText
    .replace(/\n*\[정답\][\s\S]*$/, '')
    .trimEnd();
  return cleanedOriginal + '\n\n' + gptResponse.trim();
}
