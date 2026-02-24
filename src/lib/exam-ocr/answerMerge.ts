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

  // 기존 정답/해설 제거 함수
  const removeExistingAnswer = (text: string) =>
    text.replace(/\n*\[정답\][\s\S]*$/, '').replace(/\n*정답[\s:：][\s\S]*$/m, '').trimEnd();

  // [정답] 태그로 시작하는 부분 매칭
  const answerMatch = gptResponse.match(/\[정답\][\s\S]*/);
  if (answerMatch) {
    return removeExistingAnswer(originalText) + '\n\n' + answerMatch[0].trim();
  }

  // "정답:" 또는 "정답 :" 형식 매칭 (Gemini가 태그 없이 응답하는 경우)
  const altAnswerMatch = gptResponse.match(/(?:^|\n)\s*(정답[\s:：][\s\S]*)/m);
  if (altAnswerMatch) {
    const answerPart = altAnswerMatch[1].trim();
    return removeExistingAnswer(originalText) + '\n\n[정답] ' + answerPart.replace(/^정답[\s:：]\s*/, '');
  }

  // 응답에 [문제] 태그가 있으면 원본과 중복 → 정답/해설만 추출 시도
  if (responseQuestionCount >= 1) {
    // 응답에서 원본 문제 텍스트를 제거하고 나머지(정답/해설)만 추출
    const afterLastQuestion = gptResponse.replace(/[\s\S]*\[문제\][^\[]*/, '');
    if (afterLastQuestion.trim()) {
      return removeExistingAnswer(originalText) + '\n\n' + afterLastQuestion.trim();
    }
  }

  // 어떤 패턴도 매칭 안 되면 응답 전체를 추가 (중복 방지를 위해 원본과 다를 때만)
  const cleanedOriginal = removeExistingAnswer(originalText);
  return cleanedOriginal + '\n\n' + gptResponse.trim();
}
