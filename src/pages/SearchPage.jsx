import React, { useState, useEffect } from 'react';
import {
  Search as SearchIcon,
  Filter,
  Sparkles,
  FileText,
  Table as TableIcon,
  Eye,
  Layers,
  Heading,
  Image as ImageIcon,
  BarChart3,
  RefreshCw,
  FileQuestion,
  Database,
  X,
  ExternalLink,
  ShieldAlert,
  Hash,
  Variable
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { PageHeader } from '../components/common/PageHeader';
import { EmptyState } from '../components/common/EmptyState';
import { api, isDemoMode } from '../services/api';

export const SearchPage = ({
  searchQuery,
  setSearchQuery,
  setActiveTab,
  setSelectedDocId,
  setSelectedSegmentId
}) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [availableDocs, setAvailableDocs] = useState([]);

  // Filter States
  const [docFilter, setDocFilter] = useState('All');
  const [contentTypeFilter, setContentTypeFilter] = useState('All');
  const [minScore, setMinScore] = useState(40);
  const [showCoordsMap, setShowCoordsMap] = useState({});

  const exampleQuestions = [
    "What was the revenue growth in Q3?",
    "Find tables with financial operating profit",
    "Show spatial bounding box architecture",
    "Zero-trust identity verification policies",
    "Multi-modal visual attention heatmaps",
    "Benchmark accuracy on form understanding"
  ];

  useEffect(() => {
    async function loadDocs() {
      try {
        const docs = await api.listDocuments();
        setAvailableDocs(docs);
      } catch (err) {
        console.warn("Failed to load repository documents for search filter:", err);
      }
    }
    loadDocs();
  }, []);

  const toggleCoords = (id) => {
    setShowCoordsMap(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExecuteSearch = React.useCallback(async (queryText = searchQuery) => {
    setLoading(true);
    setHasSearched(true);
    try {
      const searchData = await api.searchDocuments({
        query: queryText,
        documentId: docFilter === 'All' ? 'All' : docFilter,
        contentType: contentTypeFilter,
        minScore: minScore / 100,
        topK: 12
      });
      setResults(searchData);
    } catch (err) {
      console.error("Search execution failed:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, docFilter, contentTypeFilter, minScore]);

  const isFirstSearchEffectRender = React.useRef(true);
  useEffect(() => {
    if (isFirstSearchEffectRender.current) {
      isFirstSearchEffectRender.current = false;
      return;
    }
    if (hasSearched) {
      let isMounted = true;
      api.searchDocuments({
        query: searchQuery,
        documentId: docFilter === 'All' ? 'All' : docFilter,
        contentType: contentTypeFilter,
        minScore: minScore / 100,
        topK: 12
      }).then(searchData => {
        if (isMounted) setResults(searchData);
      }).catch(err => {
        if (isMounted) {
          console.error("Search execution failed:", err);
          setResults([]);
        }
      });
      return () => { isMounted = false; };
    }
  }, [docFilter, contentTypeFilter, minScore, searchQuery, hasSearched]);

  const handleSuggestionClick = (questionText) => {
    setSearchQuery(questionText);
    handleExecuteSearch(questionText);
  };

  const clearFilters = () => {
    setDocFilter('All');
    setContentTypeFilter('All');
    setMinScore(40);
  };

  const renderContentTypeBadge = (type) => {
    switch (type.toLowerCase()) {
      case 'table':
        return <Badge variant="table" size="sm" className="flex items-center gap-1 bg-emerald-50 text-emerald-800 border-emerald-200"><TableIcon className="w-3 h-3 text-emerald-700" /> Table</Badge>;
      case 'image':
      case 'figure':
        return <Badge variant="figure" size="sm" className="flex items-center gap-1 bg-amber-50 text-amber-900 border-amber-200"><ImageIcon className="w-3 h-3 text-amber-700" /> Figure</Badge>;
      case 'chart':
        return <Badge variant="figure" size="sm" className="flex items-center gap-1 bg-purple-50 text-purple-900 border-purple-200"><BarChart3 className="w-3 h-3 text-purple-700" /> Chart</Badge>;
      case 'formula':
        return <Badge variant="formula" size="sm" className="flex items-center gap-1 bg-purple-50 text-purple-900 border-purple-200"><Variable className="w-3 h-3 text-purple-700" /> Formula</Badge>;
      case 'heading':
        return <Badge variant="heading" size="sm" className="flex items-center gap-1 bg-rose-50 text-rose-900 border-rose-200"><Heading className="w-3 h-3 text-rose-800" /> Heading</Badge>;
      default:
        return <Badge variant="text" size="sm" className="flex items-center gap-1 bg-slate-100 text-slate-800 border-slate-200"><FileText className="w-3 h-3 text-slate-700" /> Text</Badge>;
    }
  };

  const handleOpenViewer = (targetDocId, segmentId) => {
    if (setSelectedDocId) setSelectedDocId(targetDocId);
    if (setSelectedSegmentId) setSelectedSegmentId(segmentId);
    if (setActiveTab) setActiveTab('viewer');
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-fade-in">
      {/* 1. Page Header */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <PageHeader
            title="Search & Retrieval"
            description="Query multi-modal PDF documents using dense vector retrieval, spatial coordinates, and structural indexing."
            icon={SearchIcon}
            onBack={() => setActiveTab && setActiveTab('dashboard')}
          />

          <div className="self-start sm:self-center shrink-0">
            {isDemoMode() ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-950 font-bold text-xs rounded-xl shadow-2xs">
                <Database className="w-3.5 h-3.5 text-amber-700" />
                <span>Demo Mode (Offline)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200/90 text-rose-950 font-bold text-xs rounded-xl shadow-2xs">
                <Database className="w-3.5 h-3.5 text-rose-900" />
                <span>FAISS Vector Retrieval (Live API)</span>
              </span>
            )}
          </div>
        </div>

        {/* Suggested Queries */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
          <span className="text-slate-400 font-bold shrink-0 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-rose-900" />
            Try searching:
          </span>
          <div className="flex items-center space-x-2">
            {exampleQuestions.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSuggestionClick(q)}
                className="whitespace-nowrap px-3 py-1 bg-white hover:bg-rose-50 hover:border-rose-200 hover:text-rose-900 border border-slate-200 rounded-full text-slate-600 font-medium transition-all cursor-pointer shadow-2xs text-[11px]"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Main Search Bar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-3 shadow-xs space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleExecuteSearch();
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <SearchIcon className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search across documents, tables, formulas, or bounding regions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 text-slate-900 text-sm pl-11 pr-4 py-3 rounded-xl border border-transparent focus:border-rose-900 focus:bg-white focus:outline-none transition-all font-medium"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowFilterPanel(!showFilterPanel)}
            className={`p-3 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-bold cursor-pointer shrink-0 ${
              showFilterPanel || docFilter !== 'All' || contentTypeFilter !== 'All'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {(docFilter !== 'All' || contentTypeFilter !== 'All') && (
              <span className="w-2 h-2 rounded-full bg-rose-900" />
            )}
          </button>

          <button
            type="submit"
            className="px-6 py-3 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <SearchIcon className="w-4 h-4" />
            <span>Search</span>
          </button>
        </form>

        {/* 3. Collapsible Filter Panel */}
        {showFilterPanel && (
          <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-in">
            {/* Document Select */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Filter by Document</label>
              <select
                value={docFilter}
                onChange={(e) => setDocFilter(e.target.value)}
                className="w-full bg-white text-slate-900 text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-rose-900 font-medium"
              >
                <option value="All">All Documents</option>
                {availableDocs.map(d => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
            </div>

            {/* Content Type Filter */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Element Content Type</label>
              <select
                value={contentTypeFilter}
                onChange={(e) => setContentTypeFilter(e.target.value)}
                className="w-full bg-white text-slate-900 text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-rose-900 font-medium"
              >
                <option value="All">All Content Types</option>
                <option value="text">Body Text</option>
                <option value="table">Structured Table</option>
                <option value="formula">Formula (LaTeX)</option>
                <option value="heading">Heading</option>
                <option value="figure">Figure / Visual Patch</option>
              </select>
            </div>

            {/* Relevance Score Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>Min Relevance:</span>
                <span className="font-mono text-rose-900 font-extrabold">{minScore}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="90"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-full accent-rose-900 cursor-pointer mt-1"
              />
            </div>

            <div className="sm:col-span-3 flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-bold text-rose-900 hover:text-rose-950 flex items-center gap-1 hover:underline cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                Reset Search Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Repository Documents Quick Bar */}
      <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-sm space-y-3 relative overflow-hidden border border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-rose-300" />
            <span className="text-xs font-bold text-white">Indexed Documents in Repository</span>
          </div>
          <span className="text-[10px] font-mono text-rose-300 bg-rose-950 px-2 py-0.5 rounded border border-rose-800">
            {availableDocs.length} Documents Available
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {availableDocs.slice(0, 6).map((doc) => (
            <div
              key={doc.id}
              onClick={() => handleOpenViewer(doc.id, null)}
              className="p-2.5 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-rose-500 rounded-xl flex items-center justify-between transition-all cursor-pointer group"
            >
              <div className="min-w-0 pr-2">
                <div className="text-xs font-bold text-slate-100 truncate group-hover:text-rose-200 transition-colors">
                  {doc.title}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                  <span>{doc.category || "General"}</span>
                  <span>•</span>
                  <span>{doc.pagesCount || 1} pages</span>
                </div>
              </div>

              <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-white shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* 5. States Rendering */}

      {/* A) Initial State */}
      {!hasSearched && !loading && (
        <EmptyState
          icon={FileQuestion}
          title="Ready for Semantic & Layout Search"
          description="Enter a query in the search bar above or click one of the suggested sample questions to inspect multi-modal retrieval results with attached provenance."
        />
      )}

      {/* B) Loading State */}
      {loading && (
        <div className="space-y-4">
          <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-center space-x-2 text-xs font-semibold text-slate-600 shadow-xs">
            <RefreshCw className="w-4 h-4 text-rose-900 animate-spin" />
            <span>Calculating Vector Cosine Similarity & Ranking Results...</span>
          </div>
          <LoadingSkeleton type="table" count={3} />
        </div>
      )}

      {/* C) No Results State */}
      {hasSearched && !loading && results.length === 0 && (
        <EmptyState
          icon={SearchIcon}
          title="No Matching Document Segments Found"
          description={`No content matched your query "${searchQuery}" with current filter criteria. Try lowering the minimum relevance threshold.`}
          action={
            <button
              onClick={clearFilters}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Reset Search Filters
            </button>
          }
        />
      )}

      {/* D) Search Results State */}
      {hasSearched && !loading && results.length > 0 && (
        <div className="space-y-4">
          {/* Results Summary Bar */}
          <div className="flex items-center justify-between text-xs text-slate-500 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div>
              Displaying <span className="font-extrabold text-slate-900">{results.length}</span> ranked results for <span className="font-bold text-rose-900">"{searchQuery || 'All Content'}"</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
                FAISS Dense Index
              </span>
              <span className="text-[10px] font-mono text-rose-900 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 font-bold">
                O3 Provenance Verified
              </span>
            </div>
          </div>

          {/* Results List */}
          <div className="space-y-4">
            {results.map((result) => {
              const isCoordsVisible = showCoordsMap[result.id];
              const isLowConfidence = result.isDegraded || (result.confidence !== undefined && result.confidence < 0.60) || (result.calibratedConfidence !== undefined && result.calibratedConfidence < 0.60);

              return (
                <div key={result.id} className="bg-white border border-slate-200/90 hover:border-rose-300 rounded-2xl p-5 shadow-xs space-y-4 transition-all hover:shadow-md">
                  {/* Result Header Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-start space-x-3">
                      <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl shrink-0 mt-0.5">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3
                            onClick={() => handleOpenViewer(result.documentId, result.id)}
                            className="text-sm sm:text-base font-extrabold text-slate-900 hover:text-rose-900 cursor-pointer transition-colors leading-tight"
                          >
                            {result.resultTitle || `Extracted ${result.contentType}`}
                          </h3>
                          {/* Low Confidence / Degraded Badge */}
                          {isLowConfidence && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-300 font-bold text-[10px] shrink-0 animate-pulse">
                              <ShieldAlert className="w-3 h-3 text-amber-700" />
                              Low Confidence
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="text-xs font-bold text-slate-800">{result.documentTitle || result.documentId}</span>
                          <span className="text-slate-300">•</span>
                          <span className="text-xs text-slate-500 font-medium">Page {result.pageNumber || 1}</span>
                          <span className="text-slate-300">•</span>
                          {renderContentTypeBadge(result.contentType || 'text')}
                          {result.readingOrder !== undefined && (
                            <span className="text-[10px] bg-slate-100 text-slate-700 font-mono font-bold px-1.5 py-0.5 rounded">
                              Seq #{result.readingOrder}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Relevance Score Gauge & View Button */}
                    <div className="flex items-center space-x-4 justify-between sm:justify-end shrink-0 pt-2 sm:pt-0">
                      <div className="text-left sm:text-right">
                        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                          Relevance Score
                        </div>
                        <div className="text-base font-extrabold text-rose-900 font-mono">
                          {((result.relevanceScore || 0.85) * 100).toFixed(1)}%
                        </div>
                      </div>

                      <button
                        onClick={() => handleOpenViewer(result.documentId, result.id)}
                        className="px-4 py-2 bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center space-x-1.5 shrink-0 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect in Viewer</span>
                      </button>
                    </div>
                  </div>

                  {/* Text Snippet Match */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-700 leading-relaxed font-sans space-y-1">
                    <p className="text-slate-800 font-medium leading-relaxed">
                      "{result.queryMatchSnippet || result.text || 'Document content matching query tokens.'}"
                    </p>
                  </div>

                  {/* Table Grid Preview */}
                  {result.tableData && result.tableData.headers && (
                    <div className="border border-emerald-200 rounded-xl overflow-hidden bg-emerald-50/20 shadow-2xs">
                      <div className="px-3 py-2 bg-emerald-100/70 border-b border-emerald-200 text-xs font-bold text-emerald-950 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <TableIcon className="w-3.5 h-3.5 text-emerald-700" />
                          Parsed Table Grid Preview
                        </span>
                        <span className="text-[10px] font-mono text-emerald-800 font-bold bg-white px-1.5 py-0.5 rounded border border-emerald-200">
                          Structured Data
                        </span>
                      </div>
                      <div className="overflow-x-auto p-3">
                        <table className="w-full text-xs text-left">
                          <thead>
                            <tr className="border-b border-emerald-200 text-emerald-950 font-extrabold bg-emerald-50/50">
                              {result.tableData.headers.map((h, i) => (
                                <th key={i} className="py-1.5 px-3">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-emerald-100 text-slate-800 font-mono">
                            {(result.tableData.rows || []).map((row, i) => (
                              <tr key={i} className="hover:bg-emerald-50/40 transition-colors">
                                {row.map((cell, j) => (
                                  <td key={j} className="py-2 px-3">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Provenance Strip & Coordinates Toggle */}
                  <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    {/* Provenance Metadata Tags */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-bold text-slate-700">Provenance:</span>
                      {result.provenance?.source_file_hash && (
                        <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-[10px] text-slate-700 flex items-center gap-1">
                          <Hash className="w-2.5 h-2.5 text-slate-400" />
                          {result.provenance.source_file_hash.substring(0, 12)}...
                        </span>
                      )}
                      {result.provenance?.extractor_name && (
                        <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] text-slate-700">
                          {result.provenance.extractor_name}
                        </span>
                      )}
                      {result.provenance?.config_id && (
                        <span className="bg-rose-50 border border-rose-200 text-rose-900 px-2 py-0.5 rounded text-[10px] font-mono">
                          {result.provenance.config_id}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => toggleCoords(result.id)}
                      className="text-slate-600 hover:text-rose-900 font-semibold flex items-center space-x-1.5 cursor-pointer self-start sm:self-auto"
                    >
                      <Layers className="w-3.5 h-3.5 text-rose-900" />
                      <span>{isCoordsVisible ? 'Hide BBox' : 'Inspect BBox Geometry'}</span>
                    </button>
                  </div>

                  {/* Bounding Box JSON Coordinates Inspector */}
                  {isCoordsVisible && (
                    <div className="p-3.5 bg-slate-950 text-emerald-400 font-mono text-[11px] rounded-xl overflow-x-auto border border-slate-800 shadow-inner space-y-1 animate-fade-in">
                      <div className="text-slate-400 text-[10px]">// 2D Bounding Box Spatial Coordinates (Page {result.pageNumber})</div>
                      <div>
                        {JSON.stringify({
                          document_id: result.documentId,
                          page: result.pageNumber,
                          content_type: result.contentType,
                          spatial_bbox: result.boundingRegion,
                          confidence: result.confidence,
                          calibrated_confidence: result.calibratedConfidence,
                          provenance: result.provenance,
                          is_degraded: result.isDegraded
                        }, null, 2)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
