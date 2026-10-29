import React, { useState, useEffect, useRef } from 'react';
import { 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight, 
  FileText, 
  ShieldAlert,
  Loader2,
  Variable
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '4.0.379'}/build/pdf.worker.min.mjs`;
}

export const DocumentCanvas = ({ 
  document, 
  currentPage = 1, 
  setCurrentPage,
  activeSegmentId, 
  onSelectSegment,
  filterType = 'all',
  setFilterType,
  pdfUrl = null,
  segments = null
}) => {
  const [zoom, setZoom] = useState(100);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [_pdfError, setPdfError] = useState(null);
  const canvasRef = useRef(null);

  const totalPages = document?.pagesCount || document?.pages_count || 1;
  const currentSegments = segments || document?.pages?.find(p => p.pageNumber === currentPage)?.segments || [];

  // Render PDF page via PDF.js on the canvas
  useEffect(() => {
    let isMounted = true;
    let renderTask = null;

    async function renderPdf() {
      if (!pdfUrl || !canvasRef.current) {
        setPdfLoaded(false);
        return;
      }

      try {
        setPdfLoading(true);
        setPdfError(null);

        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          withCredentials: false
        });

        const pdf = await loadingTask.promise;
        if (!isMounted) return;

        const safePageNum = Math.min(Math.max(1, currentPage), pdf.numPages);
        const page = await pdf.getPage(safePageNum);
        if (!isMounted) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        // Scale canvas to match target container width (800px base * zoom factor)
        const targetWidth = (800 * zoom) / 100;
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const scale = targetWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        renderTask = page.render({
          canvasContext: context,
          viewport: viewport
        });

        await renderTask.promise;
        if (isMounted) {
          setPdfLoaded(true);
          setPdfLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          console.warn("PDF.js render notice:", err.message);
          setPdfError(err.message);
          setPdfLoaded(false);
          setPdfLoading(false);
        }
      }
    }

    renderPdf();

    return () => {
      isMounted = false;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {}
      }
    };
  }, [pdfUrl, currentPage, zoom]);

  if (!document) {
    return (
      <div className="w-full h-96 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center p-8 text-center text-slate-500">
        <FileText className="w-12 h-12 text-slate-300 mb-3" />
        <h3 className="text-sm font-bold text-slate-700">No Document Selected</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-sm">
          Select a processed document to view interactive spatial regions and bounding box overlays.
        </p>
      </div>
    );
  }

  const handleZoomIn = () => setZoom(prev => Math.min(150, prev + 10));
  const handleZoomOut = () => setZoom(prev => Math.max(70, prev - 10));
  const handleResetZoom = () => setZoom(100);

  // Filter button types including formula
  const filterOptions = ['all', 'heading', 'text', 'table', 'formula', 'figure'];

  const getBBoxColorClasses = (type, isSelected, isDegraded) => {
    if (isDegraded) {
      return isSelected 
        ? 'border-red-600 bg-red-500/25 ring-4 ring-red-500/50 z-30'
        : 'border-dashed border-red-500 bg-red-500/15 hover:ring-2 hover:ring-red-400 z-10';
    }

    switch (type) {
      case 'heading':
        return isSelected 
          ? 'border-rose-900 bg-rose-900/20 ring-4 ring-rose-900/40 z-30' 
          : 'border-rose-900 bg-rose-900/10 hover:ring-2 hover:ring-rose-900/30 z-10';
      case 'table':
        return isSelected 
          ? 'border-emerald-600 bg-emerald-500/20 ring-4 ring-emerald-500/40 z-30' 
          : 'border-emerald-600 bg-emerald-500/10 hover:ring-2 hover:ring-emerald-500/30 z-10';
      case 'formula':
        return isSelected 
          ? 'border-purple-600 bg-purple-500/25 ring-4 ring-purple-600/40 z-30' 
          : 'border-purple-600 bg-purple-500/15 hover:ring-2 hover:ring-purple-600/30 z-10';
      case 'figure':
        return isSelected 
          ? 'border-amber-600 bg-amber-500/20 ring-4 ring-amber-500/40 z-30' 
          : 'border-amber-600 bg-amber-500/10 hover:ring-2 hover:ring-amber-500/30 z-10';
      default:
        return isSelected 
          ? 'border-blue-600 bg-blue-500/20 ring-4 ring-blue-500/40 z-30' 
          : 'border-blue-600 bg-blue-500/10 hover:ring-2 hover:ring-blue-500/30 z-10';
    }
  };

  const getBadgeBg = (type) => {
    switch (type) {
      case 'heading': return 'bg-rose-900 text-white';
      case 'table': return 'bg-emerald-700 text-white';
      case 'formula': return 'bg-purple-700 text-white';
      case 'figure': return 'bg-amber-600 text-white';
      default: return 'bg-blue-700 text-white';
    }
  };

  const canvasWidth = (800 * zoom) / 100;
  const canvasHeight = (1100 * zoom) / 100;

  return (
    <div className="bg-slate-100/90 border border-slate-200 rounded-2xl p-4 flex flex-col h-full shadow-xs space-y-3">
      {/* Top Toolbar Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs">
        {/* Filter BBoxes including formula */}
        <div className="flex items-center space-x-1 overflow-x-auto">
          <span className="text-xs font-bold text-slate-400 mr-2">Filter BBoxes:</span>
          {filterOptions.map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold capitalize transition-all ${
                filterType === type 
                  ? type === 'formula' ? 'bg-purple-700 text-white shadow-xs' : 'bg-rose-900 text-white shadow-xs' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {type === 'formula' ? 'Formula (LaTeX)' : type}
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
        {Array.from({ length: Math.min(8, totalPages) }).map((_, i) => {
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

      {/* Center Panel: Real PDF Canvas with Bounding Box Overlays */}
      <div className="flex-1 overflow-auto flex justify-center items-start p-4 min-h-[550px] bg-slate-200/70 rounded-xl border border-slate-300/80 relative">
        <div 
          className="relative bg-white rounded-lg shadow-xl overflow-hidden border border-slate-300 transition-all duration-150"
          style={{
            width: `${canvasWidth}px`,
            minHeight: `${canvasHeight}px`
          }}
        >
          {/* Real PDF Canvas (rendered via PDF.js) */}
          <canvas
            ref={canvasRef}
            className={`block transition-opacity duration-200 ${pdfLoaded ? 'opacity-100' : 'opacity-0'}`}
            style={{
              width: `${canvasWidth}px`,
              height: `${canvasHeight}px`
            }}
          />

          {/* Fallback mock/rendered background when PDF binary is not actively streaming */}
          {!pdfLoaded && (
            <div 
              className="absolute inset-0 p-8 flex flex-col justify-between bg-white select-none"
              style={{ minHeight: `${canvasHeight}px` }}
            >
              <div className="border-b border-slate-200 pb-3 flex justify-between items-center text-xs text-slate-400 font-mono">
                <span>RETRIEVA SPATIAL CANVAS</span>
                <span>{document.title}</span>
              </div>

              {pdfLoading && (
                <div className="flex items-center justify-center space-x-2 text-rose-900 py-12">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-xs font-bold">Rendering PDF page with PDF.js...</span>
                </div>
              )}

              {/* Render structured text blocks if PDF canvas is not loaded */}
              {!pdfLoading && (
                <div className="space-y-4 my-auto">
                  {currentSegments.slice(0, 5).map((seg, i) => (
                    <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700">
                      <div className="font-bold text-slate-900 mb-1">{seg.label || `Segment ${i + 1}`}</div>
                      <div className="line-clamp-2">{seg.text}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-slate-200 pt-3 text-[10px] text-slate-400 font-mono text-center">
                Page {currentPage} of {totalPages} • Retrieva Document Intelligence Engine
              </div>
            </div>
          )}

          {/* Interactive Bounding Box Overlay Layer */}
          <div className="absolute inset-0 pointer-events-none">
            {currentSegments.map((segment, index) => {
              const isSelected = activeSegmentId === segment.id;
              const isFilteredOut = filterType !== 'all' && segment.type !== filterType;

              if (isFilteredOut) return null;

              const isDegraded = segment.isDegraded || segment.is_degraded;
              const readingOrder = segment.readingOrder ?? segment.reading_order ?? index + 1;
              const colorClasses = getBBoxColorClasses(segment.type, isSelected, isDegraded);
              const badgeBg = getBadgeBg(segment.type);

              // Map normalized 800x1100 coordinates to percentage
              const bbox = segment.bbox || { x: 50, y: 50 + index * 100, width: 700, height: 80 };
              const leftPct = (bbox.x / 800) * 100;
              const topPct = (bbox.y / 1100) * 100;
              const widthPct = (bbox.width / 800) * 100;
              const heightPct = (bbox.height / 1100) * 100;

              return (
                <div
                  key={segment.id || index}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSegment(segment.id);
                  }}
                  className={`absolute pointer-events-auto border-2 rounded-lg cursor-pointer transition-all duration-150 group ${colorClasses}`}
                  style={{
                    left: `${Math.max(0, Math.min(95, leftPct))}%`,
                    top: `${Math.max(0, Math.min(95, topPct))}%`,
                    width: `${Math.min(100 - leftPct, widthPct)}%`,
                    height: `${Math.min(100 - topPct, heightPct)}%`
                  }}
                  title={`[#${readingOrder}] ${segment.type}: ${segment.label || segment.text?.substring(0, 30)}`}
                >
                  {/* Floating Tag Badge with Reading Order & Type */}
                  <div className="absolute -top-3.5 left-2 z-40 flex items-center space-x-1 shadow-xs">
                    <span className="text-[9px] font-mono font-extrabold bg-slate-950 text-white px-1.5 py-0.5 rounded">
                      #{readingOrder}
                    </span>
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wide flex items-center gap-1 ${badgeBg}`}>
                      {segment.type === 'formula' && <Variable className="w-2.5 h-2.5" />}
                      {segment.type}
                    </span>
                    {isDegraded && (
                      <span className="bg-red-600 text-white text-[9px] px-1 py-0.5 rounded font-bold flex items-center">
                        <ShieldAlert className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>

                  {/* Hover tooltip for quick spatial telemetry */}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-1 right-1 bg-slate-950/90 text-white text-[9px] font-mono px-1.5 py-0.5 rounded pointer-events-none z-50">
                    Conf: {segment.calibratedConfidence ? `${(segment.calibratedConfidence * 100).toFixed(0)}%` : `${((segment.confidence || 0.95) * 100).toFixed(0)}%`}
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
