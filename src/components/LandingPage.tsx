import React from 'react';
import { BookOpen, Sparkles, Image, Film, Key, ArrowRight } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

export const LandingPage: React.FC = () => {
  const { signIn, loading } = useAuth();

  const features = [
    {
      icon: <Sparkles className="text-amber-400" size={24} />,
      title: 'AI 스토리 생성',
      desc: 'Gemini 3 Flash가 창의적인 동화와 지식 가이드를 만들어 드립니다.',
      color: 'from-amber-500/20 to-orange-500/20',
    },
    {
      icon: <Image className="text-emerald-400" size={24} />,
      title: '자동 이미지 생성',
      desc: 'Nano Banana 모델로 각 장면에 맞는 아름다운 삽화를 생성합니다.',
      color: 'from-emerald-500/20 to-teal-500/20',
    },
    {
      icon: <Film className="text-violet-400" size={24} />,
      title: '영상 자동 제작',
      desc: '나레이션과 자막이 포함된 완성도 높은 영상을 자동으로 합성합니다.',
      color: 'from-violet-500/20 to-purple-500/20',
    },
    {
      icon: <Key className="text-sky-400" size={24} />,
      title: 'BYOK (내 API 키 사용)',
      desc: '본인의 Gemini API Key로 무제한 콘텐츠를 생성하세요.',
      color: 'from-sky-500/20 to-blue-500/20',
    },
  ];

  return (
    <div className="min-h-screen bg-dark-deeper relative overflow-hidden">
      {/* Background Decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -left-20 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-1/4 w-80 h-80 bg-amber-500/5 rounded-full blur-3xl" />
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 lg:px-12 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-400 to-purple-500 flex items-center justify-center shadow-lg shadow-primary-500/25">
            <BookOpen size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">재근쌤 스토리북</h1>
            <p className="text-[10px] text-slate-500 tracking-widest uppercase">AI Story & Magazine Maker</p>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-16 lg:pt-24 pb-16">
        {/* Badge */}
        <div className="animate-fade-in-up inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 mb-8">
          <Sparkles size={14} className="text-amber-400" />
          <span className="text-xs font-medium text-slate-300">Gemini 3 Flash 기반 AI 콘텐츠 생성</span>
        </div>

        {/* Heading */}
        <h2 className="animate-fade-in-up delay-100 text-4xl lg:text-6xl font-black leading-tight max-w-3xl opacity-0">
          <span className="text-white">상상을 현실로,</span>
          <br />
          <span className="gradient-text">AI 동화책 & 매거진</span>
          <br />
          <span className="text-white">메이커</span>
        </h2>

        <p className="animate-fade-in-up delay-200 opacity-0 mt-6 text-base lg:text-lg text-slate-400 max-w-xl leading-relaxed">
          주제만 입력하면 AI가 스토리를 만들고, 삽화를 그리고,
          나레이션까지 더해 완성된 영상 콘텐츠를 제작합니다.
        </p>

        {/* CTA Button */}
        <div className="animate-fade-in-up delay-300 opacity-0 mt-10">
          <button
            onClick={signIn}
            disabled={loading}
            className="group relative inline-flex items-center gap-3 px-8 py-4 rounded-2xl
              bg-gradient-to-r from-primary-500 to-primary-600
              hover:from-primary-400 hover:to-primary-500
              text-white font-semibold text-base
              shadow-xl shadow-primary-500/25
              transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-primary-500/30
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" opacity=".7"/>
              <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" opacity=".85"/>
              <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" opacity=".7"/>
              <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" opacity=".85"/>
            </svg>
            <span>Google 계정으로 시작하기</span>
            <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        {/* Workflow Preview */}
        <div className="animate-fade-in-up delay-400 opacity-0 mt-16 w-full max-w-3xl">
          <div className="flex items-center justify-center gap-2 lg:gap-4 flex-wrap">
            {['주제 입력', '스토리 생성', '이미지 생성', '나레이션 합성', '영상 완성'].map((step, i) => (
              <React.Fragment key={step}>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                  <div className="w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </div>
                  <span className="text-xs font-medium text-slate-300 whitespace-nowrap">{step}</span>
                </div>
                {i < 4 && (
                  <ArrowRight size={14} className="text-slate-600 hidden lg:block" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative z-10 px-6 lg:px-12 pb-24">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
          {features.map((feat, i) => (
            <div
              key={feat.title}
              className={`animate-fade-in-up opacity-0 delay-${(i + 1) * 100} group relative rounded-2xl p-6 bg-white/[0.03] border border-white/[0.06] hover:border-white/10 transition-all duration-300 hover:bg-white/[0.05]`}
              style={{ animationDelay: `${0.4 + i * 0.1}s` }}
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feat.color} flex items-center justify-center mb-4`}>
                {feat.icon}
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{feat.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 text-center py-6 text-xs text-slate-600 border-t border-white/5">
        <p>© 2026 재근쌤 스토리북 · Powered by Gemini & React</p>
      </footer>
    </div>
  );
};
