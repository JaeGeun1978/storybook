import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getProjectById, saveProject, type StoryProject, type StoryScene } from '../lib/storyStore';
import { generateStoryContent, generateSceneImage, generateCharacterGuide } from '../lib/gemini';
import { generateSpeech } from '../lib/tts';
import { renderAllScenes } from '../lib/videoRenderer';
import { saveMedia, loadMedia, mediaKey, videoKey } from '../lib/mediaStore';
import { ArrowLeft, Wand2, Video, Loader2, Save, Film, ChevronRight, Volume2, BookOpen } from 'lucide-react';

export const EditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<StoryProject | null>(null);
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [activeScene, setActiveScene] = useState<number>(0);
  // 오디오 원본 blob 캐시 (영상 렌더링 시 직접 사용)
  const [audioBlobs] = useState<Map<number, Blob>>(() => new Map());

  // ── IndexedDB에서 미디어 복원 ──
  const restoreMedia = useCallback(async (proj: StoryProject) => {
    let updated = false;
    const restoredScenes = [...proj.scenes];

    for (let i = 0; i < restoredScenes.length; i++) {
      const scene = restoredScenes[i];

      // 이미지 복원
      if (!scene.imageUrl) {
        const imgData = await loadMedia(mediaKey(proj.id, scene.id, 'image'));
        if (imgData && typeof imgData === 'string') {
          restoredScenes[i] = { ...restoredScenes[i], imageUrl: imgData };
          updated = true;
        }
      }

      // 오디오 복원
      if (!scene.audioUrl) {
        const audioData = await loadMedia(mediaKey(proj.id, scene.id, 'audio'));
        if (audioData) {
          let blob: Blob;
          if (audioData instanceof Blob) {
            blob = audioData;
          } else {
            // data:URL → Blob
            const res = await fetch(audioData);
            blob = await res.blob();
          }
          audioBlobs.set(i, blob);
          const audioUrl = URL.createObjectURL(blob);
          restoredScenes[i] = { ...restoredScenes[i], audioUrl };
          updated = true;
        }
      }
    }

    // 비디오 복원
    let finalVideoUrl = proj.finalVideoUrl;
    if (!finalVideoUrl) {
      const videoData = await loadMedia(videoKey(proj.id));
      if (videoData) {
        if (videoData instanceof Blob) {
          finalVideoUrl = URL.createObjectURL(videoData);
        } else if (typeof videoData === 'string') {
          finalVideoUrl = videoData;
        }
        updated = true;
      }
    }

    if (updated) {
      setProject(prev => prev ? ({
        ...prev,
        scenes: restoredScenes,
        finalVideoUrl: finalVideoUrl || prev.finalVideoUrl,
      }) : null);
    }
  }, [audioBlobs]);

  useEffect(() => {
    if (id) {
      const found = getProjectById(id);
      if (found) {
        setProject(found);
        // IndexedDB에서 미디어 복원
        restoreMedia(found);
      } else {
        navigate('/');
      }
    }
  }, [id, navigate, restoreMedia]);

  const handleGenerateStory = async () => {
    if (!topic || !project) return;
    setLoading(true);
    const lang = project.language || 'ko';
    setStatusText(lang === 'en'
      ? 'Gemini is writing your story...'
      : 'Gemini가 이야기를 짓고 있습니다...');

    try {
      const generatedScenes = await generateStoryContent(topic, lang);
      const newScenes: StoryScene[] = generatedScenes.map(scene => ({
        id: crypto.randomUUID(),
        text: scene.text,
        imagePrompt: scene.imagePrompt,
        imageUrl: '',
        vocabulary: scene.vocabulary,
        translation: scene.translation,
      }));

      // 🎭 캐릭터 가이드 자동 생성 (이미지 일관성용)
      setStatusText(lang === 'en'
        ? 'Creating character design sheet...'
        : '🎭 캐릭터 디자인 시트 생성 중...');
      let characterGuide = '';
      try {
        characterGuide = await generateCharacterGuide(
          generatedScenes.map(s => ({ text: s.text, imagePrompt: s.imagePrompt })),
          lang
        );
      } catch (e) {
        console.warn('[Editor] 캐릭터 가이드 생성 실패 (무시):', e);
      }

      const updatedProject = {
        ...project,
        title: topic,
        scenes: newScenes,
        status: 'draft' as const,
        characterGuide,
      };
      setProject(updatedProject);
      saveProject(updatedProject);
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  const handleAutoProcess = async () => {
    if (!project || project.scenes.length === 0) return;
    setLoading(true);
    setProgress(0);
    const lang = project.language || 'ko';
    setStatusText('자동 작업을 시작합니다...');

    try {
      const updatedScenes = [...project.scenes];
      const sceneDataForVideo: { imageFile: Blob; audioFile: Blob; subtitleText: string; vocabulary?: { word: string; meaning: string }[] }[] = [];

      // ══════════════════════════════════════════
      // Phase 1: 모든 장면의 이미지 + TTS 생성
      // ══════════════════════════════════════════
      for (let i = 0; i < updatedScenes.length; i++) {
        const scene = updatedScenes[i];
        setActiveScene(i);

        // ── 이미지 생성 (캐릭터 가이드 포함) ──
        if (!updatedScenes[i].imageUrl) {
          setStatusText(`장면 ${i + 1}/${updatedScenes.length}: 🎨 나노바나나 이미지 생성 중...`);
          try {
            const prompt = scene.imagePrompt || scene.text;
            console.log(`[AutoProcess] 장면 ${i + 1} 이미지 프롬프트:`, prompt.substring(0, 80));
            const dataUrl = await generateSceneImage(prompt, project.characterGuide);
            updatedScenes[i] = { ...updatedScenes[i], imageUrl: dataUrl };
            console.log(`[AutoProcess] ✅ 장면 ${i + 1} 이미지 생성 완료`);
            await saveMedia(mediaKey(project.id, scene.id, 'image'), dataUrl);
          } catch (imgErr) {
            console.warn(`[AutoProcess] ⚠️ 장면 ${i + 1} AI 이미지 실패:`, imgErr);
          }
        }

        // ── TTS 생성 ──
        if (!updatedScenes[i].audioUrl || !audioBlobs.has(i)) {
          setStatusText(`장면 ${i + 1}/${updatedScenes.length}: 🔊 ${lang === 'en' ? 'Generating voice...' : 'Gemini TTS 음성 생성 중...'}`);
          try {
            const blob = await generateSpeech(scene.text, lang);
            console.log(`[AutoProcess] ✅ 장면 ${i + 1} TTS 완료: ${blob.size} bytes, type=${blob.type}`);
            audioBlobs.set(i, blob);
            const audioUrl = URL.createObjectURL(blob);
            updatedScenes[i] = { ...updatedScenes[i], audioUrl };
            await saveMedia(mediaKey(project.id, scene.id, 'audio'), blob);
          } catch (e) {
            throw new Error(`장면 ${i + 1} TTS 실패: ${(e as Error).message}`);
          }
        }

        // 중간 업데이트 (미리보기 표시)
        setProject(prev => prev ? ({ ...prev, scenes: [...updatedScenes] }) : null);

        // ── 이미지 Blob 준비 ──
        let imageFile: Blob;
        const currentImageUrl = updatedScenes[i].imageUrl;
        if (currentImageUrl && (currentImageUrl.startsWith('data:') || currentImageUrl.startsWith('blob:'))) {
          try {
            const res = await fetch(currentImageUrl);
            imageFile = await res.blob();
          } catch {
            imageFile = createPlaceholderImage(scene.text, i);
          }
        } else {
          imageFile = createPlaceholderImage(scene.text, i);
        }

        // ── 오디오 Blob 준비 ──
        let audioFile: Blob;
        if (audioBlobs.has(i)) {
          audioFile = audioBlobs.get(i)!;
        } else if (updatedScenes[i].audioUrl) {
          try {
            audioFile = await fetch(updatedScenes[i].audioUrl!).then(r => r.blob());
            if (audioFile.size === 0) throw new Error('빈 오디오');
          } catch {
            setStatusText(`장면 ${i + 1}/${updatedScenes.length}: 🔊 음성 재생성 중...`);
            const blob = await generateSpeech(scene.text, lang);
            audioBlobs.set(i, blob);
            const audioUrl = URL.createObjectURL(blob);
            updatedScenes[i] = { ...updatedScenes[i], audioUrl };
            audioFile = blob;
            await saveMedia(mediaKey(project.id, scene.id, 'audio'), blob);
          }
        } else {
          throw new Error(`장면 ${i + 1}: 오디오가 없습니다`);
        }

        console.log(`[AutoProcess] 장면 ${i + 1} 준비 완료 (이미지: ${imageFile.size}B, 오디오: ${audioFile.size}B)`);
        sceneDataForVideo.push({ imageFile, audioFile, subtitleText: scene.text, vocabulary: scene.vocabulary });
      }

      // ══════════════════════════════════════════
      // Phase 2: 전체 장면을 하나의 영상으로 렌더링
      // ══════════════════════════════════════════
      setStatusText('🎬 전체 영상 렌더링 중... (장면 전환 효과 적용)');
      const finalVideoUrl = await renderAllScenes({
        scenes: sceneDataForVideo,
        onProgress: (p, text) => {
          setProgress(p);
          if (text) setStatusText(`🎬 ${text}`);
        },
      });

      // IndexedDB에 최종 비디오 저장
      try {
        const videoBlob = await fetch(finalVideoUrl).then(r => r.blob());
        await saveMedia(videoKey(project.id), videoBlob);
        console.log(`[AutoProcess] ✅ 최종 영상 IndexedDB 저장 완료 (${(videoBlob.size / 1024 / 1024).toFixed(1)}MB)`);
      } catch (e) {
        console.warn('[AutoProcess] 비디오 IndexedDB 저장 실패:', e);
      }

      const finalProject = { ...project, scenes: updatedScenes, finalVideoUrl, status: 'completed' as const };
      setProject(finalProject);
      saveProject(finalProject);
      setStatusText('✅ 완료!');

    } catch (e) {
      console.error(e);
      alert(`작업 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusText(''), 3000);
    }
  };

  const handleGenerateAudio = async (sceneId: string, text: string, sceneIndex: number) => {
    if (!project) return;
    setLoading(true);
    const lang = project.language || 'ko';
    setStatusText(lang === 'en' ? 'Generating voice...' : 'TTS 생성 중...');
    try {
      const blob = await generateSpeech(text, lang);
      audioBlobs.set(sceneIndex, blob);
      const audioUrl = URL.createObjectURL(blob);
      const updatedScenes = project.scenes.map(s => s.id === sceneId ? { ...s, audioUrl } : s);
      const updatedProject = { ...project, scenes: updatedScenes };
      setProject(updatedProject);
      saveProject(updatedProject);
      // IndexedDB에 저장
      await saveMedia(mediaKey(project.id, sceneId, 'audio'), blob);
    } catch {
      alert('TTS 생성 실패');
    } finally {
      setLoading(false);
      setStatusText('');
    }
  };

  const handleDownloadPdf = async () => {
    if (!project || project.scenes.length === 0) return;
    setLoading(true);
    setStatusText('📖 PDF 동화책 생성 중...');
    setProgress(0);

    try {
      const { generateStoryBookPdf } = await import('../lib/pdfGenerator');
      const pdfBlob = await generateStoryBookPdf({
        title: project.title,
        language: project.language || 'ko',
        scenes: project.scenes.map(s => ({
          text: s.text,
          imageUrl: s.imageUrl,
          imagePrompt: s.imagePrompt,
          translation: s.translation,
        })),
        onProgress: (p, status) => {
          setProgress(p);
          if (status) setStatusText(`📖 ${status}`);
        },
      });

      // 다운로드
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.title || '스토리북'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      setStatusText('✅ PDF 다운로드 완료!');
      console.log(`[PDF] ✅ 다운로드 완료: ${(pdfBlob.size / 1024 / 1024).toFixed(1)}MB`);
    } catch (e) {
      console.error('[PDF] 생성 실패:', e);
      alert(`PDF 생성 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setStatusText(''), 2000);
    }
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 size={24} className="animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white">{project.title}</h2>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/5 border border-white/10 text-slate-400">
                {project.language === 'en' ? '🇺🇸 EN' : '🇰🇷 KO'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {project.scenes.length}개 장면 · {project.status === 'completed' ? '완료됨' : '작성 중'}
            </p>
          </div>
        </div>
        <button
          onClick={() => saveProject(project)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
        >
          <Save size={16} />
          저장
        </button>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Left: Script Editor */}
        <div className="space-y-5">
          {/* Story Generation */}
          <div className="rounded-2xl bg-surface border border-white/5 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Wand2 size={18} className="text-primary-400" />
              <h3 className="text-base font-bold text-white">스토리 생성</h3>
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder={project.language === 'en'
                  ? "주제를 입력하세요 (예: 우주로 간 강아지) → 영어 스토리 생성"
                  : "이야기의 주제를 입력하세요 (예: 우주로 간 강아지)"}
                value={topic}
                onChange={e => setTopic(e.target.value)}
                disabled={project.scenes.length > 0}
                className="flex-1 px-4 py-3 rounded-xl bg-dark border border-white/10 text-white placeholder-slate-500 text-sm
                  focus:outline-none focus:ring-2 focus:ring-primary-500/50 disabled:opacity-50
                  transition-all duration-200"
              />
              <button
                onClick={handleGenerateStory}
                disabled={loading || !topic || project.scenes.length > 0}
                className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white
                  bg-gradient-to-r from-primary-500 to-primary-600
                  disabled:opacity-40 disabled:cursor-not-allowed
                  hover:from-primary-400 hover:to-primary-500
                  transition-all duration-200 whitespace-nowrap"
              >
                {loading && !project.scenes.length ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <SparklesIcon size={16} />
                )}
                생성하기
              </button>
            </div>
          </div>

          {/* Scenes */}
          <div className="space-y-3">
            {project.scenes.map((scene, index) => (
              <div
                key={scene.id}
                className={`rounded-2xl bg-surface border p-5 transition-all duration-200 cursor-pointer ${
                  activeScene === index
                    ? 'border-primary-500/30 ring-1 ring-primary-500/10'
                    : 'border-white/5 hover:border-white/10'
                }`}
                onClick={() => setActiveScene(index)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-primary-500/15 text-primary-400 text-xs font-bold flex items-center justify-center">
                      {index + 1}
                    </span>
                    <h4 className="text-sm font-semibold text-white">장면 #{index + 1}</h4>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleGenerateAudio(scene.id, scene.text, index);
                    }}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                      text-primary-400 hover:bg-primary-500/10 transition-all disabled:opacity-40"
                  >
                    <Volume2 size={12} />
                    {scene.audioUrl ? '다시 생성' : 'TTS 생성'}
                  </button>
                </div>

                {/* 이미지 미리보기 */}
                {scene.imageUrl && (
                  <div className="mb-3 rounded-xl overflow-hidden border border-white/10">
                    <img src={scene.imageUrl} alt={`장면 ${index + 1}`} className="w-full h-40 object-cover" />
                  </div>
                )}

                <textarea
                  className="w-full px-3 py-2.5 rounded-xl bg-dark/50 border border-white/5 text-sm text-slate-300
                    focus:outline-none focus:ring-1 focus:ring-primary-500/30 resize-none leading-relaxed"
                  rows={3}
                  value={scene.text}
                  readOnly
                />

                {/* 어려운 단어 (영어 스토리) */}
                {scene.vocabulary && scene.vocabulary.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {scene.vocabulary.map((v, vi) => (
                      <span key={vi} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/15 text-[11px]">
                        <span className="font-bold text-amber-300">{v.word}</span>
                        <span className="text-slate-400">{v.meaning}</span>
                      </span>
                    ))}
                  </div>
                )}

                {scene.audioUrl && (
                  <div className="mt-3 flex items-center gap-2">
                    <audio controls src={scene.audioUrl} className="flex-1 h-8 rounded-lg" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const a = document.createElement('a');
                        a.href = scene.audioUrl!;
                        a.download = `scene_${index + 1}.wav`;
                        a.click();
                      }}
                      className="text-xs text-slate-500 hover:text-white px-2 py-1 rounded-lg hover:bg-white/5"
                    >
                      저장
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Preview & Render */}
        <div className="lg:sticky lg:top-8 self-start">
          <div className="rounded-2xl bg-surface border border-white/5 p-5">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Video size={16} className="text-primary-400" />
              영상 미리보기
            </h3>

            {/* Video Preview */}
            <div className="aspect-video bg-dark rounded-xl overflow-hidden flex items-center justify-center mb-4 border border-white/5">
              {project.finalVideoUrl ? (
                <video src={project.finalVideoUrl} controls className="w-full h-full" />
              ) : (
                <div className="text-center text-slate-600">
                  <Film size={32} className="mx-auto mb-2" />
                  <p className="text-xs">생성된 영상이 없습니다</p>
                </div>
              )}
            </div>

            {/* Progress */}
            {(loading || statusText) && (
              <div className="mb-4 p-3 rounded-xl bg-primary-500/5 border border-primary-500/10">
                <div className="flex items-center gap-2 text-xs text-primary-300 mb-2">
                  {loading && <Loader2 size={12} className="animate-spin" />}
                  <span className="font-medium">{statusText}</span>
                </div>
                {progress > 0 && progress < 100 && (
                  <div className="w-full h-1.5 rounded-full bg-dark overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Downloads */}
            {project.finalVideoUrl && (
              <a
                href={project.finalVideoUrl}
                download={`${project.title || 'storybook'}.webm`}
                className="block w-full mb-2 text-center px-4 py-2.5 rounded-xl text-sm font-medium
                  text-emerald-400 bg-emerald-500/10 border border-emerald-500/20
                  hover:bg-emerald-500/20 transition-all"
              >
                📥 영상 다운로드 (.webm)
              </a>
            )}

            {/* PDF Download */}
            {project.scenes.length > 0 && (
              <button
                onClick={handleDownloadPdf}
                disabled={loading}
                className="w-full mb-3 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                  text-amber-400 bg-amber-500/10 border border-amber-500/20
                  hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <BookOpen size={16} />
                📖 PDF 동화책 다운로드
              </button>
            )}

            {/* Auto Process Button */}
            <button
              onClick={handleAutoProcess}
              disabled={loading || project.scenes.length === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white
                bg-gradient-to-r from-primary-500 to-purple-500
                hover:from-primary-400 hover:to-purple-400
                disabled:opacity-40 disabled:cursor-not-allowed
                shadow-lg shadow-primary-500/20
                transition-all duration-200"
            >
              <Film size={16} />
              전체 자동 생성
              <ChevronRight size={14} />
            </button>

            {/* Workflow Steps */}
            <div className="mt-4 space-y-2">
              {['🎨 나노바나나 이미지 생성', '🔊 Gemini TTS 음성 생성', '🎬 전체 영상 연속 렌더링'].map((step, i) => (
                <div key={step} className="flex items-center gap-2 text-xs text-slate-500">
                  <div className="w-5 h-5 rounded-full bg-white/5 text-[10px] font-bold flex items-center justify-center">
                    {i + 1}
                  </div>
                  <span>{step}</span>
                </div>
              ))}
            </div>

            {/* Info */}
            <div className="mt-4 p-3 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-slate-500 leading-relaxed">
              💡 이미지가 생성된 상태에서 <strong className="text-slate-400">PDF 동화책</strong>을 바로 다운로드할 수 있습니다. 영상은 전체 자동 생성 버튼으로 만들 수 있습니다.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Placeholder 이미지 생성 */
function createPlaceholderImage(text: string, sceneIndex: number): Blob {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;

  // 그라데이션 배경 (장면마다 다른 색상)
  const colors = [
    ['#1a1a2e', '#16213e', '#0f3460'],
    ['#0d1b2a', '#1b263b', '#415a77'],
    ['#2d1b69', '#1a1a2e', '#1e3a5f'],
    ['#1b2838', '#2a4858', '#1e5162'],
    ['#1a1a2e', '#3d1f5c', '#2d1b69'],
  ];
  const palette = colors[sceneIndex % colors.length];
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
  gradient.addColorStop(0, palette[0]);
  gradient.addColorStop(0.5, palette[1]);
  gradient.addColorStop(1, palette[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 720);

  // 장면 번호
  ctx.font = 'bold 120px "Noto Sans KR", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${sceneIndex + 1}`, 640, 320);

  // 텍스트
  ctx.font = '32px "Noto Sans KR", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  const shortText = text.length > 40 ? text.substring(0, 40) + '...' : text;
  ctx.fillText(shortText, 640, 400);

  // Canvas → Blob (동기)
  const dataUrl = canvas.toDataURL('image/png');
  const byteString = atob(dataUrl.split(',')[1]);
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

// Sparkles Icon
const SparklesIcon: React.FC<{ size: number; className?: string }> = ({ size, className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    <path d="M20 3v4"/>
    <path d="M22 5h-4"/>
  </svg>
);
