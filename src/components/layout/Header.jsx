import React from 'react';
import { 
  Search, 
  Menu, 
  Bell, 
  User, 
  Sparkles,
  Layers
} from 'lucide-react';

export const Header = ({ 
  activeTab, 
  setActiveTab, 
  searchQuery, 
  setSearchQuery,
  mobileOpen,
  setMobileOpen
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 lg:px-8 py-3 flex items-center justify-between gap-4 shadow-xs">
      {/* Left: Mobile Drawer Toggle & Page Title Section */}
      <div className="flex items-center space-x-3">
        {/* Mobile Hamburger Toggle Button */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="lg:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
          title="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Page Title & Description */}
        <div>
          <h1 className="text-base sm:text-lg font-extrabold text-slate-900 leading-tight">
            Document Intelligence
          </h1>
          <p className="text-xs text-slate-500 hidden sm:block">
            Understand, search, and explore complex PDF documents.
          </p>
        </div>
      </div>

      {/* Center/Right: Quick Search & Actions */}
      <div className="flex items-center space-x-3">
        {/* Quick Search Bar */}
        <div className="relative hidden md:flex items-center w-72 lg:w-80">
          <Search className="w-4 h-4 absolute left-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Quick search documents or regions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              if (activeTab !== 'search') setActiveTab('search');
            }}
            className="w-full bg-slate-100/80 hover:bg-slate-100 focus:bg-white text-slate-900 text-xs pl-10 pr-10 py-2 rounded-xl border border-slate-200 focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 transition-all outline-none"
          />
          <span className="absolute right-3 text-[10px] font-mono text-slate-400 bg-slate-200/70 px-1.5 py-0.5 rounded">
            ⌘K
          </span>
        </div>

        {/* Upload Button Shortcut */}
        <button
          onClick={() => setActiveTab('upload')}
          className="hidden sm:flex bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all shadow-xs items-center space-x-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Upload</span>
        </button>

        <div className="h-5 w-px bg-slate-200 hidden sm:block"></div>

        {/* Notification Bell */}
        <button 
          onClick={() => setActiveTab('search')}
          className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors relative"
          title="Notifications"
        >
          <Bell className="w-4.5 h-4.5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-900 rounded-full"></span>
        </button>

        {/* User Profile Placeholder */}
        <div className="flex items-center space-x-2.5 pl-1">
          <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xs font-bold ring-2 ring-rose-900/20 shadow-xs">
            <User className="w-4 h-4 text-slate-200" />
          </div>
          <div className="hidden xl:block text-left">
            <div className="text-xs font-bold text-slate-900 leading-tight">Project Demo User</div>
            <div className="text-[10px] text-slate-500 font-medium">KL University CSE</div>
          </div>
        </div>
      </div>
    </header>
  );
};
