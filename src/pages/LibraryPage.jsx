import React, { useState } from 'react';
import { 
  FolderKanban, 
  Search, 
  Grid, 
  List, 
  FileText, 
  Eye, 
  Trash2, 
  UploadCloud, 
  AlertTriangle,
  X,
  FileQuestion
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { PageHeader } from '../components/common/PageHeader';
import { EmptyState } from '../components/common/EmptyState';
import { MOCK_DOCUMENTS } from '../mockData/documentsData';

export const LibraryPage = ({ setActiveTab, setSelectedDocId }) => {
  const [documents, setDocuments] = useState(MOCK_DOCUMENTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [viewMode, setViewMode] = useState('grid'); // grid or list
  const [deleteTarget, setDeleteTarget] = useState(null); // document object to delete

  // Filter documents by name and processing status
  const filteredDocs = documents.filter(doc => {
    const matchesName = doc.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        doc.category?.toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesStatus = true;
    if (statusFilter === 'Processed') {
      matchesStatus = doc.status === 'Processed';
    } else if (statusFilter === 'Processing') {
      matchesStatus = doc.status === 'Processing';
    } else if (statusFilter === 'Indexed') {
      matchesStatus = doc.status === 'Processed';
    }

    return matchesName && matchesStatus;
  });

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setDocuments(prev => prev.filter(d => d.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-fade-in relative">
      {/* 1. Page Header */}
      <PageHeader
        title="Documents Library"
        description="Manage, search, and inspect processed enterprise PDF documents in your mock repository."
        icon={FolderKanban}
        action={
          <button
            onClick={() => setActiveTab('upload')}
            className="bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-xs flex items-center space-x-2"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload Document</span>
          </button>
        }
      />

      {/* 2 & 3. Search & Filter Bar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search by Name */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search documents by name or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 text-slate-900 text-xs pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-rose-900 focus:outline-none"
            />
          </div>

          {/* Filter by Status & View Switcher */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5">
              <span className="text-xs text-slate-500 font-semibold">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-50 text-slate-900 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900"
              >
                <option value="All">All Statuses</option>
                <option value="Processed">Processed</option>
                <option value="Processing">Processing</option>
                <option value="Indexed">Indexed Only</option>
              </select>
            </div>

            <div className="h-5 w-px bg-slate-200"></div>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'grid' ? 'bg-white text-rose-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Grid View"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'list' ? 'bg-white text-rose-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="List View"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Count & Stats Banner */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <div>
          Showing <span className="font-extrabold text-slate-900">{filteredDocs.length}</span> of {documents.length} repository documents
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-bold">
            Mock Vector DB Sync
          </span>
        </div>
      </div>

      {/* 7. Empty State when no matching documents */}
      {filteredDocs.length === 0 && (
        <EmptyState
          icon={FileQuestion}
          title="No Matching Documents Found"
          description={`No document in the library matches query "${searchQuery}" with status "${statusFilter}".`}
          action={
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('All');
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
            >
              Clear Search & Filters
            </button>
          }
        />
      )}

      {/* 4 & 5. Responsive Grid / Table Layout */}
      {filteredDocs.length > 0 && (
        viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredDocs.map((doc) => (
              <div 
                key={doc.id} 
                className="bg-white border border-slate-200/90 hover:border-rose-300 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 transition-all group"
              >
                <div className="space-y-3">
                  {/* Top Badges Row */}
                  <div className="flex items-start justify-between">
                    <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl group-hover:scale-105 transition-transform">
                      <FileText className="w-5 h-5" />
                    </div>

                    <div className="flex items-center space-x-1.5">
                      <Badge variant={doc.status === 'Processed' ? 'success' : 'warning'} size="sm">
                        {doc.status}
                      </Badge>
                      <span className="text-[10px] font-mono font-bold bg-blue-50 text-blue-800 border border-blue-200 px-1.5 py-0.5 rounded">
                        Indexed
                      </span>
                    </div>
                  </div>

                  {/* Document Title & Category */}
                  <div>
                    <h3 
                      onClick={() => {
                        setSelectedDocId(doc.id);
                        setActiveTab('viewer');
                      }}
                      className="text-sm font-extrabold text-slate-900 line-clamp-1 hover:text-rose-900 cursor-pointer transition-colors"
                      title={doc.title}
                    >
                      {doc.title}
                    </h3>
                    <p className="text-xs text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                      {doc.summary || 'Enterprise document ingested for multi-modal spatial indexing.'}
                    </p>
                  </div>

                  {/* Document Metrics */}
                  <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-center text-xs">
                    <div>
                      <div className="font-extrabold text-slate-900">{doc.pagesCount}</div>
                      <div className="text-[10px] text-slate-400 font-semibold">Pages</div>
                    </div>
                    <div>
                      <div className="font-extrabold text-emerald-700">{doc.metrics?.tables || 4}</div>
                      <div className="text-[10px] text-slate-400 font-semibold">Tables</div>
                    </div>
                    <div>
                      <div className="font-extrabold text-rose-900 font-mono">{doc.parsingAccuracy || 98}%</div>
                      <div className="text-[10px] text-slate-400 font-semibold">Accuracy</div>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
                    <span>Uploaded: {doc.uploadedAt}</span>
                    <span>{doc.fileSize}</span>
                  </div>
                </div>

                {/* Frontend Actions: View, Delete */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    onClick={() => setDeleteTarget(doc)}
                    className="p-2 text-rose-700 hover:bg-rose-50 rounded-lg transition-colors flex items-center space-x-1"
                    title="Delete document"
                  >
                    <Trash2 className="w-4 h-4 text-rose-700" />
                    <span className="text-xs font-semibold">Delete</span>
                  </button>

                  <button
                    onClick={() => {
                      setSelectedDocId(doc.id);
                      setActiveTab('viewer');
                    }}
                    className="px-3.5 py-1.5 bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold rounded-lg transition-all shadow-xs flex items-center space-x-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Page</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View Table */
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="pb-3 pr-4">Document Name</th>
                  <th className="pb-3 px-3">Pages</th>
                  <th className="pb-3 px-3">Upload Date</th>
                  <th className="pb-3 px-3">Processing Status</th>
                  <th className="pb-3 px-3">Indexed Status</th>
                  <th className="pb-3 pl-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocs.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                    {/* Document Name */}
                    <td className="py-3.5 pr-4 font-extrabold text-slate-900 flex items-center space-x-2.5">
                      <FileText className="w-4 h-4 text-rose-900 shrink-0" />
                      <span className="truncate max-w-xs">{doc.title}</span>
                    </td>

                    {/* Pages */}
                    <td className="py-3.5 px-3 font-semibold text-slate-700">
                      {doc.pagesCount} pages
                    </td>

                    {/* Upload Date */}
                    <td className="py-3.5 px-3 font-mono text-[11px] text-slate-500">
                      {doc.uploadedAt}
                    </td>

                    {/* Processing Status */}
                    <td className="py-3.5 px-3">
                      <Badge variant={doc.status === 'Processed' ? 'success' : 'warning'} size="sm">
                        {doc.status}
                      </Badge>
                    </td>

                    {/* Indexed Status (Mock) */}
                    <td className="py-3.5 px-3">
                      <span className="text-[10px] font-mono font-bold bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded">
                        Vector Indexed
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 pl-3 text-right space-x-2">
                      <button
                        onClick={() => setDeleteTarget(doc)}
                        className="p-1.5 text-rose-700 hover:bg-rose-50 rounded-lg transition-colors inline-flex items-center"
                        title="Delete Document"
                      >
                        <Trash2 className="w-4 h-4 text-rose-700" />
                      </button>

                      <button
                        onClick={() => {
                          setSelectedDocId(doc.id);
                          setActiveTab('viewer');
                        }}
                        className="px-3 py-1.5 bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold rounded-lg transition-colors inline-flex items-center space-x-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Confirmation Modal Dialog for Deletion */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2 text-rose-900 font-extrabold text-sm">
                <AlertTriangle className="w-5 h-5 text-rose-900" />
                <span>Confirm Document Deletion</span>
              </div>
              <button 
                onClick={() => setDeleteTarget(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-600">
              <p>
                Are you sure you want to delete <strong className="text-slate-900 font-bold">"{deleteTarget.title}"</strong>?
              </p>
              <p className="text-slate-400">
                This action will remove the document and its 2D spatial bounding box records from the mock repository.
              </p>
            </div>

            <div className="pt-2 flex items-center justify-end space-x-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center space-x-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Document</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
