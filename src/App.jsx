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

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocId, setSelectedDocId] = useState('doc-001');
  const [selectedSegmentId, setSelectedSegmentId] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Global keyboard shortcut for search (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setActiveTab('search');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleUploadComplete = (fileName) => {
    setSelectedDocId('doc-001');
  };

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
        </main>
      </div>

      {/* Footer */}
      <Footer />
    </div>
  );
}
