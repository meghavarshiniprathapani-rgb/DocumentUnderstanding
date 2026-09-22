import React, { useState } from 'react';
import { 
  FileText, 
  Layers, 
  Code2, 
  Info, 
  Table as TableIcon, 
  CheckCircle2, 
  Copy, 
  Check, 
  ChevronRight,
  Sparkles,
  HelpCircle,
  Hash
} from 'lucide-react';
import { Badge } from '../common/Badge';

export const DocumentInspectorPanel = ({ document, activeSegmentId, onSelectSegment }) => {
  const [tab, setTab] = useState('region'); // region, json, metadata
  const [copied, setCopied] = useState(false);

  if (!document) return null;

  const activeSegment = document.pages?.[0]?.segments?.find(s => s.id === activeSegmentId) || document.pages?.[0]?.segments?.[0];

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(activeSegment || document, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col h-full shadow-xs space-y-4">
      {/* Right Panel Tabs */}
      <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl">
        <button
          onClick={() => setTab('region')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
            tab === 'region' ? 'bg-white text-rose-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Selected Region
        </button>
        <button
          onClick={() => setTab('json')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
            tab === 'json' ? 'bg-white text-rose-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Coordinates JSON
        </button>
        <button
          onClick={() => setTab('metadata')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
            tab === 'metadata' ? 'bg-white text-rose-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Doc Info
        </button>
      </div>

      {/* Tab 1: Selected Region Info */}
      {tab === 'region' && (
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {activeSegment ? (
            <div className="space-y-4">
              {/* Region Overview Header */}
              <div className="p-3.5 bg-rose-50/80 border border-rose-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs font-extrabold text-rose-950">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-rose-900" />
                    Selected Bounding Region
                  </span>
                  <span className="font-mono text-[10px] bg-white px-2 py-0.5 rounded border border-rose-200 text-rose-900">
                    {activeSegment.id}
                  </span>
                </div>
                <div className="text-xs text-slate-900 font-bold">
                  {activeSegment.label}
                </div>
              </div>

              {/* Attributes List */}
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Page Number:</span>
                  <span className="font-bold text-slate-900 font-mono">Page {activeSegment.page || 1}</span>
                </div>

                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Content Type:</span>
                  <Badge variant="burgundy" size="sm" className="capitalize">
                    {activeSegment.type}
                  </Badge>
                </div>

                <div className="flex justify-between py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Relevance Score (Mock):</span>
                  <span className="font-mono font-extrabold text-rose-900">
                    {activeSegment.confidence ? `${(activeSegment.confidence * 100).toFixed(1)}%` : '98.4%'}
                  </span>
                </div>

                <div className="space-y-1 pt-1">
                  <span className="text-slate-500 font-medium block">Sample Extracted Text:</span>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed font-sans">
                    {activeSegment.text}
                  </div>
                </div>

                {/* Spatial Geometry */}
                <div className="space-y-1 pt-1">
                  <span className="text-slate-500 font-medium block">Position & Dimensions [x, y, w, h]:</span>
                  <div className="p-2.5 bg-slate-950 text-emerald-400 font-mono text-[11px] rounded-xl border border-slate-800">
                    {`{"x": ${activeSegment.bbox.x}, "y": ${activeSegment.bbox.y}, "width": ${activeSegment.bbox.width}, "height": ${activeSegment.bbox.height}}`}
                  </div>
                </div>
              </div>

              {/* Sample Data Indicator */}
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-center space-x-1.5">
                <Info className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>Sample mock coordinates for demonstration.</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400 text-xs">
              Click any bounding box on the document canvas to inspect region details.
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Spatial JSON viewer */}
      {tab === 'json' && (
        <div className="flex-1 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              2D Bounding Box Payload
            </span>
            <button
              onClick={handleCopyJson}
              className="text-xs text-rose-900 hover:text-rose-700 font-semibold flex items-center space-x-1"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy JSON'}</span>
            </button>
          </div>
          <pre className="flex-1 p-3 bg-slate-950 text-emerald-400 font-mono text-[11px] rounded-xl overflow-auto border border-slate-800 leading-relaxed">
            {JSON.stringify(activeSegment || document, null, 2)}
          </pre>
        </div>
      )}

      {/* Tab 3: Document Metadata */}
      {tab === 'metadata' && (
        <div className="flex-1 space-y-3 overflow-y-auto pr-1 text-xs">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <div className="font-bold text-slate-900 text-sm">{document.title}</div>
            <div className="text-slate-500">{document.summary}</div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Category:</span>
              <Badge variant="burgundy" size="sm">{document.category}</Badge>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">File Size:</span>
              <span className="font-semibold text-slate-800">{document.fileSize}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Total Pages:</span>
              <span className="font-semibold text-slate-800">{document.pagesCount}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Parsing Accuracy:</span>
              <span className="font-mono font-extrabold text-rose-900">{document.parsingAccuracy}%</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Uploaded At:</span>
              <span className="text-slate-700">{document.uploadedAt}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
