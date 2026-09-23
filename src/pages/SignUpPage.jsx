import React, { useState } from 'react';
import { 
  Layers, 
  Mail, 
  Lock, 
  User, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  Sparkles, 
  CheckCircle2, 
  ShieldCheck, 
  AlertCircle,
  Loader2,
  FileText,
  Search
} from 'lucide-react';

export const SignUpPage = ({ onNavigate, onSignUpSuccess }) => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    agreeTerms: true
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [signUpError, setSignUpError] = useState('');

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));

    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    if (signUpError) setSignUpError('');
  };

  const validate = () => {
    const newErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!formData.fullName.trim()) {
      newErrors.fullName = 'Full name is required';
    } else if (formData.fullName.trim().length < 2) {
      newErrors.fullName = 'Full name must be at least 2 characters';
    }

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

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (!formData.agreeTerms) {
      newErrors.agreeTerms = 'You must agree to the Terms of Service';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    setSignUpError('');

    // Simulate mock sign up latency
    setTimeout(() => {
      setIsLoading(false);

      const userData = {
        name: formData.fullName.trim(),
        email: formData.email.trim(),
        role: 'Research Associate',
        institution: 'Capstone Document Intelligence Lab'
      };

      if (onSignUpSuccess) {
        onSignUpSuccess(userData);
      }
      if (onNavigate) {
        onNavigate('/');
      }
    }, 600);
  };

  const handleFillDemo = () => {
    setFormData({
      fullName: 'Meghavarshini Prathapani',
      email: 'meghavarshini@retrieva.ai',
      password: 'password123',
      confirmPassword: 'password123',
      agreeTerms: true
    });
    setErrors({});
    setSignUpError('');
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans selection:bg-rose-900 selection:text-white relative overflow-hidden">
      {/* Background Decorative Blur Orbs */}
      <div className="absolute top-0 -right-20 w-96 h-96 bg-rose-950/60 rounded-full filter blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -left-20 w-96 h-96 bg-rose-900/30 rounded-full filter blur-3xl pointer-events-none" />

      {/* Main Glassmorphic Container Card */}
      <div className="w-full max-w-5xl bg-slate-900/90 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 relative z-10 animate-fade-in backdrop-blur-xl">
        
        {/* Left Side: Brand & Feature Showcase (Desktop 5 cols) */}
        <div className="lg:col-span-5 bg-gradient-to-br from-rose-950 via-rose-900 to-slate-950 p-8 sm:p-10 text-white flex flex-col justify-between relative overflow-hidden border-b lg:border-b-0 lg:border-r border-rose-900/40">
          {/* Subtle grid pattern overlay */}
          <div className="absolute inset-0 bg-[radial-gradient(#e11d48_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />

          {/* Top Logo */}
          <div className="relative z-10 space-y-6">
            <div className="flex items-center space-x-3">
              <div className="w-11 h-11 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-white flex items-center justify-center shadow-lg">
                <Layers className="w-6 h-6 text-rose-200" />
              </div>
              <div>
                <div className="text-xl font-extrabold tracking-tight text-white flex items-center gap-1">
                  Retri<span className="text-rose-300">eva</span>
                </div>
                <div className="text-xs text-rose-200/80 font-medium">
                  Document Intelligence Platform
                </div>
              </div>
            </div>

            <div className="pt-6 space-y-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-200 border border-rose-500/30">
                <Sparkles className="w-3.5 h-3.5 text-rose-300" />
                Create Researcher Account
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">
                Start analyzing PDFs with spatial AI precision
              </h2>
              <p className="text-xs sm:text-sm text-rose-100/80 leading-relaxed font-normal">
                Join Retrieva to parse, index, search, and visualize document layout coordinates with high fidelity.
              </p>
            </div>
          </div>

          {/* Key Platform Highlights */}
          <div className="relative z-10 py-8 space-y-3 hidden sm:block">
            <div className="flex items-center space-x-3 text-xs text-rose-100 bg-white/5 border border-white/10 rounded-xl p-3 backdrop-blur-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Instant Access to Dashboard & PDF Viewer</span>
            </div>
            <div className="flex items-center space-x-3 text-xs text-rose-100 bg-white/5 border border-white/10 rounded-xl p-3 backdrop-blur-xs">
              <FileText className="w-4 h-4 text-rose-300 shrink-0" />
              <span>Bounding Box & Bounding Region Debugging</span>
            </div>
            <div className="flex items-center space-x-3 text-xs text-rose-100 bg-white/5 border border-white/10 rounded-xl p-3 backdrop-blur-xs">
              <ShieldCheck className="w-4 h-4 text-rose-300 shrink-0" />
              <span>Free Capstone Research Quota (10 GB)</span>
            </div>
          </div>

          {/* Footer info */}
          <div className="relative z-10 pt-4 border-t border-white/10 flex items-center justify-between text-[11px] text-rose-300/80 font-mono">
            <span>Retrieva v2.4</span>
            <span>No Credit Card Required</span>
          </div>
        </div>

        {/* Right Side: Sign Up Form (7 cols) */}
        <div className="lg:col-span-7 bg-white p-8 sm:p-12 flex flex-col justify-between">
          <div>
            {/* Header Title */}
            <div className="space-y-2 mb-6">
              <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                Create an account
              </h3>
              <p className="text-xs sm:text-sm text-slate-500">
                Get started with your Retrieva document intelligence workspace.
              </p>
            </div>

            {/* Global Error Banner */}
            {signUpError && (
              <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center space-x-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-700" />
                <span>{signUpError}</span>
              </div>
            )}

            {/* Quick Demo Fill Button Bar */}
            <div className="mb-6 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-slate-700">Quick Test Mode</span>
              </div>
              <button
                type="button"
                onClick={handleFillDemo}
                className="px-3 py-1.5 bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Auto-fill Sample Data
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* Full Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  Full Name <span className="text-rose-600">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    name="fullName"
                    placeholder="e.g. Meghavarshini Prathapani"
                    value={formData.fullName}
                    onChange={handleChange}
                    className={`w-full bg-slate-50 text-slate-900 text-xs font-medium pl-10 pr-4 py-2.5 rounded-xl border transition-all outline-none ${
                      errors.fullName
                        ? 'border-rose-500 ring-2 ring-rose-500/10 focus:border-rose-600'
                        : 'border-slate-200 focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 focus:bg-white'
                    }`}
                  />
                </div>
                {errors.fullName && (
                  <p className="text-[11px] font-semibold text-rose-600 flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.fullName}
                  </p>
                )}
              </div>

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
                    className={`w-full bg-slate-50 text-slate-900 text-xs font-medium pl-10 pr-4 py-2.5 rounded-xl border transition-all outline-none ${
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

              {/* Password & Confirm Password Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Password <span className="text-rose-600">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      placeholder="••••••••••••"
                      value={formData.password}
                      onChange={handleChange}
                      className={`w-full bg-slate-50 text-slate-900 text-xs font-medium pl-10 pr-9 py-2.5 rounded-xl border transition-all outline-none ${
                        errors.password
                          ? 'border-rose-500 ring-2 ring-rose-500/10 focus:border-rose-600'
                          : 'border-slate-200 focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 focus:bg-white'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors p-1"
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-[11px] font-semibold text-rose-600 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.password}
                    </p>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Confirm Password <span className="text-rose-600">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      name="confirmPassword"
                      placeholder="••••••••••••"
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      className={`w-full bg-slate-50 text-slate-900 text-xs font-medium pl-10 pr-9 py-2.5 rounded-xl border transition-all outline-none ${
                        errors.confirmPassword
                          ? 'border-rose-500 ring-2 ring-rose-500/10 focus:border-rose-600'
                          : 'border-slate-200 focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 focus:bg-white'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors p-1"
                      title={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {errors.confirmPassword && (
                    <p className="text-[11px] font-semibold text-rose-600 flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.confirmPassword}
                    </p>
                  )}
                </div>
              </div>

              {/* Terms & Conditions Checkbox */}
              <div className="space-y-1 pt-1">
                <div className="flex items-start space-x-2">
                  <input
                    type="checkbox"
                    id="agreeTerms"
                    name="agreeTerms"
                    checked={formData.agreeTerms}
                    onChange={handleChange}
                    className="w-4 h-4 mt-0.5 rounded text-rose-900 border-slate-300 focus:ring-rose-900 cursor-pointer"
                  />
                  <label htmlFor="agreeTerms" className="text-xs text-slate-600 cursor-pointer leading-tight">
                    I agree to the <span className="text-rose-900 font-semibold hover:underline">Terms of Service</span> and <span className="text-rose-900 font-semibold hover:underline">Privacy Policy</span>.
                  </label>
                </div>
                {errors.agreeTerms && (
                  <p className="text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {errors.agreeTerms}
                  </p>
                )}
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
                    <span>Creating Account...</span>
                  </>
                ) : (
                  <>
                    <span>Create Account</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Bottom Switch Link & Guest Route */}
          <div className="pt-6 border-t border-slate-100 mt-6 space-y-3 text-center">
            <p className="text-xs text-slate-600">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => onNavigate && onNavigate('/login')}
                className="font-extrabold text-rose-900 hover:text-rose-950 underline transition-colors"
              >
                Log In
              </button>
            </p>

            <div>
              <button
                type="button"
                onClick={() => onNavigate && onNavigate('/')}
                className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors"
              >
                Skip authentication and enter Dashboard as Guest →
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
