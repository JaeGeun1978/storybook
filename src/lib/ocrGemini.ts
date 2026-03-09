/**
 * OCR Gemini API 호출 (클라이언트 사이드)
 * past-exam-web의 서버사이드 API route를 클라이언트용으로 변환
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSettings } from './store';
import {
  EXTRACT_TEXT_PROMPT,
  EXTRACT_TEXT_WITH_FORMATTING_PROMPT,
  EXTRACT_MULTIPLE_REGIONS_PROMPT,
  EXTRACT_MULTIPLE_REGIONS_WITH_FORMATTING_PROMPT,
  FALLBACK_SIMPLE_PROMPT,
  ANSWER_EXPLANATION_PROMPT,
  BATCH_ANSWER_PROMPT,
  EXAM_ANALYSIS_PROMPT,
} from './ocrPrompts';

const MODEL_NAME = 'gemini-2.5-flash-preview-05-20';

export type OcrMode = 'extract' | 'extract_formatting' | 'multi' | 'multi_formatting';

function getModel() {
  const { geminiApiKey } = getSettings();
  if (!geminiApiKey) throw new Error('Gemini API Key가 설정되지 않았습니다. 설정 페이지에서 키를 등록해주세요.');

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  return genAI.getGenerativeModel(
    { model: MODEL_NAME },
    {
      apiVersion: 'v1beta',
      // @ts-ignore
      dangerouslyAllowBrowser: true,
    }
  );
}

/**
 * 이미지 OCR 실행
 * @param images base64 이미지 배열
 * @param mode OCR 모드
 */
export async function runOcr(images: string[], mode: OcrMode = 'extract'): Promise<string> {
  const model = getModel();

  let prompt: string;
  switch (mode) {
    case 'extract_formatting':
      prompt = EXTRACT_TEXT_WITH_FORMATTING_PROMPT;
      break;
    case 'multi':
      prompt = EXTRACT_MULTIPLE_REGIONS_PROMPT;
      break;
    case 'multi_formatting':
      prompt = EXTRACT_MULTIPLE_REGIONS_WITH_FORMATTING_PROMPT;
      break;
    default:
      prompt = EXTRACT_TEXT_PROMPT;
  }

  // Gemini SDK에 이미지를 inline data로 전달
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = [prompt];
  for (const base64Image of images) {
    contents.push({
      inlineData: {
        mimeType: 'image/png',
        data: base64Image,
      },
    });
  }

  // 재시도 로직
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(contents);
      const response = result.response;
      const text = response.text();

      // 빈 응답 또는 거부 응답 확인
      if (text.trim().length < 50) {
        const lower = text.toLowerCase();
        const isRejection =
          text.trim().length === 0 ||
          text.includes("I'm sorry") ||
          lower.includes("can't") ||
          lower.includes('cannot') ||
          lower.includes('unable');

        if (isRejection && attempt < maxRetries) {
          console.log(`[OCR] 빈/거부 응답 (attempt ${attempt + 1}/${maxRetries + 1}), 재시도...`);
          continue;
        }
      }

      return text;
    } catch (error) {
      console.error(`[OCR] 에러 (attempt ${attempt + 1}/${maxRetries + 1}):`, error);
      if (attempt >= maxRetries) {
        // 최종 폴백 시도
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fallbackContents: any[] = [FALLBACK_SIMPLE_PROMPT];
          for (const base64Image of images) {
            fallbackContents.push({
              inlineData: { mimeType: 'image/png', data: base64Image },
            });
          }
          const fallbackResult = await model.generateContent(fallbackContents);
          const fallbackText = fallbackResult.response.text();
          if (fallbackText.trim().length > 0) return fallbackText;
        } catch (fallbackError) {
          console.error('[OCR] 폴백 시도도 실패:', fallbackError);
        }
        throw error;
      }
    }
  }

  throw new Error('OCR 처리 실패');
}

/**
 * 정답/해설 생성
 */
export async function getAnswerExplanation(text: string): Promise<string> {
  const model = getModel();
  const result = await model.generateContent(ANSWER_EXPLANATION_PROMPT(text));
  return result.response.text();
}

/**
 * 일괄 정답/해설 생성
 */
export async function getBatchAnswers(texts: string[]): Promise<string> {
  const model = getModel();
  const result = await model.generateContent(BATCH_ANSWER_PROMPT(texts));
  return result.response.text();
}

/**
 * 시험지 분석
 */
export async function analyzeExam(jsonText: string, examName: string): Promise<string> {
  const model = getModel();
  const result = await model.generateContent(EXAM_ANALYSIS_PROMPT(jsonText, examName));
  return result.response.text();
}
