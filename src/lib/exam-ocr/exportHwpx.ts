/**
 * HWPX 내보내기 모듈
 * Firebase Cloud Function을 호출하여 JSON → HWPX 변환
 * 
 * 이중 방식:
 *   A) 사용자가 설정에서 .hwpx 템플릿을 업로드한 경우 → 템플릿 기반 변환
 *   B) 템플릿 없으면 → md2hwpx 기본 변환
 */

import type { Question } from './types.ts';
import { questionsToExportJson } from './questionParser.ts';
import { getHwpxTemplate } from '../store.ts';

// Firebase Cloud Function URL (배포 후 실제 URL로 교체)
// 형식: https://<region>-<project-id>.cloudfunctions.net/convert_to_hwpx
const CLOUD_FUNCTION_URL =
  import.meta.env.VITE_HWPX_FUNCTION_URL ||
  'https://asia-northeast3-storybook-ocr.cloudfunctions.net/convert_to_hwpx';

/**
 * HWPX 파일로 내보내기
 * Cloud Function을 호출하여 변환 후 다운로드
 */
export async function exportQuestionsHwpx(
  questions: Question[],
  title?: string,
  onProgress?: (status: string) => void
): Promise<void> {
  if (questions.length === 0) {
    alert('내보낼 문제가 없습니다.');
    return;
  }

  const exportTitle = title || '기출문제 정리';
  onProgress?.('HWPX 변환 요청 중...');

  try {
    // 문제 데이터를 JSON 형식으로 변환
    const exportData = questionsToExportJson(questions);
    const jsonData = exportData as { questions: Array<Record<string, unknown>> };

    // 저장된 템플릿이 있는지 확인
    const template = getHwpxTemplate();
    const useTemplate = !!template;

    if (useTemplate) {
      onProgress?.('템플릿 기반으로 HWPX 생성 중...');
    } else {
      onProgress?.('서버에서 HWPX 생성 중...');
    }

    // Cloud Function 호출 (템플릿이 있으면 함께 전송)
    const requestBody: Record<string, unknown> = {
      title: exportTitle,
      questions: jsonData.questions,
    };

    if (template) {
      requestBody.template_base64 = template.data;
    }

    const response = await fetch(CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `서버 오류 (${response.status})`
      );
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || 'HWPX 변환 실패');
    }

    // Base64 → Blob → 다운로드
    onProgress?.('다운로드 준비 중...');
    const binaryData = atob(result.data);
    const bytes = new Uint8Array(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
      bytes[i] = binaryData.charCodeAt(i);
    }

    const blob = new Blob([bytes], {
      type: 'application/vnd.hancom.hwpx',
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      result.filename ||
      `${exportTitle}_${new Date().toISOString().slice(0, 10)}.hwpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    onProgress?.('HWPX 다운로드 완료!');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '알 수 없는 오류';

    // 네트워크 오류 시 안내 메시지
    if (
      message.includes('Failed to fetch') ||
      message.includes('NetworkError')
    ) {
      alert(
        'HWPX 변환 서버에 연결할 수 없습니다.\n\n' +
          '가능한 원인:\n' +
          '1. Firebase Cloud Function이 아직 배포되지 않았습니다\n' +
          '2. 네트워크 연결을 확인하세요\n\n' +
          'PDF 내보내기를 대신 사용하시겠습니까?'
      );
    } else {
      alert(`HWPX 내보내기 실패: ${message}`);
    }

    throw error;
  }
}
