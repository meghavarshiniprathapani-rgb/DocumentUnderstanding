import React, { useState, useEffect } from 'react';
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
  FileQuestion,
  CheckSquare,
  Square,
  Sparkles
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { PageHeader } from '../components/common/PageHeader';
import { EmptyState } from '../components/common/EmptyState';
import { api } from '../services/api';

export const LibraryPage = ({ 
  setActiveTab, 
  setSelectedDocId, 
  selectedDocIds = [], 
  setSelectedDocIds = () => {} 
}) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [viewMode, setViewMode] = useState('grid');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function fetchDocs() {
      try {
        const docs = await api.listDocuments();
        if (isMounted) setDocuments(docs || []);
      } catch (err) {
        console.warn("Failed to load documents in LibraryPage:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    fetchDocs();
    return () => { isMounted = false; };
  }, []);

  const filteredDocs = documents.filter(doc => {
    const matchesName = (doc.title || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                        (doc.category || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesStatus = true;
    if (statusFilter === 'Processed') {
      matchesStatus = doc.status === 'Processed' && !doc.isDegraded;
    } else if (statusFilter === 'Degraded') {
      matchesStatus = doc.isDegraded;
    }

    return matchesName && matchesStatus;
  });

  const toggleSelectDoc = (docId) => {
    setSelectedDocIds(prev => 
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  };

  const handleSelectAll = () => {
    if (selectedDocIds.length === filteredDocs.length && filteredDocs.length > 0) {
      setSelectedDocIds([]);
    } else {
      setSelectedDocIds(filteredDocs.map(d => d.id));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteDocument(deleteTarget.id);
      setDocuments(prev => prev.filter(d => d.id !== deleteTarget.id));
      setSelectedDocIds(prev => prev.filter(id => id !== deleteTarget.id));
    } catch (err) {
      console.error("Failed to delete document:", err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleSearchSelected = () => {
    if (setActiveTab) setActiveTab('search');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in relative pb-16">
      <PageHeader
        title="Documents Library"
        description="Manage, multi-select, and inspect real processed PDF documents in the FAISS vector repository."
        icon={FolderKanban}
        onBack={() => setActiveTab && setActiveTab('dashboard')}
        action={
          <button
            onClick={() => setActiveTab('upload')}
            className="bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-xs flex items-center space-x-2 cursor-pointer"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Batch Upload</span>
          </button>
        }
      />

      {selectedDocIds.length > 0 && (
        <div className="p-4 bg-rose-900 text-white rounded-2xl shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center space-x-2.5 text-xs font-bold">
            <span className="w-6 h-6 rounded-full bg-white text-rose-900 flex items-center justify-center font-extrabold text-[11px]">
              {selectedDocIds.length}
            </span>
            <span>Document{selectedDocIds.length > 1 ? 's' : ''} Selected for Cross-Document Query</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setSelectedDocIds([])}
              className="px-3 py-1.5 bg-rose-800 hover:bg-rose-950 text-rose-100 text-xs font-semibold rounded-lg transition-colors"
            >
              Deselect All
            </button>
            <button
              onClick={handleSearchSelected}
              className="px-4 py-1.5 bg-white text-rose-900 hover:bg-rose-50 text-xs font-bold rounded-lg transition-all shadow-xs flex items-center space-x-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Search Selected Documents</span>
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Filter repository documents by title or category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 text-slate-900 text-xs pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-rose-900 focus:outline-none"
            />
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1.5">
              <span className="text-xs text-slate-500 font-semibold">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-50 text-slate-900 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900"
              >
                <option value="All">All Statuses</option>
                <option value="Processed">Processed (Normal)</option>
                <option value="Degraded">Degraded Mode</option>
              </select>
            </div>

            <div className="h-5 w-px bg-slate-200"></div>

            <button
              onClick={handleSelectAll}
              className="px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 rounded-xl flex items-center space-x-1.5 cursor-pointer"
            >
              {selectedDocIds.length === filteredDocs.length && filteredDocs.length > 0 ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5 text-rose-900" />
                  <span>Deselect All</span>
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5 text-slate-400" />
                  <span>Select All</span>
                </>
              )}
            </button>

            <div className="h-5 w-px bg-slate-200"></div>

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

      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <div>
          Showing <span className="font-extrabold text-slate-900">{filteredDocs.length}</span> of {documents.length} repository documents
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-bold">
            FAISS Sub-corpus Index Active
          </span>
        </div>
      </div>

      {filteredDocs.length === 0 && !loading && (
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

      {filteredDocs.length > 0 && (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredDocs.map((doc) => {
              const isSelected = selectedDocIds.includes(doc.id);
              return (
                <div 
                  key={doc.id} 
                  className={`bg-white border rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4 transition-all group ${
                    isSelected ? 'border-rose-900 ring-2 ring-rose-900/10 shadow-md' : 'border-slate-200/90 hover:border-rose-300'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2.5">
                        <button
                          type="button"
                          onClick={() => toggleSelectDoc(doc.id)}
                          className="p-1 text-slate-400 hover:text-rose-900 cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-rose-900" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-300 group-hover:text-slate-400" />
                          )}
                        </button>
                        <div className="p-2 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl">
                          <FileText className="w-4 h-4" />
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <Badge variant={doc.isDegraded ? 'warning' : 'success'} size="sm">
                          {doc.isDegraded ? 'Degraded' : (doc.status || 'Processed')}
                        </Badge>
                      </div>
                    </div>

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
                      <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                        ID: {doc.id}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-center text-xs">
                      <div>
                        <div className="font-extrabold text-slate-900">{doc.pagesCount || doc.pages_count || 1}</div>
                        <div className="text-[10px] text-slate-400 font-semibold">Pages</div>
                      </div>
                      <div>
                        <div className="font-extrabold text-emerald-700">{doc.metrics?.tables ?? 0}</div>
                        <div className="text-[10px] text-slate-400 font-semibold">Tables</div>
                      </div>
                      <div>
                        <div className="font-extrabold text-rose-900 font-mono">
                          {typeof doc.parsingAccuracy === 'number' ? doc.parsingAccuracy.toFixed(1) : (doc.parsingAccuracy || 99.0)}%
                        </div>
                        <div className="text-[10px] text-slate-400 font-semibold">Accuracy</div>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
                      <span>Uploaded: {doc.uploadedAt || '2026-09-20'}</span>
                      <span>{doc.fileSize || '1.2 MB'}</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <button
                      onClick={() => setDeleteTarget(doc)}
                      className="p-2 text-rose-700 hover:bg-rose-50 rounded-lg transition-colors flex items-center space-x-1 cursor-pointer"
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
                      className="px-3.5 py-1.5 bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold rounded-lg transition-all shadow-xs flex items-center space-x-1.5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>View Page</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="pb-3 pr-2 w-8"></th>
                  <th className="pb-3 pr-4">Document Name</th>
                  <th className="pb-3 px-3">Pages</th>
                  <th className="pb-3 px-3">Upload Date</th>
                  <th className="pb-3 px-3">Processing Status</th>
                  <th className="pb-3 pl-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocs.map((doc) => {
                  const isSelected = selectedDocIds.includes(doc.id);
                  return (
                    <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3.5 pr-2">
                        <button
                          type="button"
                          onClick={() => toggleSelectDoc(doc.id)}
                          className="text-slate-400 hover:text-rose-900 cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-rose-900" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300" />
                          )}
                        </button>
                      </td>

                      <td className="py-3.5 pr-4 font-extrabold text-slate-900 flex items-center space-x-2.5">
                        <FileText className="w-4 h-4 text-rose-900 shrink-0" />
                        <span className="truncate max-w-xs">{doc.title}</span>
                      </td>

                      <td className="py-3.5 px-3 font-semibold text-slate-700">
                        {doc.pagesCount || doc.pages_count || 1} pages
                      </td>

                      <td className="py-3.5 px-3 font-mono text-[11px] text-slate-500">
                        {doc.uploadedAt || '2026-09-20'}
                      </td>

                      <td className="py-3.5 px-3">
                        <Badge variant={doc.isDegraded ? 'warning' : 'success'} size="sm">
                          {doc.isDegraded ? 'Degraded' : (doc.status || 'Processed')}
                        </Badge>
                      </td>

                      <td className="py-3.5 pl-3 text-right space-x-2">
                        <button
                          onClick={() => setDeleteTarget(doc)}
                          className="p-1.5 text-rose-700 hover:bg-rose-50 rounded-lg transition-colors inline-flex items-center cursor-pointer"
                          title="Delete Document"
                        >
                          <Trash2 className="w-4 h-4 text-rose-700" />
                        </button>

                        <button
                          onClick={() => {
                            setSelectedDocId(doc.id);
                            setActiveTab('viewer');
                          }}
                          className="px-3 py-1.5 bg-rose-900 hover:bg-rose-950 text-white text-xs font-bold rounded-lg transition-colors inline-flex items-center space-x-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

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
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-600">
              <p>
                Are you sure you want to permanently delete <strong className="text-slate-900 font-bold">"{deleteTarget.title}"</strong>?
              </p>
              <p className="text-slate-500">
                This will purge all vector chunk embeddings from the FAISS index and remove the stored PDF from disk.
              </p>
            </div>

            <div className="pt-2 flex items-center justify-end space-x-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center space-x-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleting ? 'Deleting...' : 'Delete Document'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
