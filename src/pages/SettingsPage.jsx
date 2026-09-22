import React, { useState } from 'react';
import { 
  Settings, 
  Cpu, 
  Save, 
  Check, 
  Sparkles
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { PageHeader } from '../components/common/PageHeader';

export const SettingsPage = () => {
  const [fastApiEndpoint, setFastApiEndpoint] = useState('http://localhost:8000/api/v1');
  const [ocrEngine, setOcrEngine] = useState('layoutlmv3');
  const [vectorDb, setVectorDb] = useState('faiss');
  const [confidenceThreshold, setConfidenceThreshold] = useState(85);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      {/* Page Header */}
      <PageHeader
        title="Settings"
        description="Configure Python FastAPI backend endpoint, OCR model parameters, and vector database indices."
        icon={Settings}
      />

      {/* Settings Form Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
        {/* Section 1: Backend API Endpoint */}
        <div className="space-y-3 pb-6 border-b border-slate-100">
          <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
            <Cpu className="w-4 h-4 text-rose-900" />
            <span>FastAPI Backend Server</span>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700">REST API Base URL</label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={fastApiEndpoint}
                onChange={(e) => setFastApiEndpoint(e.target.value)}
                className="flex-1 bg-slate-50 text-slate-900 text-xs font-mono p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900"
              />
              <Badge variant="success" size="sm">Connected</Badge>
            </div>
            <p className="text-[11px] text-slate-400">
              The frontend dispatches layout extraction and vector search queries to this Python server.
            </p>
          </div>
        </div>

        {/* Section 2: AI Model & OCR Settings */}
        <div className="space-y-3 pb-6 border-b border-slate-100">
          <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
            <Sparkles className="w-4 h-4 text-rose-900" />
            <span>Spatial Layout & OCR Engine</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700">Primary Model Architecture</label>
              <select
                value={ocrEngine}
                onChange={(e) => setOcrEngine(e.target.value)}
                className="w-full bg-slate-50 text-slate-900 text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900"
              >
                <option value="layoutlmv3">LayoutLMv3 (Text + 2D BBoxes + Vision)</option>
                <option value="paddleocr">PaddleOCR + Table Transformer</option>
                <option value="tesseract">Tesseract Optical OCR</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700">Vector Index Database</label>
              <select
                value={vectorDb}
                onChange={(e) => setVectorDb(e.target.value)}
                className="w-full bg-slate-50 text-slate-900 text-xs p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900"
              >
                <option value="faiss">FAISS (Flat L2 Index)</option>
                <option value="chromadb">ChromaDB Persistent Store</option>
                <option value="qdrant">Qdrant Vector Engine</option>
              </select>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="flex justify-between text-xs font-semibold text-slate-700">
              <span>Bounding Box Confidence Cutoff:</span>
              <span className="font-mono text-rose-900 font-bold">{confidenceThreshold}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="99"
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
              className="w-full accent-rose-900 cursor-pointer"
            />
          </div>
        </div>

        {/* Save Actions */}
        <div className="flex items-center justify-between pt-2">
          <div className="text-xs text-slate-400">
            DocuSense System v1.0.0
          </div>

          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center space-x-2"
          >
            {saved ? <Check className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
            <span>{saved ? 'Settings Saved' : 'Save System Settings'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
