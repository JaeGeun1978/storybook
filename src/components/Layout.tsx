import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Settings, BookOpen, Menu, X, ScanSearch } from 'lucide-react';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  // 기출OCR/검수 페이지는 전체 폭 사용
  const isFullWidth = location.pathname.startsWith('/exam-ocr') || location.pathname.startsWith('/exam-review');

  return (
    <div className="flex min-h-screen bg-dark text-white">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-[260px] bg-surface border-r border-white/5
        flex flex-col transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-white/5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-400 to-purple-500 flex items-center justify-center">
            <BookOpen size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-[13px] font-bold tracking-tight leading-tight">재근쌤 스토리북<br/><span className="text-primary-300">&amp; 기출정리</span></h1>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden text-slate-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavLink
            to="/"
            icon={<LayoutDashboard size={18} />}
            label="스토리북 대시보드"
            active={isActive('/')}
            onClick={() => setSidebarOpen(false)}
          />
          <NavLink
            to="/exam-ocr"
            icon={<ScanSearch size={18} />}
            label="기출OCR"
            active={isActive('/exam-ocr') || isActive('/exam-review')}
            onClick={() => setSidebarOpen(false)}
          />
          <NavLink
            to="/settings"
            icon={<Settings size={18} />}
            label="설정"
            active={isActive('/settings')}
            onClick={() => setSidebarOpen(false)}
          />
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-white/5">
          <p className="text-[10px] text-slate-500 text-center">© 2026 재근쌤 스토리북 &amp; 기출정리</p>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top Bar (Mobile) */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-surface/80 backdrop-blur-md border-b border-white/5 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-300 hover:text-white"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-primary-400" />
            <span className="font-bold text-sm">재근쌤 스토리북 &amp; 기출정리</span>
          </div>
          <div className="w-8" />
        </header>

        {/* Page Content */}
        <main className={`flex-1 overflow-y-auto ${isFullWidth ? 'p-0' : 'p-4 lg:p-8'}`}>
          <div className={isFullWidth ? '' : 'max-w-7xl mx-auto'}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

const NavLink: React.FC<{
  to: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick?: () => void;
}> = ({ to, icon, label, active, onClick }) => (
  <Link
    to={to}
    onClick={onClick}
    className={`
      flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
      transition-all duration-200
      ${active
        ? 'bg-primary-500/10 text-primary-400 shadow-sm shadow-primary-500/5'
        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
      }
    `}
  >
    {icon}
    <span>{label}</span>
    {active && (
      <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-400" />
    )}
  </Link>
);
