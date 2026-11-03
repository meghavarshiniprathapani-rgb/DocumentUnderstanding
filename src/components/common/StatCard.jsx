import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

export const StatCard = ({ title, value, subtext, icon: Icon, trend, trendValue, accent = false }) => {
  return (
    <div className={`p-5 rounded-2xl border transition-all duration-200 ${
      accent 
        ? 'bg-gradient-to-br from-rose-950 via-rose-900 to-rose-950 text-white border-rose-800 shadow-sm shadow-rose-950/20' 
        : 'bg-white text-slate-900 border-slate-200/90 hover:border-slate-300 shadow-xs'
    }`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-bold uppercase tracking-wider ${accent ? 'text-rose-200' : 'text-slate-500'}`}>
          {title}
        </span>
        {Icon && (
          <div className={`p-2.5 rounded-xl ${accent ? 'bg-white/10 text-rose-100 ring-1 ring-white/10' : 'bg-rose-50 text-rose-900 border border-rose-100'}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <div className="text-2xl lg:text-3xl font-extrabold tracking-tight">
          {value}
        </div>
        {trendValue && (
          <div className={`flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${
            trend === 'up' 
              ? (accent ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
              : (accent ? 'bg-rose-500/20 text-rose-300 border border-rose-400/30' : 'bg-rose-50 text-rose-700 border border-rose-200')
          }`}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
            {trendValue}
          </div>
        )}
      </div>

      {subtext && (
        <p className={`mt-2 text-xs leading-relaxed ${accent ? 'text-rose-200/80' : 'text-slate-500'}`}>
          {subtext}
        </p>
      )}
    </div>
  );
};
