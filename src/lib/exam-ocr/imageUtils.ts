const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_DIMENSION = 2000;

/**
 * File/Blob을 data URL로 변환
 */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 이미지 크기 제한 처리 - Canvas 리사이즈
 */
export async function processImageForOcr(_file: Blob): Promise<string> {
  const dataUrl = await fileToDataUrl(_file);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      let result = canvas.toDataURL('image/png');

      const base64Length = result.split(',')[1]?.length ?? 0;
      const estimatedSize = (base64Length * 3) / 4;

      if (estimatedSize > MAX_FILE_SIZE) {
        let attempts = 0;
        while (attempts < 3) {
          width = Math.round(width * 0.8);
          height = Math.round(height * 0.8);
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          result = canvas.toDataURL('image/jpeg', 0.85);

          const newBase64Length = result.split(',')[1]?.length ?? 0;
          const newSize = (newBase64Length * 3) / 4;
          if (newSize <= MAX_FILE_SIZE) break;
          attempts++;
        }
      }

      const base64 = result.split(',')[1];
      resolve(base64);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Canvas에서 선택된 영역을 잘라서 base64로 반환
 */
export function cropCanvasRegion(
  sourceCanvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number
): string {
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = width;
  cropCanvas.height = height;
  const ctx = cropCanvas.getContext('2d')!;
  ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);

  const dataUrl = cropCanvas.toDataURL('image/png');
  return dataUrl.split(',')[1];
}
