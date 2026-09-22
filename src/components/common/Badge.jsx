import React from 'react';

export const Badge = ({ children, variant = 'default', size = 'md', className = '' }) => {
  const baseStyles = "inline-flex items-center font-medium rounded-full transition-colors";
  
  const sizeStyles = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-xs",
    lg: "px-3 py-1.5 text-sm"
  };

  const variantStyles = {
    default: "bg-slate-100 text-slate-700 border border-slate-200",
    burgundy: "bg-rose-50 text-rose-950 border border-rose-200 font-semibold",
    primary: "bg-rose-900 text-white shadow-xs",
    success: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border border-amber-200",
    info: "bg-blue-50 text-blue-700 border border-blue-200",
    table: "bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono",
    figure: "bg-amber-100 text-amber-800 border border-amber-300 font-mono",
    heading: "bg-rose-100 text-rose-900 border border-rose-300 font-mono",
    text: "bg-blue-100 text-blue-800 border border-blue-300 font-mono"
  };

  return (
    <span className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant] || variantStyles.default} ${className}`}>
      {children}
    </span>
  );
};
