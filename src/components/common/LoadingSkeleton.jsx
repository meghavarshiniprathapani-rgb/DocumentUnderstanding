import React from 'react';

export const LoadingSkeleton = ({ type = 'card', count = 1 }) => {
  const items = Array.from({ length: count });

  if (type === 'table') {
    return (
      <div className="w-full space-y-3 animate-pulse">
        <div className="h-10 bg-slate-200 rounded-lg w-full"></div>
        {items.map((_, i) => (
          <div key={i} className="h-12 bg-slate-100 rounded-lg w-full flex items-center px-4 space-x-4">
            <div className="h-4 bg-slate-200 rounded w-1/4"></div>
            <div className="h-4 bg-slate-200 rounded w-1/2"></div>
            <div className="h-4 bg-slate-200 rounded w-1/6"></div>
          </div>
        ))}
      </div>
    );
  }

  if (type === 'viewer') {
    return (
      <div className="w-full h-96 bg-slate-100 rounded-xl border border-slate-200 animate-pulse flex flex-col items-center justify-center p-8">
        <div className="w-48 h-6 bg-slate-200 rounded mb-4"></div>
        <div className="w-full max-w-md h-4 bg-slate-200 rounded mb-2"></div>
        <div className="w-full max-w-sm h-4 bg-slate-200 rounded mb-6"></div>
        <div className="w-3/4 h-32 bg-slate-200 rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((_, i) => (
        <div key={i} className="p-5 bg-white border border-slate-200 rounded-xl animate-pulse space-y-3">
          <div className="h-4 bg-slate-200 rounded w-1/3"></div>
          <div className="h-8 bg-slate-200 rounded w-2/3"></div>
          <div className="h-3 bg-slate-100 rounded w-full"></div>
        </div>
      ))}
    </div>
  );
};
