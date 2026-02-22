import React, { useEffect, useState } from 'react';
import { Save, Key, ExternalLink, CheckCircle, Volume2, Shield, AlertTriangle } from 'lucide-react';
import { getSettings, saveSettings, type AppSettings, type GeminiVoice } from '../lib/store';
import { useAuth } from '../lib/AuthContext';

const VOICE_OPTIONS: { id: GeminiVoice; label: string; desc: string; emoji: string }[] = [
  { id: 'Aoede',  label: 'Aoede',  desc: '부드럽고 따뜻한 여성 음성', emoji: '🎵' },
  { id: 'Kore',   label: 'Kore',   desc: '밝고 활기찬 여성 음성', emoji: '✨' },
  { id: 'Puck',   label: 'Puck',   desc: '친근하고 장난스러운 남성 음성', emoji: '🎭' },
  { id: 'Charon', label: 'Charon', desc: '깊고 차분한 남성 음성', emoji: '🌙' },
  { id: 'Fenrir', label: 'Fenrir', desc: '강렬하고 힘 있는 남성 음성', emoji: '🐺' },
];

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AppSettings>({
    geminiApiKey: '',
    useGeminiTTS: true,
    geminiVoice: 'Aoede',
  });
  const [status, setStatus] = useState<'idle' | 'saved'>('idle');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  const handleSave = () => {
    saveSettings(settings);
    setStatus('saved');
    setTimeout(() => setStatus('idle'), 2000);
  };

  const hasKey = !!settings.geminiApiKey;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Page Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">설정</h2>
        <p className="text-sm text-slate-400 mt-1">API 키 관리 및 앱 환경설정</p>
      </div>

      <div className="space-y-5">
        {/* Profile Card */}
        {user && (
          <div className="rounded-2xl bg-surface border border-white/5 p-6 animate-fade-in-up">
            <div className="flex items-center gap-4">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || ''}
                  className="w-14 h-14 rounded-2xl object-cover ring-2 ring-primary-500/20"
                />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-primary-500/20 flex items-center justify-center">
                  <Shield size={24} className="text-primary-400" />
                </div>
              )}
              <div>
                <h3 className="text-base font-bold text-white">{user.displayName || '사용자'}</h3>
                <p className="text-sm text-slate-400">{user.email}</p>
                <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-400">
                  <CheckCircle size={10} />
                  Google 인증됨
                </span>
              </div>
            </div>
          </div>
        )}

        {/* API Key Section */}
        <div className="rounded-2xl bg-surface border border-white/5 p-6 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-start gap-4 mb-5">
            <div className="w-11 h-11 rounded-xl bg-primary-500/15 flex items-center justify-center flex-shrink-0">
              <Key size={20} className="text-primary-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Gemini API Key</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                스토리 생성, 이미지 생성, 음성 합성 등 모든 AI 기능에 사용됩니다.
                키는 브라우저의 LocalStorage에만 저장되며, 외부 서버로 전송되지 않습니다.
              </p>
            </div>
          </div>

          {/* Status Indicator */}
          <div className={`mb-4 px-4 py-3 rounded-xl flex items-center gap-3 ${
            hasKey
              ? 'bg-emerald-500/10 border border-emerald-500/20'
              : 'bg-amber-500/10 border border-amber-500/20'
          }`}>
            {hasKey ? (
              <>
                <CheckCircle size={16} className="text-emerald-400" />
                <span className="text-xs font-medium text-emerald-300">API 키가 설정되어 있습니다</span>
              </>
            ) : (
              <>
                <AlertTriangle size={16} className="text-amber-400" />
                <span className="text-xs font-medium text-amber-300">API 키를 먼저 설정해 주세요</span>
              </>
            )}
          </div>

          {/* Input */}
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              placeholder="AIzaSy..."
              value={settings.geminiApiKey}
              onChange={(e) => setSettings({ ...settings, geminiApiKey: e.target.value })}
              className="w-full px-4 py-3 pr-20 rounded-xl bg-dark border border-white/10 text-white placeholder-slate-500 text-sm
                focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50
                transition-all duration-200"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1 rounded-lg text-xs font-medium
                text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            >
              {showKey ? '숨기기' : '보기'}
            </button>
          </div>

          {/* AI Studio Link */}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-3 text-xs text-primary-400 hover:text-primary-300 transition-colors"
          >
            <ExternalLink size={12} />
            Google AI Studio에서 API 키 발급받기 →
          </a>
        </div>

        {/* TTS Settings */}
        <div className="rounded-2xl bg-surface border border-white/5 p-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <div className="flex items-start gap-4 mb-5">
            <div className="w-11 h-11 rounded-xl bg-violet-500/15 flex items-center justify-center flex-shrink-0">
              <Volume2 size={20} className="text-violet-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-white">TTS 엔진 선택</h3>
              <p className="text-xs text-slate-400 mt-1">
                나레이션 생성에 사용할 음성 엔진을 선택하세요.
              </p>
            </div>
          </div>

          {/* Toggle Options */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setSettings({ ...settings, useGeminiTTS: true })}
              className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                settings.useGeminiTTS
                  ? 'bg-primary-500/10 border-primary-500/30 ring-1 ring-primary-500/20'
                  : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'
              }`}
            >
              <div className="text-sm font-semibold text-white mb-1">Gemini Live Voice</div>
              <p className="text-xs text-slate-400">감정 표현이 풍부한 AI 음성</p>
              {settings.useGeminiTTS && (
                <div className="mt-2 flex items-center gap-1 text-xs text-primary-400 font-medium">
                  <CheckCircle size={12} />
                  선택됨
                </div>
              )}
            </button>
            <button
              onClick={() => setSettings({ ...settings, useGeminiTTS: false })}
              className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                !settings.useGeminiTTS
                  ? 'bg-primary-500/10 border-primary-500/30 ring-1 ring-primary-500/20'
                  : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'
              }`}
            >
              <div className="text-sm font-semibold text-white mb-1">Cloud TTS</div>
              <p className="text-xs text-slate-400">안정적인 일반 음성 합성</p>
              {!settings.useGeminiTTS && (
                <div className="mt-2 flex items-center gap-1 text-xs text-primary-400 font-medium">
                  <CheckCircle size={12} />
                  선택됨
                </div>
              )}
            </button>
          </div>

          {/* Gemini Voice Selection */}
          {settings.useGeminiTTS && (
            <div className="mt-5 pt-5 border-t border-white/5">
              <h4 className="text-sm font-semibold text-white mb-1">🎙️ 음성 선택</h4>
              <p className="text-xs text-slate-500 mb-3">Gemini Live Voice에서 사용할 음성을 선택하세요.</p>
              <div className="grid grid-cols-1 gap-2">
                {VOICE_OPTIONS.map((voice) => (
                  <button
                    key={voice.id}
                    onClick={() => setSettings({ ...settings, geminiVoice: voice.id })}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-200 ${
                      settings.geminiVoice === voice.id
                        ? 'bg-violet-500/10 border-violet-500/30 ring-1 ring-violet-500/15'
                        : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="text-xl w-8 text-center">{voice.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white">{voice.label}</div>
                      <div className="text-[11px] text-slate-400">{voice.desc}</div>
                    </div>
                    {settings.geminiVoice === voice.id && (
                      <CheckCircle size={16} className="text-violet-400 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-2 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${
              status === 'saved'
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                : 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-500/20 hover:shadow-xl hover:scale-105'
            }`}
          >
            {status === 'saved' ? (
              <>
                <CheckCircle size={18} />
                저장됨!
              </>
            ) : (
              <>
                <Save size={18} />
                설정 저장
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
