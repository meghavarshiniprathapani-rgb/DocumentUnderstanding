import React from 'react';
import { isDemoMode } from '../../services/api';
import { MOCK_SYSTEM_METRICS } from '../../mockData/documentsData';

export const Footer = () => {
  const demo = isDemoMode();

  return (
    <footer className="bg-white border-t border-slate-200/90 py-3.5 px-4 lg:px-8 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs">
      <div className="flex items-center space-x-2 flex-wrap justify-center sm:justify-start text-xs">
        <span className="font-bold text-slate-800">Retrieva AI</span>
        <span className="text-slate-300">•</span>
        <span className="text-slate-600">Multi-Modal Spatial Retrieval</span>
        <span className="text-slate-300">•</span>
        <span className="text-rose-900 font-semibold">{MOCK_SYSTEM_METRICS.capstoneProject.institution}</span>
      </div>
      <div className="flex items-center space-x-3 text-xs">
        <span className="text-slate-400 font-mono text-[11px]">Bundle O3-v1.0.0</span>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
          demo 
            ? 'bg-amber-50 text-amber-800 border-amber-300' 
            : 'bg-emerald-50 text-emerald-800 border-emerald-300'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${demo ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          {demo ? 'Offline Demo' : 'FastAPI Connected'}
        </span>
      </div>
    </footer>
  );
};
