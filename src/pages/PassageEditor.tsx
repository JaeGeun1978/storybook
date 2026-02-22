import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getPassageById, savePassage, type PassageEntry } from '../lib/passageStore';
import { analyzePassage } from '../lib/gemini';
import { generateSpeech } from '../lib/tts';
import { renderDiaryVideo } from '../lib/videoRenderer';
import { saveMedia, loadMedia, videoKey } from '../lib/mediaStore';
import {
  ArrowLeft, Wand2, Loader2, Volume2, Pause, ChevronLeft, ChevronRight,
  Download, BookOpen, RotateCcw, Film, User, UserCircle2,
} from 'lucide-react';

type VoiceGender = 'female' | 'male';

export const PassageEditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [passage, setPassage] = useState<PassageEntry | null>(null);
  const [englishInput, setEnglishInput] = useState('');
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

  // 성우 선택
  const [voiceGender, setVoiceGender] = useState<VoiceGender>('female');

  // 영상
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      const found = getPassageById(id);
      if (found) {
        setPassage(found);
        setEnglishInput(found.englishInput);
        loadMedia(videoKey(found.id)).then((data) => {
          if (data) {
            if (data instanceof Blob) {
              setVideoUrl(URL.createObjectURL(data));
            } else if (typeof data === 'string' && !data.startsWith('blob:')) {
              setVideoUrl(data);
            }
          }
        });
      } else {
        navigate('/');
      }
    }
  }, [id, navigate]);

  const totalPages = passage?.sentences
    ? Math.ceil(passage.sentences.length / SENTENCES_PER_PAGE)
    : 0;

  const currentSentences = passage?.sentences?.slice(
    currentPage * SENTENCES_PER_PAGE,
    (currentPage + 1) * SENTENCES_PER_PAGE
  ) || [];

  // ── 영어 지문 분석 ──
  const handleGenerate = async () => {
    if (!englishInput.trim() || !passage) return;
    setLoading(true);
    setStatusText('✨ 지문을 분석하고 있습니다...');

    try {
      const result = await analyzePassage(englishInput);

      const updatedPassage: PassageEntry = {
        ...passage,
        englishInput,
        title: englishInput.substring(0, 40).replace(/\n/g, ' ') + (englishInput.length > 40 ? '...' : ''),
        sentences: result.sentences,
        vocabulary: result.vocabulary,
        status: 'generated',
        updatedAt: Date.now(),
      };
      setPassage(updatedPassage);
      savePassage(updatedPassage);
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

  // ── Gemini 음성 이름 (성별) ──
  const getGeminiVoiceName = useCallback((): string => {
    // Gemini Live Voice: female=Aoede, male=Charon
    return voiceGender === 'female' ? 'Aoede' : 'Charon';
  }, [voiceGender]);

  // ── TTS 재생 (현재 페이지의 2문장) ──
  const handlePlayPage = useCallback(async (page: number) => {
    if (!passage || passage.sentences.length === 0) return;

    if (isPlaying && playingPage === page) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPlaying(false);
      setPlayingPage(-1);
      return;
    }

    const sentences = passage.sentences.slice(
      page * SENTENCES_PER_PAGE,
      (page + 1) * SENTENCES_PER_PAGE
    );
    const textToRead = sentences.map(s => s.english).join(' ');

    setIsPlaying(true);
    setPlayingPage(page);

    try {
      // 성별+페이지 조합 캐시 키
      const voiceName = getGeminiVoiceName();
      const cacheKey = page * 10 + (voiceGender === 'male' ? 1 : 0);
      let blob = audioBlobsRef.current.get(cacheKey);
      if (!blob) {
        blob = await generateSpeech(textToRead, 'en', voiceName);
        audioBlobsRef.current.set(cacheKey, blob);
      }

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setIsPlaying(false);
        setPlayingPage(-1);

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
      console.warn('[Passage TTS] 재생 실패:', e);
      setIsPlaying(false);
      setPlayingPage(-1);
    }
  }, [passage, isPlaying, playingPage, totalPages, voiceGender, getGeminiVoiceName]);

  const handlePlayAll = () => {
    setCurrentPage(0);
    setTimeout(() => handlePlayPage(0), 100);
  };

  // ── 영상 생성 ──
  const handleGenerateVideo = async () => {
    if (!passage || passage.sentences.length === 0) return;
    setLoading(true);
    setProgress(0);
    setStatusText('🎬 영상 준비 중...');

    try {
      const sceneCount = passage.sentences.length;
      const scenes: {
        englishLines: string[];
        koreanLines: string[];
        audioFile: Blob;
        vocabulary: { word: string; meaning: string }[];
      }[] = [];

      for (let i = 0; i < sceneCount; i++) {
        const sentence = passage.sentences[i];

        setStatusText(`🎧 음성 생성 중... (${i + 1}/${sceneCount})`);
        setProgress(Math.round((i / sceneCount) * 40));

        const voiceName = getGeminiVoiceName();
        const videoCacheKey = 20000 + i + (voiceGender === 'male' ? 5000 : 0);
        let audioBlob = audioBlobsRef.current.get(videoCacheKey);
        if (!audioBlob) {
          const textToRead = sentence.english || `Sentence ${i + 1}`;
          audioBlob = await generateSpeech(textToRead, 'en', voiceName);
          audioBlobsRef.current.set(videoCacheKey, audioBlob);
        }

        const sentenceText = (sentence.english || '').toLowerCase();
        const relatedVocab = (passage.vocabulary || [])
          .filter(v => v && v.word && sentenceText.includes(v.word.toLowerCase()))
          .map(v => ({ word: v.word, meaning: v.meaning || '' }));

        scenes.push({
          englishLines: [sentence.english],
          koreanLines: [sentence.korean],
          audioFile: audioBlob,
          vocabulary: relatedVocab,
        });
      }

      setStatusText('🎬 영상 렌더링 중...');
      setProgress(40);

      const result = await renderDiaryVideo({
        scenes,
        onProgress: (p, text) => {
          setProgress(40 + Math.round(p * 0.55));
          if (text) setStatusText(`🎬 ${text}`);
        },
      });

      try {
        const videoBlob = await fetch(result).then(r => r.blob());
        await saveMedia(videoKey(passage.id), videoBlob);
      } catch (e) {
        console.warn('[PassageEditor] 비디오 IndexedDB 저장 실패:', e);
      }

      setVideoUrl(result);
      setProgress(100);
      setStatusText('✅ 영상 생성 완료!');

      const updated = { ...passage, status: 'completed' as const, updatedAt: Date.now() };
      setPassage(updated);
      savePassage(updated);

    } catch (error) {
      alert('영상 생성 실패: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // ── PDF 다운로드 ──
  const handleDownloadPdf = async () => {
    if (!passage || passage.sentences.length === 0) return;
    setLoading(true);
    setStatusText('📄 PDF 생성 중...');
    try {
      const { generateDiaryPdf } = await import('../lib/pdfGenerator');
      const pdfBlob = await generateDiaryPdf({
        title: passage.title,
        sentences: passage.sentences,
        vocabulary: passage.vocabulary,
      });
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${passage.title.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_passage.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('PDF 생성 실패: ' + (e as Error).message);
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  const goPage = (delta: number) => {
    const next = currentPage + delta;
    if (next >= 0 && next < totalPages) {
      setCurrentPage(next);
    }
  };

  if (!passage) return null;

  const isGenerated = passage.sentences.length > 0;

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
              📰 하루 한 지문
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-teal-500/15 text-teal-400">
                Daily Passage
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">영어 지문을 넣으면 한글 해석 + 단어 + TTS를 제공합니다</p>
          </div>
        </div>

        {isGenerated && (
          <div className="flex items-center gap-2">
            {/* 성우 선택 */}
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] border border-white/10">
              <button
                onClick={() => { setVoiceGender('female'); audioBlobsRef.current.clear(); }}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  voiceGender === 'female'
                    ? 'bg-pink-500/20 text-pink-400 ring-1 ring-pink-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserCircle2 size={13} />
                여성
              </button>
              <button
                onClick={() => { setVoiceGender('male'); audioBlobsRef.current.clear(); }}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  voiceGender === 'male'
                    ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <User size={13} />
                남성
              </button>
            </div>

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
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-teal-500/10 to-cyan-500/10 border border-teal-500/20 p-5 animate-fade-in-up">
          <div className="flex items-center gap-4 mb-3">
            <Loader2 size={24} className="text-teal-400 animate-spin" />
            <div className="flex-1">
              <p className="text-sm font-medium text-teal-300">{statusText}</p>
            </div>
            <span className="text-sm font-bold text-teal-400">{progress}%</span>
          </div>
          {progress > 0 && (
            <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-teal-500 to-cyan-500 rounded-full transition-all duration-300"
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
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center">
              <BookOpen size={20} className="text-teal-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">영어 지문을 붙여넣으세요!</h3>
              <p className="text-xs text-slate-400">영어 기사, 교과서 지문, 수능 지문 등 무엇이든 OK (최대 30문장)</p>
            </div>
          </div>

          <textarea
            value={englishInput}
            onChange={(e) => setEnglishInput(e.target.value)}
            placeholder="Digital platforms have made a lot of work less sticky. As work becomes ever more modularised, commoditised and standardised, and as markets for digital work are created, ties between service work and particular places can be disconnected..."
            className="w-full h-56 p-4 rounded-xl bg-white/[0.03] border border-white/10 text-white text-sm
              placeholder:text-slate-600 resize-none focus:outline-none focus:border-teal-500/40 focus:ring-1 focus:ring-teal-500/20 transition-all"
          />

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-slate-500">
              {englishInput.length > 0 ? `${englishInput.length}자` : ''}
            </p>
            <button
              onClick={handleGenerate}
              disabled={loading || !englishInput.trim()}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white
                bg-gradient-to-r from-teal-500 to-cyan-500
                hover:from-teal-400 hover:to-cyan-400
                shadow-lg shadow-teal-500/20 disabled:opacity-50
                transition-all duration-200 hover:scale-105"
            >
              <Wand2 size={16} />
              지문 분석하기
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
                  🎬 하루 한 지문 영상
                </h3>
                <a
                  href={videoUrl}
                  download={`${passage.title.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_passage.webm`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                    bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
                    hover:bg-emerald-500/20 transition-all"
                >
                  <Download size={13} />
                  영상 다운로드 (.webm)
                </a>
              </div>
              <div className="aspect-video rounded-xl overflow-hidden bg-black">
                <video src={videoUrl} controls className="w-full h-full" />
              </div>
            </div>
          )}

          {/* ─── 상단: 단어장 ─── */}
          <div className="rounded-2xl bg-surface border border-white/5 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                📚 단어 · 구동사 · 이디엄
                <span className="text-xs font-normal text-slate-500">
                  {passage.vocabulary.length}개
                </span>
              </h3>
              <button
                onClick={() => {
                  setPassage({ ...passage, sentences: [], vocabulary: [], status: 'draft' });
                  savePassage({ ...passage, sentences: [], vocabulary: [], status: 'draft', updatedAt: Date.now() });
                  audioBlobsRef.current.clear();
                  setVideoUrl(null);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400
                  hover:text-white hover:bg-white/5 transition-all"
              >
                <RotateCcw size={13} />
                다시 분석
              </button>
            </div>

            <div className="max-h-[280px] overflow-y-auto pr-2 custom-scrollbar">
              <div className="flex flex-wrap gap-2">
                {passage.vocabulary.map((vocab, i) => (
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
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                📝 지문 해석
                <span className="text-xs font-normal text-slate-500">
                  {passage.sentences.length}문장
                </span>
              </h3>

              <div className="flex items-center gap-2">
                <button
                  onClick={handlePlayAll}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                    bg-teal-500/10 text-teal-400 border border-teal-500/20
                    hover:bg-teal-500/20 transition-all disabled:opacity-50"
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
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-teal-500/15 flex items-center justify-center text-xs font-bold text-teal-400">
                        {globalIndex + 1}
                      </span>
                      <div className="flex-1">
                        <p className="text-white text-base font-medium leading-relaxed">
                          {sentence.english}
                        </p>
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
                <button
                  onClick={() => handlePlayPage(currentPage)}
                  className={`p-2.5 rounded-xl transition-all ${
                    isPlaying && playingPage === currentPage
                      ? 'bg-teal-500/20 text-teal-400 ring-1 ring-teal-500/30'
                      : 'bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {isPlaying && playingPage === currentPage ? (
                    <Pause size={18} />
                  ) : (
                    <Volume2 size={18} />
                  )}
                </button>

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
              📋 원문 전체 보기
            </summary>
            <div className="px-5 pb-4">
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{passage.englishInput}</p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
};
