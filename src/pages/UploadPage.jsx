import React, { useState } from 'react';
import { 
  UploadCloud, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Sparkles, 
  Eye, 
  RefreshCw, 
  ShieldAlert,
  Hash,
  Files,
  Trash2,
  ArrowRight,
  FolderKanban
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { PageHeader } from '../components/common/PageHeader';
import { api, isDemoMode } from '../services/api';

export const UploadPage = ({ setActiveTab, onUploadComplete }) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [processingState, setProcessingState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(1);
  const [batchResult, setBatchResult] = useState(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const validateFiles = (newFiles) => {
    setErrorMessage(null);
    if (!newFiles || newFiles.length === 0) return;

    const validated = [];
    const errors = [];

    for (const file of newFiles) {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        errors.push(`"${file.name}" is not a PDF file.`);
        continue;
      }
      if (file.size > 50 * 1024 * 1024) {
        errors.push(`"${file.name}" exceeds the 50 MB limit.`);
        continue;
      }
      if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
        continue;
      }
      validated.push(file);
    }

    if (errors.length > 0) {
      setErrorMessage(errors.join(' '));
    }

    if (validated.length > 0) {
      setSelectedFiles(prev => [...prev, ...validated]);
      setProcessingState('idle');
      setBatchResult(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      validateFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const handleRemoveFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    if (selectedFiles.length <= 1) {
      setErrorMessage(null);
      setProcessingState('idle');
      setProgress(0);
      setActiveStep(1);
      setBatchResult(null);
    }
  };

  const handleClearAllFiles = () => {
    setSelectedFiles([]);
    setErrorMessage(null);
    setProcessingState('idle');
    setProgress(0);
    setActiveStep(1);
    setBatchResult(null);
  };

  const handleStartProcessing = async () => {
    if (selectedFiles.length === 0) return;
    setProcessingState('processing');
    setProgress(15);
    setActiveStep(1);
    setErrorMessage(null);

    try {
      const result = await api.uploadBatch(selectedFiles, (pct) => {
        setProgress(pct);
        if (pct < 35) {
          setActiveStep(1);
        } else if (pct < 75) {
          setActiveStep(2);
        } else {
          setActiveStep(3);
        }
      });

      setProgress(100);
      setActiveStep(3);
      setProcessingState('completed');
      setBatchResult(result);

      if (onUploadComplete && result.items && result.items.length > 0) {
        const firstSuccess = result.items.find(i => i.status === 'success' || i.status === 'duplicate');
        if (firstSuccess) {
          onUploadComplete(firstSuccess.filename, firstSuccess.document_id);
        }
      }
    } catch (err) {
      setProcessingState('idle');
      setErrorMessage(err.message || 'Batch upload failed. Please verify that the backend service is running.');
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const totalSelectedBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-fade-in">
      <PageHeader
        title="Batch Document Upload"
        description="Upload single or multiple PDF documents for real PyMuPDF layout analysis, reading order recovery, and unified vector indexing."
        icon={UploadCloud}
        onBack={() => setActiveTab && setActiveTab('dashboard')}
        action={
          isDemoMode() ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-950 font-bold text-xs rounded-xl shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span>Demo Mode</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200/90 text-rose-950 font-bold text-xs rounded-xl shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-900" />
              <span>Multi-Document Pipeline (Live)</span>
            </span>
          )
        }
      />

      {processingState === 'idle' && (
        <div className="space-y-4">
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all duration-200 ${
              dragActive 
                ? 'border-rose-900 bg-rose-50/60 scale-[1.01] shadow-md' 
                : 'border-slate-300 bg-white hover:border-rose-800/40 hover:bg-slate-50/50 shadow-xs'
            }`}
          >
            <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 mx-auto flex items-center justify-center mb-4 shadow-xs">
              <UploadCloud className="w-8 h-8" />
            </div>

            <h3 className="text-base font-extrabold text-slate-900">
              Drag & drop multiple PDF files here
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Select multiple documents simultaneously or browse from your computer
            </p>

            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <label className="cursor-pointer bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-xs flex items-center space-x-2">
                <Files className="w-4 h-4" />
                <span>Select Multiple Files</span>
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </label>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-100 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400 font-medium">
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                Supported format: <strong className="text-slate-600">PDF</strong>
              </span>
              <span>•</span>
              <span>Batch limit: <strong className="text-slate-600">Multiple files supported</strong></span>
              <span>•</span>
              <span>Max per file: <strong className="text-slate-600">50 MB</strong></span>
            </div>
          </div>

          {errorMessage && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 flex items-start justify-between animate-fade-in shadow-xs">
              <div className="flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-rose-900 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Upload Notice</div>
                  <div className="mt-0.5 text-rose-800">{errorMessage}</div>
                </div>
              </div>
              <button 
                onClick={() => setErrorMessage(null)} 
                className="text-rose-400 hover:text-rose-900 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4 animate-fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                    <Files className="w-5 h-5 text-rose-900" />
                    <span>Staged Files for Batch Ingestion ({selectedFiles.length})</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Combined batch payload size: <strong className="text-slate-700">{formatFileSize(totalSelectedBytes)}</strong>
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleClearAllFiles}
                    className="px-3 py-1.5 text-xs font-semibold text-rose-900 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors flex items-center space-x-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All</span>
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {selectedFiles.map((file, idx) => (
                  <div key={idx} className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center space-x-3 truncate">
                      <div className="p-2 bg-rose-50 border border-rose-200 text-rose-900 rounded-lg shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <div className="text-xs font-bold text-slate-900 truncate">{file.name}</div>
                        <div className="text-[11px] text-slate-400">{formatFileSize(file.size)}</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0">
                      <Badge variant="neutral" size="sm">Ready</Badge>
                      <button
                        onClick={() => handleRemoveFile(idx)}
                        className="text-slate-400 hover:text-rose-900 p-1 transition-colors"
                        title="Remove file"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  Each file will be validated, parsed for text and tables, and indexed into FAISS.
                </p>

                <button
                  onClick={handleStartProcessing}
                  className="w-full sm:w-auto px-6 py-3 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center space-x-2"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Upload & Ingest All {selectedFiles.length} File{selectedFiles.length > 1 ? 's' : ''}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {processingState === 'processing' && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6 animate-fade-in text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 mx-auto flex items-center justify-center animate-pulse">
            <RefreshCw className="w-7 h-7 animate-spin" />
          </div>

          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              Processing Batch of {selectedFiles.length} Document{selectedFiles.length > 1 ? 's' : ''}...
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Running multi-column reading order recovery, table structure parsing, SHA-256 provenance sealing, and vector chunk indexing.
            </p>
          </div>

          <div className="max-w-md mx-auto space-y-2">
            <div className="flex justify-between text-xs font-semibold text-slate-700">
              <span>Pipeline Stage {activeStep} of 3</span>
              <span className="font-mono text-rose-900">{progress}%</span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-rose-900 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 max-w-lg mx-auto pt-2 text-xs">
            <div className={`p-2 rounded-lg border text-center ${activeStep >= 1 ? 'bg-rose-50 border-rose-200 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
              1. OCR & Parsing
            </div>
            <div className={`p-2 rounded-lg border text-center ${activeStep >= 2 ? 'bg-rose-50 border-rose-200 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
              2. Order Recovery
            </div>
            <div className={`p-2 rounded-lg border text-center ${activeStep >= 3 ? 'bg-rose-50 border-rose-200 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
              3. Vector Indexing
            </div>
          </div>
        </div>
      )}

      {processingState === 'completed' && batchResult && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950">
            <div className="p-3 bg-emerald-600 text-white rounded-xl shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="flex-1 text-center sm:text-left">
              <h3 className="text-sm font-extrabold">Batch Ingestion Completed Successfully!</h3>
              <p className="text-xs text-emerald-800 mt-0.5">
                Processed {batchResult.successful_count} of {batchResult.total_files} documents with real multi-modal extraction into the unified FAISS vector index.
              </p>
            </div>
            <Badge variant="success" size="sm" className="shrink-0">
              {batchResult.successful_count} / {batchResult.total_files} Succeeded
            </Badge>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Ingested Document Results
            </h4>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {batchResult.items.map((item, idx) => (
                <div key={idx} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-white border border-slate-200 rounded-lg text-slate-700">
                      <FileText className="w-4 h-4 text-rose-900" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">{item.filename}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                        <span>Size: {item.file_size}</span>
                        <span>•</span>
                        <span>Pages: {item.pages_count}</span>
                        <span>•</span>
                        <span>Chunks: {item.chunk_count}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {item.status === 'success' && (
                      <Badge variant="success" size="sm">Indexed & Ready</Badge>
                    )}
                    {item.status === 'duplicate' && (
                      <Badge variant="neutral" size="sm">Duplicate (Existing)</Badge>
                    )}
                    {item.status === 'failed' && (
                      <Badge variant="error" size="sm">Failed: {item.error || 'Extraction error'}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              onClick={handleClearAllFiles}
              className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors"
            >
              Upload More Documents
            </button>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <button
                onClick={() => setActiveTab && setActiveTab('library')}
                className="w-full sm:w-auto px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-colors flex items-center justify-center space-x-1.5"
              >
                <FolderKanban className="w-4 h-4" />
                <span>Go to Library</span>
              </button>
              <button
                onClick={() => setActiveTab && setActiveTab('search')}
                className="w-full sm:w-auto px-5 py-2.5 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center space-x-1.5"
              >
                <Sparkles className="w-4 h-4" />
                <span>Cross-Document Search</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
