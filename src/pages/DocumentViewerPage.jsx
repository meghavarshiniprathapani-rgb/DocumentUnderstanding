import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  ArrowLeft,
  ShieldAlert,
  Loader2
} from 'lucide-react';
import { DocumentCanvas } from '../components/viewer/DocumentCanvas';
import { DocumentInspectorPanel } from '../components/viewer/DocumentInspectorPanel';
import { Badge } from '../components/common/Badge';
import { api, isDemoMode } from '../services/api';

export const DocumentViewerPage = ({ selectedDocId, setSelectedDocId, selectedSegmentId, setSelectedSegmentId, selectedPageNumber }) => {
  const [documents, setDocuments] = useState([]);
  const [docId, setDocId] = useState(selectedDocId || '');
  const [currentDoc, setCurrentDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSegments, setPageSegments] = useState([]);
  const [filterType, setFilterType] = useState('all');
  const [activeSegmentId, setActiveSegmentId] = useState(selectedSegmentId || null);
  const [prevSelectedSegmentId, setPrevSelectedSegmentId] = useState(selectedSegmentId);
  const [prevSelectedDocId, setPrevSelectedDocId] = useState(selectedDocId);
  const [prevSelectedPageNumber, setPrevSelectedPageNumber] = useState(selectedPageNumber);
  const [loading, setLoading] = useState(true);

  if (selectedSegmentId !== prevSelectedSegmentId) {
    setPrevSelectedSegmentId(selectedSegmentId);
    setActiveSegmentId(selectedSegmentId);
  }
  if (selectedDocId !== prevSelectedDocId) {
    setPrevSelectedDocId(selectedDocId);
    if (selectedDocId) setDocId(selectedDocId);
  }
  if (selectedPageNumber !== prevSelectedPageNumber) {
    setPrevSelectedPageNumber(selectedPageNumber);
    if (selectedPageNumber) setCurrentPage(selectedPageNumber);
  }

  // 1. Load document list from backend API / demo repository
  useEffect(() => {
    let isMounted = true;
    async function loadDocs() {
      try {
        const docs = await api.listDocuments();
        if (!isMounted) return;
        setDocuments(docs);
        if (docs.length > 0) {
          const targetId = selectedDocId || docs[0].id;
          setDocId(targetId);
        }
      } catch (err) {
        console.warn("Failed to load documents list:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadDocs();
    return () => { isMounted = false; };
  }, [selectedDocId]);

  // 2. Load selected document details
  useEffect(() => {
    let isMounted = true;
    if (!docId) return;

    async function loadDocDetails() {
      try {
        const doc = await api.getDocument(docId);
        if (isMounted) setCurrentDoc(doc);
      } catch (err) {
        console.warn(`Failed to fetch doc ${docId}:`, err);
      }
    }
    loadDocDetails();
    return () => { isMounted = false; };
  }, [docId]);

  // 3. Load page layout segments when document or page changes
  useEffect(() => {
    let isMounted = true;
    if (!docId) return;

    async function loadPageSegments() {
      try {
        const segs = await api.getPageLayout(docId, currentPage);
        if (!isMounted) return;
        setPageSegments(segs);
        if (selectedSegmentId && segs.length > 0) {
          const match = segs.find(s => s.id === selectedSegmentId || selectedSegmentId.includes(s.id) || s.id.includes(selectedSegmentId));
          if (match) setActiveSegmentId(match.id);
        }
      } catch (err) {
        console.warn(`Failed to fetch page segments for ${docId} page ${currentPage}:`, err);
      }
    }
    loadPageSegments();
    return () => { isMounted = false; };
  }, [docId, currentPage, selectedSegmentId]);

  const activeSegment = pageSegments.find(s => s.id === activeSegmentId) || pageSegments[0] || null;
  const pdfUrl = docId ? api.getPdfFileUrl(docId) : null;

  if (loading && !currentDoc) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex items-center space-x-3 text-rose-900">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm font-bold">Loading Document Inspector...</span>
        </div>
      </div>
    );
  }

  const effectiveAccuracy = currentDoc?.parsingAccuracy ?? currentDoc?.parsing_accuracy ?? 98.2;
  const isDocDegraded = currentDoc?.isDegraded ?? currentDoc?.is_degraded ?? false;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Page Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Back Button & Document Selector */}
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center space-x-1.5 text-xs font-bold text-slate-600 hover:text-rose-950 hover:bg-rose-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:border-rose-200 transition-all cursor-pointer group shadow-2xs shrink-0"
            title="Go Back"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform text-rose-900" />
            <span>Back</span>
          </button>

          <div className="p-2 bg-rose-50 text-rose-900 border border-rose-200 rounded-xl shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>Document Inspector</span>
              {isDemoMode() && (
                <span className="font-mono text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-bold">Demo Mode</span>
              )}
            </div>
            <select
              value={docId}
              onChange={(e) => {
                const newId = e.target.value;
                setDocId(newId);
                if (setSelectedDocId) setSelectedDocId(newId);
                setCurrentPage(1);
              }}
              className="bg-transparent text-sm font-extrabold text-slate-900 focus:outline-none cursor-pointer hover:text-rose-900 transition-colors"
            >
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title} ({doc.category})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Header Right: Degradation warning & Spatial Score Badge */}
        <div className="flex items-center space-x-3 justify-end">
          {isDocDegraded && (
            <Badge variant="warning" size="sm" className="font-bold flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Degraded Path Active</span>
            </Badge>
          )}
          <Badge variant="burgundy" size="sm" className="font-mono font-bold">
            {typeof effectiveAccuracy === 'number' ? effectiveAccuracy.toFixed(1) : effectiveAccuracy}% Spatial Score
          </Badge>
        </div>
      </div>

      {/* Main Grid: Left/Center Document Canvas (2 cols) & Right Inspector Panel (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-220px)] min-h-[660px]">
        <div className="lg:col-span-2 h-full">
          <DocumentCanvas
            document={currentDoc}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            activeSegmentId={activeSegmentId}
            onSelectSegment={(id) => {
              setActiveSegmentId(id);
              if (setSelectedSegmentId) setSelectedSegmentId(id);
            }}
            filterType={filterType}
            setFilterType={setFilterType}
            pdfUrl={pdfUrl}
            segments={pageSegments}
          />
        </div>

        <div className="h-full">
          <DocumentInspectorPanel
            document={currentDoc}
            activeSegment={activeSegment}
            onSelectSegment={(id) => {
              setActiveSegmentId(id);
              if (setSelectedSegmentId) setSelectedSegmentId(id);
            }}
          />
        </div>
      </div>
    </div>
  );
};
