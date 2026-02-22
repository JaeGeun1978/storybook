/**
 * IndexedDB 기반 미디어 저장소
 * 
 * localStorage는 ~5MB 한계가 있어 base64 이미지를 저장할 수 없음.
 * IndexedDB는 수백 MB까지 저장 가능하므로 이미지/오디오/비디오를 여기에 보관.
 * 
 * 키 형식: "project_{projectId}_scene_{sceneId}_{type}"
 *  - type: "image" | "audio" | "video"
 */

const DB_NAME = 'jaegeun_storybook_media';
const DB_VERSION = 1;
const STORE_NAME = 'media';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── 키 생성 유틸리티 ───

export function mediaKey(projectId: string, sceneId: string, type: 'image' | 'audio'): string {
  return `project_${projectId}_scene_${sceneId}_${type}`;
}

export function videoKey(projectId: string): string {
  return `project_${projectId}_video`;
}

// ─── 저장 / 불러오기 ───

/**
 * 미디어 데이터 저장 (data:URL 문자열 또는 Blob)
 */
export async function saveMedia(key: string, data: string | Blob): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(data, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.warn('[MediaStore] 저장 실패:', key, e);
  }
}

/**
 * 미디어 데이터 불러오기
 * @returns data:URL 문자열, Blob, 또는 없으면 null
 */
export async function loadMedia(key: string): Promise<string | Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  } catch (e) {
    console.warn('[MediaStore] 불러오기 실패:', key, e);
    return null;
  }
}

/**
 * 미디어 삭제
 */
export async function deleteMedia(key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.warn('[MediaStore] 삭제 실패:', key, e);
  }
}

/**
 * 특정 프로젝트의 모든 미디어 삭제
 */
export async function deleteProjectMedia(projectId: string): Promise<void> {
  try {
    const prefix = `project_${projectId}_`;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.warn('[MediaStore] 프로젝트 미디어 삭제 실패:', projectId, e);
  }
}
