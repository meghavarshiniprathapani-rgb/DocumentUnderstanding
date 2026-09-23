import React from 'react';
import { ArrowLeft } from 'lucide-react';

export const PageHeader = ({ 
  title, 
  description, 
  icon: Icon, 
  action, 
  onBack, 
  showBack = true 
}) => {
  const handleBackClick = () => {
    if (onBack) {
      onBack();
    } else {
      window.history.back();
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="space-y-1">
        {showBack && (
          <button
            type="button"
            onClick={handleBackClick}
            className="inline-flex items-center space-x-1.5 text-xs font-bold text-slate-600 hover:text-rose-950 hover:bg-rose-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:border-rose-200 transition-all mb-1 cursor-pointer group shadow-2xs"
            title="Navigate Back"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform text-rose-900" />
            <span>Back</span>
          </button>
        )}
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 flex items-center space-x-2.5">
          {Icon && <Icon className="w-6 h-6 sm:w-7 sm:h-7 text-rose-900 shrink-0" />}
          <span>{title}</span>
        </h1>
        {description && (
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {description}
          </p>
        )}
      </div>

      {action && (
        <div className="self-start sm:self-auto shrink-0">
          {action}
        </div>
      )}
    </div>
  );
};
