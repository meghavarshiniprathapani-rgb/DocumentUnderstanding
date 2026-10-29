import React, { useState } from 'react';
import { 
  Layers, 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  Sparkles, 
  FileText, 
  Search, 
  ShieldCheck, 
  AlertCircle, 
  Loader2
} from 'lucide-react';

export const LoginPage = ({ onNavigate, onLoginSuccess }) => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: true
  });

  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    // Clear field-specific error on change
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    if (loginError) setLoginError('');
  };

  const validate = () => {
    const newErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!formData.email.trim()) {
      newErrors.email = 'Email address is required';
    } else if (!emailRegex.test(formData.email.trim())) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    setLoginError('');

    // Simulate mock authentication request latency
    setTimeout(() => {
      setIsLoading(false);
      // Derive name from email or default
      const username = formData.email.split('@')[0];
      const formattedName = username
        ? username.charAt(0).toUpperCase() + username.slice(1).replace(/[._]/g, ' ')
        : 'Researcher User';

      const userData = {
        name: formattedName,
        email: formData.email,
        role: 'Senior Document Researcher',
        institution: 'Enterprise AI Lab'
      };

      if (onLoginSuccess) {
        onLoginSuccess(userData);
      }
      if (onNavigate) {
        onNavigate('/');
      }
    }, 600);
  };

  return (
    <div className="min-h-screen bg-white font-sans selection:bg-slate-900 selection:text-white">

      {/* Main Glassmorphic Container Card */}
      <div className="min-h-screen w-full bg-white grid grid-cols-1 lg:grid-cols-12 animate-fade-in">
        
        {/* Left Side: Brand & Feature Showcase (Desktop 5 cols) */}
        <div className="lg:col-span-5 bg-slate-950 p-8 sm:p-10 lg:p-14 text-white flex flex-col justify-between relative overflow-hidden border-b lg:border-b-0 lg:border-r border-slate-800 min-h-[320px]">
          {/* Subtle grid pattern overlay */}
          <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

          {/* Top Logo */}
          <div className="relative z-10 space-y-6">
            <div className="flex items-center space-x-3">
              <div className="w-11 h-11 rounded-2xl bg-white text-slate-950 flex items-center justify-center shadow-lg">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <div className="text-xl font-extrabold tracking-tight text-white">
                  Retrieva <span className="text-slate-300">AI</span>
                </div>
                <div className="text-xs text-slate-400 font-medium">
                  Document Intelligence Platform
                </div>
              </div>
            </div>

            <div className="pt-6 space-y-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-white/10 text-slate-200 border border-white/15">
                <Sparkles className="w-3.5 h-3.5" />
                Secure document workspace
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">
                Unlock deep multi-modal PDF insights
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-normal">
                Sign in to search your documents, inspect layouts, and work with extracted intelligence in one place.
              </p>
            </div>
          </div>

          {/* Key Platform Highlights */}
          <div className="relative z-10 py-8 space-y-3 hidden sm:block">
            <div className="flex items-center space-x-3 text-xs text-slate-200 bg-white/5 border border-white/10 rounded-xl p-3">
              <FileText className="w-4 h-4 text-slate-300 shrink-0" />
              <span>Structured document extraction</span>
            </div>
            <div className="flex items-center space-x-3 text-xs text-slate-200 bg-white/5 border border-white/10 rounded-xl p-3">
              <Search className="w-4 h-4 text-slate-300 shrink-0" />
              <span>Fast semantic search</span>
            </div>
            <div className="flex items-center space-x-3 text-xs text-slate-200 bg-white/5 border border-white/10 rounded-xl p-3">
              <ShieldCheck className="w-4 h-4 text-slate-300 shrink-0" />
              <span>Private, reliable access</span>
            </div>
          </div>

          {/* Footer badge */}
          <div className="relative z-10 pt-4 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>Retrieva v2.4</span>
            <span>FastAPI Connected</span>
          </div>
        </div>

        {/* Right Side: Login Form (7 cols) */}
        <div className="lg:col-span-7 bg-white p-8 sm:p-10 lg:p-14 flex flex-col justify-center">
          <div>
            {/* Header Title */}
            <div className="space-y-2 mb-8">
              <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                Welcome back
              </h3>
              <p className="text-xs sm:text-sm text-slate-500">
                Please enter your details to sign in to your dashboard.
              </p>
            </div>

            {/* Global Error Banner */}
            {loginError && (
              <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center space-x-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-700" />
                <span>{loginError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Email Address */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  Email Address <span className="text-rose-600">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    name="email"
                    placeholder="name@institution.com"
                    value={formData.email}
                    onChange={handleChange}
                    className={`w-full bg-slate-50 text-slate-900 text-xs font-medium pl-10 pr-4 py-3 rounded-xl border transition-all outline-none ${
                      errors.email
                        ? 'border-rose-500 ring-2 ring-rose-500/10 focus:border-rose-600'
                        : 'border-slate-200 focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 focus:bg-white'
                    }`}
                  />
                </div>
                {errors.email && (
                  <p className="text-[11px] font-semibold text-rose-600 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.email}
                  </p>
                )}
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 block">
                    Password <span className="text-rose-600">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => alert('Demo Mode: Click "Fill Demo Credentials" to sign in quickly!')}
                    className="text-[11px] font-semibold text-rose-900 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleChange}
                    className={`w-full bg-slate-50 text-slate-900 text-xs font-medium pl-10 pr-10 py-3 rounded-xl border transition-all outline-none ${
                      errors.password
                        ? 'border-rose-500 ring-2 ring-rose-500/10 focus:border-rose-600'
                        : 'border-slate-200 focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 focus:bg-white'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors p-1"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-[11px] font-semibold text-rose-600 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.password}
                  </p>
                )}
              </div>

              {/* Remember Me Checkbox */}
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="rememberMe"
                  name="rememberMe"
                  checked={formData.rememberMe}
                  onChange={handleChange}
                  className="w-4 h-4 rounded text-rose-900 border-slate-300 focus:ring-rose-900 cursor-pointer"
                />
                <label htmlFor="rememberMe" className="text-xs text-slate-600 cursor-pointer font-medium">
                  Remember me
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-4 bg-rose-900 hover:bg-rose-950 active:scale-[0.99] text-white font-bold text-xs rounded-xl shadow-md shadow-rose-950/20 transition-all flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Bottom Switch Link & Guest Route */}
          <div className="pt-8 border-t border-slate-100 mt-8 space-y-3 text-center">
            <p className="text-xs text-slate-600">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => onNavigate && onNavigate('/signup')}
                className="font-extrabold text-rose-900 hover:text-rose-950 underline transition-colors"
              >
                Sign Up
              </button>
            </p>

            <div>
              <button
                type="button"
                onClick={() => onNavigate && onNavigate('/')}
                className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors"
              >
                Continue as a guest →
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
