import React, { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { Footer } from './components/layout/Footer';
import { DashboardPage } from './pages/DashboardPage';
import { UploadPage } from './pages/UploadPage';
import { SearchPage } from './pages/SearchPage';
import { DocumentViewerPage } from './pages/DocumentViewerPage';
import { LibraryPage } from './pages/LibraryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { LoginPage } from './pages/LoginPage';
import { SignUpPage } from './pages/SignUpPage';

export default function App() {
  // Navigation & Router State
  const [currentPath, setCurrentPath] = useState(window.location.pathname || '/');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocId, setSelectedDocId] = useState('doc-001');
  const [selectedSegmentId, setSelectedSegmentId] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const saved = localStorage.getItem('retrieva_auth');
    return saved !== null ? JSON.parse(saved) : true; // Default authenticated for smooth capstone demo
  });

  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('retrieva_user');
    if (savedUser) {
      try { return JSON.parse(savedUser); } catch (e) {}
    }
    return {
      name: 'Meghavarshini Prathapani',
      email: 'meghavarshini@retrieva.ai',
      role: '',
      institution: 'Retrieva AI'
    };
  });

  // Client-side Router Navigation Helper
  const navigate = (path) => {
    window.history.pushState(null, '', path);
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Sync with browser Back/Forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Global keyboard shortcut for search (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (currentPath === '/login' || currentPath === '/signup') {
          navigate('/');
        }
        setActiveTab('search');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPath]);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    setIsAuthenticated(true);
    localStorage.setItem('retrieva_user', JSON.stringify(userData));
    localStorage.setItem('retrieva_auth', JSON.stringify(true));
  };

  const handleSignUpSuccess = (userData) => {
    setUser(userData);
    setIsAuthenticated(true);
    localStorage.setItem('retrieva_user', JSON.stringify(userData));
    localStorage.setItem('retrieva_auth', JSON.stringify(true));
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.setItem('retrieva_auth', JSON.stringify(false));
    navigate('/login');
  };

  const handleUploadComplete = (fileName) => {
    setSelectedDocId('doc-001');
  };

  // Route Handler: Render Auth Pages if path matches /login or /signup
  if (currentPath === '/login') {
    return (
      <LoginPage 
        onNavigate={navigate}
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  if (currentPath === '/signup') {
    return (
      <SignUpPage 
        onNavigate={navigate}
        onSignUpSuccess={handleSignUpSuccess}
      />
    );
  }

  // Render Main Dashboard Layout
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-rose-900 selection:text-white">
      {/* Top Header Navigation */}
      <Header 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        user={user}
        isAuthenticated={isAuthenticated}
        onNavigate={navigate}
        onLogout={handleLogout}
      />

      {/* Main Container: Sidebar + Active Page Viewport */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Navigation Sidebar */}
        <Sidebar 
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
        />

        {/* Dynamic Page Content Viewport */}
        <main className="flex-1 p-4 lg:p-8 overflow-y-auto">
          {activeTab === 'dashboard' && (
            <DashboardPage 
              setActiveTab={setActiveTab}
              setSelectedDocId={setSelectedDocId}
            />
          )}

          {activeTab === 'upload' && (
            <UploadPage 
              setActiveTab={setActiveTab}
              onUploadComplete={handleUploadComplete}
            />
          )}

          {activeTab === 'search' && (
            <SearchPage 
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              setActiveTab={setActiveTab}
              setSelectedDocId={setSelectedDocId}
              setSelectedSegmentId={setSelectedSegmentId}
            />
          )}

          {activeTab === 'viewer' && (
            <DocumentViewerPage 
              selectedDocId={selectedDocId}
              setSelectedDocId={setSelectedDocId}
              selectedSegmentId={selectedSegmentId}
              setSelectedSegmentId={setSelectedSegmentId}
            />
          )}

          {activeTab === 'library' && (
            <LibraryPage 
              setActiveTab={setActiveTab}
              setSelectedDocId={setSelectedDocId}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsPage />
          )}

          {activeTab === 'profile' && (
            <ProfilePage 
              user={user}
              onLogout={handleLogout}
            />
          )}
        </main>
      </div>

      {/* Footer */}
      <Footer />
    </div>
  );
}
