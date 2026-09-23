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
  ArrowRight,
  Info
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { PageHeader } from '../components/common/PageHeader';

export const UploadPage = ({ setActiveTab, onUploadComplete }) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [processingState, setProcessingState] = useState('idle'); // idle, processing, completed
  const [progress, setProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(1);
  const [mockResults, setMockResults] = useState(null);

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
    setMockResults(null);
  };

  const handleStartProcessing = () => {
    if (!selectedFile) return;
    setProcessingState('processing');
    setProgress(10);
    setActiveStep(1);

    const timer1 = setTimeout(() => {
      setProgress(45);
      setActiveStep(2);
    }, 800);

    const timer2 = setTimeout(() => {
      setProgress(80);
      setActiveStep(3);
    }, 1600);

    const timer3 = setTimeout(() => {
      setProgress(100);
      setProcessingState('completed');
      setMockResults({
        totalPages: Math.floor(Math.random() * 25) + 10,
        textBlocks: Math.floor(Math.random() * 120) + 60,
        tablesExtracted: Math.floor(Math.random() * 8) + 2,
        indexedRegions: Math.floor(Math.random() * 400) + 150,
        accuracyScore: (97 + Math.random() * 2.5).toFixed(1)
      });
      if (onUploadComplete) {
        onUploadComplete(selectedFile.name);
      }
    }, 2400);
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
        description="Upload enterprise PDF documents for future layout analysis and intelligent retrieval."
        icon={UploadCloud}
        onBack={() => setActiveTab && setActiveTab('dashboard')}
      />

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

              <button
                type="button"
                onClick={() => {
                  validateAndSetFile(new File(["sample pdf content"], "Annual Financial Report.pdf", { type: "application/pdf" }));
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs px-4 py-2.5 rounded-xl transition-colors"
              >
                Use Sample PDF
              </button>
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
            <p className="text-xs text-slate-400">
              Click below to trigger the simulated frontend layout extraction process.
            </p>

            <button
              onClick={handleStartProcessing}
              className="w-full sm:w-auto px-6 py-3 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center space-x-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>Upload & Start Processing</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Processing Status (Simulated Loading State) */}
      {processingState === 'processing' && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6 animate-fade-in text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 mx-auto flex items-center justify-center animate-pulse">
            <RefreshCw className="w-7 h-7 animate-spin" />
          </div>

          <div>
            <h3 className="text-base font-extrabold text-slate-900">
              Simulating Document Layout Extraction...
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Parsing 2D bounding boxes, text blocks, and table structures from <strong>{selectedFile?.name}</strong>.
            </p>
          </div>

          {/* Progress Bar */}
          <div className="max-w-md mx-auto space-y-2">
            <div className="flex justify-between text-xs font-semibold text-slate-700">
              <span>Processing Step {activeStep} of 3</span>
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
              2. BBox Grounding
            </div>
            <div className={`p-2 rounded-lg border text-center ${activeStep >= 3 ? 'bg-rose-50 border-rose-200 text-rose-950 font-bold' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
              3. Vector Indexing
            </div>
          </div>

          <div className="pt-2 text-[11px] text-slate-400">
            Note: This is a frontend demonstration. No actual backend processing is occurring.
          </div>
        </div>
      )}

      {/* 5. Completed State */}
      {processingState === 'completed' && mockResults && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xs space-y-6 animate-fade-in">
          {/* Success Banner */}
          <div className="flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950">
            <div className="p-3 bg-emerald-600 text-white rounded-xl shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="flex-1 text-center sm:text-left">
              <h3 className="text-sm font-extrabold">Document Successfully Parsed & Indexed!</h3>
              <p className="text-xs text-emerald-800 mt-0.5">
                Simulated extraction generated structural bounding regions for <strong>{selectedFile?.name}</strong>.
              </p>
            </div>
            <Badge variant="success" size="sm" className="shrink-0">Mock Process Complete</Badge>
          </div>

          {/* Results Summary Grid */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Simulated Extraction Statistics
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-lg font-extrabold text-slate-900">{mockResults.totalPages}</div>
                <div className="text-[10px] text-slate-500 font-semibold">Total Pages</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-lg font-extrabold text-slate-900">{mockResults.textBlocks}</div>
                <div className="text-[10px] text-slate-500 font-semibold">Text Segments</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-lg font-extrabold text-emerald-700">{mockResults.tablesExtracted}</div>
                <div className="text-[10px] text-slate-500 font-semibold">Tables Found</div>
              </div>
              <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
                <div className="text-lg font-extrabold text-rose-900">{mockResults.accuracyScore}%</div>
                <div className="text-[10px] text-rose-800 font-semibold">Spatial Score</div>
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
                onClick={() => setActiveTab('viewer')}
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


