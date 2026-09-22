import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  ChevronLeft, 
  ChevronRight, 
  Layers, 
  Search, 
  Filter,
  CheckCircle2,
  Info
} from 'lucide-react';
import { DocumentCanvas } from '../components/viewer/DocumentCanvas';
import { DocumentInspectorPanel } from '../components/viewer/DocumentInspectorPanel';
import { MOCK_DOCUMENTS } from '../mockData/documentsData';
import { Badge } from '../components/common/Badge';

export const DocumentViewerPage = ({ selectedDocId, setSelectedDocId, selectedSegmentId, setSelectedSegmentId }) => {
  const [docId, setDocId] = useState(selectedDocId || MOCK_DOCUMENTS[0].id);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterType, setFilterType] = useState('all');
  const [activeSegmentId, setActiveSegmentId] = useState(selectedSegmentId || null);

  useEffect(() => {
    if (selectedDocId) {
      setDocId(selectedDocId);
    }
  }, [selectedDocId]);

  useEffect(() => {
    if (selectedSegmentId) {
      setActiveSegmentId(selectedSegmentId);
    }
  }, [selectedSegmentId]);

  const currentDoc = MOCK_DOCUMENTS.find(d => d.id === docId) || MOCK_DOCUMENTS[0];

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Page Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Document Selector & Title */}
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-rose-50 text-rose-900 border border-rose-200 rounded-xl shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Document Inspector</div>
            <select
              value={docId}
              onChange={(e) => {
                setDocId(e.target.value);
                setSelectedDocId(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-transparent text-sm font-extrabold text-slate-900 focus:outline-none cursor-pointer hover:text-rose-900 transition-colors"
            >
              {MOCK_DOCUMENTS.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title} ({doc.category})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Header Right: Spatial Score Badge */}
        <div className="flex items-center space-x-3 justify-end">
          <Badge variant="burgundy" size="sm">
            {currentDoc.parsingAccuracy}% Spatial Score
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
          />
        </div>

        <div className="h-full">
          <DocumentInspectorPanel
            document={currentDoc}
            activeSegmentId={activeSegmentId}
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
