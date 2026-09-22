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
  Info,
  RefreshCw,
  FileQuestion
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

  const exampleQuestions = [
    "What was the revenue in Q3?",
    "Find the table containing financial results.",
    "Show the section about project objectives."
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
        return <Badge variant="table" size="sm" className="flex items-center gap-1"><TableIcon className="w-3 h-3 text-emerald-700" /> Table</Badge>;
      case 'image':
      case 'figure':
        return <Badge variant="figure" size="sm" className="flex items-center gap-1"><ImageIcon className="w-3 h-3 text-amber-700" /> Image</Badge>;
      case 'heading':
        return <Badge variant="heading" size="sm" className="flex items-center gap-1"><Heading className="w-3 h-3 text-rose-800" /> Heading</Badge>;
      default:
        return <Badge variant="text" size="sm" className="flex items-center gap-1"><FileText className="w-3 h-3 text-blue-700" /> Text</Badge>;
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-fade-in">
      {/* 1. Page Header */}
      <PageHeader
        title="Search & Retrieval"
        description="Ask questions and explore relevant document content using multi-modal layout search."
        icon={SearchIcon}
      />

      {/* 2. Large Modern Search Input Box */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); handleExecuteSearch(); }}>
          <div className="relative flex items-center">
            <SearchIcon className="w-5 h-5 absolute left-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ask a question about your documents..."
              className="w-full bg-slate-50 hover:bg-white focus:bg-white text-slate-900 text-sm pl-11 pr-36 py-3.5 rounded-xl border border-slate-200 focus:border-rose-900 focus:ring-2 focus:ring-rose-900/10 transition-all outline-none"
            />
            
            <div className="absolute right-2.5 flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setShowFilterPanel(!showFilterPanel)}
                className={`p-2 rounded-lg text-xs font-semibold border transition-all flex items-center space-x-1 ${
                  showFilterPanel || docFilter !== 'All' || contentTypeFilter !== 'All'
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
                className="bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all shadow-xs flex items-center space-x-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Search</span>
              </button>
            </div>
          </div>
        </form>

        {/* Question Suggestion Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-slate-400 font-semibold flex items-center gap-1 mr-1">
            <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
            Suggested:
          </span>
          {exampleQuestions.map((q, idx) => (
            <button
              key={idx}
              onClick={() => handleSuggestionClick(q)}
              className="bg-slate-100 hover:bg-rose-50 hover:text-rose-900 hover:border-rose-200 text-slate-700 text-[11px] font-medium px-3 py-1 rounded-full border border-slate-200 transition-all"
            >
              "{q}"
            </button>
          ))}
        </div>

        {/* 3. Filter Panel (Frontend-only controls) */}
        {showFilterPanel && (
          <div className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
            {/* Document Filter */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Document</label>
              <select
                value={docFilter}
                onChange={(e) => setDocFilter(e.target.value)}
                className="w-full bg-slate-50 text-slate-900 text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-rose-900"
              >
                <option value="All">All Documents</option>
                {MOCK_DOCUMENTS.map((doc) => (
                  <option key={doc.id} value={doc.title}>
                    {doc.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Content Type Selector */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Content Type</label>
              <select
                value={contentTypeFilter}
                onChange={(e) => setContentTypeFilter(e.target.value)}
                className="w-full bg-slate-50 text-slate-900 text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-rose-900"
              >
                <option value="All">All Types (Text, Table, Image, Heading)</option>
                <option value="Text">Text</option>
                <option value="Table">Table</option>
                <option value="Image">Image</option>
                <option value="Heading">Heading</option>
              </select>
            </div>

            {/* Page Range Input */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Page Range</label>
              <input
                type="text"
                placeholder="e.g. 1-10 or All"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                className="w-full bg-slate-50 text-slate-900 text-xs p-2 rounded-lg border border-slate-200 focus:outline-none focus:border-rose-900"
              />
            </div>

            {/* Relevance Threshold Slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>Min Relevance:</span>
                <span className="font-mono text-rose-900">{minScore}%</span>
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
          </div>
        )}
      </div>

      {/* Sample Data Disclaimer Banner */}
      <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between shadow-xs">
        <div className="flex items-center space-x-2">
          <Info className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            <strong>Frontend Service Layer:</strong> Relevance scores and snippet matches use simulated vector search metrics for UI testing.
          </span>
        </div>
        <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-300 uppercase shrink-0 hidden sm:inline-block">
          Sample Data
        </span>
      </div>

      {/* 5. States Rendering */}

      {/* A) Initial Empty Search State */}
      {!hasSearched && !loading && (
        <EmptyState
          icon={FileQuestion}
          title="Ready to Explore Document Intelligence"
          description="Enter a search question above or click one of the suggested query chips to see layout-aware spatial retrieval in action."
        />
      )}

      {/* B) Loading State */}
      {loading && (
        <div className="space-y-4">
          <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-center space-x-2 text-xs font-semibold text-slate-600">
            <RefreshCw className="w-4 h-4 text-rose-900 animate-spin" />
            <span>Simulating Vector Cosine Distance & Spatial Bounding Box Ranking...</span>
          </div>
          <LoadingSkeleton type="table" count={3} />
        </div>
      )}

      {/* C) No Results State */}
      {hasSearched && !loading && results.length === 0 && (
        <EmptyState
          icon={SearchIcon}
          title="No Matching Document Segments Found"
          description={`No content matched your query "${searchQuery}" with the current filters. Try lowering the relevance threshold or clearing category filters.`}
          action={
            <button
              onClick={clearFilters}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
            >
              Reset Filters
            </button>
          }
        />
      )}

      {/* D) Search Results State */}
      {hasSearched && !loading && results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <div>
              Found <span className="font-extrabold text-slate-900">{results.length}</span> mock results for "{searchQuery || 'All Content'}"
            </div>
            <span className="text-[11px] font-mono text-rose-900 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
              FAISS Ranker Simulated
            </span>
          </div>

          <div className="space-y-4">
            {results.map((result) => {
              const isCoordsVisible = showCoordsMap[result.id];
              return (
                <div key={result.id} className="bg-white border border-slate-200 hover:border-rose-300 rounded-2xl p-5 shadow-xs space-y-4 transition-all">
                  {/* Header Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start space-x-3">
                      <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl shrink-0 mt-0.5">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 
                          onClick={() => {
                            setSelectedDocId(result.documentId);
                            setSelectedSegmentId(result.id);
                            setActiveTab('viewer');
                          }}
                          className="text-sm font-extrabold text-slate-900 hover:text-rose-900 cursor-pointer transition-colors"
                        >
                          {result.resultTitle}
                        </h3>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-xs font-bold text-slate-700">{result.documentTitle}</span>
                          <span className="text-slate-300">•</span>
                          <span className="text-xs text-slate-500 font-medium">Page {result.pageNumber}</span>
                          <span className="text-slate-300">•</span>
                          {renderContentTypeBadge(result.contentType)}
                        </div>
                      </div>
                    </div>

                    {/* Score Gauge & View Button */}
                    <div className="flex items-center space-x-4 justify-end">
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                          Relevance Score
                        </div>
                        <div className="text-sm font-extrabold text-rose-900 font-mono">
                          {(result.relevanceScore * 100).toFixed(1)}%
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setSelectedDocId(result.documentId);
                          setSelectedSegmentId(result.id);
                          setActiveTab('viewer');
                        }}
                        className="px-3.5 py-2 bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center space-x-1.5 shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View Page</span>
                      </button>
                    </div>
                  </div>

                  {/* Content Preview Snippet */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 text-xs text-slate-700 leading-relaxed font-sans">
                    <span className="font-bold text-slate-900 mr-2">[Snippet Preview]</span>
                    {result.queryMatchSnippet}
                  </div>

                  {/* Table Grid Preview if result is table content type */}
                  {result.tableData && (
                    <div className="border border-emerald-200 rounded-xl overflow-hidden bg-emerald-50/20">
                      <div className="px-3 py-2 bg-emerald-100/60 border-b border-emerald-200 text-xs font-bold text-emerald-950 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <TableIcon className="w-3.5 h-3.5 text-emerald-700" />
                          Parsed Table Grid Preview
                        </span>
                        <span className="text-[10px] font-mono text-emerald-800">Structured Data</span>
                      </div>
                      <div className="overflow-x-auto p-3">
                        <table className="w-full text-xs text-left">
                          <thead>
                            <tr className="border-b border-emerald-200 text-emerald-900 font-bold">
                              {result.tableData.headers.map((h, i) => (
                                <th key={i} className="pb-2 pr-4">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-emerald-100 text-slate-700 font-mono">
                            {result.tableData.rows.map((row, i) => (
                              <tr key={i}>
                                {row.map((cell, j) => (
                                  <td key={j} className="py-2 pr-4">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Bounding Box Coordinates Toggle */}
                  <div className="pt-1 flex items-center justify-between text-xs">
                    <button
                      onClick={() => toggleCoords(result.id)}
                      className="text-slate-500 hover:text-rose-900 font-semibold flex items-center space-x-1"
                    >
                      <Layers className="w-3.5 h-3.5 text-slate-400" />
                      <span>{isCoordsVisible ? 'Hide Spatial Coordinates' : 'Show Spatial Bounding Box [x, y, w, h]'}</span>
                    </button>

                    {result.highlights && (
                      <div className="flex items-center space-x-1.5">
                        {result.highlights.map((h, i) => (
                          <span key={i} className="text-[10px] bg-rose-50 text-rose-950 px-2 py-0.5 rounded font-mono font-semibold border border-rose-200">
                            {h}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {isCoordsVisible && (
                    <div className="p-3 bg-slate-950 text-emerald-400 font-mono text-[11px] rounded-xl overflow-x-auto border border-slate-800 shadow-inner">
                      <div>// 2D Spatial Layout Region Geometry</div>
                      <div>
                        {`{"x": ${result.boundingRegion.x}, "y": ${result.boundingRegion.y}, "width": ${result.boundingRegion.width}, "height": ${result.boundingRegion.height}, "page": ${result.pageNumber}}`}
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
