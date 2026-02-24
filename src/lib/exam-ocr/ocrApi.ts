/**
 * OCR API - 브라우저에서 직접 Gemini API 호출
 * Next.js API route를 대체
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSettings } from '../store.ts';
import {
  EXTRACT_TEXT_PROMPT,
  EXTRACT_TEXT_WITH_FORMATTING_PROMPT,
  EXTRACT_MULTIPLE_REGIONS_PROMPT,
  ANSWER_EXPLANATION_PROMPT,
  BATCH_ANSWER_PROMPT,
  EXAM_ANALYSIS_PROMPT,
} from './prompts.ts';

const MODEL = 'gemini-2.0-flash';

/**
 * Gemini 응답에서 마크다운 코드 블록 및 불필요한 래핑 제거
 */
function cleanGeminiResponse(text: string): string {
  let cleaned = text;
  // 마크다운 코드 블록 제거 (```json ... ``` 또는 ``` ... ```)
  const codeBlockMatch = cleaned.match(/```(?:\w*)\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1];
  }
  return cleaned.trim();
}

function getClient(): GoogleGenerativeAI {
  const key = getSettings().geminiApiKey;
  if (!key) throw new Error('Gemini API 키가 설정되지 않았습니다. 설정에서 API 키를 입력해주세요.');
  return new GoogleGenerativeAI(key);
}

/**
 * 이미지 OCR - 이미지에서 텍스트 추출
 */
export async function ocrExtract(
  images: string[],
  mode: 'extract' | 'extract_formatting' | 'multi' = 'extract'
): Promise<string> {
  const ai = getClient();
  const model = ai.getGenerativeModel({ model: MODEL });

  let prompt: string;
  switch (mode) {
    case 'extract_formatting':
      prompt = EXTRACT_TEXT_WITH_FORMATTING_PROMPT;
      break;
    case 'multi':
      prompt = EXTRACT_MULTIPLE_REGIONS_PROMPT;
      break;
    default:
      prompt = EXTRACT_TEXT_PROMPT;
  }

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];

  for (const base64Image of images) {
    parts.push({
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
      const result = await model.generateContent(parts);
      const text = result.response.text();

      // 거부 응답 확인
      if (text.trim().length < 50) {
        const lower = text.toLowerCase();
        const isRejection =
          text.includes("I'm sorry") ||
          lower.includes("can't") ||
          lower.includes('cannot') ||
          lower.includes('unable');

        if (isRejection && attempt < maxRetries) {
          continue;
        }
      }

      return cleanGeminiResponse(text);
    } catch (error) {
      if (attempt >= maxRetries) throw error;
    }
  }

  throw new Error('OCR 처리 실패');
}

/**
 * 정답/해설 생성 - 단일 문제
 */
export async function getAnswer(text: string): Promise<string> {
  const ai = getClient();
  const model = ai.getGenerativeModel({ model: MODEL });
  const result = await model.generateContent(ANSWER_EXPLANATION_PROMPT(text));
  return cleanGeminiResponse(result.response.text());
}

/**
 * 정답/해설 생성 - 일괄 처리
 */
export async function getBatchAnswer(texts: string[]): Promise<string> {
  const ai = getClient();
  const model = ai.getGenerativeModel({ model: MODEL });
  const result = await model.generateContent(BATCH_ANSWER_PROMPT(texts));
  return cleanGeminiResponse(result.response.text());
}

/**
 * 시험지 분석
 */
export async function analyzeExam(jsonText: string, examName: string): Promise<string> {
  const ai = getClient();
  const model = ai.getGenerativeModel({ model: MODEL });
  const result = await model.generateContent(EXAM_ANALYSIS_PROMPT(jsonText, examName));
  return result.response.text();
}
