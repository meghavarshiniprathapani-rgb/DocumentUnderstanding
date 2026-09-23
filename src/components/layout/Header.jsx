import React, { useState } from 'react';
import { 
  Search, 
  Menu, 
  Bell, 
  User, 
  Sparkles,
  LogOut,
  LogIn,
  UserPlus,
  ChevronDown
} from 'lucide-react';

export const Header = ({ 
  activeTab, 
  setActiveTab, 
  searchQuery, 
  setSearchQuery,
  mobileOpen,
  setMobileOpen,
  user,
  isAuthenticated,
  onNavigate,
  onLogout
}) => {
  const [showDropdown, setShowDropdown] = useState(false);

  // Extract initials
  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : 'MP';

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
        <div className="relative hidden md:flex items-center w-64 lg:w-72">
          <Search className="w-4 h-4 absolute left-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Quick search documents..."
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
          className="hidden sm:flex bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold px-3 py-2 rounded-xl transition-all shadow-xs items-center space-x-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Upload</span>
        </button>

        <div className="h-5 w-px bg-slate-200 hidden sm:block"></div>

        {/* Auth Navigation Links or Profile Dropdown */}
        {isAuthenticated ? (
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className={`flex items-center space-x-2 pl-1.5 pr-2.5 py-1 rounded-xl transition-all ${
                activeTab === 'profile' || showDropdown
                  ? 'bg-rose-50 border border-rose-200'
                  : 'hover:bg-slate-100'
              }`}
              title="User Account Menu"
            >
              <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xs font-extrabold ring-2 ring-rose-900/20 shadow-xs">
                {initials}
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-xs font-bold text-slate-900 leading-tight max-w-[120px] truncate">
                  {user?.name || 'Meghavarshini P.'}
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
            </button>

            {/* Dropdown Menu */}
            {showDropdown && (
              <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl py-2 z-50 animate-fade-in space-y-1">
                <div className="px-4 py-2 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-900 truncate">{user?.name || 'Researcher'}</p>
                  <p className="text-[11px] text-slate-500 truncate">{user?.email || 'user@docusense.ai'}</p>
                </div>

                <button
                  onClick={() => {
                    setActiveTab('profile');
                    setShowDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center space-x-2"
                >
                  <User className="w-4 h-4 text-slate-500" />
                  <span>View Account Profile</span>
                </button>

                <div className="border-t border-slate-100 my-1"></div>

                <button
                  onClick={() => {
                    setShowDropdown(false);
                    if (onLogout) onLogout();
                  }}
                  className="w-full text-left px-4 py-2 text-xs font-bold text-rose-900 hover:bg-rose-50 flex items-center space-x-2"
                >
                  <LogOut className="w-4 h-4 text-rose-900" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onNavigate && onNavigate('/login')}
              className="text-xs font-bold text-slate-700 hover:text-rose-900 px-3 py-2 rounded-xl hover:bg-slate-100 transition-all flex items-center space-x-1.5"
            >
              <LogIn className="w-4 h-4 text-slate-500" />
              <span>Log In</span>
            </button>
            <button
              onClick={() => onNavigate && onNavigate('/signup')}
              className="bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold px-3 py-2 rounded-xl transition-all shadow-xs flex items-center space-x-1.5"
            >
              <UserPlus className="w-4 h-4" />
              <span>Sign Up</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

