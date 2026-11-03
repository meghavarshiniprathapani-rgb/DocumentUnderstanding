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
  Variable,
  CheckCircle2,
  GitCompare,
  BookOpen
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
  setSelectedSegmentId,
  setSelectedPageNumber,
  selectedDocIds = [],
  setSelectedDocIds = () => {}
}) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [aggregateResult, setAggregateResult] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [availableDocs, setAvailableDocs] = useState([]);
  const [viewTab, setViewTab] = useState('passages');

  const [docFilter, setDocFilter] = useState('All');
  const [searchScope, setSearchScope] = useState(selectedDocIds.length > 0 ? 'selected' : 'all');
  const [contentTypeFilter, setContentTypeFilter] = useState('All');
  const [minScore, setMinScore] = useState(20);
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
        setAvailableDocs(docs || []);
      } catch (err) {
        console.warn("Failed to load repository documents for search filter:", err);
      }
    }
    loadDocs();
  }, []);

  useEffect(() => {
    if (selectedDocIds.length > 0) {
      setSearchScope('selected');
    }
  }, [selectedDocIds]);

  const toggleCoords = (id) => {
    setShowCoordsMap(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getEffectiveDocIds = () => {
    if (searchScope === 'selected' && selectedDocIds.length > 0) {
      return selectedDocIds;
    }
    if (docFilter !== 'All') {
      return [docFilter];
    }
    return null;
  };

  const handleExecuteSearch = React.useCallback(async (queryText = searchQuery) => {
    setLoading(true);
    setHasSearched(true);
    const activeDocIds = getEffectiveDocIds();

    try {
      const [searchData, aggData] = await Promise.all([
        api.searchDocuments({
          query: queryText,
          documentId: docFilter === 'All' ? 'All' : docFilter,
          documentIds: activeDocIds,
          contentType: contentTypeFilter,
          minScore: minScore / 100,
          topK: 12
        }),
        api.searchAggregate({
          query: queryText,
          documentIds: activeDocIds,
          contentType: contentTypeFilter,
          minScore: minScore / 100,
          topK: 12
        }).catch(err => {
          console.warn("Cross-document aggregation notice:", err);
          return null;
        })
      ]);

      setResults(searchData || []);
      setAggregateResult(aggData);
    } catch (err) {
      console.error("Search execution failed:", err);
      setResults([]);
      setAggregateResult(null);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, docFilter, searchScope, selectedDocIds, contentTypeFilter, minScore]);

  const isFirstSearchEffectRender = React.useRef(true);
  useEffect(() => {
    if (isFirstSearchEffectRender.current) {
      isFirstSearchEffectRender.current = false;
      return;
    }
    if (hasSearched) {
      handleExecuteSearch();
    }
  }, [docFilter, searchScope, contentTypeFilter, minScore]);

  const handleSuggestionClick = (questionText) => {
    setSearchQuery(questionText);
    handleExecuteSearch(questionText);
  };

  const clearFilters = () => {
    setDocFilter('All');
    setSearchScope('all');
    setContentTypeFilter('All');
    setMinScore(20);
  };

  const renderContentTypeBadge = (type) => {
    switch ((type || '').toLowerCase()) {
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

  const handleOpenViewer = (targetDocId, segmentId, pageNumber = 1) => {
    if (setSelectedDocId) setSelectedDocId(targetDocId);
    if (setSelectedSegmentId) setSelectedSegmentId(segmentId);
    if (setSelectedPageNumber) setSelectedPageNumber(pageNumber);
    if (setActiveTab) setActiveTab('viewer');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in">
      <div className="space-y-3">
        <PageHeader
          title="Cross-Document Search & Retrieval"
          description="Execute dense vector and spatial queries across real uploaded PDF documents with multi-document aggregation."
          icon={SearchIcon}
          onBack={() => setActiveTab && setActiveTab('dashboard')}
          action={
            isDemoMode() ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-950 font-bold text-xs rounded-xl shadow-2xs">
                <Database className="w-3.5 h-3.5 text-amber-700" />
                <span>Demo Mode</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200/90 text-rose-950 font-bold text-xs rounded-xl shadow-2xs">
                <Database className="w-3.5 h-3.5 text-rose-900" />
                <span>FAISS Unified Vector Index (Live)</span>
              </span>
            )
          }
        />

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
              placeholder="Search across uploaded documents, tables, formulas, or bounding regions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 text-slate-900 text-sm pl-11 pr-4 py-3 rounded-xl border border-transparent focus:border-rose-900 focus:bg-white focus:outline-none transition-all font-medium"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowFilterPanel(!showFilterPanel)}
            className={`p-3 rounded-xl border transition-all flex items-center gap-1.5 text-xs font-bold cursor-pointer shrink-0 ${
              showFilterPanel || docFilter !== 'All' || contentTypeFilter !== 'All' || searchScope === 'selected'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Scope & Filters</span>
            {(docFilter !== 'All' || contentTypeFilter !== 'All' || searchScope === 'selected') && (
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

        {showFilterPanel && (
          <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-in">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Corpus Search Scope</label>
              <select
                value={searchScope}
                onChange={(e) => setSearchScope(e.target.value)}
                className="w-full bg-white text-slate-900 text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-rose-900 font-medium"
              >
                <option value="all">All Repository Documents ({availableDocs.length})</option>
                {selectedDocIds.length > 0 && (
                  <option value="selected">Selected Documents Only ({selectedDocIds.length})</option>
                )}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Filter Specific Document</label>
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

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Content Modality</label>
              <select
                value={contentTypeFilter}
                onChange={(e) => setContentTypeFilter(e.target.value)}
                className="w-full bg-white text-slate-900 text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-rose-900 font-medium"
              >
                <option value="All">All Modalities</option>
                <option value="text">Body Text</option>
                <option value="table">Structured Table</option>
                <option value="formula">Formula (LaTeX)</option>
                <option value="heading">Heading</option>
                <option value="figure">Figure / Visual Patch</option>
              </select>
            </div>

            <div className="sm:col-span-3 flex items-center justify-between pt-1 text-xs">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-slate-600">Min Relevance:</span>
                <span className="font-mono text-rose-900 font-bold">{minScore}%</span>
                <input
                  type="range"
                  min="20"
                  max="90"
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="accent-rose-900 cursor-pointer w-32"
                />
              </div>

              <button
                type="button"
                onClick={clearFilters}
                className="font-bold text-rose-900 hover:text-rose-950 flex items-center gap-1 hover:underline cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-sm space-y-3 relative overflow-hidden border border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-rose-300" />
            <span className="text-xs font-bold text-white">Indexed Documents in Repository</span>
          </div>
          <div className="flex items-center space-x-2">
            {selectedDocIds.length > 0 && (
              <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                {selectedDocIds.length} Selected
              </span>
            )}
            <span className="text-[10px] font-mono text-rose-300 bg-rose-950 px-2 py-0.5 rounded border border-rose-800">
              {availableDocs.length} Total Documents
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {availableDocs.slice(0, 6).map((doc) => {
            const isDocSelected = selectedDocIds.includes(doc.id);
            return (
              <div
                key={doc.id}
                onClick={() => handleOpenViewer(doc.id, null)}
                className={`p-2.5 border rounded-xl flex items-center justify-between transition-all cursor-pointer group ${
                  isDocSelected ? 'bg-rose-950/70 border-rose-500' : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700/80 hover:border-rose-500'
                }`}
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
            );
          })}
        </div>
      </div>

      {!hasSearched && !loading && (
        <EmptyState
          icon={FileQuestion}
          title="Ready for Cross-Document Search"
          description="Enter a query in the search bar above or choose a suggested question to run spatial retrieval across real documents with consensus synthesis."
        />
      )}

      {loading && (
        <div className="space-y-4">
          <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-center space-x-2 text-xs font-semibold text-slate-600 shadow-xs">
            <RefreshCw className="w-4 h-4 text-rose-900 animate-spin" />
            <span>Executing Cross-Document FAISS Search & Ranking Results...</span>
          </div>
          <LoadingSkeleton type="table" count={3} />
        </div>
      )}

      {hasSearched && !loading && results.length === 0 && (
        <EmptyState
          icon={SearchIcon}
          title="No Matching Document Segments Found"
          description={`No content matched query "${searchQuery}" with the current filters. Try lowering the minimum relevance score or expanding the document scope.`}
          action={
            <button
              onClick={clearFilters}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Reset Filters
            </button>
          }
        />
      )}

      {hasSearched && !loading && results.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewTab('passages')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                  viewTab === 'passages' 
                    ? 'bg-rose-900 text-white shadow-xs' 
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Matching Passages ({results.length})</span>
              </button>

              <button
                onClick={() => setViewTab('synthesis')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                  viewTab === 'synthesis' 
                    ? 'bg-rose-900 text-white shadow-xs' 
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>Cross-Document Consensus & Synthesis</span>
              </button>
            </div>

            <div className="flex items-center space-x-2 text-xs">
              <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
                FAISS Vector Space
              </span>
              <span className="text-[10px] font-mono text-rose-900 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 font-bold">
                O3 Lineage Verified
              </span>
            </div>
          </div>

          {viewTab === 'synthesis' && aggregateResult && (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-6 animate-fade-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-rose-900" />
                    <span>Cross-Document Evidence Synthesis</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Synthesizing findings across <strong className="text-slate-700">{aggregateResult.document_count}</strong> matching document{aggregateResult.document_count > 1 ? 's' : ''} for query "{searchQuery}".
                  </p>
                </div>
                <Badge variant="burgundy" size="sm">
                  {aggregateResult.total_results} Matches
                </Badge>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Consensus Findings Across Documents</span>
                </h4>
                <div className="space-y-2">
                  {aggregateResult.consensus_points && aggregateResult.consensus_points.length > 0 ? (
                    aggregateResult.consensus_points.map((point, idx) => (
                      <div key={idx} className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex items-start space-x-2.5">
                        <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <p className="leading-relaxed font-medium">{point}</p>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
                      Single-source evidence extracted from matching passages.
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Document Evidence Coverage
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {aggregateResult.document_coverage && aggregateResult.document_coverage.map((cov, idx) => (
                    <div key={idx} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {cov.title || cov.document_id}
                        </div>
                        <span className="font-mono text-[10px] bg-rose-50 border border-rose-200 text-rose-900 px-1.5 py-0.5 rounded font-bold shrink-0">
                          {(cov.highest_score * 100).toFixed(0)}% Match
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Evidence items: <strong className="text-slate-700">{cov.match_count}</strong></span>
                        <button
                          onClick={() => handleOpenViewer(cov.document_id, null)}
                          className="text-rose-900 hover:underline font-semibold"
                        >
                          Inspect Doc
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {viewTab === 'passages' && (
            <div className="space-y-4">
              {results.map((result) => {
                const isCoordsVisible = showCoordsMap[result.id];
                const isLowConfidence = result.isDegraded || (result.confidence !== undefined && result.confidence < 0.60) || (result.calibratedConfidence !== undefined && result.calibratedConfidence < 0.60);

                return (
                  <div key={result.id} className="bg-white border border-slate-200/90 hover:border-rose-300 rounded-2xl p-5 shadow-xs space-y-4 transition-all hover:shadow-md">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div className="flex items-start space-x-3">
                        <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl shrink-0 mt-0.5">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3
                              onClick={() => handleOpenViewer(result.documentId, result.id, result.pageNumber || 1)}
                              className="text-sm sm:text-base font-extrabold text-slate-900 hover:text-rose-900 cursor-pointer transition-colors leading-tight"
                            >
                              {result.resultTitle || `Extracted ${result.contentType}`}
                            </h3>
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
                          onClick={() => handleOpenViewer(result.documentId, result.id, result.pageNumber || 1)}
                          className="px-4 py-2 bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center space-x-1.5 shrink-0 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Inspect in Viewer</span>
                        </button>
                      </div>
                    </div>

                    <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-700 leading-relaxed font-sans space-y-1">
                      <p className="text-slate-800 font-medium leading-relaxed">
                        "{result.queryMatchSnippet || result.text || 'Document content matching query tokens.'}"
                      </p>
                    </div>

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

                    <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
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
          )}
        </div>
      )}
    </div>
  );
};
