/**
 * 문제 텍스트에 [문제] 태그가 없으면 자동으로 붙여주는 정규화 함수
 */
export function normalizeQuestionText(text: string): string {
  if (!text.trim()) return text;

  // 이미 [문제] 태그가 하나라도 있으면 그대로 반환
  if (/\[문제\]/.test(text)) {
    return text;
  }

  // [문제] 태그가 없는 경우: 맨 앞에 [문제] 추가
  return '[문제] ' + text.trimStart();
}
