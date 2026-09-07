import React, { useState, useEffect } from 'react';
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
  X
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
  const [newFolderColor, setNewFolderColor] = useState('#6366f1');

  // Share & Embed Modal
  const [shareTemplate, setShareTemplate] = useState<TemplateItem | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

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
      color: 'from-indigo-500/20 to-blue-500/10'
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
      color: 'from-violet-500/20 to-purple-500/10'
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
      color: 'from-cyan-500/20 to-teal-500/10'
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
      color: 'from-amber-500/20 to-orange-500/10'
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
    return `<iframe src="${link}" width="100%" height="800px" frameborder="0" style="border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);"></iframe>`;
  };

  return (
    <div className="space-y-8 pb-16">
      
      {/* Top Banner with Aceternity glow */}
      <div className="relative overflow-hidden rounded-3xl p-8 glass-card border border-white/10 bg-gradient-to-r from-indigo-950/40 via-slate-900/60 to-slate-900/40">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-400/20 text-xs font-semibold text-indigo-300 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Document Intelligence & Reusable Blueprints
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Templates Studio & Folders
            </h1>
            <p className="mt-1.5 text-sm text-slate-400 max-w-xl">
              Create, organize in folders, and publish cryptographic document packages. Shareable via public URLs and embeddable iframes with zero third-party dependencies.
            </p>
          </div>
          <button
            onClick={onNewEnvelope}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white btn-primary-glow shrink-0 shadow-lg"
          >
            <Plus className="w-4 h-4" />
            Create Blueprint
          </button>
        </div>
      </div>

      {/* Folders & Filters Navigation Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Folder pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedFolderId('all')}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shrink-0 ${
              selectedFolderId === 'all'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                : 'bg-slate-900 text-slate-400 border border-white/5 hover:text-white'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            All Templates
          </button>

          {folders.map(f => (
            <div key={f.id} className="relative group shrink-0">
              <button
                onClick={() => setSelectedFolderId(f.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                  selectedFolderId === f.id
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                    : 'bg-slate-900 text-slate-400 border border-white/5 hover:text-white'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: f.color || '#6366f1' }} />
                {f.name}
              </button>
              <button
                onClick={(e) => handleDeleteFolder(f.id, e)}
                className="hidden group-hover:block absolute -top-1.5 -right-1.5 p-1 bg-rose-600 rounded-full text-white text-[10px]"
                title="Delete Folder"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}

          <button
            onClick={() => setShowFolderModal(true)}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-3 h-3" />
            New Folder
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search templates, folders, or tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((item: any, i) => (
          <div
            key={item.id || i}
            className="group relative flex flex-col justify-between p-6 rounded-2xl glass-card border border-white/10 hover:border-indigo-500/40 transition-all shadow-lg"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-400/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex items-center gap-1.5">
                  {(item.tags || []).map((tg: string) => (
                    <span key={tg} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-white/5">
                      {tg}
                    </span>
                  ))}
                  {item.is_public_shared && (
                    <button
                      onClick={() => setShareTemplate(item)}
                      title="Share Public Link & Embed"
                      className="p-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition-colors">
                {item.title}
              </h3>
              <p className="mt-2 text-xs text-slate-400 line-clamp-2 leading-relaxed">
                {item.description || 'Pre-configured template with automated signature routing and field validations.'}
              </p>
            </div>

            <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                <span>{item.roles_data?.length || 2} Signers</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShareTemplate(item)}
                  className="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white bg-slate-900 border border-white/5 text-[11px] font-medium"
                >
                  Share
                </button>
                <button
                  onClick={() => onSelectTemplate(item)}
                  className="flex items-center gap-1 font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Use Template
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-white/10 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Folder className="w-4 h-4 text-indigo-400" />
                Create Template Folder
              </h3>
              <button onClick={() => setShowFolderModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Folder Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Legal & Contracts"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Color Marker</label>
                <div className="flex items-center gap-2">
                  {['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewFolderColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${newFolderColor === c ? 'scale-125 border-white' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFolderModal(false)}
                  className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white btn-primary-glow"
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-white/10 p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Share2 className="w-4 h-4 text-indigo-400" />
                Share & Embed Blueprint
              </h3>
              <button onClick={() => setShareTemplate(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-200">{shareTemplate.title}</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Anyone with this public link can fill and cryptographically sign this form.
              </p>
            </div>

            {/* Public Link */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300">Public Form URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={getPublicLink(shareTemplate.public_slug)}
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs text-indigo-300 font-mono"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(getPublicLink(shareTemplate.public_slug));
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="px-3 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 flex items-center gap-1.5"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedLink ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Embed Snippet */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5 text-indigo-400" />
                Embed Code (Responsive iframe)
              </label>
              <textarea
                readOnly
                rows={3}
                value={getEmbedCode(shareTemplate.public_slug)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-[11px] text-slate-400 font-mono leading-relaxed"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(getEmbedCode(shareTemplate.public_slug));
                  setCopiedEmbed(true);
                  setTimeout(() => setCopiedEmbed(false), 2000);
                }}
                className="w-full py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 flex items-center justify-center gap-1.5"
              >
                {copiedEmbed ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedEmbed ? 'Snippet Copied' : 'Copy Embed Code'}
              </button>
            </div>

            <div className="pt-2 border-t border-white/5 flex justify-end">
              <button
                onClick={() => setShareTemplate(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
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
