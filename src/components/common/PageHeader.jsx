import React from 'react';

export const PageHeader = ({ title, description, icon: Icon, action }) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
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
