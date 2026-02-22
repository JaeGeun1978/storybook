import React, { useEffect, useState } from 'react';
import { PlusCircle, Trash2, PlayCircle, Clock, CheckCircle2, Sparkles, Key, Globe2, BookOpen, X, PenLine, FileText, Newspaper } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createNewProject, getProjects, deleteProject, type StoryProject, type StoryLanguage } from '../lib/storyStore';
import { getDiaries, deleteDiary, createNewDiary, type DiaryEntry } from '../lib/diaryStore';
import { getExams, deleteExam, createNewExam, type ExamEntry } from '../lib/examStore';
import { getPassages, deletePassage, createNewPassage, type PassageEntry } from '../lib/passageStore';
import { getSettings } from '../lib/store';
import { ApiKeyModal } from '../components/ApiKeyModal';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [diaries, setDiaries] = useState<DiaryEntry[]>([]);
  const [exams, setExams] = useState<ExamEntry[]>([]);
  const [passages, setPassages] = useState<PassageEntry[]>([]);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);

  const loadProjects = () => {
    setProjects(getProjects().sort((a, b) => b.updatedAt - a.updatedAt));
  };

  const loadDiaries = () => {
    setDiaries(getDiaries().sort((a, b) => b.updatedAt - a.updatedAt));
  };

  const loadExams = () => {
    setExams(getExams().sort((a, b) => b.updatedAt - a.updatedAt));
  };

  const loadPassages = () => {
    setPassages(getPassages().sort((a, b) => b.updatedAt - a.updatedAt));
  };

  const checkApiKey = () => {
    const settings = getSettings();
    setHasApiKey(!!settings.geminiApiKey);
  };

  useEffect(() => {
    loadProjects();
    loadDiaries();
    loadExams();
    loadPassages();
    checkApiKey();
    window.addEventListener('projects-changed', loadProjects);
    window.addEventListener('diaries-changed', loadDiaries);
    window.addEventListener('exams-changed', loadExams);
    window.addEventListener('passages-changed', loadPassages);
    window.addEventListener('settings-changed', checkApiKey);
    return () => {
      window.removeEventListener('projects-changed', loadProjects);
      window.removeEventListener('diaries-changed', loadDiaries);
      window.removeEventListener('exams-changed', loadExams);
      window.removeEventListener('passages-changed', loadPassages);
      window.removeEventListener('settings-changed', checkApiKey);
    };
  }, []);

  const handleNewProject = () => {
    if (!hasApiKey) {
      setShowApiKeyModal(true);
      return;
    }
    setShowLangModal(true);
  };

  const handleNewDiary = () => {
    if (!hasApiKey) {
      setShowApiKeyModal(true);
      return;
    }
    const newDiary = createNewDiary();
    navigate(`/diary/${newDiary.id}`);
  };

  const handleNewExam = () => {
    if (!hasApiKey) {
      setShowApiKeyModal(true);
      return;
    }
    const newExam = createNewExam();
    navigate(`/exam/${newExam.id}`);
  };

  const handleNewPassage = () => {
    if (!hasApiKey) {
      setShowApiKeyModal(true);
      return;
    }
    const newPassage = createNewPassage();
    navigate(`/passage/${newPassage.id}`);
  };

  const handleSelectLanguage = (lang: StoryLanguage) => {
    setShowLangModal(false);
    const newProject = createNewProject(lang);
    navigate(`/editor/${newProject.id}`);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm('정말 이 프로젝트를 삭제하시겠습니까?')) {
      deleteProject(id);
    }
  };

  const handleDeleteDiary = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm('정말 이 일기를 삭제하시겠습니까?')) {
      deleteDiary(id);
    }
  };

  const handleDeleteExam = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm('정말 이 지문설명을 삭제하시겠습니까?')) {
      deleteExam(id);
    }
  };

  const handleDeletePassage = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm('정말 이 지문을 삭제하시겠습니까?')) {
      deletePassage(id);
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">내 프로젝트</h2>
          <p className="text-sm text-slate-400 mt-1">AI로 만든 동화책 & 매거진 콘텐츠</p>
        </div>
        <div className="flex items-center gap-3">
          {!hasApiKey && (
            <button
              onClick={() => setShowApiKeyModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                bg-amber-500/10 text-amber-400 border border-amber-500/20
                hover:bg-amber-500/20 transition-all duration-200"
            >
              <Key size={16} />
              API 키 설정
            </button>
          )}
          <button
            onClick={handleNewProject}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white
              bg-gradient-to-r from-primary-500 to-primary-600
              hover:from-primary-400 hover:to-primary-500
              shadow-lg shadow-primary-500/20
              transition-all duration-200 hover:scale-105"
          >
            <PlusCircle size={18} />
            새 스토리 만들기
          </button>
          <button
            onClick={handleNewDiary}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white
              bg-gradient-to-r from-orange-500 to-amber-500
              hover:from-orange-400 hover:to-amber-400
              shadow-lg shadow-orange-500/20
              transition-all duration-200 hover:scale-105"
          >
            <PenLine size={18} />
            영어일기쓰기
          </button>
          <button
            onClick={handleNewExam}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white
              bg-gradient-to-r from-cyan-500 to-blue-500
              hover:from-cyan-400 hover:to-blue-400
              shadow-lg shadow-cyan-500/20
              transition-all duration-200 hover:scale-105"
          >
            <FileText size={18} />
            영어지문설명
          </button>
          <button
            onClick={handleNewPassage}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white
              bg-gradient-to-r from-teal-500 to-emerald-500
              hover:from-teal-400 hover:to-emerald-400
              shadow-lg shadow-teal-500/20
              transition-all duration-200 hover:scale-105"
          >
            <Newspaper size={18} />
            하루 한 지문
          </button>
        </div>
      </div>

      {/* API Key Warning Banner */}
      {!hasApiKey && (
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 p-5 flex items-start gap-4 animate-fade-in-up">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <Key size={20} className="text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-amber-300 mb-1">API 키를 먼저 설정해 주세요</h3>
            <p className="text-xs text-amber-200/60 leading-relaxed">
              콘텐츠를 생성하려면 Google Gemini API Key가 필요합니다.
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-amber-300 hover:text-amber-200 ml-1"
              >
                Google AI Studio
              </a>
              에서 무료로 발급받을 수 있습니다.
            </p>
          </div>
          <button
            onClick={() => setShowApiKeyModal(true)}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors whitespace-nowrap"
          >
            키 설정하기
          </button>
        </div>
      )}

      {/* ═══ 📖 스토리북 섹션 ═══ */}
      <div className="mb-10">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <BookOpen size={18} className="text-primary-400" />
          스토리북
          {projects.length > 0 && <span className="text-xs font-normal text-slate-500">{projects.length}개</span>}
        </h3>

        {projects.length === 0 ? (
          <EmptyState onNewProject={handleNewProject} type="story" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((project, i) => (
              <ProjectCard
                key={project.id}
                project={project}
                index={i}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* ═══ 📓 영어일기 섹션 ═══ */}
      <div className="mb-10">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <PenLine size={18} className="text-orange-400" />
          영어일기
          {diaries.length > 0 && <span className="text-xs font-normal text-slate-500">{diaries.length}개</span>}
        </h3>

        {diaries.length === 0 ? (
          <EmptyState onNewProject={handleNewDiary} type="diary" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {diaries.map((diary, i) => (
              <DiaryCard
                key={diary.id}
                diary={diary}
                index={i}
                onDelete={handleDeleteDiary}
              />
            ))}
          </div>
        )}
      </div>

      {/* ═══ 📝 영어지문설명 섹션 ═══ */}
      <div className="mb-10">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <FileText size={18} className="text-cyan-400" />
          영어지문설명
          {exams.length > 0 && <span className="text-xs font-normal text-slate-500">{exams.length}개</span>}
        </h3>

        {exams.length === 0 ? (
          <EmptyState onNewProject={handleNewExam} type="exam" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {exams.map((exam, i) => (
              <ExamCard
                key={exam.id}
                exam={exam}
                index={i}
                onDelete={handleDeleteExam}
              />
            ))}
          </div>
        )}
      </div>

      {/* ═══ 📰 하루 한 지문 섹션 ═══ */}
      <div className="mb-10">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Newspaper size={18} className="text-teal-400" />
          하루 한 지문
          {passages.length > 0 && <span className="text-xs font-normal text-slate-500">{passages.length}개</span>}
        </h3>

        {passages.length === 0 ? (
          <EmptyState onNewProject={handleNewPassage} type="passage" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {passages.map((passage, i) => (
              <PassageCard
                key={passage.id}
                passage={passage}
                index={i}
                onDelete={handleDeletePassage}
              />
            ))}
          </div>
        )}
      </div>

      {/* API Key Modal */}
      <ApiKeyModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />

      {/* Language Selection Modal */}
      <LanguageSelectModal
        isOpen={showLangModal}
        onClose={() => setShowLangModal(false)}
        onSelect={handleSelectLanguage}
      />
    </div>
  );
};

const EmptyState: React.FC<{ onNewProject: () => void; type?: 'story' | 'diary' | 'exam' | 'passage' }> = ({ onNewProject, type = 'story' }) => {
  const config = {
    story: {
      icon: <Sparkles size={28} className="text-primary-400" />,
      bg: 'bg-gradient-to-br from-primary-500/20 to-purple-500/20',
      title: '아직 프로젝트가 없습니다',
      desc: 'AI와 함께 동화책을 만들어 보세요. 주제만 입력하면 나머지는 AI가!',
      btn: '첫 스토리 시작하기',
      btnBg: 'bg-gradient-to-r from-primary-500 to-purple-500 hover:from-primary-400 hover:to-purple-400 shadow-primary-500/20',
    },
    diary: {
      icon: <PenLine size={28} className="text-orange-400" />,
      bg: 'bg-gradient-to-br from-orange-500/20 to-amber-500/20',
      title: '아직 일기가 없습니다',
      desc: '한글로 하고 싶은 말을 쓰면 영어 일기로 변환해드려요!',
      btn: '첫 영어일기 쓰기',
      btnBg: 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 shadow-orange-500/20',
    },
    exam: {
      icon: <FileText size={28} className="text-cyan-400" />,
      bg: 'bg-gradient-to-br from-cyan-500/20 to-blue-500/20',
      title: '아직 지문설명이 없습니다',
      desc: '모의고사 영어 지문을 입력하면 5단계로 분석한 영상을 만들어 드려요!',
      btn: '첫 영어지문설명 만들기',
      btnBg: 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 shadow-cyan-500/20',
    },
    passage: {
      icon: <Newspaper size={28} className="text-teal-400" />,
      bg: 'bg-gradient-to-br from-teal-500/20 to-emerald-500/20',
      title: '아직 지문이 없습니다',
      desc: '영어 지문을 넣으면 한글 해석 + 단어 정리 + TTS로 읽어드려요!',
      btn: '첫 하루 한 지문 시작하기',
      btnBg: 'bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 shadow-teal-500/20',
    },
  }[type];

  return (
    <div className="flex flex-col items-center justify-center py-12 animate-fade-in-up">
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 animate-float ${config.bg}`}>
        {config.icon}
      </div>
      <h3 className="text-base font-bold text-white mb-1">{config.title}</h3>
      <p className="text-xs text-slate-400 mb-5 text-center max-w-sm">{config.desc}</p>
      <button
        onClick={onNewProject}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white
          shadow-lg transition-all duration-300 hover:scale-105 ${config.btnBg}`}
      >
        <PlusCircle size={16} />
        {config.btn}
      </button>
    </div>
  );
};

/** 언어 선택 모달 */
const LanguageSelectModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSelect: (lang: StoryLanguage) => void;
}> = ({ isOpen, onClose, onSelect }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in-up">
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-surface border border-white/10 shadow-2xl p-6">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-all"
        >
          <X size={18} />
        </button>

        {/* Title */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center">
            <Globe2 size={20} className="text-primary-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">어떤 이야기를 만들까요?</h3>
            <p className="text-xs text-slate-400 mt-0.5">스토리북의 언어를 선택해 주세요</p>
          </div>
        </div>

        {/* Language Options */}
        <div className="grid grid-cols-2 gap-3">
          {/* 한글 */}
          <button
            onClick={() => onSelect('ko')}
            className="group flex flex-col items-center gap-3 p-5 rounded-xl
              bg-gradient-to-br from-blue-500/5 to-indigo-500/5
              border border-white/5 hover:border-blue-400/30
              hover:from-blue-500/10 hover:to-indigo-500/10
              transition-all duration-200 hover:scale-[1.02]"
          >
            <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center
              group-hover:bg-blue-500/20 transition-colors text-3xl">
              🇰🇷
            </div>
            <div className="text-center">
              <div className="text-sm font-bold text-white">한글 이야기</div>
              <div className="text-[11px] text-slate-500 mt-1">
                한국어로 동화책을 만들어요
              </div>
            </div>
          </button>

          {/* English */}
          <button
            onClick={() => onSelect('en')}
            className="group flex flex-col items-center gap-3 p-5 rounded-xl
              bg-gradient-to-br from-emerald-500/5 to-teal-500/5
              border border-white/5 hover:border-emerald-400/30
              hover:from-emerald-500/10 hover:to-teal-500/10
              transition-all duration-200 hover:scale-[1.02]"
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center
              group-hover:bg-emerald-500/20 transition-colors text-3xl">
              🇺🇸
            </div>
            <div className="text-center">
              <div className="text-sm font-bold text-white">English Story</div>
              <div className="text-[11px] text-slate-500 mt-1">
                영어 스토리북을 만들어요
              </div>
            </div>
          </button>
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-600">
          💡 한글로 주제를 입력해도 선택한 언어로 스토리가 생성됩니다
        </p>
      </div>
    </div>
  );
};

const ProjectCard: React.FC<{
  project: StoryProject;
  index: number;
  onDelete: (e: React.MouseEvent, id: string) => void;
}> = ({ project, index, onDelete }) => {
  const isCompleted = project.status === 'completed';

  return (
    <Link
      to={`/editor/${project.id}`}
      className="group relative block rounded-2xl overflow-hidden bg-surface border border-white/5
        hover:border-primary-500/30 transition-all duration-300
        hover:shadow-xl hover:shadow-primary-500/10 hover:-translate-y-1
        animate-fade-in-up opacity-0"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gradient-to-br from-slate-800 to-slate-700 overflow-hidden">
        {project.thumbnailUrl ? (
          <img
            src={project.thumbnailUrl}
            alt={project.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <PlayCircle size={40} className="text-white/10 group-hover:text-white/20 transition-colors" />
          </div>
        )}
        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Delete Button */}
        <button
          onClick={(e) => onDelete(e, project.id)}
          className="absolute top-3 right-3 p-2 rounded-lg bg-black/50 text-white/60 hover:text-red-400 hover:bg-black/70
            opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm"
        >
          <Trash2 size={14} />
        </button>

        {/* Scene Count & Language Badge */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
          {project.scenes.length > 0 && (
            <div className="px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur-sm text-xs text-white/80 font-medium">
              {project.scenes.length}개 장면
            </div>
          )}
          <div className="px-2 py-1 rounded-lg bg-black/50 backdrop-blur-sm text-xs text-white/80 font-medium">
            {project.language === 'en' ? '🇺🇸 EN' : '🇰🇷 KO'}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-bold text-white truncate group-hover:text-primary-300 transition-colors">
          {project.title}
        </h3>
        <div className="flex items-center justify-between mt-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock size={12} />
            {new Date(project.updatedAt).toLocaleDateString('ko-KR')}
          </span>
          <span className={`
            flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
            ${isCompleted
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-primary-500/15 text-primary-400'
            }
          `}>
            {isCompleted ? <CheckCircle2 size={12} /> : <Clock size={12} />}
            {isCompleted ? '완료' : '작성 중'}
          </span>
        </div>
      </div>
    </Link>
  );
};

/** 영어일기 카드 */
const DiaryCard: React.FC<{
  diary: DiaryEntry;
  index: number;
  onDelete: (e: React.MouseEvent, id: string) => void;
}> = ({ diary, index, onDelete }) => {
  const isGenerated = diary.status !== 'draft';
  const preview = diary.sentences.length > 0
    ? diary.sentences[0].english
    : diary.koreanInput.substring(0, 60);

  return (
    <Link
      to={`/diary/${diary.id}`}
      className="group relative block rounded-2xl overflow-hidden bg-surface border border-white/5
        hover:border-orange-500/30 transition-all duration-300
        hover:shadow-xl hover:shadow-orange-500/10 hover:-translate-y-1
        animate-fade-in-up opacity-0"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {/* Header */}
      <div className="relative h-28 bg-gradient-to-br from-orange-900/40 to-amber-900/40 overflow-hidden p-4 flex flex-col justify-between">
        {/* Pattern decoration */}
        <div className="absolute top-2 right-2 text-4xl opacity-10">📓</div>

        {/* Preview text */}
        <p className="text-white/70 text-xs leading-relaxed line-clamp-2 mt-2 font-medium">
          {preview || 'Empty diary...'}
        </p>

        {/* Badges */}
        <div className="flex items-center gap-1.5">
          <div className="px-2 py-0.5 rounded-md bg-black/30 backdrop-blur-sm text-[10px] text-orange-300 font-medium">
            🇺🇸 English Diary
          </div>
          {diary.sentences.length > 0 && (
            <div className="px-2 py-0.5 rounded-md bg-black/30 backdrop-blur-sm text-[10px] text-white/70 font-medium">
              {diary.sentences.length}문장
            </div>
          )}
          {diary.vocabulary.length > 0 && (
            <div className="px-2 py-0.5 rounded-md bg-black/30 backdrop-blur-sm text-[10px] text-white/70 font-medium">
              {diary.vocabulary.length}단어
            </div>
          )}
        </div>

        {/* Delete */}
        <button
          onClick={(e) => onDelete(e, diary.id)}
          className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/40 text-white/50 hover:text-red-400 hover:bg-black/60
            opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-bold text-white text-sm truncate group-hover:text-orange-300 transition-colors">
          {diary.title}
        </h3>
        <div className="flex items-center justify-between mt-2.5">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock size={11} />
            {new Date(diary.updatedAt).toLocaleDateString('ko-KR')}
          </span>
          <span className={`
            flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium
            ${isGenerated
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-orange-500/15 text-orange-400'
            }
          `}>
            {isGenerated ? <CheckCircle2 size={11} /> : <Clock size={11} />}
            {isGenerated ? '완료' : '작성 중'}
          </span>
        </div>
      </div>
    </Link>
  );
};

/** 하루 한 지문 카드 */
const PassageCard: React.FC<{
  passage: PassageEntry;
  index: number;
  onDelete: (e: React.MouseEvent, id: string) => void;
}> = ({ passage, index, onDelete }) => {
  const isGenerated = passage.status !== 'draft';
  const preview = passage.sentences.length > 0
    ? passage.sentences[0].english
    : passage.englishInput.substring(0, 80);

  return (
    <Link
      to={`/passage/${passage.id}`}
      className="group relative block rounded-2xl overflow-hidden bg-surface border border-white/5
        hover:border-teal-500/30 transition-all duration-300
        hover:shadow-xl hover:shadow-teal-500/10 hover:-translate-y-1
        animate-fade-in-up opacity-0"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {/* Header */}
      <div className="relative h-28 bg-gradient-to-br from-teal-900/40 to-emerald-900/40 overflow-hidden p-4 flex flex-col justify-between">
        <div className="absolute top-2 right-2 text-4xl opacity-10">📰</div>

        <p className="text-white/70 text-xs leading-relaxed line-clamp-2 mt-2 font-medium">
          {preview || 'Empty passage...'}
        </p>

        <div className="flex items-center gap-1.5">
          <div className="px-2 py-0.5 rounded-md bg-black/30 backdrop-blur-sm text-[10px] text-teal-300 font-medium">
            📰 Daily Passage
          </div>
          {passage.sentences.length > 0 && (
            <div className="px-2 py-0.5 rounded-md bg-black/30 backdrop-blur-sm text-[10px] text-white/70 font-medium">
              {passage.sentences.length}문장
            </div>
          )}
          {passage.vocabulary.length > 0 && (
            <div className="px-2 py-0.5 rounded-md bg-black/30 backdrop-blur-sm text-[10px] text-white/70 font-medium">
              {passage.vocabulary.length}단어
            </div>
          )}
        </div>

        <button
          onClick={(e) => onDelete(e, passage.id)}
          className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/40 text-white/50 hover:text-red-400 hover:bg-black/60
            opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="p-4">
        <h3 className="font-bold text-white text-sm truncate group-hover:text-teal-300 transition-colors">
          {passage.title}
        </h3>
        <div className="flex items-center justify-between mt-2.5">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock size={11} />
            {new Date(passage.updatedAt).toLocaleDateString('ko-KR')}
          </span>
          <span className={`
            flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium
            ${isGenerated
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-teal-500/15 text-teal-400'
            }
          `}>
            {isGenerated ? <CheckCircle2 size={11} /> : <Clock size={11} />}
            {isGenerated ? '완료' : '분석 전'}
          </span>
        </div>
      </div>
    </Link>
  );
};

/** 영어지문설명 카드 */
const ExamCard: React.FC<{
  exam: ExamEntry;
  index: number;
  onDelete: (e: React.MouseEvent, id: string) => void;
}> = ({ exam, index, onDelete }) => {
  const isCompleted = exam.status === 'completed';
  const preview = exam.passage.substring(0, 80) + (exam.passage.length > 80 ? '...' : '');

  return (
    <Link
      to={`/exam/${exam.id}`}
      className="group relative block rounded-2xl overflow-hidden bg-surface border border-white/5
        hover:border-cyan-500/30 transition-all duration-300
        hover:shadow-xl hover:shadow-cyan-500/10 hover:-translate-y-1
        animate-fade-in-up opacity-0"
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {/* Header */}
      <div className="relative h-28 bg-gradient-to-br from-cyan-900/40 to-blue-900/40 overflow-hidden p-4 flex flex-col justify-between">
        <div className="absolute top-2 right-2 text-4xl opacity-10">📝</div>

        <p className="text-white/70 text-xs leading-relaxed line-clamp-2 mt-2 font-mono">
          {preview || 'Empty passage...'}
        </p>

        <div className="flex items-center gap-1.5">
          <div className="px-2 py-0.5 rounded-md bg-black/30 backdrop-blur-sm text-[10px] text-cyan-300 font-medium">
            🎓 Passage Analysis
          </div>
          {exam.segments.length > 0 && (
            <div className="px-2 py-0.5 rounded-md bg-black/30 backdrop-blur-sm text-[10px] text-white/70 font-medium">
              {exam.segments.length}세그먼트
            </div>
          )}
        </div>

        <button
          onClick={(e) => onDelete(e, exam.id)}
          className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/40 text-white/50 hover:text-red-400 hover:bg-black/60
            opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="p-4">
        <h3 className="font-bold text-white text-sm truncate group-hover:text-cyan-300 transition-colors">
          {exam.title}
        </h3>
        <div className="flex items-center justify-between mt-2.5">
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock size={11} />
            {new Date(exam.updatedAt).toLocaleDateString('ko-KR')}
          </span>
          <span className={`
            flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium
            ${isCompleted
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-cyan-500/15 text-cyan-400'
            }
          `}>
            {isCompleted ? <CheckCircle2 size={11} /> : <Clock size={11} />}
            {isCompleted ? '완료' : '분석 중'}
          </span>
        </div>
      </div>
    </Link>
  );
};
