import React from 'react';
import { 
  LayoutDashboard, 
  UploadCloud, 
  Search, 
  FolderKanban, 
  Settings,
  Layers, 
  Sparkles,
  ChevronRight,
  X,
  FileText,
  User
} from 'lucide-react';

export const Sidebar = ({ activeTab, setActiveTab, mobileOpen, setMobileOpen }) => {
  const navItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      description: 'System overview & metrics'
    },
    {
      id: 'upload',
      label: 'Upload Documents',
      icon: UploadCloud,
      description: 'PDF layout ingestion'
    },
    {
      id: 'search',
      label: 'Search & Retrieval',
      icon: Search,
      description: 'Semantic & spatial search'
    },
    {
      id: 'library',
      label: 'Documents Library',
      icon: FolderKanban,
      description: 'Repository & export'
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      description: 'System & API preferences'
    },
    {
      id: 'profile',
      label: 'User Profile',
      icon: User,
      description: 'Account & usage overview'
    }
  ];

  const sidebarContent = (
    <div className="h-full flex flex-col justify-between p-4 bg-white border-r border-slate-200/80">
      {/* Top Header Logo: Retrieva */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-950 via-rose-900 to-rose-950 text-white flex items-center justify-center shadow-md shadow-rose-900/20 ring-1 ring-rose-800">
              <Layers className="w-5.5 h-5.5 text-rose-100" />
            </div>
            <div>
              <div className="text-base font-extrabold text-slate-900 tracking-tight leading-none">
                Retrieva <span className="text-rose-900 font-extrabold">AI</span>
              </div>
              <div className="text-[10px] font-medium text-slate-400 mt-0.5">
                Doc Intelligence Platform
              </div>
            </div>
          </div>

          {/* Close button for mobile drawer */}
          {setMobileOpen && (
            <button 
              onClick={() => setMobileOpen(false)}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation Section */}
        <div>
          <div className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Main Navigation
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    if (setMobileOpen) setMobileOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 text-left group ${
                    isActive
                      ? 'bg-rose-900 text-white shadow-sm shadow-rose-950/20 font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                  }`}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-rose-100' : 'text-slate-500 group-hover:text-rose-900'}`} />
                    <div className="truncate">
                      <div className="leading-tight">{item.label}</div>
                      <div className={`text-[10px] font-normal truncate mt-0.5 ${isActive ? 'text-rose-200/80' : 'text-slate-400'}`}>
                        {item.description}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 transition-opacity ${isActive ? 'opacity-100 text-white' : 'opacity-0 group-hover:opacity-100 text-slate-400'}`} />
                </button>
              );
            })}
          </nav>
        </div>

        {/* Product Feature Badge */}
        <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200/80 space-y-2">
          <div className="flex items-center space-x-2 text-rose-950 text-xs font-bold">
            <Sparkles className="w-4 h-4 text-rose-900" />
            <span>Document Understanding</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            LayoutLMv3 multi-modal spatial indexing & semantic retrieval engine.
          </p>
        </div>
      </div>

      {/* Footer Info Box */}
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500 space-y-1">
        <div className="flex items-center justify-between text-slate-700 font-semibold text-[11px]">
          <span>FastAPI Integration</span>
          <span className="font-mono text-[10px] text-rose-900 bg-white px-1.5 py-0.5 rounded border border-rose-200">
            Ready
          </span>
        </div>
        <div className="text-[10px] text-slate-400">
          Capstone Project Demo
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div 
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 lg:hidden transition-opacity"
        />
      )}

      {/* Mobile Sidebar Overlay */}
      <aside className={`fixed top-0 bottom-0 left-0 z-50 w-72 transform transition-transform duration-200 ease-in-out lg:hidden ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        {sidebarContent}
      </aside>
    </>
  );
};
