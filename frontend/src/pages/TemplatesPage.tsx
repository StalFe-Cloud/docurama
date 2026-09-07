import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Plus, 
  Send, 
  Copy, 
  Sparkles, 
  Clock, 
  Search, 
  Filter, 
  ChevronRight, 
  ShieldCheck, 
  Folder, 
  Tag, 
  Share2, 
  Code, 
  Check, 
  Trash2, 
  X,
  Upload,
  LayoutGrid,
  List
} from 'lucide-react';
import { api, TemplateItem, TemplateFolder } from '../lib/api';

interface TemplatesPageProps {
  onSelectTemplate: (template: TemplateItem) => void;
  onNewEnvelope: () => void;
}

export const TemplatesPage: React.FC<TemplatesPageProps> = ({
  onSelectTemplate,
  onNewEnvelope,
}) => {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [folders, setFolders] = useState<TemplateFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Folder Creation Modal
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#1D72FE');

  // Share & Embed Modal
  const [shareTemplate, setShareTemplate] = useState<TemplateItem | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, [selectedFolderId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tList, fList] = await Promise.all([
        api.listTemplates(selectedFolderId === 'all' ? undefined : selectedFolderId),
        api.listFolders()
      ]);
      setTemplates(tList);
      setFolders(fList);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await api.createFolder(newFolderName.trim(), newFolderColor);
      setNewFolderName('');
      setShowFolderModal(false);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create folder');
    }
  };

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this folder?')) return;
    try {
      await api.deleteFolder(folderId);
      if (selectedFolderId === folderId) setSelectedFolderId('all');
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete folder');
    }
  };

  const handleDropzoneClick = () => {
    onNewEnvelope();
  };

  const defaultTemplates = [
    {
      id: 'nda-standard',
      title: 'Standard Mutual Non-Disclosure Agreement (NDA)',
      description: 'Comprehensive confidentiality agreement with PAdES digital seal for cross-border IP protection.',
      fields_data: [1, 2, 3],
      roles_data: [{ name: 'Signer 1' }, { name: 'Counterparty' }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ['Legal & IP'],
      public_slug: 'mutual-nda-standard',
      is_public_shared: true,
    },
    {
      id: 'employment-contract',
      title: 'Executive Employment Offer & Master Agreement',
      description: 'Pre-configured with salary, equity vesting schedule, IP assignment, and remote work provisions.',
      fields_data: [1, 2, 3, 4],
      roles_data: [{ name: 'Candidate' }, { name: 'Hiring Manager' }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ['HR & People'],
      public_slug: 'executive-offer',
      is_public_shared: true,
    },
    {
      id: 'saas-order-form',
      title: 'Enterprise Software Subscription Order Form (MSA)',
      description: 'B2B subscription order schedule, SLA commitment, and billing authorization fields.',
      fields_data: [1, 2, 3, 4, 5],
      roles_data: [{ name: 'Customer Signer' }, { name: 'Sales Director' }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ['Sales & Revenue'],
      public_slug: 'saas-order-form',
      is_public_shared: true,
    },
    {
      id: 'consulting-sow',
      title: 'Professional Services Statement of Work (SOW)',
      description: 'Milestone deliverables schedule, acceptance criteria, and hourly rate approval.',
      fields_data: [1, 2],
      roles_data: [{ name: 'Client' }, { name: 'Lead Consultant' }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: ['Operations'],
      public_slug: 'consulting-sow',
      is_public_shared: false,
    }
  ];

  const allItems = templates.length > 0 ? templates : (defaultTemplates as unknown as TemplateItem[]);
  const filtered = allItems.filter(t => 
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    (t.description || '').toLowerCase().includes(search.toLowerCase()) ||
    (t.tags || []).some(tg => tg.toLowerCase().includes(search.toLowerCase()))
  );

  const getPublicLink = (slug?: string) => {
    const s = slug || 'form';
    return `${window.location.origin}/d/${s}`;
  };

  const getEmbedCode = (slug?: string) => {
    const link = getPublicLink(slug);
    return `<iframe src="${link}" width="100%" height="800px" frameborder="0" style="border-radius: 16px; border: 1px solid #E2E8F0;"></iframe>`;
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header Matching Production templates_dashboard/index */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center">
          {/* Toggle View Pill (Templates / Submissions) */}
          <div className="bg-[#F1F5F9] p-1 rounded-xl border border-[#E2E8F0] flex items-center space-x-1 mr-4 shrink-0">
            <button className="px-3 py-1.5 text-xs font-semibold text-[#0F172A] bg-white rounded-lg shadow-sm border border-[#E2E8F0] transition-all flex items-center space-x-1.5">
              <LayoutGrid className="w-4 h-4 text-[#1D72FE] stroke-[2.5]" />
              <span>Templates</span>
            </button>
            <a 
              href="/submissions" 
              onClick={(e) => { e.preventDefault(); window.location.pathname = '/submissions'; }}
              className="px-3 py-1.5 text-xs font-medium text-[#64748B] hover:text-[#0F172A] rounded-lg transition-all flex items-center space-x-1.5"
            >
              <List className="w-4 h-4 stroke-2" />
              <span>Submissions</span>
            </a>
          </div>

          <h1 className="text-2xl md:text-3xl font-bold truncate tracking-tight text-[#0F172A] font-heading">
            Templates
          </h1>
        </div>

        <div className="flex items-center space-x-2">
          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 text-xs w-full bg-white border border-[#E2E8F0] rounded-xl text-[#0F172A] placeholder-[#94A3B8] focus:border-[#1D72FE] shadow-sm"
            />
          </div>

          <button
            onClick={onNewEnvelope}
            className="btn btn-primary px-4 py-2 text-xs md:text-sm font-semibold gap-1.5 shadow-sm shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Create</span>
          </button>
        </div>
      </div>

      {/* Welcome Banner Matching Production */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-[#EFF6FF] via-[#F8FAFC] to-[#EFF6FF] border border-[#BFDBFE]/60 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-[#0F172A] mb-1 font-heading">Welcome to Docurama</h2>
          <p className="text-sm text-[#475569]">Create your first electronic signature workflow in seconds. Upload any PDF or document below.</p>
        </div>
        <button 
          onClick={onNewEnvelope}
          className="btn btn-primary shrink-0 shadow-md px-5 py-2.5 text-sm font-semibold gap-2"
        >
          <Plus className="w-4 h-4 stroke-2" />
          <span>Get Started</span>
        </button>
      </div>

      {/* Dropzone Matching Production */}
      <div 
        onClick={handleDropzoneClick}
        className="docurama-dropzone p-10 text-center cursor-pointer transition-all bg-white shadow-sm"
      >
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#EFF6FF] text-[#1D72FE] flex items-center justify-center mb-3">
          <Upload className="w-7 h-7 stroke-2" />
        </div>
        <h3 className="text-base font-bold text-[#0F172A] font-heading">Drag and drop your PDF here, or browse</h3>
        <p className="text-xs text-[#64748B] mt-1">Supports PDF, DOCX, XLSX documents with PAdES-LTV digital sealing</p>
      </div>

      {/* Folders & Filters Navigation Bar */}
      <div className="flex items-center justify-between gap-4 pt-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedFolderId('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 ${
              selectedFolderId === 'all'
                ? 'bg-[#1D72FE] text-white shadow-sm'
                : 'bg-white text-[#64748B] border border-[#E2E8F0] hover:text-[#0F172A]'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            All Templates
          </button>

          {folders.map(f => (
            <div key={f.id} className="relative group shrink-0">
              <button
                onClick={() => setSelectedFolderId(f.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  selectedFolderId === f.id
                    ? 'bg-[#1D72FE] text-white shadow-sm'
                    : 'bg-white text-[#64748B] border border-[#E2E8F0] hover:text-[#0F172A]'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: f.color || '#1D72FE' }} />
                {f.name}
              </button>
              <button
                onClick={(e) => handleDeleteFolder(f.id, e)}
                className="hidden group-hover:block absolute -top-1.5 -right-1.5 p-1 bg-rose-500 rounded-full text-white text-[10px]"
                title="Delete Folder"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}

          <button
            onClick={() => setShowFolderModal(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[#1D72FE] bg-[#EFF6FF] border border-[#BFDBFE] hover:bg-[#DBEAFE] flex items-center gap-1 shrink-0 transition-colors"
          >
            <Plus className="w-3 h-3 stroke-[2.5]" />
            New Folder
          </button>
        </div>
      </div>

      {/* Grid of Templates Matching Production Bento */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((item: any, i) => (
          <div
            key={item.id || i}
            className="group relative flex flex-col justify-between p-5 rounded-2xl bg-white border border-[#E2E8F0] hover:border-[#CBD5E1] hover:shadow-md transition-all shadow-sm"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center text-[#1D72FE] group-hover:scale-105 transition-transform">
                  <FileText className="w-5 h-5 stroke-2" />
                </div>
                <div className="flex items-center gap-1.5">
                  {(item.tags || []).map((tg: string) => (
                    <span key={tg} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]">
                      {tg}
                    </span>
                  ))}
                  {item.is_public_shared && (
                    <button
                      onClick={() => setShareTemplate(item)}
                      title="Share Public Link & Embed"
                      className="p-1.5 rounded-lg bg-[#EFF6FF] hover:bg-[#DBEAFE] text-[#1D72FE] transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <h3 className="text-base font-bold text-[#0F172A] group-hover:text-[#1D72FE] transition-colors font-heading">
                {item.title}
              </h3>
              <p className="mt-1.5 text-xs text-[#64748B] line-clamp-2 leading-relaxed">
                {item.description || 'Pre-configured workflow with automated signature routing and field validations.'}
              </p>
            </div>

            <div className="mt-5 pt-3 border-t border-[#F1F5F9] flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-[#64748B] text-[11px] font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>{item.roles_data?.length || 2} Signers</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShareTemplate(item)}
                  className="px-2.5 py-1 rounded-lg text-[#64748B] hover:text-[#0F172A] bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] font-medium hover:bg-[#F1F5F9] transition-colors"
                >
                  Share
                </button>
                <button
                  onClick={() => onSelectTemplate(item)}
                  className="btn btn-primary px-3 py-1 text-xs font-semibold gap-1 shadow-sm"
                >
                  <span>Use Template</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white border border-[#E2E8F0] p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2 font-heading">
                <Folder className="w-4 h-4 text-[#1D72FE]" />
                Create Template Folder
              </h3>
              <button onClick={() => setShowFolderModal(false)} className="text-[#64748B] hover:text-[#0F172A]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Folder Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Legal & Contracts"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] text-xs text-[#0F172A]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Color Marker</label>
                <div className="flex items-center gap-2">
                  {['#1D72FE', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewFolderColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${newFolderColor === c ? 'scale-125 border-slate-900' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFolderModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#64748B] hover:text-[#0F172A]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary px-4 py-2 text-xs font-semibold shadow-sm"
                >
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share & Embed Modal */}
      {shareTemplate && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white border border-[#E2E8F0] p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2 font-heading">
                <Share2 className="w-4 h-4 text-[#1D72FE]" />
                Share & Embed Blueprint
              </h3>
              <button onClick={() => setShareTemplate(null)} className="text-[#64748B] hover:text-[#0F172A]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h4 className="text-xs font-bold text-[#0F172A]">{shareTemplate.title}</h4>
              <p className="text-[11px] text-[#64748B] mt-0.5">
                Anyone with this public link can fill and cryptographically sign this form.
              </p>
            </div>

            {/* Public Link */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#334155]">Public Form URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={getPublicLink(shareTemplate.public_slug)}
                  className="flex-1 px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#1D72FE] font-mono"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(getPublicLink(shareTemplate.public_slug));
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="btn btn-primary px-3 py-2 text-xs font-semibold shadow-sm"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedLink ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Embed Snippet */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#334155] flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5 text-[#1D72FE]" />
                Embed Code (Responsive iframe)
              </label>
              <textarea
                readOnly
                rows={3}
                value={getEmbedCode(shareTemplate.public_slug)}
                className="w-full px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] text-[#475569] font-mono leading-relaxed"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(getEmbedCode(shareTemplate.public_slug));
                  setCopiedEmbed(true);
                  setTimeout(() => setCopiedEmbed(false), 2000);
                }}
                className="btn btn-white w-full py-2 text-xs font-semibold shadow-sm flex items-center justify-center gap-1.5"
              >
                {copiedEmbed ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedEmbed ? 'Snippet Copied' : 'Copy Embed Code'}
              </button>
            </div>

            <div className="pt-2 border-t border-[#F1F5F9] flex justify-end">
              <button
                onClick={() => setShareTemplate(null)}
                className="btn btn-white px-4 py-2 text-xs font-semibold"
              >
                Done
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
