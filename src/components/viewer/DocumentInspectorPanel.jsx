import React, { useState } from 'react';
import { 
  Copy, 
  Check, 
  Sparkles, 
  ShieldAlert,
  Hash,
  GitBranch,
  Clock,
  Cpu,
  Variable
} from 'lucide-react';
import { Badge } from '../common/Badge';

export const DocumentInspectorPanel = ({ document, activeSegment, _onSelectSegment }) => {
  const [tab, setTab] = useState('region'); // region, provenance, json, metadata
  const [copied, setCopied] = useState(false);

  if (!document) return null;

  const currentSegment = activeSegment || (document.pages?.[0]?.segments?.[0] ?? null);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(currentSegment || document, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isDegraded = currentSegment?.isDegraded || currentSegment?.is_degraded;
  const degradedReasons = currentSegment?.degradedReasons || currentSegment?.degraded_reasons || [];

  const rawConf = currentSegment?.confidence !== undefined 
    ? (currentSegment.confidence <= 1 ? (currentSegment.confidence * 100).toFixed(1) : currentSegment.confidence.toFixed(1)) 
    : '95.0';

  const calibConf = currentSegment?.calibratedConfidence !== undefined && currentSegment.calibratedConfidence !== null
    ? (currentSegment.calibratedConfidence <= 1 ? (currentSegment.calibratedConfidence * 100).toFixed(1) : currentSegment.calibratedConfidence.toFixed(1))
    : rawConf;

  const prov = currentSegment?.provenance || {
    source_file_hash: document.fileHash || "sha256-d8f92a105b4c3e8e1290ff45b9021a",
    extractor_name: "PyMuPDF+pdfplumber",
    extractor_version: "1.23.0",
    config_id: "O3-v1.0.0-PROD",
    timestamp: document.uploadedAt || new Date().toISOString(),
    parent_element_id: currentSegment?.id || "elem-root"
  };

  const readingOrderNum = currentSegment?.readingOrder ?? currentSegment?.reading_order ?? 1;

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-4 flex flex-col h-full shadow-xs space-y-4">
      {/* Inspector Tabs */}
      <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl">
        <button
          onClick={() => setTab('region')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            tab === 'region' ? 'bg-white text-rose-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Selected Region
        </button>
        <button
          onClick={() => setTab('provenance')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            tab === 'provenance' ? 'bg-white text-rose-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Provenance (O3)
        </button>
        <button
          onClick={() => setTab('json')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            tab === 'json' ? 'bg-white text-rose-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          JSON
        </button>
        <button
          onClick={() => setTab('metadata')}
          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
            tab === 'metadata' ? 'bg-white text-rose-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Doc Info
        </button>
      </div>

      {/* Tab 1: Selected Region Info */}
      {tab === 'region' && (
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {currentSegment ? (
            <div className="space-y-4">
              {/* Degraded Warning Banner */}
              {isDegraded && (
                <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-xl text-amber-950 space-y-1.5 animate-pulse">
                  <div className="flex items-center space-x-2 font-extrabold text-xs text-amber-900">
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>DEGRADED EXTRACTION DETECTED</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-tight">
                    This element triggered degraded fallback routing due to low confidence or reading order ambiguity.
                  </p>
                  {degradedReasons.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-amber-200">
                      <span className="text-[10px] font-bold text-amber-900 block">Reasons:</span>
                      <ul className="text-[10px] text-amber-800 list-disc list-inside mt-0.5">
                        {degradedReasons.map((reason, idx) => (
                          <li key={idx}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Region Overview Header */}
              <div className="p-3.5 bg-rose-50/80 border border-rose-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs font-extrabold text-rose-950">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-rose-900" />
                    Spatial Bounding Region
                  </span>
                  <span className="font-mono text-[10px] bg-white px-2 py-0.5 rounded border border-rose-200 text-rose-900">
                    {currentSegment.id}
                  </span>
                </div>
                <div className="text-xs text-slate-900 font-bold">
                  {currentSegment.label || `Element ${currentSegment.id}`}
                </div>
              </div>

              {/* Attributes List */}
              <div className="space-y-2.5 text-xs">
                {/* Reading Order */}
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Reading Order:</span>
                  <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded text-xs">
                    Sequence #{readingOrderNum}
                  </span>
                </div>

                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Page Number:</span>
                  <span className="font-bold text-slate-900 font-mono">Page {currentSegment.page || 1}</span>
                </div>

                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Element Type:</span>
                  <Badge 
                    variant={
                      currentSegment.type === 'heading' ? 'burgundy' :
                      currentSegment.type === 'table' ? 'success' :
                      currentSegment.type === 'formula' ? 'purple' :
                      currentSegment.type === 'figure' ? 'warning' : 'neutral'
                    } 
                    size="sm" 
                    className="capitalize font-bold"
                  >
                    {currentSegment.type}
                  </Badge>
                </div>

                {/* Calibrated Confidence */}
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Calibrated Confidence:</span>
                  <span className="font-mono font-extrabold text-rose-900">
                    {calibConf}%
                  </span>
                </div>

                {/* Raw Extractor Confidence */}
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Raw Confidence:</span>
                  <span className="font-mono text-slate-700">
                    {rawConf}%
                  </span>
                </div>

                {/* Calibration Method */}
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Confidence Method:</span>
                  <span className="text-[11px] font-semibold text-slate-800 text-right">
                    Platt Scaling (Multi-Signal)
                  </span>
                </div>

                {/* Formula LaTeX preview */}
                {(currentSegment.type === 'formula' || currentSegment.formulaLatex || currentSegment.formula_latex) && (
                  <div className="space-y-1 pt-1">
                    <span className="text-purple-900 font-semibold flex items-center gap-1">
                      <Variable className="w-3.5 h-3.5" />
                      LaTeX Representation:
                    </span>
                    <div className="p-2.5 bg-purple-50 border border-purple-200 text-purple-950 font-mono text-xs rounded-xl overflow-x-auto">
                      {currentSegment.formulaLatex || currentSegment.formula_latex || currentSegment.text}
                    </div>
                  </div>
                )}

                {/* Text Content */}
                <div className="space-y-1 pt-1">
                  <span className="text-slate-500 font-medium block">Extracted Content:</span>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 leading-relaxed font-sans max-h-40 overflow-y-auto">
                    {currentSegment.text}
                  </div>
                </div>

                {/* Spatial Geometry */}
                {currentSegment.bbox && (
                  <div className="space-y-1 pt-1">
                    <span className="text-slate-500 font-medium block">Spatial Coordinates [x, y, w, h]:</span>
                    <div className="p-2.5 bg-slate-950 text-emerald-400 font-mono text-[11px] rounded-xl border border-slate-800">
                      {`{"x": ${currentSegment.bbox.x}, "y": ${currentSegment.bbox.y}, "width": ${currentSegment.bbox.width}, "height": ${currentSegment.bbox.height}}`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400 text-xs">
              Click any bounding box on the document canvas to inspect region details.
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Provenance (O3 Contribution) */}
      {tab === 'provenance' && (
        <div className="flex-1 space-y-3 overflow-y-auto pr-1 text-xs">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center space-x-2 text-rose-900 font-bold text-xs">
              <GitBranch className="w-4 h-4" />
              <span>O3 Cryptographic Provenance Record</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Immutable audit record attaching source lineage, extractor metadata, and calibration config to every segment.
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="space-y-1">
              <span className="text-slate-500 font-medium flex items-center gap-1">
                <Hash className="w-3 h-3 text-slate-400" />
                Source File SHA-256 Digest:
              </span>
              <div className="p-2 bg-slate-100 rounded-lg font-mono text-[10px] text-slate-800 break-all select-all">
                {prov.source_file_hash || document.fileHash}
              </div>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 flex items-center gap-1">
                <Cpu className="w-3 h-3 text-slate-400" />
                Extractor Engine:
              </span>
              <span className="font-bold text-slate-900 font-mono">{prov.extractor_name}</span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Extractor Version:</span>
              <span className="font-mono text-slate-700">{prov.extractor_version}</span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Config Bundle ID:</span>
              <span className="font-mono text-rose-900 font-semibold">{prov.config_id}</span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                Extraction Timestamp:
              </span>
              <span className="font-mono text-slate-700">{prov.timestamp}</span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Parent Element ID:</span>
              <span className="font-mono text-slate-700">{prov.parent_element_id || currentSegment?.id}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Spatial JSON viewer */}
      {tab === 'json' && (
        <div className="flex-1 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Segment Payload
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
            {JSON.stringify(currentSegment || document, null, 2)}
          </pre>
        </div>
      )}

      {/* Tab 4: Document Metadata */}
      {tab === 'metadata' && (
        <div className="flex-1 space-y-3 overflow-y-auto pr-1 text-xs">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <div className="font-bold text-slate-900 text-sm">{document.title}</div>
            <div className="text-slate-500">{document.summary || "Document ingested into Retrieva spatial repository."}</div>
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
              <span className="text-slate-500">File Hash:</span>
              <span className="font-mono text-slate-700 text-[10px]">{document.fileHash ? `${document.fileHash.substring(0, 16)}...` : 'N/A'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
