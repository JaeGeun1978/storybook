import type { Question } from './types.ts';
import { questionsToExportJson, importJsonToQuestions } from './questionParser.ts';

/**
 * JSON 파일로 다운로드
 */
export function downloadJson(questions: Question[], filename?: string) {
  const data = questionsToExportJson(questions);
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `exam_questions_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * JSON 파일에서 문제 가져오기
 */
export function loadJsonFile(): Promise<Question[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('파일이 선택되지 않았습니다'));
        return;
      }

      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const questions = importJsonToQuestions(json);
        resolve(questions);
      } catch (error) {
        reject(error);
      }
    };

    input.click();
  });
}
