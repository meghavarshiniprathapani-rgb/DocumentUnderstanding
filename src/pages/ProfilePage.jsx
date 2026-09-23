import React, { useState, useEffect, useRef } from 'react';
import { 
  User, 
  Mail, 
  Building2, 
  GraduationCap, 
  FileText, 
  Search, 
  Layers, 
  Check, 
  Save, 
  Calendar, 
  Clock, 
  ShieldCheck, 
  HardDrive,
  Sparkles,
  Activity,
  Edit3,
  Pencil,
  LogOut
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Badge } from '../components/common/Badge';
import { StatCard } from '../components/common/StatCard';
import { MOCK_OVERVIEW_METRICS } from '../mockData/documentsData';

export const ProfilePage = ({ user, onLogout }) => {
  const fullNameInputRef = useRef(null);

  // Editable form state initialized from props
  const [profileData, setProfileData] = useState({
    fullName: user?.name || 'Meghavarshini Prathapani',
    email: user?.email || 'meghavarshini@docusense.ai',
    role: user?.role || 'Lead CSE Researcher',
    department: 'Computer Science & Engineering',
    institution: user?.institution || 'DocuSense AI',
    bio: 'Building AI-driven document understanding and multi-modal spatial retrieval systems for enterprise PDF intelligence.'
  });

  useEffect(() => {
    if (user) {
      setProfileData(prev => ({
        ...prev,
        fullName: user.name || prev.fullName,
        email: user.email || prev.email,
        role: user.role || prev.role,
        institution: user.institution || prev.institution
      }));
    }
  }, [user]);

  const [saved, setSaved] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setProfileData(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveProfile = (e) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleFocusEdit = () => {
    if (fullNameInputRef.current) {
      fullNameInputRef.current.focus();
      fullNameInputRef.current.select();
    }
  };

  const mockActivities = [
    {
      id: 'act-1',
      title: 'Uploaded Document',
      description: 'Ingested "Annual Financial Report.pdf" into spatial indexer',
      timestamp: '2 hours ago',
      type: 'upload',
      icon: FileText
    },
    {
      id: 'act-2',
      title: 'Search Query Performed',
      description: 'Executed query "Quarterly revenue cloud growth Q3"',
      timestamp: '4 hours ago',
      type: 'search',
      icon: Search
    },
    {
      id: 'act-3',
      title: 'Bounding Box Inspected',
      description: 'Inspected Table 1.1 coordinates in Document Viewer',
      timestamp: 'Yesterday at 16:45',
      type: 'viewer',
      icon: Layers
    },
    {
      id: 'act-4',
      title: 'Profile Settings Verified',
      description: 'Updated research credentials & API authorization tokens',
      timestamp: '3 days ago',
      type: 'profile',
      icon: ShieldCheck
    }
  ];

  return (
    <div className="space-y-8 max-w-6xl mx-auto animate-fade-in">
      {/* 1. Page Header */}
      <PageHeader
        title="User Profile & Account"
        description="Manage your researcher profile, view usage statistics, and monitor recent account activity."
        icon={User}
      />

      {/* 2. Top Profile Summary Hero Banner */}
      <div className="bg-gradient-to-r from-rose-950 via-rose-900 to-rose-950 rounded-2xl p-6 sm:p-8 text-white shadow-md relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-center sm:items-start space-y-4 sm:space-y-0 sm:space-x-6 relative z-10">
          {/* Avatar with Initials */}
          <div className="relative">
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-white text-rose-950 font-extrabold text-2xl sm:text-3xl flex items-center justify-center shadow-lg border-2 border-rose-300 shrink-0">
              MP
            </div>
            <button
              onClick={handleFocusEdit}
              className="absolute -top-1.5 -right-1.5 p-2 bg-rose-900 hover:bg-rose-950 text-white rounded-full border-2 border-rose-950 shadow-md transition-all hover:scale-110 cursor-pointer z-10"
              title="Edit Profile Details"
            >
              <Pencil className="w-3.5 h-3.5 text-rose-100" />
            </button>
            <span className="absolute -bottom-2 -right-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-rose-950 flex items-center gap-1 shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
              Active
            </span>
          </div>

          {/* Profile Name & Meta */}
          <div className="text-center sm:text-left space-y-2 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  {profileData.fullName}
                </h2>
              </div>

              <Badge variant="primary" className="self-center sm:self-start bg-white/10 text-white border border-white/20 px-3 py-1">
                Capstone Tier User
              </Badge>
            </div>

            <div className="pt-2 flex flex-wrap justify-center sm:justify-start gap-4 text-xs text-rose-200/90 font-medium">
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-rose-300" />
                {profileData.institution}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-rose-300" />
                {profileData.email}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-rose-300" />
                Joined Sept 2026
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Usage Overview Section (Prototype Statistics) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold text-slate-900 flex items-center space-x-2">
            <Activity className="w-5 h-5 text-rose-900" />
            <span>Usage Overview (Prototype Data)</span>
          </h3>
          <span className="text-[11px] font-mono text-slate-400">Account Quota: 1.42 GB / 10 GB</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Documents Uploaded"
            value={MOCK_OVERVIEW_METRICS.totalDocuments}
            subtext="Indexed PDF repositories"
            icon={FileText}
            accent={true}
          />
          <StatCard
            title="Pages Processed"
            value={MOCK_OVERVIEW_METRICS.pagesProcessed}
            subtext="2D bounding box parsed pages"
            icon={Layers}
            trend="up"
            trendValue="+14%"
          />
          <StatCard
            title="Search Queries"
            value={MOCK_OVERVIEW_METRICS.searchQueries}
            subtext="Multi-modal spatial queries"
            icon={Search}
            trend="up"
            trendValue="+28%"
          />
        </div>
      </div>

      {/* 4. Profile Information Form Card */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={handleFocusEdit}
              className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200/80 shadow-2xs transition-all flex items-center justify-center group"
              title="Edit Profile Fields"
            >
              <Pencil className="w-4 h-4 text-rose-900 group-hover:scale-110 transition-transform" />
            </button>
            <h3 className="text-sm font-extrabold text-slate-900">
              Editable Profile Details
            </h3>
          </div>
          
          <button
            type="button"
            onClick={handleFocusEdit}
            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-900 text-xs font-bold rounded-xl border border-rose-200/80 transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5 text-rose-900" />
            <span>Edit Fields</span>
          </button>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Full Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>Full Name</span>
                <button
                  type="button"
                  onClick={handleFocusEdit}
                  className="text-rose-900 hover:text-rose-950 p-0.5 rounded transition-colors"
                  title="Edit Full Name"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </label>
              <input
                ref={fullNameInputRef}
                type="text"
                name="fullName"
                value={profileData.fullName}
                onChange={handleInputChange}
                className="w-full bg-slate-50 text-slate-900 text-xs font-medium p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 transition-all"
              />
            </div>

            {/* Email Address */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Email Address</label>
              <input
                type="email"
                name="email"
                value={profileData.email}
                onChange={handleInputChange}
                className="w-full bg-slate-50 text-slate-900 text-xs font-medium p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Role */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Role / Title</label>
              <input
                type="text"
                name="role"
                value={profileData.role}
                onChange={handleInputChange}
                className="w-full bg-slate-50 text-slate-900 text-xs font-medium p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 transition-all"
              />
            </div>

            {/* Institution */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Institution</label>
              <input
                type="text"
                name="institution"
                value={profileData.institution}
                onChange={handleInputChange}
                className="w-full bg-slate-50 text-slate-900 text-xs font-medium p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 transition-all"
              />
            </div>
          </div>

          {/* Department */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700">Department</label>
            <input
              type="text"
              name="department"
              value={profileData.department}
              onChange={handleInputChange}
              className="w-full bg-slate-50 text-slate-900 text-xs font-medium p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 transition-all"
            />
          </div>

          {/* Research Bio */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700">Research Focus & Bio</label>
            <textarea
              name="bio"
              rows="3"
              value={profileData.bio}
              onChange={handleInputChange}
              className="w-full bg-slate-50 text-slate-900 text-xs font-medium p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 transition-all"
            />
          </div>

          {/* Form Actions Footer */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100">
            <span className="text-[11px] text-slate-400">Changes update local frontend state</span>

            <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-900 text-xs font-bold rounded-xl border border-rose-200/80 transition-all flex items-center space-x-2 cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-rose-900" />
                  <span>Sign Out</span>
                </button>
              )}

              <button
                type="submit"
                className="px-5 py-2.5 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center space-x-2 cursor-pointer"
              >
                {saved ? <Check className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
                <span>{saved ? 'Profile Updated!' : 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
