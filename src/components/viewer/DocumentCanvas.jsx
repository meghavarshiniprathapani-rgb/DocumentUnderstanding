import React, { useState } from 'react';
import { 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight, 
  FileText, 
  Layers, 
  Info,
  Sliders,
  Check,
  Maximize2,
  Table as TableIcon
} from 'lucide-react';
import { Badge } from '../common/Badge';

export const DocumentCanvas = ({ 
  document, 
  currentPage = 1, 
  setCurrentPage,
  activeSegmentId, 
  onSelectSegment,
  filterType,
  setFilterType
}) => {
  const [zoom, setZoom] = useState(100);

  if (!document || !document.pages || document.pages.length === 0) {
    return (
      <div className="w-full h-96 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center p-8 text-center text-slate-500">
        <FileText className="w-12 h-12 text-slate-300 mb-3" />
        <h3 className="text-sm font-bold text-slate-700">No Bounding Box Data Available</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-sm">
          Select a processed document from the library to view interactive spatial regions.
        </p>
      </div>
    );
  }

  const totalPages = document.pagesCount || 1;
  const page = document.pages.find(p => p.pageNumber === currentPage) || document.pages[0];

  const handleZoomIn = () => setZoom(prev => Math.min(150, prev + 10));
  const handleZoomOut = () => setZoom(prev => Math.max(70, prev - 10));
  const handleResetZoom = () => setZoom(100);

  return (
    <div className="bg-slate-100/90 border border-slate-200 rounded-2xl p-4 flex flex-col h-full shadow-xs space-y-3">
      {/* Top Toolbar Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
        {/* Page Filter Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto">
          <span className="text-xs font-bold text-slate-400 mr-2">Filter BBoxes:</span>
          {['all', 'heading', 'text', 'table', 'figure'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold capitalize transition-all ${
                filterType === type 
                  ? 'bg-rose-900 text-white shadow-xs' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Center: Page Navigation */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg text-slate-700 transition-colors"
            title="Previous Page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="text-xs font-bold text-slate-800 font-mono">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg text-slate-700 transition-colors"
            title="Next Page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Zoom Controls */}
        <div className="flex items-center space-x-2">
          <button 
            onClick={handleZoomOut}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono font-bold text-slate-800 w-12 text-center">{zoom}%</span>
          <button 
            onClick={handleZoomIn}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button 
            onClick={handleResetZoom}
            className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700"
            title="Reset Zoom"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Page Thumbnails Selector Strip */}
      <div className="flex items-center space-x-2 overflow-x-auto bg-white p-2 rounded-xl border border-slate-200/80">
        <span className="text-[11px] font-bold text-slate-400 px-2 uppercase tracking-wider">Pages:</span>
        {Array.from({ length: Math.min(6, totalPages) }).map((_, i) => {
          const pageNum = i + 1;
          const isActive = pageNum === currentPage;
          return (
            <button
              key={pageNum}
              onClick={() => setCurrentPage(pageNum)}
              className={`px-3 py-1 rounded-lg text-xs font-bold font-mono transition-all flex items-center space-x-1 ${
                isActive 
                  ? 'bg-rose-900 text-white shadow-xs' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <FileText className="w-3 h-3" />
              <span>Page {pageNum}</span>
            </button>
          );
        })}
      </div>

      {/* Center Panel: Large Document Page Preview with Sample Bounding Boxes */}
      <div className="flex-1 overflow-auto flex justify-center items-start p-4 min-h-[550px] bg-slate-200/70 rounded-xl border border-slate-300/80 relative">
        <div 
          className="bg-white rounded-lg shadow-xl relative transition-transform duration-200 border border-slate-300"
          style={{
            width: `${(800 * zoom) / 100}px`,
            minHeight: `${(1000 * zoom) / 100}px`,
            padding: '40px'
          }}
        >
          {/* Header watermark */}
          <div className="border-b border-slate-200 pb-3 flex justify-between items-center text-xs text-slate-400 font-mono">
            <span>DOCUSENSE - MOCK BOUNDING BOX CANVAS</span>
            <span>{document.title}</span>
          </div>

          {/* Render layout segments with interactive bounding box overlays */}
          <div className="mt-4 space-y-6">
            {page.segments.map((segment) => {
              const isSelected = activeSegmentId === segment.id;
              const isFilteredOut = filterType !== 'all' && segment.type !== filterType;

              if (isFilteredOut) return null;

              // Color styles by segment type
              const getBBoxColor = (type) => {
                switch(type) {
                  case 'heading': return 'border-rose-900 bg-rose-900/10 text-rose-950';
                  case 'table': return 'border-emerald-600 bg-emerald-500/10 text-emerald-950';
                  case 'figure': return 'border-amber-600 bg-amber-500/10 text-amber-950';
                  default: return 'border-blue-600 bg-blue-500/10 text-blue-950';
                }
              };

              return (
                <div
                  key={segment.id}
                  onClick={() => onSelectSegment(segment.id)}
                  className={`relative p-3.5 rounded-xl border-2 transition-all cursor-pointer group ${getBBoxColor(segment.type)} ${
                    isSelected ? 'ring-4 ring-rose-900/40 scale-[1.01] shadow-lg z-20' : 'hover:ring-2 hover:ring-rose-900/30 z-10'
                  }`}
                >
                  {/* Floating Bounding Box Label Badge */}
                  <div className="absolute -top-3.5 left-3 z-30 flex items-center space-x-1">
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded shadow-xs uppercase tracking-wide flex items-center gap-1 ${
                      segment.type === 'heading' ? 'bg-rose-900 text-white' :
                      segment.type === 'table' ? 'bg-emerald-700 text-white' :
                      segment.type === 'figure' ? 'bg-amber-600 text-white' :
                      'bg-blue-700 text-white'
                    }`}>
                      {segment.label} (Mock BBox)
                    </span>
                  </div>

                  {/* Segment Content Preview */}
                  {segment.type === 'heading' && (
                    <h2 className="text-lg font-extrabold text-slate-900 tracking-tight pt-1">
                      {segment.text}
                    </h2>
                  )}

                  {segment.type === 'text' && (
                    <p className="text-xs text-slate-700 leading-relaxed font-sans pt-1">
                      {segment.text}
                    </p>
                  )}

                  {segment.type === 'table' && segment.tableData && (
                    <div className="pt-2">
                      <div className="text-xs font-bold text-slate-900 mb-2">{segment.text}</div>
                      <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 p-2 shadow-xs">
                        <table className="w-full text-[11px] text-left">
                          <thead>
                            <tr className="border-b border-slate-300 font-bold text-slate-800">
                              {segment.tableData.headers.map((h, i) => (
                                <th key={i} className="pb-1.5 pr-3">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-mono text-slate-600">
                            {segment.tableData.rows.map((r, i) => (
                              <tr key={i}>
                                {r.map((c, j) => (
                                  <td key={j} className="py-1.5 pr-3">{c}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {segment.type === 'figure' && (
                    <div className="pt-2 text-center p-4 bg-amber-50 rounded-lg border border-amber-200">
                      <div className="text-xs font-bold text-amber-900">{segment.text}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{segment.figureCaption}</div>
                      <div className="mt-2 h-20 bg-amber-100/60 rounded border border-dashed border-amber-300 flex items-center justify-center text-amber-800 text-xs font-mono">
                        [Extracted Visual Patch Element]
                      </div>
                    </div>
                  )}

                  {/* Tooltip on Hover showing 2D coordinates */}
                  <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-slate-500 opacity-70 group-hover:opacity-100 transition-opacity">
                    <span>Position: [x:{segment.bbox.x}, y:{segment.bbox.y}, w:{segment.bbox.width}, h:{segment.bbox.height}]</span>
                    <span className="text-rose-900 font-bold">Sample Bounding Box</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
