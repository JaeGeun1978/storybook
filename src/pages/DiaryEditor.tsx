import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDiaryById, saveDiary, type DiaryEntry } from '../lib/diaryStore';
import { generateEnglishDiary } from '../lib/gemini';
import { generateSpeech } from '../lib/tts';
import { renderDiaryVideo } from '../lib/videoRenderer';
import { saveMedia, loadMedia, videoKey } from '../lib/mediaStore';
import {
  ArrowLeft, Wand2, Loader2, Volume2, Pause, ChevronLeft, ChevronRight,
  Download, BookOpen, RotateCcw, Film,
} from 'lucide-react';

export const DiaryEditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [diary, setDiary] = useState<DiaryEntry | null>(null);
  const [koreanInput, setKoreanInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [progress, setProgress] = useState(0);

  // 2문장씩 보기
  const [currentPage, setCurrentPage] = useState(0);
  const SENTENCES_PER_PAGE = 2;

  // TTS
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingPage, setPlayingPage] = useState(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioBlobsRef = useRef<Map<number, Blob>>(new Map());

  // 영상
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      const found = getDiaryById(id);
      if (found) {
        setDiary(found);
        setKoreanInput(found.koreanInput);
        // IndexedDB에서 비디오 복원
        loadMedia(videoKey(found.id)).then((data) => {
          if (data) {
            if (data instanceof Blob) {
              setVideoUrl(URL.createObjectURL(data));
            } else if (typeof data === 'string' && data.startsWith('blob:')) {
              // stale blob URL - ignore
            } else if (typeof data === 'string') {
              setVideoUrl(data);
            }
          }
        });
      } else {
        navigate('/');
      }
    }
  }, [id, navigate]);

  const totalPages = diary?.sentences
    ? Math.ceil(diary.sentences.length / SENTENCES_PER_PAGE)
    : 0;

  const currentSentences = diary?.sentences?.slice(
    currentPage * SENTENCES_PER_PAGE,
    (currentPage + 1) * SENTENCES_PER_PAGE
  ) || [];

  // ── 한글 → 영어일기 변환 ──
  const handleGenerate = async () => {
    if (!koreanInput.trim() || !diary) return;
    setLoading(true);
    setStatusText('✨ Gemini가 영어일기를 쓰고 있습니다...');

    try {
      const result = await generateEnglishDiary(koreanInput);

      const updatedDiary: DiaryEntry = {
        ...diary,
        koreanInput,
        title: koreanInput.substring(0, 30) + (koreanInput.length > 30 ? '...' : ''),
        sentences: result.sentences,
        vocabulary: result.vocabulary,
        status: 'generated',
        updatedAt: Date.now(),
      };
      setDiary(updatedDiary);
      saveDiary(updatedDiary);
      setCurrentPage(0);
      audioBlobsRef.current.clear();
      setVideoUrl(null);
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  // ── TTS 재생 (현재 페이지의 2문장) ──
  const handlePlayPage = useCallback(async (page: number) => {
    if (!diary || diary.sentences.length === 0) return;

    // 이미 재생 중이면 정지
    if (isPlaying && playingPage === page) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPlaying(false);
      setPlayingPage(-1);
      return;
    }

    const sentences = diary.sentences.slice(
      page * SENTENCES_PER_PAGE,
      (page + 1) * SENTENCES_PER_PAGE
    );
    const textToRead = sentences.map(s => s.english).join(' ');

    setIsPlaying(true);
    setPlayingPage(page);

    try {
      let blob = audioBlobsRef.current.get(page);
      if (!blob) {
        blob = await generateSpeech(textToRead, 'en');
        audioBlobsRef.current.set(page, blob);
      }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setIsPlaying(false);
        setPlayingPage(-1);

        // 자동으로 다음 페이지로 넘어가기
        if (page + 1 < totalPages) {
          setCurrentPage(page + 1);
          setTimeout(() => handlePlayPage(page + 1), 300);
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setIsPlaying(false);
        setPlayingPage(-1);
      };

      await audio.play();
    } catch (e) {
      console.warn('[Diary TTS] 재생 실패:', e);
      setIsPlaying(false);
      setPlayingPage(-1);
    }
  }, [diary, isPlaying, playingPage, totalPages]);

  // ── 전체 재생 ──
  const handlePlayAll = () => {
    setCurrentPage(0);
    setTimeout(() => handlePlayPage(0), 100);
  };

  // ── 영상 생성 ──
  const handleGenerateVideo = async () => {
    if (!diary || diary.sentences.length === 0) return;
    setLoading(true);
    setProgress(0);
    setStatusText('🎬 영상 준비 중...');

    try {
      // 1문장씩 DiarySceneData 생성
      const sceneCount = diary.sentences.length;
      const scenes: {
        englishLines: string[];
        koreanLines: string[];
        audioFile: Blob;
        vocabulary: { word: string; meaning: string }[];
      }[] = [];

      for (let i = 0; i < sceneCount; i++) {
        const sentence = diary.sentences[i];

        // TTS 생성 (1문장씩, 영상용 별도 캐시 키 사용)
        setStatusText(`🎧 음성 생성 중... (${i + 1}/${sceneCount})`);
        setProgress(Math.round((i / sceneCount) * 40));

        const videoCacheKey = 10000 + i; // 영상용 별도 캐시 키
        let audioBlob = audioBlobsRef.current.get(videoCacheKey);
        if (!audioBlob) {
          const textToRead = sentence.english || `Sentence ${i + 1}`;
          audioBlob = await generateSpeech(textToRead, 'en');
          audioBlobsRef.current.set(videoCacheKey, audioBlob);
        }

        // 해당 문장에 포함된 단어만 찾기
        const sentenceText = (sentence.english || '').toLowerCase();
        const relatedVocab = (diary.vocabulary || [])
          .filter(v => v && v.word && sentenceText.includes(v.word.toLowerCase()))
          .map(v => ({ word: v.word, meaning: v.meaning || '' }));

        scenes.push({
          englishLines: [sentence.english],
          koreanLines: [sentence.korean],
          audioFile: audioBlob,
          vocabulary: relatedVocab,
        });
      }

      // 영상 렌더링
      setStatusText('🎬 영상 렌더링 중...');
      setProgress(40);

      const result = await renderDiaryVideo({
        scenes,
        onProgress: (p, text) => {
          setProgress(40 + Math.round(p * 0.55));
          if (text) setStatusText(`🎬 ${text}`);
        },
      });

      // IndexedDB에 저장
      try {
        const videoBlob = await fetch(result).then(r => r.blob());
        await saveMedia(videoKey(diary.id), videoBlob);
        console.log(`[DiaryEditor] ✅ 영상 IndexedDB 저장 완료 (${(videoBlob.size / 1024 / 1024).toFixed(1)}MB)`);
      } catch (e) {
        console.warn('[DiaryEditor] 비디오 IndexedDB 저장 실패:', e);
      }

      setVideoUrl(result);
      setProgress(100);
      setStatusText('✅ 영상 생성 완료!');

      // 상태 업데이트
      const updatedDiary = { ...diary, status: 'completed' as const, updatedAt: Date.now() };
      setDiary(updatedDiary);
      saveDiary(updatedDiary);

    } catch (error) {
      alert('영상 생성 실패: ' + (error as Error).message);
      console.error('[DiaryEditor] 영상 생성 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // ── PDF 다운로드 ──
  const handleDownloadPdf = async () => {
    if (!diary || diary.sentences.length === 0) return;
    setLoading(true);
    setStatusText('📄 PDF 생성 중...');
    try {
      const { generateDiaryPdf } = await import('../lib/pdfGenerator');
      const pdfBlob = await generateDiaryPdf({
        title: diary.title,
        sentences: diary.sentences,
        vocabulary: diary.vocabulary,
      });
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${diary.title.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_diary.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('PDF 생성 실패: ' + (e as Error).message);
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  // ── 페이지 네비게이션 ──
  const goPage = (delta: number) => {
    const next = currentPage + delta;
    if (next >= 0 && next < totalPages) {
      setCurrentPage(next);
    }
  };

  if (!diary) return null;

  const isGenerated = diary.sentences.length > 0;

  return (
    <div className="max-w-6xl mx-auto">
      {/* ── 헤더 ── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              📓 영어일기쓰기
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/15 text-orange-400">
                🇺🇸 English Diary
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">한글로 쓰면 영어 일기로 변환해드려요</p>
          </div>
        </div>

        {isGenerated && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateVideo}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                bg-violet-500/10 text-violet-400 border border-violet-500/20
                hover:bg-violet-500/20 transition-all disabled:opacity-50"
            >
              <Film size={16} />
              영상 만들기
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
                hover:bg-emerald-500/20 transition-all disabled:opacity-50"
            >
              <Download size={16} />
              PDF
            </button>
          </div>
        )}
      </div>

      {/* ── 로딩 상태 ── */}
      {loading && (
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 border border-violet-500/20 p-5 animate-fade-in-up">
          <div className="flex items-center gap-4 mb-3">
            <Loader2 size={24} className="text-violet-400 animate-spin" />
            <div className="flex-1">
              <p className="text-sm font-medium text-violet-300">{statusText}</p>
            </div>
            <span className="text-sm font-bold text-violet-400">{progress}%</span>
          </div>
          {progress > 0 && (
            <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── 입력 영역 (생성 전) ── */}
      {!isGenerated && (
        <div className="rounded-2xl bg-surface border border-white/5 p-6 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
              <BookOpen size={20} className="text-orange-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">오늘 하고 싶은 말을 한글로 써보세요!</h3>
              <p className="text-xs text-slate-400">AI가 자연스러운 영어 일기로 바꿔드려요 (최대 30문장)</p>
            </div>
          </div>

          <textarea
            value={koreanInput}
            onChange={(e) => setKoreanInput(e.target.value)}
            placeholder="오늘 학교에서 재밌는 일이 있었다. 점심시간에 친구들이랑 축구를 했는데 내가 골을 넣었다! 정말 기분이 좋았다. 집에 와서 엄마가 만들어주신 떡볶이를 먹었다. 내일은 수학 시험이라 공부를 해야 한다..."
            className="w-full h-48 p-4 rounded-xl bg-white/[0.03] border border-white/10 text-white text-sm
              placeholder:text-slate-600 resize-none focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all"
          />

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-slate-500">
              {koreanInput.length > 0 ? `${koreanInput.length}자` : ''}
            </p>
            <button
              onClick={handleGenerate}
              disabled={loading || !koreanInput.trim()}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white
                bg-gradient-to-r from-orange-500 to-amber-500
                hover:from-orange-400 hover:to-amber-400
                shadow-lg shadow-orange-500/20 disabled:opacity-50
                transition-all duration-200 hover:scale-105"
            >
              <Wand2 size={16} />
              영어일기 만들기
            </button>
          </div>
        </div>
      )}

      {/* ── 결과 화면 (생성 후) ── */}
      {isGenerated && (
        <div className="space-y-5 animate-fade-in-up">

          {/* ─── 영상 미리보기 ─── */}
          {videoUrl && (
            <div className="rounded-2xl bg-surface border border-white/5 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  🎬 영어일기 영상
                </h3>
                <a
                  href={videoUrl}
                  download={`${diary.title.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_diary.webm`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                    bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
                    hover:bg-emerald-500/20 transition-all"
                >
                  <Download size={13} />
                  영상 다운로드 (.webm)
                </a>
              </div>
              <div className="aspect-video rounded-xl overflow-hidden bg-black">
                <video
                  src={videoUrl}
                  controls
                  className="w-full h-full"
                />
              </div>
            </div>
          )}

          {/* ─── 상단: 단어장 ─── */}
          <div className="rounded-2xl bg-surface border border-white/5 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                📚 단어 · 구동사 · 이디엄
                <span className="text-xs font-normal text-slate-500">
                  {diary.vocabulary.length}개
                </span>
              </h3>
              <button
                onClick={() => {
                  setDiary({ ...diary, sentences: [], vocabulary: [], status: 'draft' });
                  saveDiary({ ...diary, sentences: [], vocabulary: [], status: 'draft', updatedAt: Date.now() });
                  audioBlobsRef.current.clear();
                  setVideoUrl(null);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400
                  hover:text-white hover:bg-white/5 transition-all"
              >
                <RotateCcw size={13} />
                다시 쓰기
              </button>
            </div>

            <div className="max-h-[280px] overflow-y-auto pr-2 custom-scrollbar">
              <div className="flex flex-wrap gap-2">
                {diary.vocabulary.map((vocab, i) => (
                  <div
                    key={i}
                    className={`
                      px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                      ${vocab.type === 'idiom'
                        ? 'bg-purple-500/10 border-purple-500/20 text-purple-300'
                        : vocab.type === 'phrase'
                          ? 'bg-blue-500/10 border-blue-500/20 text-blue-300'
                          : 'bg-white/[0.04] border-white/10 text-slate-300'
                      }
                    `}
                  >
                    <span className="font-bold">{vocab.word}</span>
                    <span className="text-slate-500 mx-1">·</span>
                    <span className={
                      vocab.type === 'idiom' ? 'text-purple-400/80'
                      : vocab.type === 'phrase' ? 'text-blue-400/80'
                      : 'text-slate-400'
                    }>
                      {vocab.meaning}
                    </span>
                    {vocab.type !== 'word' && (
                      <span className="ml-1.5 text-[10px] opacity-60">
                        {vocab.type === 'phrase' ? '구동사' : '이디엄'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─── 하단: 문장 (2문장씩) ─── */}
          <div className="rounded-2xl bg-surface border border-white/5 p-5">
            {/* 컨트롤 바 */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                📝 영어 일기
                <span className="text-xs font-normal text-slate-500">
                  {diary.sentences.length}문장
                </span>
              </h3>

              <div className="flex items-center gap-2">
                {/* 전체 재생 */}
                <button
                  onClick={handlePlayAll}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                    bg-orange-500/10 text-orange-400 border border-orange-500/20
                    hover:bg-orange-500/20 transition-all disabled:opacity-50"
                >
                  <Volume2 size={13} />
                  처음부터 듣기
                </button>
              </div>
            </div>

            {/* 문장 카드 */}
            <div className="min-h-[200px] flex flex-col justify-center">
              {currentSentences.map((sentence, i) => {
                const globalIndex = currentPage * SENTENCES_PER_PAGE + i;
                return (
                  <div
                    key={globalIndex}
                    className="mb-5 last:mb-0 p-4 rounded-xl bg-white/[0.02] border border-white/5"
                  >
                    {/* 문장 번호 */}
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-orange-500/15 flex items-center justify-center text-xs font-bold text-orange-400">
                        {globalIndex + 1}
                      </span>
                      <div className="flex-1">
                        {/* 영어 */}
                        <p className="text-white text-base font-medium leading-relaxed">
                          {sentence.english}
                        </p>
                        {/* 한글 */}
                        <p className="text-slate-400 text-sm mt-1.5 leading-relaxed">
                          {sentence.korean}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 페이지 네비게이션 + TTS */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
              <button
                onClick={() => goPage(-1)}
                disabled={currentPage === 0}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-slate-400
                  hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              >
                <ChevronLeft size={16} /> 이전
              </button>

              <div className="flex items-center gap-3">
                {/* 현재 페이지 TTS 재생 */}
                <button
                  onClick={() => handlePlayPage(currentPage)}
                  className={`p-2.5 rounded-xl transition-all ${
                    isPlaying && playingPage === currentPage
                      ? 'bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/30'
                      : 'bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {isPlaying && playingPage === currentPage ? (
                    <Pause size={18} />
                  ) : (
                    <Volume2 size={18} />
                  )}
                </button>

                {/* 페이지 표시 */}
                <span className="text-sm text-slate-400 font-medium min-w-[60px] text-center">
                  {currentPage + 1} / {totalPages}
                </span>
              </div>

              <button
                onClick={() => goPage(1)}
                disabled={currentPage >= totalPages - 1}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-slate-400
                  hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              >
                다음 <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* ─── 원문 보기 ─── */}
          <details className="rounded-2xl bg-surface border border-white/5 overflow-hidden">
            <summary className="px-5 py-3 cursor-pointer text-sm text-slate-400 hover:text-white transition-colors">
              📋 한글 원문 보기
            </summary>
            <div className="px-5 pb-4">
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{diary.koreanInput}</p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
};
