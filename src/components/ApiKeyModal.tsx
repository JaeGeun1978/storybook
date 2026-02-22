import React, { useState, useEffect } from 'react';
import { X, Key, ExternalLink, CheckCircle, AlertTriangle } from 'lucide-react';
import { getSettings, saveSettings } from '../lib/store';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const settings = getSettings();
      setApiKey(settings.geminiApiKey || '');
      setHasKey(!!settings.geminiApiKey);
      setSaved(false);
    }
  }, [isOpen]);

  const handleSave = () => {
    const settings = getSettings();
    saveSettings({ ...settings, geminiApiKey: apiKey.trim() });
    setSaved(true);
    setHasKey(!!apiKey.trim());
    setTimeout(() => {
      onClose();
    }, 1000);
  };

  const handleClear = () => {
    setApiKey('');
    const settings = getSettings();
    saveSettings({ ...settings, geminiApiKey: '' });
    setHasKey(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-2xl bg-surface border border-white/10 shadow-2xl animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-500/20 flex items-center justify-center">
              <Key size={20} className="text-primary-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">API 키 설정</h3>
              <p className="text-xs text-slate-400">BYOK – Bring Your Own Key</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Info Banner */}
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 flex gap-3">
            <AlertTriangle size={18} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-amber-200/80 leading-relaxed">
              <p className="font-semibold text-amber-300 mb-1">API 키를 먼저 설정해 주세요</p>
              <p>스토리 생성, 이미지 생성, 나레이션 합성 등 모든 AI 기능에 Gemini API 키가 필요합니다. 키는 브라우저에만 저장되며 외부로 전송되지 않습니다.</p>
            </div>
          </div>

          {/* Input */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Google Gemini API Key
            </label>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setSaved(false); }}
              className="w-full px-4 py-3 rounded-xl bg-dark border border-white/10 text-white placeholder-slate-500 text-sm
                focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50
                transition-all duration-200"
            />
          </div>

          {/* Link to AI Studio */}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-primary-400 hover:text-primary-300 transition-colors"
          >
            <ExternalLink size={12} />
            <span>Google AI Studio에서 API 키 발급받기</span>
          </a>

          {/* Current Status */}
          {hasKey && !saved && (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <CheckCircle size={14} />
              <span>API 키가 설정되어 있습니다</span>
              <button
                onClick={handleClear}
                className="ml-auto text-red-400 hover:text-red-300 text-xs underline"
              >
                키 삭제
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-400 bg-white/5 hover:bg-white/10 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!apiKey.trim()}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white
              bg-gradient-to-r from-primary-500 to-primary-600
              hover:from-primary-400 hover:to-primary-500
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-all duration-200 flex items-center justify-center gap-2"
          >
            {saved ? (
              <>
                <CheckCircle size={16} />
                저장됨!
              </>
            ) : (
              '키 저장'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
