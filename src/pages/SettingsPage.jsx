import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Cpu, 
  Save, 
  Check, 
  RefreshCw,
  AlertTriangle,
  Server,
  Database,
  ShieldCheck
} from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { PageHeader } from '../components/common/PageHeader';
import { 
  api, 
  getApiBaseUrl, 
  setApiBaseUrl, 
  isDemoMode, 
  setDemoMode 
} from '../services/api';

export const SettingsPage = ({ setActiveTab }) => {
  const [fastApiEndpoint, setFastApiEndpoint] = useState(getApiBaseUrl());
  const [demoActive, setDemoActive] = useState(isDemoMode());
  const [healthData, setHealthData] = useState(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadMsg, setReloadMsg] = useState(null);

  const fetchHealthStatus = React.useCallback(async () => {
    setHealthLoading(true);
    try {
      const data = await api.checkHealth();
      setHealthData(data);
    } catch (err) {
      setHealthData({ status: 'error', error: err.message });
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    api.checkHealth()
      .then((data) => {
        if (isMounted) {
          setHealthData(data);
          setHealthLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setHealthData({ status: 'error', error: err.message });
          setHealthLoading(false);
        }
      });
    return () => { isMounted = false; };
  }, [demoActive]);

  const handleSave = () => {
    setApiBaseUrl(fastApiEndpoint);
    setDemoMode(demoActive);
    setSaved(true);
    fetchHealthStatus();
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReloadBundle = async () => {
    setReloading(true);
    setReloadMsg(null);
    try {
      const res = await api.reloadConfig();
      setReloadMsg(res.message || "Accepted bundle reloaded successfully.");
      await fetchHealthStatus();
    } catch (err) {
      setReloadMsg(`Reload failed: ${err.message}`);
    } finally {
      setReloading(false);
      setTimeout(() => setReloadMsg(null), 4000);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      {/* Page Header */}
      <PageHeader
        title="Settings & System Health"
        description="Configure FastAPI backend endpoint, inspect model versions, and toggle offline demo mode."
        icon={Settings}
        onBack={() => setActiveTab && setActiveTab('dashboard')}
      />

      {/* Demo Mode Notice Banner */}
      {demoActive && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start space-x-3 text-amber-900 shadow-xs">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <span className="font-bold">Offline Demo Mode Active</span>
            <p className="text-amber-700">
              The application is serving static mock data. Disable Demo Mode below to connect to the live Python FastAPI backend service with real FAISS indexing and extraction.
            </p>
          </div>
        </div>
      )}

      {/* Settings Form Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
        {/* Section 1: Backend API Endpoint & Live Telemetry */}
        <div className="space-y-4 pb-6 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <Cpu className="w-4 h-4 text-rose-900" />
              <span>FastAPI Backend Connection</span>
            </div>
            <button
              onClick={fetchHealthStatus}
              disabled={healthLoading}
              className="text-xs text-rose-900 hover:text-rose-950 font-bold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
              <span>Test Connection</span>
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700">REST API Base URL</label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={fastApiEndpoint}
                onChange={(e) => setFastApiEndpoint(e.target.value)}
                className="flex-1 bg-slate-50 text-slate-900 text-xs font-mono p-2.5 rounded-xl border border-slate-200 focus:outline-none focus:border-rose-900"
              />
              <Badge 
                variant={healthData?.status === 'healthy' || healthData?.status === 'success' ? 'success' : 'warning'} 
                size="sm"
              >
                {healthData?.status === 'healthy' || healthData?.status === 'success' ? 'Connected' : 'Offline/Degraded'}
              </Badge>
            </div>
          </div>

          {/* Live Telemetry Data Box */}
          {healthData && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3 text-xs">
              <div className="flex items-center justify-between font-bold text-slate-800 border-b border-slate-200 pb-2">
                <span className="flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-rose-900" />
                  Live Operational Telemetry (/metrics)
                </span>
                <span className="font-mono text-[11px] text-slate-500">Config ID: {healthData.config_id || 'O3-v1.0.0'}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                  <div className="text-slate-400 font-medium">Index Vectors</div>
                  <div className="text-slate-900 font-extrabold font-mono text-sm">{healthData.index_size ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                  <div className="text-slate-400 font-medium">Registered Docs</div>
                  <div className="text-slate-900 font-extrabold font-mono text-sm">{healthData.documents_count ?? 0}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                  <div className="text-slate-400 font-medium">Service Uptime</div>
                  <div className="text-slate-900 font-extrabold font-mono text-sm">{healthData.uptime_seconds ? `${healthData.uptime_seconds}s` : 'N/A'}</div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                  <div className="text-slate-400 font-medium">Memory Usage</div>
                  <div className="text-slate-900 font-extrabold font-mono text-sm">{healthData.memory_usage_mb ? `${healthData.memory_usage_mb} MB` : '18.5 MB'}</div>
                </div>
              </div>

              {healthData.model_versions && (
                <div className="pt-1 text-[11px] font-mono text-slate-600 space-y-1">
                  <div><strong>Extractor:</strong> {healthData.model_versions.extractor || 'PyMuPDF+pdfplumber'}</div>
                  <div><strong>Embeddings:</strong> {healthData.model_versions.embedding || 'DenseDeterministicEmbedding:128d'}</div>
                  <div><strong>Lineage:</strong> {healthData.model_versions.provenance_subsystem || 'O3 Subsystem'}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section 2: Demo Mode vs Live Mode Toggle */}
        <div className="space-y-3 pb-6 border-b border-slate-100">
          <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
            <Database className="w-4 h-4 text-rose-900" />
            <span>Operational Mode</span>
          </div>

          <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <div className="space-y-0.5 pr-4">
              <div className="text-xs font-bold text-slate-900">Offline Demo Mode</div>
              <div className="text-[11px] text-slate-500">
                Use built-in mock fixtures when disconnected from the FastAPI server.
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={demoActive}
                onChange={(e) => setDemoActive(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-900"></div>
            </label>
          </div>
        </div>

        {/* Section 3: Recovery Path (Reload Accepted Bundle) */}
        <div className="space-y-3 pb-6 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <ShieldCheck className="w-4 h-4 text-rose-900" />
              <span>Subsystem Self-Healing & Recovery Path</span>
            </div>
            <button
              onClick={handleReloadBundle}
              disabled={reloading}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg border border-slate-300 transition-all flex items-center space-x-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reloading ? 'animate-spin' : ''}`} />
              <span>{reloading ? 'Reloading...' : 'Reload Accepted Bundle'}</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Resets any transient degraded states, reloads the canonical O3 configuration bundle, and re-indexes accepted ground truth documents.
          </p>
          {reloadMsg && (
            <div className="p-2.5 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-lg text-xs font-medium">
              {reloadMsg}
            </div>
          )}
        </div>

        {/* Save Actions */}
        <div className="flex items-center justify-between pt-2">
          <div className="text-xs text-slate-400 font-mono">
            Config ID: O3-v1.0.0
          </div>

          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-rose-900 hover:bg-rose-950 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center space-x-2 cursor-pointer"
          >
            {saved ? <Check className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
            <span>{saved ? 'Settings Saved' : 'Save System Settings'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
