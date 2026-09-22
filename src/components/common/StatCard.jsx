import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

export const StatCard = ({ title, value, subtext, icon: Icon, trend, trendValue, accent = false }) => {
  return (
    <div className={`p-5 rounded-xl border transition-all duration-200 ${
      accent 
        ? 'bg-gradient-to-br from-rose-950 via-rose-900 to-rose-950 text-white border-rose-800 shadow-sm' 
        : 'bg-white text-slate-900 border-slate-200 hover:border-slate-300 shadow-xs'
    }`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold uppercase tracking-wider ${accent ? 'text-rose-200' : 'text-slate-500'}`}>
          {title}
        </span>
        {Icon && (
          <div className={`p-2 rounded-lg ${accent ? 'bg-white/10 text-rose-100' : 'bg-rose-50 text-rose-900'}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <div className="text-2xl lg:text-3xl font-extrabold tracking-tight">
          {value}
        </div>
        {trendValue && (
          <div className={`flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
            trend === 'up' 
              ? (accent ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
              : (accent ? 'bg-rose-500/20 text-rose-300' : 'bg-rose-50 text-rose-700 border border-rose-200')
          }`}>
            {trend === 'up' ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
            {trendValue}
          </div>
        )}
      </div>

      {subtext && (
        <p className={`mt-2 text-xs ${accent ? 'text-rose-200/80' : 'text-slate-500'}`}>
          {subtext}
        </p>
      )}
    </div>
  );
};
