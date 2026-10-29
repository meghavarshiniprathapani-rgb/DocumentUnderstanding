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
  Hash
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { PageHeader } from '../components/common/PageHeader';
import { api, isDemoMode } from '../services/api';

export const UploadPage = ({ setActiveTab, onUploadComplete }) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [processingState, setProcessingState] = useState('idle'); // idle, processing, completed
  const [progress, setProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(1);
  const [extractionResult, setExtractionResult] = useState(null);

  // Drag & Drop Handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const validateAndSetFile = (file) => {
    setErrorMessage(null);
    if (!file) return;

    // Frontend file type validation
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setErrorMessage(`Invalid file format: "${file.name}". Please upload a PDF document.`);
      setSelectedFile(null);
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setErrorMessage(`File size exceeds 50MB limit: ${(file.size / (1024 * 1024)).toFixed(1)}MB.`);
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    setProcessingState('idle');
    setExtractionResult(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setErrorMessage(null);
    setProcessingState('idle');
    setProgress(0);
    setActiveStep(1);
    setExtractionResult(null);
  };

  const handleStartProcessing = async () => {
    if (!selectedFile) return;
    setProcessingState('processing');
    setProgress(15);
    setActiveStep(1);
    setErrorMessage(null);

    try {
      const result = await api.uploadDocument(selectedFile, (pct) => {
        setProgress(pct);
        if (pct < 40) {
          setActiveStep(1);
        } else if (pct < 85) {
          setActiveStep(2);
        } else {
          setActiveStep(3);
        }
      });

      setProgress(100);
      setActiveStep(3);
      setProcessingState('completed');
      setExtractionResult(result);

      if (onUploadComplete) {
        onUploadComplete(result.title || selectedFile.name, result.document_id);
      }
    } catch (err) {
      setProcessingState('idle');
      setErrorMessage(err.message || 'Extraction failed. Please ensure the backend is running at Settings URL.');
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      {/* 1. Page Header */}
      <PageHeader
        title="Upload Documents"
        description="Upload PDF documents for spatial layout analysis, reading order recovery, and vector indexing."
        icon={UploadCloud}
        onBack={() => setActiveTab && setActiveTab('dashboard')}
      />

      {isDemoMode() && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-amber-900 text-xs">
          <span className="font-semibold">Demo Mode Active: Ingestion running against local mock simulation.</span>
          <span className="font-mono text-[11px] bg-amber-100 px-2 py-0.5 rounded">offline-demo</span>
        </div>
      )}

      {/* 2. Drag & Drop Upload Zone (Empty / Initial State) */}
      {!selectedFile && processingState === 'idle' && (
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
              Drag and drop your PDF here
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              or browse files from your device
            </p>

            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
              <label className="cursor-pointer bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-xs flex items-center space-x-2">
                <UploadCloud className="w-4 h-4" />
                <span>Browse Files</span>
                <input
                  type="file"
                  accept="application/pdf"
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
              <span>Maximum file size: <strong className="text-slate-600">50 MB</strong></span>
            </div>
          </div>

          {/* Validation Error State Message */}
          {errorMessage && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 flex items-start justify-between animate-fade-in shadow-xs">
              <div className="flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-rose-900 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Upload Error</div>
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
        </div>
      )}

      {/* 3. Selected File Preview State */}
      {selectedFile && processingState === 'idle' && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-6 animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
              <FileText className="w-5 h-5 text-rose-900" />
              <span>Selected Document Ready</span>
            </h3>
            <Badge variant="burgundy" size="sm">PDF Validated</Badge>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3.5">
              <div className="p-3 bg-rose-900 text-white rounded-xl shadow-xs">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">{selectedFile.name}</div>
                <div className="text-xs text-slate-500 mt-0.5 flex items-center space-x-2">
                  <span>File Type: <strong className="text-slate-700">PDF Document</strong></span>
                  <span>•</span>
                  <span>Size: <strong className="text-slate-700">{formatFileSize(selectedFile.size)}</strong></span>
                </div>
              </div>
            </div>

            <button
              onClick={handleRemoveFile}
              className="px-3 py-1.5 text-xs font-semibold text-rose-900 hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors flex items-center space-x-1 self-start sm:self-auto"
            >
              <X className="w-3.5 h-3.5" />
              <span>Remove File</span>
            </button>
          </div>

          {/* Action Button */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <p className="text-xs text-slate-500">
              Extraction will run real PyMuPDF layout analysis, reading order recovery, and FAISS indexing.
            </p>

            <button
              onClick={handleStartProcessing}
              className="w-full sm:w-auto px-6 py-3 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center space-x-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>Upload & Run Extraction Pipeline</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Processing Status */}
      {processingState === 'processing' && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6 animate-fade-in text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 mx-auto flex items-center justify-center animate-pulse">
            <RefreshCw className="w-7 h-7 animate-spin" />
          </div>

          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              Executing Document Extraction Pipeline...
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Extracting bounding boxes, recovering reading order, and calibrating confidence for <strong>{selectedFile?.name}</strong>.
            </p>
          </div>

          {/* Progress Bar */}
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

          {/* Step indicators */}
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

      {/* 5. Completed State */}
      {processingState === 'completed' && extractionResult && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6 animate-fade-in">
          {/* Banner */}
          {extractionResult.is_degraded ? (
            <div className="flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-4 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-950">
              <div className="p-3 bg-amber-600 text-white rounded-xl shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h3 className="text-sm font-extrabold">Document Parsed with Degraded Mode Active</h3>
                <p className="text-xs text-amber-800 mt-0.5">
                  Anomalies detected in reading order or structural confidence. Inspection recommended before retrieval.
                </p>
              </div>
              <Badge variant="warning" size="sm" className="shrink-0">Degraded Path</Badge>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950">
              <div className="p-3 bg-emerald-600 text-white rounded-xl shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h3 className="text-sm font-extrabold">Document Successfully Parsed & Indexed!</h3>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Real multi-modal extraction generated structural bounding regions for <strong>{extractionResult.title || selectedFile?.name}</strong>.
                </p>
              </div>
              <Badge variant="success" size="sm" className="shrink-0">Complete</Badge>
            </div>
          )}

          {/* Results Summary Grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Actual Extraction Statistics
              </h4>
              {extractionResult.file_hash && (
                <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
                  <Hash className="w-3 h-3" />
                  {extractionResult.file_hash.substring(0, 16)}...
                </span>
              )}
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-lg font-extrabold text-slate-900">{extractionResult.pages_count || 1}</div>
                <div className="text-[10px] text-slate-500 font-semibold">Total Pages</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-lg font-extrabold text-slate-900">{extractionResult.metrics?.text_blocks ?? 0}</div>
                <div className="text-[10px] text-slate-500 font-semibold">Text Segments</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-lg font-extrabold text-slate-900">{extractionResult.metrics?.headings ?? 0}</div>
                <div className="text-[10px] text-slate-500 font-semibold">Headings</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-lg font-extrabold text-emerald-700">{extractionResult.metrics?.tables ?? 0}</div>
                <div className="text-[10px] text-slate-500 font-semibold">Tables Found</div>
              </div>
              <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
                <div className="text-lg font-extrabold text-rose-900">{typeof extractionResult.parsing_accuracy === 'number' ? extractionResult.parsing_accuracy.toFixed(1) : extractionResult.parsing_accuracy}%</div>
                <div className="text-[10px] text-rose-800 font-semibold">Calibrated Score</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              onClick={handleRemoveFile}
              className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors"
            >
              Upload Another Document
            </button>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <button
                onClick={() => setActiveTab && setActiveTab('viewer')}
                className="w-full sm:w-auto px-5 py-2.5 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center space-x-1.5"
              >
                <Eye className="w-4 h-4" />
                <span>View in Bounding Box Canvas</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
