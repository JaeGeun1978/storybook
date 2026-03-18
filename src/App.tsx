import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { SettingsProvider } from './contexts/SettingsContext';
// Pages (Lazy load or direct import)
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import WordsPage from './pages/words/WordsPage';

const App: React.FC = () => {
  return (
    <SettingsProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="words" element={<WordsPage />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SettingsProvider>
  );
};

export default App;
