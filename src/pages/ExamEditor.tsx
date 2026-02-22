import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getExamById, saveExam, type ExamEntry, type ExamSegment } from '../lib/examStore';
import { generatePassageAnalysis, generateSceneImage, generateAudio, generateCharacterGuide } from '../lib/gemini';
import { renderAllScenes } from '../lib/videoRenderer';
import { saveMedia, loadMedia, mediaKey, videoKey } from '../lib/mediaStore';
import {
  ArrowLeft, Loader2, Film, Download, BookOpen, Sparkles,
  ChevronRight, Image as ImageIcon, Volume2, CheckCircle2,
} from 'lucide-react';

// TTS 음성: 남자=Puck, 여자=Kore
const MALE_VOICE = 'Puck';
const FEMALE_VOICE = 'Kore';

export const ExamEditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<ExamEntry | null>(null);
  const [passage, setPassage] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [activeSegment, setActiveSegment] = useState(0);

  // 오디오 blob 캐시 (페이지별: segIdx_partType)
  const audioBlobsRef = useRef<Map<string, Blob>>(new Map());
  // 개별 오디오 재생용
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // ── 로드 & 미디어 복원 ──
  useEffect(() => {
    if (!id) return;
    const found = getExamById(id);
    if (!found) { navigate('/'); return; }

    setExam(found);
    setPassage(found.passage);

    // IndexedDB에서 미디어 복원
    (async () => {
      let updated = false;
      const restoredSegments = await Promise.all(found.segments.map(async (seg) => {
        let imageUrl = seg.imageUrl;
        if (!imageUrl) {
          const data = await loadMedia(mediaKey(found.id, seg.id, 'image'));
          if (data) {
            imageUrl = data instanceof Blob ? URL.createObjectURL(data) : data as string;
            updated = true;
          }
        }
        // 오디오 복원
        for (const partKey of ['male_orig', 'female_simp', 'male_expl'] as const) {
          const audioData = await loadMedia(mediaKey(found.id, `${seg.id}_${partKey}`, 'audio'));
          if (audioData instanceof Blob) {
            audioBlobsRef.current.set(`${seg.id}_${partKey}`, audioData);
          }
        }
        return { ...seg, imageUrl };
      }));

      // 비디오 복원
      let videoUrl = found.finalVideoUrl;
      if (!videoUrl) {
        const vData = await loadMedia(videoKey(found.id));
        if (vData) {
          videoUrl = vData instanceof Blob ? URL.createObjectURL(vData) : vData as string;
          updated = true;
        }
      }

      if (updated || videoUrl) {
        setExam(prev => prev ? { ...prev, segments: restoredSegments, finalVideoUrl: videoUrl || prev.finalVideoUrl } : null);
      }
    })();
  }, [id, navigate]);

  if (!exam) return null;

  const isAnalyzed = exam.segments.length > 0;
  const hasVideo = !!exam.finalVideoUrl;

  // ── 1단계: 지문 분석 ──
  const handleAnalyze = async () => {
    if (!passage.trim()) { alert('영어 지문을 입력해주세요.'); return; }
    setLoading(true);
    setProgress(0);
    setStatusText('📝 Gemini가 지문을 분석하고 있습니다...');

    try {
      const segments = await generatePassageAnalysis(passage);

      const newSegments: ExamSegment[] = segments.map(seg => ({
        id: crypto.randomUUID(),
        segmentId: seg.segment_id,
        segmentRole: seg.segment_role,
        imagePrompt: seg.image_prompt,
        scriptMaleOriginal: seg.script_male_original,
        scriptFemaleSimplified: seg.script_female_simplified,
        scriptMaleExplanation: seg.script_male_explanation,
        koreanTranslation: seg.korean_translation,
      }));

      // 캐릭터 가이드 생성 (이미지 일관성)
      setStatusText('🎭 이미지 스타일 가이드 생성 중...');
      const charGuide = await generateCharacterGuide(
        newSegments.map(s => ({ text: s.scriptMaleOriginal, imagePrompt: s.imagePrompt })),
        'en'
      );

      const title = passage.substring(0, 40) + (passage.length > 40 ? '...' : '');
      const updated: ExamEntry = {
        ...exam,
        title,
        passage,
        segments: newSegments,
        characterGuide: charGuide,
        status: 'analyzing',
        updatedAt: Date.now(),
      };
      setExam(updated);
      saveExam(updated);
      audioBlobsRef.current.clear();
      setStatusText('✅ 분석 완료! 이제 "전체 자동 생성"을 눌러주세요.');
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // ── 2단계: 전체 자동 생성 (이미지 + TTS + 영상) ──
  const handleAutoProcess = async () => {
    if (!exam || exam.segments.length === 0) return;
    setLoading(true);
    setProgress(0);
    setStatusText('🚀 자동 생성 시작...');

    try {
      const updatedSegments = [...exam.segments];
      const totalSteps = exam.segments.length * 4; // 이미지1 + TTS3
      let step = 0;

      // ── Phase 1: 이미지 + TTS 생성 ──
      for (let i = 0; i < updatedSegments.length; i++) {
        const seg = updatedSegments[i];
        setActiveSegment(i);

        // 이미지 생성
        if (!seg.imageUrl) {
          setStatusText(`🎨 Segment ${i + 1}/5: 이미지 생성 중...`);
          try {
            const dataUrl = await generateSceneImage(seg.imagePrompt, exam.characterGuide);
            updatedSegments[i] = { ...updatedSegments[i], imageUrl: dataUrl };
            await saveMedia(mediaKey(exam.id, seg.id, 'image'), dataUrl);
          } catch (e) {
            console.warn(`[Exam] ⚠️ Segment ${i + 1} 이미지 실패:`, e);
            // placeholder
            updatedSegments[i] = { ...updatedSegments[i], imageUrl: createPlaceholder(i) };
          }
        }
        step++;
        setProgress(Math.round((step / totalSteps) * 50));

        // TTS: 남자 원문
        const maleOrigKey = `${seg.id}_male_orig`;
        if (!audioBlobsRef.current.has(maleOrigKey)) {
          setStatusText(`🎙️ Segment ${i + 1}/5: 원문 읽기 음성 (Male)...`);
          try {
            const blob = await generateAudio(seg.scriptMaleOriginal, MALE_VOICE, 'en');
            audioBlobsRef.current.set(maleOrigKey, blob);
            await saveMedia(mediaKey(exam.id, maleOrigKey, 'audio'), blob);
          } catch (e) {
            console.warn(`[Exam] ⚠️ Segment ${i + 1} male_orig TTS 실패:`, e);
          }
        }
        step++;
        setProgress(Math.round((step / totalSteps) * 50));

        // TTS: 여자 설명
        const femaleSimpKey = `${seg.id}_female_simp`;
        if (!audioBlobsRef.current.has(femaleSimpKey)) {
          setStatusText(`🎙️ Segment ${i + 1}/5: 쉬운 설명 음성 (Female)...`);
          try {
            const blob = await generateAudio(seg.scriptFemaleSimplified, FEMALE_VOICE, 'en');
            audioBlobsRef.current.set(femaleSimpKey, blob);
            await saveMedia(mediaKey(exam.id, femaleSimpKey, 'audio'), blob);
          } catch (e) {
            console.warn(`[Exam] ⚠️ Segment ${i + 1} female_simp TTS 실패:`, e);
          }
        }
        step++;
        setProgress(Math.round((step / totalSteps) * 50));

        // TTS: 남자 해설
        const maleExplKey = `${seg.id}_male_expl`;
        if (!audioBlobsRef.current.has(maleExplKey)) {
          setStatusText(`🎙️ Segment ${i + 1}/5: 어휘 해설 음성 (Male)...`);
          try {
            const blob = await generateAudio(seg.scriptMaleExplanation, MALE_VOICE, 'en');
            audioBlobsRef.current.set(maleExplKey, blob);
            await saveMedia(mediaKey(exam.id, maleExplKey, 'audio'), blob);
          } catch (e) {
            console.warn(`[Exam] ⚠️ Segment ${i + 1} male_expl TTS 실패:`, e);
          }
        }
        step++;
        setProgress(Math.round((step / totalSteps) * 50));
      }

      // 중간 저장
      const midExam = { ...exam, segments: updatedSegments, updatedAt: Date.now() };
      setExam(midExam);
      saveExam(midExam);

      // ── Phase 2: 영상 렌더링 (15 미니 장면) ──
      setStatusText('🎬 영상 렌더링 준비 중...');
      setProgress(50);

      const sceneDataForVideo: { imageFile: Blob; audioFile: Blob; subtitleText: string }[] = [];

      for (let i = 0; i < updatedSegments.length; i++) {
        const seg = updatedSegments[i];
        const imageBlob = await urlToBlob(seg.imageUrl || '');

        // Part 1: 원문 읽기
        const maleOrigBlob = audioBlobsRef.current.get(`${seg.id}_male_orig`) || createSilentWav(2);
        sceneDataForVideo.push({
          imageFile: imageBlob,
          audioFile: maleOrigBlob,
          subtitleText: seg.scriptMaleOriginal,
        });

        // Part 2: 쉬운 설명
        const femaleSimpBlob = audioBlobsRef.current.get(`${seg.id}_female_simp`) || createSilentWav(2);
        sceneDataForVideo.push({
          imageFile: imageBlob,
          audioFile: femaleSimpBlob,
          subtitleText: seg.scriptFemaleSimplified,
        });

        // Part 3: 어휘 해설
        const maleExplBlob = audioBlobsRef.current.get(`${seg.id}_male_expl`) || createSilentWav(2);
        sceneDataForVideo.push({
          imageFile: imageBlob,
          audioFile: maleExplBlob,
          subtitleText: seg.scriptMaleExplanation,
        });
      }

      setStatusText('🎬 전체 영상 렌더링 중...');
      const videoUrl = await renderAllScenes({
        scenes: sceneDataForVideo,
        onProgress: (p, text) => {
          setProgress(50 + Math.round(p * 0.45));
          if (text) setStatusText(`🎬 ${text}`);
        },
      });

      // IndexedDB 저장
      try {
        const videoBlob = await fetch(videoUrl).then(r => r.blob());
        await saveMedia(videoKey(exam.id), videoBlob);
        console.log(`[Exam] ✅ 영상 저장 완료 (${(videoBlob.size / 1024 / 1024).toFixed(1)}MB)`);
      } catch (e) {
        console.warn('[Exam] 비디오 IndexedDB 저장 실패:', e);
      }

      const finalExam: ExamEntry = {
        ...exam,
        segments: updatedSegments,
        finalVideoUrl: videoUrl,
        status: 'completed',
        updatedAt: Date.now(),
      };
      setExam(finalExam);
      saveExam(finalExam);
      setProgress(100);
      setStatusText('✅ 완료!');
    } catch (error) {
      alert('자동 생성 실패: ' + (error as Error).message);
      console.error('[Exam] 자동 생성 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // ── PDF 다운로드 ──
  const handleDownloadPdf = async () => {
    if (!exam || exam.segments.length === 0) return;
    setLoading(true);
    setStatusText('📄 PDF 생성 중...');
    try {
      const { generateExamPdf } = await import('../lib/pdfGenerator');
      const pdfBlob = await generateExamPdf({
        title: exam.title,
        passage: exam.passage,
        segments: exam.segments,
        onProgress: (p, s) => {
          setProgress(p);
          setStatusText(`📄 ${s}`);
        },
      });
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exam.title.replace(/[^a-zA-Z0-9가-힣\s]/g, '_')}_analysis.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('PDF 생성 실패: ' + (e as Error).message);
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  // ── 개별 오디오 재생 ──
  const playAudio = async (segId: string, partKey: string) => {
    if (audioElRef.current) { audioElRef.current.pause(); }
    const blob = audioBlobsRef.current.get(`${segId}_${partKey}`);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioElRef.current = audio;
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play().catch(() => {});
  };

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
              📝 영어지문설명
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-500/15 text-cyan-400">
                🎓 수능 분석
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">고등학생 모의고사 영어 지문을 5단계로 분석합니다</p>
          </div>
        </div>

        {isAnalyzed && (
          <div className="flex items-center gap-2">
            {hasVideo && (
              <a
                href={exam.finalVideoUrl}
                download={`${exam.title.replace(/[^a-zA-Z0-9가-힣]/g, '_')}.webm`}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                  bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
                  hover:bg-emerald-500/20 transition-all"
              >
                <Download size={16} />
                영상 다운로드
              </a>
            )}
            <button
              onClick={handleDownloadPdf}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                bg-amber-500/10 text-amber-400 border border-amber-500/20
                hover:bg-amber-500/20 transition-all disabled:opacity-50"
            >
              <BookOpen size={16} />
              PDF 한줄해석
            </button>
          </div>
        )}
      </div>

      {/* ── 로딩 바 ── */}
      {loading && (
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 p-5 animate-fade-in-up">
          <div className="flex items-center gap-4 mb-3">
            <Loader2 size={24} className="text-cyan-400 animate-spin" />
            <div className="flex-1">
              <p className="text-sm font-medium text-cyan-300">{statusText}</p>
            </div>
            <span className="text-sm font-bold text-cyan-400">{progress}%</span>
          </div>
          {progress > 0 && (
            <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── 입력 영역 (분석 전) ── */}
      {!isAnalyzed && (
        <div className="rounded-2xl bg-surface border border-white/5 p-6 animate-fade-in-up">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center">
              <BookOpen size={20} className="text-cyan-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">영어 지문을 붙여넣기 하세요</h3>
              <p className="text-xs text-slate-400">모의고사나 수능 영어 독해 지문을 입력하면 5단계로 분석합니다</p>
            </div>
          </div>

          <textarea
            value={passage}
            onChange={(e) => setPassage(e.target.value)}
            placeholder="The concept of emotional intelligence has gained significant traction in both academic and professional circles over the past few decades. Unlike traditional measures of intelligence, which focus primarily on cognitive abilities such as memory, problem-solving, and analytical thinking..."
            className="w-full h-56 p-4 rounded-xl bg-white/[0.03] border border-white/10 text-white text-sm
              placeholder:text-slate-600 resize-none focus:outline-none focus:border-cyan-500/40
              focus:ring-1 focus:ring-cyan-500/20 transition-all font-mono leading-relaxed"
          />

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-slate-500">
              {passage.length > 0 ? `${passage.split(/\s+/).filter(Boolean).length} words` : ''}
            </p>
            <button
              onClick={handleAnalyze}
              disabled={loading || !passage.trim()}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white
                bg-gradient-to-r from-cyan-500 to-blue-500
                hover:from-cyan-400 hover:to-blue-400
                shadow-lg shadow-cyan-500/20 disabled:opacity-50
                transition-all duration-200 hover:scale-105"
            >
              <Sparkles size={16} />
              지문 분석 시작
            </button>
          </div>
        </div>
      )}

      {/* ── 분석 결과 ── */}
      {isAnalyzed && (
        <div className="space-y-5 animate-fade-in-up">

          {/* 영상 미리보기 */}
          {hasVideo && (
            <div className="rounded-2xl bg-surface border border-white/5 p-5">
              <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                🎬 분석 영상
              </h3>
              <div className="aspect-video rounded-xl overflow-hidden bg-black">
                <video src={exam.finalVideoUrl} controls className="w-full h-full" />
              </div>
            </div>
          )}

          {/* 전체 자동 생성 버튼 */}
          {!hasVideo && (
            <button
              onClick={handleAutoProcess}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl text-sm font-semibold text-white
                bg-gradient-to-r from-cyan-500 to-blue-600
                hover:from-cyan-400 hover:to-blue-500
                shadow-lg shadow-cyan-500/20 disabled:opacity-50
                transition-all duration-200"
            >
              <Film size={18} />
              전체 자동 생성 (이미지 + TTS + 영상)
              <ChevronRight size={16} />
            </button>
          )}

          {/* 5개 세그먼트 카드 */}
          <div className="space-y-4">
            {exam.segments.map((seg, i) => (
              <div
                key={seg.id}
                className={`rounded-2xl bg-surface border transition-all duration-200 ${
                  activeSegment === i && loading
                    ? 'border-cyan-500/30 shadow-lg shadow-cyan-500/10'
                    : 'border-white/5'
                }`}
              >
                {/* 세그먼트 헤더 */}
                <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5">
                  <span className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center text-sm font-bold text-cyan-400">
                    {seg.segmentId}
                  </span>
                  <div className="flex-1">
                    <span className="text-sm font-bold text-white">{seg.segmentRole}</span>
                  </div>
                  {seg.imageUrl && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <CheckCircle2 size={12} /> 이미지
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                  {/* 왼쪽: 이미지 */}
                  <div className="p-4">
                    {seg.imageUrl ? (
                      <img
                        src={seg.imageUrl}
                        alt={`Segment ${seg.segmentId}`}
                        className="w-full aspect-video object-cover rounded-xl"
                      />
                    ) : (
                      <div className="w-full aspect-video rounded-xl bg-gradient-to-br from-slate-800 to-slate-700 flex items-center justify-center">
                        <ImageIcon size={32} className="text-white/10" />
                      </div>
                    )}
                  </div>

                  {/* 오른쪽: 스크립트 */}
                  <div className="p-4 space-y-3">
                    {/* 남자: 원문 */}
                    <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                          🎙️ Original Reading (Male)
                        </span>
                        <button
                          onClick={() => playAudio(seg.id, 'male_orig')}
                          className="p-1 rounded-md hover:bg-blue-500/10 text-blue-400 transition-colors"
                        >
                          <Volume2 size={14} />
                        </button>
                      </div>
                      <p className="text-xs text-white/80 leading-relaxed">{seg.scriptMaleOriginal}</p>
                    </div>

                    {/* 여자: 설명 */}
                    <div className="p-3 rounded-xl bg-pink-500/5 border border-pink-500/10">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-pink-400 uppercase tracking-wider">
                          💡 Simplified (Female)
                        </span>
                        <button
                          onClick={() => playAudio(seg.id, 'female_simp')}
                          className="p-1 rounded-md hover:bg-pink-500/10 text-pink-400 transition-colors"
                        >
                          <Volume2 size={14} />
                        </button>
                      </div>
                      <p className="text-xs text-white/80 leading-relaxed">{seg.scriptFemaleSimplified}</p>
                    </div>

                    {/* 남자: 해설 */}
                    <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
                          📖 Vocabulary & Grammar (Male)
                        </span>
                        <button
                          onClick={() => playAudio(seg.id, 'male_expl')}
                          className="p-1 rounded-md hover:bg-amber-500/10 text-amber-400 transition-colors"
                        >
                          <Volume2 size={14} />
                        </button>
                      </div>
                      <p className="text-xs text-white/80 leading-relaxed">{seg.scriptMaleExplanation}</p>
                    </div>

                    {/* 한줄해석 */}
                    {seg.koreanTranslation && (
                      <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          📋 한줄해석
                        </span>
                        <p className="text-xs text-slate-400 leading-relaxed mt-1">{seg.koreanTranslation}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 원문 보기 */}
          <details className="rounded-2xl bg-surface border border-white/5 overflow-hidden">
            <summary className="px-5 py-3 cursor-pointer text-sm text-slate-400 hover:text-white transition-colors">
              📋 원문 전체 보기
            </summary>
            <div className="px-5 pb-4">
              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap font-mono">{exam.passage}</p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// 유틸리티
// ═══════════════════════════════════════════════════════════

function createPlaceholder(index: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  const colors = [
    ['#0f2027', '#203a43', '#2c5364'],
    ['#1a1a2e', '#16213e', '#0f3460'],
    ['#2d1b69', '#11998e', '#38ef7d'],
    ['#1f1c2c', '#928dab', '#1f1c2c'],
    ['#0f0c29', '#302b63', '#24243e'],
  ];
  const [c1, c2, c3] = colors[index % colors.length];
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, c1);
  g.addColorStop(0.5, c2);
  g.addColorStop(1, c3);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = 'bold 48px "Noto Sans KR", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Segment ${index + 1}`, canvas.width / 2, canvas.height / 2);

  return canvas.toDataURL('image/png');
}

async function urlToBlob(url: string): Promise<Blob> {
  if (!url) return createPlaceholderBlob();
  try {
    if (url.startsWith('data:')) {
      const res = await fetch(url);
      return await res.blob();
    }
    if (url.startsWith('blob:')) {
      const res = await fetch(url);
      return await res.blob();
    }
    return createPlaceholderBlob();
  } catch {
    return createPlaceholderBlob();
  }
}

async function createPlaceholderBlob(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, '#1a1a2e');
  g.addColorStop(1, '#0f3460');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob || new Blob()), 'image/png');
  });
}

function createSilentWav(durationSec: number): Blob {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const w = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); w(8, 'WAVE');
  w(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, dataSize, true);
  return new Blob([buffer], { type: 'audio/wav' });
}
