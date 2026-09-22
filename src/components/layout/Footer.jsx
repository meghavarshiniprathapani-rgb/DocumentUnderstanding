import React from 'react';
import { MOCK_SYSTEM_METRICS } from '../../mockData/documentsData';

export const Footer = () => {
  return (
    <footer className="bg-white border-t border-slate-200 py-4 px-6 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3">
      <div className="flex items-center space-x-2">
        <span className="font-semibold text-slate-700">DocMind AI</span>
        <span>•</span>
        <span>Document Understanding for Retrieval</span>
        <span>•</span>
        <span className="text-rose-900 font-medium">{MOCK_SYSTEM_METRICS.klUniversityProject.institution}</span>
      </div>
      <div className="flex items-center space-x-4">
        <span className="text-slate-400">Frontend SaaS Console</span>
        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-mono">
          Ready for FastAPI
        </span>
      </div>
    </footer>
  );
};
