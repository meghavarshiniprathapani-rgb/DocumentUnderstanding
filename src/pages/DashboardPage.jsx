import React from 'react';
import { 
  FileText, 
  Layers, 
  Search, 
  UploadCloud, 
  Eye, 
  ArrowRight, 
  Sparkles, 
  Database,
  CheckCircle2,
  Clock,
  Info,
  HelpCircle,
  FileCheck,
  Zap,
  Tag
} from 'lucide-react';
import { StatCard } from '../components/common/StatCard';
import { Badge } from '../components/common/Badge';
import { MOCK_OVERVIEW_METRICS, MOCK_DOCUMENTS } from '../mockData/documentsData';

export const DashboardPage = ({ setActiveTab, setSelectedDocId }) => {
  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-fade-in">
      {/* Sample Data Alert / System Banner */}
      <div className="bg-amber-50/80 border border-amber-200/90 rounded-2xl p-3.5 px-4 flex items-center justify-between text-xs text-amber-900 shadow-xs">
        <div className="flex items-center space-x-2.5">
          <Info className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            <strong className="font-bold">Demonstration Environment:</strong> Displaying simulated sample data for frontend UI/UX evaluation. AI backend integration ready.
          </span>
        </div>
        <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300 uppercase shrink-0 hidden sm:inline-block">
          Sample Data Mode
        </span>
      </div>

      {/* 1. Overview Cards (4 Cards) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-slate-900 flex items-center space-x-2">
            <Layers className="w-5 h-5 text-rose-900" />
            <span>System Performance Overview</span>
          </h2>
          <span className="text-xs text-slate-400 font-medium">Updated just now</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Documents"
            value={MOCK_OVERVIEW_METRICS.totalDocuments}
            subtext="Indexed PDF files in database"
            icon={FileText}
            accent={true}
          />
          <StatCard
            title="Pages Processed"
            value={MOCK_OVERVIEW_METRICS.pagesProcessed}
            subtext="OCR & layout extracted pages"
            icon={FileCheck}
            trend="up"
            trendValue="+14%"
          />
          <StatCard
            title="Search Queries"
            value={MOCK_OVERVIEW_METRICS.searchQueries}
            subtext="Multi-modal spatial queries"
            icon={Search}
            trend="up"
            trendValue="+28%"
          />
          <StatCard
            title="Indexed Regions"
            value={MOCK_OVERVIEW_METRICS.indexedRegions}
            subtext="2D bounding boxes stored"
            icon={Database}
          />
        </div>
      </div>

      {/* 2. Quick Actions (Two Prominent Cards) */}
      <div className="space-y-3">
        <h2 className="text-base font-extrabold text-slate-900">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Action 1: Upload New Document */}
          <div className="bg-gradient-to-br from-white to-rose-50/40 border border-slate-200/90 hover:border-rose-300 rounded-2xl p-6 shadow-xs transition-all duration-200 flex flex-col justify-between space-y-4 group">
            <div className="space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-rose-900 text-white flex items-center justify-center shadow-md shadow-rose-900/20 group-hover:scale-105 transition-transform">
                <UploadCloud className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-extrabold text-slate-900 group-hover:text-rose-900 transition-colors">
                Upload New Document
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Ingest enterprise PDF files into the spatial layout engine to parse text blocks, tables, figures, and bounding box coordinates.
              </p>
            </div>
            <button
              onClick={() => setActiveTab('upload')}
              className="w-full py-3 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center space-x-2"
            >
              <span>Upload Document</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Action 2: Search Documents */}
          <div className="bg-gradient-to-br from-white to-slate-100/60 border border-slate-200/90 hover:border-slate-300 rounded-2xl p-6 shadow-xs transition-all duration-200 flex flex-col justify-between space-y-4 group">
            <div className="space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
                <Search className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-extrabold text-slate-900 group-hover:text-rose-900 transition-colors">
                Search Documents
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Perform semantic, spatial coordinate, and visual table queries across all processed documents with relevance score rankings.
              </p>
            </div>
            <button
              onClick={() => setActiveTab('search')}
              className="w-full py-3 bg-slate-900 hover:bg-slate-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center justify-center space-x-2"
            >
              <span>Explore Search & Retrieval</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Recent Documents Table */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">Recent Documents</h3>
            <p className="text-xs text-slate-500">Processed PDF documents available in repository</p>
          </div>
          <button 
            onClick={() => setActiveTab('library')}
            className="text-xs font-bold text-rose-900 hover:text-rose-700 flex items-center space-x-1 self-start sm:self-auto"
          >
            <span>View Complete Library</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Responsive Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="pb-3 pr-4">Document Name</th>
                <th className="pb-3 px-3">File Type</th>
                <th className="pb-3 px-3">Pages</th>
                <th className="pb-3 px-3">Processing Status</th>
                <th className="pb-3 px-3">Date Added</th>
                <th className="pb-3 pl-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {MOCK_DOCUMENTS.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50/80 transition-colors">
                  {/* Document Name */}
                  <td className="py-3.5 pr-4 font-bold text-slate-900 flex items-center space-x-3">
                    <div className="p-2 bg-rose-50 border border-rose-200 text-rose-900 rounded-lg shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="truncate max-w-xs">{doc.title}</div>
                      <div className="text-[10px] text-slate-400 font-normal">{doc.category}</div>
                    </div>
                  </td>

                  {/* File Type */}
                  <td className="py-3.5 px-3">
                    <span className="font-mono text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                      {doc.fileType}
                    </span>
                  </td>

                  {/* Number of Pages */}
                  <td className="py-3.5 px-3 font-semibold text-slate-700">
                    {doc.pagesCount} pages
                  </td>

                  {/* Processing Status */}
                  <td className="py-3.5 px-3">
                    <Badge 
                      variant={doc.status === 'Processed' ? 'success' : 'warning'}
                      size="sm"
                    >
                      {doc.status}
                    </Badge>
                  </td>

                  {/* Date Added */}
                  <td className="py-3.5 px-3 text-slate-500 font-mono text-[11px]">
                    {doc.uploadedAt}
                  </td>

                  {/* View Action */}
                  <td className="py-3.5 pl-3 text-right">
                    <button
                      onClick={() => {
                        setSelectedDocId(doc.id);
                        setActiveTab('viewer');
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-rose-900 hover:text-white text-slate-700 text-xs font-bold rounded-lg transition-colors inline-flex items-center space-x-1.5"
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
      </div>
    </div>
  );
};
