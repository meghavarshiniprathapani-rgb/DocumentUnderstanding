import React from 'react';

export const EmptyState = ({ icon: Icon, title, description, action }) => {
  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-8 sm:p-12 text-center shadow-xs space-y-4 animate-fade-in">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 mx-auto flex items-center justify-center shadow-xs">
          <Icon className="w-7 h-7 text-rose-900" />
        </div>
      )}
      <div className="max-w-md mx-auto space-y-1">
        <h3 className="text-base font-extrabold text-slate-900">
          {title}
        </h3>
        {description && (
          <p className="text-xs text-slate-500 leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {action && (
        <div className="pt-2">
          {action}
        </div>
      )}
    </div>
  );
};
