import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/Dashboard';
import { SettingsPage } from './pages/Settings';
import { EditorPage } from './pages/Editor';
import { DiaryEditorPage } from './pages/DiaryEditor';
import { ExamEditorPage } from './pages/ExamEditor';
import { useEffect, useState } from 'react';
import { getSettings } from './lib/store';
import { ApiKeyModal } from './components/ApiKeyModal';

function AppRoutes() {
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [checked, setChecked] = useState(false);

  const checkKey = () => {
    const settings = getSettings();
    const exists = !!settings.geminiApiKey;
    setHasApiKey(exists);
    if (!exists) setShowModal(true);
    setChecked(true);
  };

  useEffect(() => {
    checkKey();
    window.addEventListener('settings-changed', checkKey);
    return () => window.removeEventListener('settings-changed', checkKey);
  }, []);

  if (!checked) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-400 to-purple-500 animate-pulse" />
      </div>
    );
  }

  return (
    <>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/editor/:id" element={<EditorPage />} />
          <Route path="/diary/:id" element={<DiaryEditorPage />} />
          <Route path="/exam/:id" element={<ExamEditorPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>

      {/* API 키가 없으면 첫 진입 시 모달 자동 표시 */}
      <ApiKeyModal
        isOpen={showModal && !hasApiKey}
        onClose={() => setShowModal(false)}
      />
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
