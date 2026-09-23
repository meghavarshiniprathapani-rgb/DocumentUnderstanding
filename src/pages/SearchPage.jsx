import React, { useState, useEffect } from 'react';
import { 
  Search as SearchIcon, 
  Filter, 
  Sparkles, 
  FileText, 
  Table as TableIcon, 
  Eye, 
  Layers, 
  HelpCircle, 
  Heading,
  Image as ImageIcon,
  BarChart3,
  Info,
  RefreshCw,
  FileQuestion,
  Database,
  Sliders,
  Check,
  X,
  ExternalLink
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { PageHeader } from '../components/common/PageHeader';
import { EmptyState } from '../components/common/EmptyState';
import { MOCK_DOCUMENTS, mockSearchService } from '../mockData/documentsData';

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

  // Filter States
  const [docFilter, setDocFilter] = useState('All');
  const [contentTypeFilter, setContentTypeFilter] = useState('All');
  const [pageRange, setPageRange] = useState('');
  const [minScore, setMinScore] = useState(70);
  const [showCoordsMap, setShowCoordsMap] = useState({});

  // Realistic sample search queries related to document understanding, tables, layouts & semantic retrieval
  const exampleQuestions = [
    "What was the revenue growth in Q3?",
    "Find tables with financial operating profit",
    "Show LayoutLMv3 spatial bounding box architecture",
    "Zero-trust identity verification policies",
    "Multi-modal visual attention heatmaps",
    "FUNSD and CORD benchmark accuracy"
  ];

  const toggleCoords = (id) => {
    setShowCoordsMap(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExecuteSearch = async (queryText = searchQuery) => {
    setLoading(true);
    setHasSearched(true);
    try {
      const searchData = await mockSearchService({
        query: queryText,
        documentFilter: docFilter,
        contentType: contentTypeFilter,
        minScore: minScore,
        pageRange: pageRange
      });
      setResults(searchData);
    } catch (err) {
      console.error(err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasSearched) {
      handleExecuteSearch();
    }
  }, [docFilter, contentTypeFilter, minScore]);

  const handleSuggestionClick = (questionText) => {
    setSearchQuery(questionText);
    handleExecuteSearch(questionText);
  };

  const clearFilters = () => {
    setDocFilter('All');
    setContentTypeFilter('All');
    setPageRange('');
    setMinScore(70);
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
      case 'heading':
        return <Badge variant="heading" size="sm" className="flex items-center gap-1 bg-rose-50 text-rose-900 border-rose-200"><Heading className="w-3 h-3 text-rose-800" /> Heading</Badge>;
      default:
        return <Badge variant="text" size="sm" className="flex items-center gap-1 bg-slate-100 text-slate-800 border-slate-200"><FileText className="w-3 h-3 text-slate-700" /> Text</Badge>;
    }
  };

  const handleOpenViewer = (docId, segmentId) => {
    if (setSelectedDocId) setSelectedDocId(docId);
    if (setSelectedSegmentId) setSelectedSegmentId(segmentId);
    if (setActiveTab) setActiveTab('viewer');
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-fade-in">
      {/* 1. Page Header with Prototype/Mock Data Banner */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <PageHeader
            title="Search & Retrieval"
            description="Query multi-modal PDF documents using semantic search, spatial bounding box coordinates, and structural indexing."
            icon={SearchIcon}
            onBack={() => setActiveTab && setActiveTab('dashboard')}
          />

          <div className="self-start sm:self-center shrink-0">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200/90 text-rose-950 font-bold text-xs rounded-xl shadow-2xs">
              <Database className="w-3.5 h-3.5 text-rose-900" />
              <span>Prototype / Mock Data</span>
            </span>
          </div>
        </div>
      </div>

      {/* 2. Large Modern Search Input Box */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); handleExecuteSearch(); }}>
          <div className="relative flex items-center">
            <SearchIcon className="w-5 h-5 absolute left-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents by question, table data, or keywords..."
              className="w-full bg-slate-50 hover:bg-white focus:bg-white text-slate-900 text-sm pl-11 pr-36 py-3.5 rounded-xl border border-slate-200 focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 transition-all outline-none"
            />
            
            <div className="absolute right-2.5 flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setShowFilterPanel(!showFilterPanel)}
                className={`p-2 rounded-lg text-xs font-semibold border transition-all flex items-center space-x-1 ${
                  showFilterPanel || docFilter !== 'All' || contentTypeFilter !== 'All' || minScore !== 70 || pageRange !== ''
                    ? 'bg-rose-50 border-rose-200 text-rose-950 font-bold'
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-700'
                }`}
                title="Toggle Filter Panel"
              >
                <Filter className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Filters</span>
              </button>

              <button
                type="submit"
                className="bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-rose-200" />
                <span>Search</span>
              </button>
            </div>
          </div>
        </form>

        {/* Question Suggestion Chips */}
        <div className="space-y-2 pt-1">
          <div className="text-xs text-slate-400 font-bold flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-rose-900" />
            <span>Sample Search Queries (Click to test mock retrieval):</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {exampleQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(q)}
                className="bg-slate-100 hover:bg-rose-50 hover:text-rose-950 hover:border-rose-300 text-slate-700 text-[11px] font-medium px-3 py-1 rounded-full border border-slate-200 transition-all flex items-center gap-1 cursor-pointer"
              >
                <span>"{q}"</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Filter Controls Panel */}
        {showFilterPanel && (
          <div className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in bg-slate-50/70 p-4 rounded-xl border border-slate-200/80">
            {/* Document Filter */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Filter by Document</label>
              <select
                value={docFilter}
                onChange={(e) => setDocFilter(e.target.value)}
                className="w-full bg-white text-slate-900 text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-rose-900 font-medium"
              >
                <option value="All">All Sample Documents ({MOCK_DOCUMENTS.length})</option>
                {MOCK_DOCUMENTS.map((doc) => (
                  <option key={doc.id} value={doc.title}>
                    {doc.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Content / Document Type Selector */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Content / Result Type</label>
              <select
                value={contentTypeFilter}
                onChange={(e) => setContentTypeFilter(e.target.value)}
                className="w-full bg-white text-slate-900 text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-rose-900 font-medium"
              >
                <option value="All">All Types (Text, Table, Figure, Heading, Chart)</option>
                <option value="Text">Text Snippet</option>
                <option value="Table">Structured Table</option>
                <option value="Image">Figure / Image</option>
                <option value="Heading">Heading / Section</option>
                <option value="Chart">Chart / Plot</option>
              </select>
            </div>

            {/* Page Range Input */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Page Number Range</label>
              <input
                type="text"
                placeholder="e.g. 1-10 or All"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                className="w-full bg-white text-slate-900 text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-rose-900 font-medium"
              />
            </div>

            {/* Relevance Score Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>Min Relevance Threshold:</span>
                <span className="font-mono text-rose-900 font-extrabold">{minScore}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="95"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-full accent-rose-900 cursor-pointer mt-1"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-bold text-rose-900 hover:text-rose-950 flex items-center gap-1 hover:underline"
              >
                <X className="w-3.5 h-3.5" />
                Reset Search Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Sample Documents Library Bar */}
      <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-sm space-y-3 relative overflow-hidden border border-slate-800">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-rose-300" />
            <span className="text-xs font-bold text-white">Indexed Sample Documents in Prototype</span>
          </div>
          <span className="text-[10px] font-mono text-rose-300 bg-rose-950 px-2 py-0.5 rounded border border-rose-800">
            5 Documents Available
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {MOCK_DOCUMENTS.map((doc) => (
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
                  <span>{doc.category}</span>
                  <span>•</span>
                  <span>{doc.pagesCount} pages</span>
                </div>
              </div>

              <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-white shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* 5. States Rendering */}

      {/* A) Initial State (Before search) */}
      {!hasSearched && !loading && (
        <EmptyState
          icon={FileQuestion}
          title="Ready for Semantic & Layout Search"
          description="Enter a query in the search bar above or click one of the suggested sample questions to inspect multi-modal mock retrieval results."
        />
      )}

      {/* B) Loading State */}
      {loading && (
        <div className="space-y-4">
          <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-center space-x-2 text-xs font-semibold text-slate-600 shadow-xs">
            <RefreshCw className="w-4 h-4 text-rose-900 animate-spin" />
            <span>Simulating Vector Cosine Similarity & FAISS Bounding Box Ranking...</span>
          </div>
          <LoadingSkeleton type="table" count={3} />
        </div>
      )}

      {/* C) No Results State */}
      {hasSearched && !loading && results.length === 0 && (
        <EmptyState
          icon={SearchIcon}
          title="No Matching Document Segments Found"
          description={`No prototype content matched your search query "${searchQuery}" with current filter criteria. Try lowering the minimum relevance score threshold or clearing content type filters.`}
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
              Displaying <span className="font-extrabold text-slate-900">{results.length}</span> mock results for <span className="font-bold text-rose-900">"{searchQuery || 'All Content'}"</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
                Mock FAISS Index
              </span>
              <span className="text-[10px] font-mono text-rose-900 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 font-bold">
                Prototype Data
              </span>
            </div>
          </div>

          {/* Results List */}
          <div className="space-y-4">
            {results.map((result) => {
              const isCoordsVisible = showCoordsMap[result.id];
              return (
                <div key={result.id} className="bg-white border border-slate-200/90 hover:border-rose-300 rounded-2xl p-5 shadow-xs space-y-4 transition-all hover:shadow-md">
                  {/* Result Header Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-start space-x-3">
                      <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl shrink-0 mt-0.5">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 
                          onClick={() => handleOpenViewer(result.documentId, result.id)}
                          className="text-sm sm:text-base font-extrabold text-slate-900 hover:text-rose-900 cursor-pointer transition-colors leading-tight"
                        >
                          {result.resultTitle}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="text-xs font-bold text-slate-800">{result.documentTitle}</span>
                          <span className="text-slate-300">•</span>
                          <span className="text-xs text-slate-500 font-medium">Page {result.pageNumber}</span>
                          <span className="text-slate-300">•</span>
                          {renderContentTypeBadge(result.contentType)}
                          {result.category && (
                            <span className="text-[10px] bg-slate-100 text-slate-600 font-medium px-2 py-0.5 rounded">
                              {result.category}
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
                          {(result.relevanceScore * 100).toFixed(1)}%
                        </div>
                      </div>

                      <button
                        onClick={() => handleOpenViewer(result.documentId, result.id)}
                        className="px-4 py-2 bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center space-x-1.5 shrink-0 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Open Viewer</span>
                      </button>
                    </div>
                  </div>

                  {/* Text Snippet Match */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-700 leading-relaxed font-sans space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 border-b border-slate-200/60 pb-1.5 mb-1.5">
                      <span className="flex items-center gap-1 text-slate-800">
                        <Sparkles className="w-3 h-3 text-rose-900" />
                        Matched Snippet Content
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">Prototype Text Extract</span>
                    </div>
                    <p className="text-slate-800 font-medium leading-relaxed">
                      "{result.queryMatchSnippet}"
                    </p>
                  </div>

                  {/* Table Grid Preview if result is table content type */}
                  {result.tableData && (
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
                            {result.tableData.rows.map((row, i) => (
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

                  {/* Bounding Box Coordinates Toggle & Highlights */}
                  <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <button
                      onClick={() => toggleCoords(result.id)}
                      className="text-slate-600 hover:text-rose-900 font-semibold flex items-center space-x-1.5 cursor-pointer self-start sm:self-auto"
                    >
                      <Layers className="w-3.5 h-3.5 text-rose-900" />
                      <span>{isCoordsVisible ? 'Hide Bounding Box Geometry' : 'Show Spatial Bounding Box [x, y, w, h]'}</span>
                    </button>

                    {result.highlights && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 font-bold mr-1">Matched Keywords:</span>
                        {result.highlights.map((h, i) => (
                          <span key={i} className="text-[10px] bg-rose-50 text-rose-950 px-2 py-0.5 rounded font-mono font-bold border border-rose-200">
                            {h}
                          </span>
                        ))}
                      </div>
                    )}
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
                          relevance_confidence: result.relevanceScore
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
