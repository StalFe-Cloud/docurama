import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Plus,
  Copy,
  Clock,
  Search,
  ChevronRight,
  Folder,
  Share2,
  Code,
  Check,
  X,
  Upload,
  LayoutGrid,
  List,
  Inbox
} from 'lucide-react';
import { api, TemplateItem, TemplateFolder, Envelope } from '../lib/api';
import { useToast } from '../components/ui/Toast';
import { TemplateCardSkeleton } from '../components/ui/Skeleton';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyAction,
} from '../components/ui/Empty';

interface TemplatesPageProps {
  onSelectTemplate: (template: TemplateItem) => void;
  onNewEnvelope: () => void;
  onNavigate: (tab: string) => void;
}

/**
 * Workspace home. Everything here uses the app's own tokens (warm hairlines,
 * purple as the single accent) - the page previously ran on a parallel
 * slate-blue palette that fought the shell around it.
 */
export const TemplatesPage: React.FC<TemplatesPageProps> = ({
  onSelectTemplate,
  onNewEnvelope,
  onNavigate,
}) => {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [folders, setFolders] = useState<TemplateFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [envelopeStats, setEnvelopeStats] = useState<{ total: number; pending: number; completed: number } | null>(null);

  // Folder Creation Modal
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#5645d4');

  // Share & Embed Modal
  const [shareTemplate, setShareTemplate] = useState<TemplateItem | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  const { toast } = useToast();

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
      // Quiet header stats come from the same ledger the submissions table
      // reads; failure here degrades to hiding the strip, never to an error.
      try {
        const envelopes: Envelope[] = await api.listEnvelopes();
        const pending = envelopes.filter((e) => e.status === 'sent' || e.status === 'delivered').length;
        const completed = envelopes.filter((e) => e.status === 'completed').length;
        setEnvelopeStats({ total: envelopes.length, pending, completed });
      } catch {
        setEnvelopeStats(null);
      }
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
      toast('Folder created.');
    } catch (err: any) {
      toast(err.message || 'Failed to create folder', 'error');
    }
  };

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this folder? Templates inside stay in your workspace.')) return;
    try {
      await api.deleteFolder(folderId);
      if (selectedFolderId === folderId) setSelectedFolderId('all');
      await loadData();
      toast('Folder deleted.');
    } catch (err: any) {
      toast(err.message || 'Failed to delete folder', 'error');
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

  const isFreshWorkspace = templates.length === 0;
  const allItems = isFreshWorkspace ? (defaultTemplates as unknown as TemplateItem[]) : templates;
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
    return `<iframe src="${link}" width="100%" height="800px" frameborder="0" style="border-radius: 16px; border: 1px solid #e5e3df;"></iframe>`;
  };

  return (
    <div className="space-y-6">

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center">
          {/* Workspace Switcher (Templates / Submissions) - state navigation,
              no page reload: the old version hit /submissions with a full load
              and the route did not exist, dropping people back on Templates. */}
          <div className="bg-[#f0eeec] p-1 rounded-lg border border-[#e5e3df] flex items-center gap-1 mr-4 shrink-0" role="tablist" aria-label="Workspace view">
            <button
              role="tab"
              aria-selected="true"
              className="px-3 py-1.5 text-xs font-semibold text-[#1a1a1a] bg-white rounded-md shadow-[0px_1px_2px_0px_rgba(15,15,15,0.06)] border border-[#e5e3df] transition-all flex items-center gap-1.5"
            >
              <LayoutGrid className="w-4 h-4 text-[#5645d4]" />
              <span>Templates</span>
            </button>
            <button
              role="tab"
              aria-selected="false"
              onClick={() => onNavigate('submissions')}
              className="px-3 py-1.5 text-xs font-medium text-[#787671] hover:text-[#1a1a1a] rounded-md transition-all flex items-center gap-1.5"
            >
              <List className="w-4 h-4" />
              <span>Submissions</span>
            </button>
          </div>

          <h1 className="text-2xl md:text-3xl font-semibold truncate tracking-tight text-[#1a1a1a] font-heading">
            Templates
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#a4a097] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search templates…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search templates"
              className="pl-9 pr-3 py-2 text-xs w-full bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] placeholder-[#a4a097] shadow-[0px_1px_2px_0px_rgba(15,15,15,0.04)]"
            />
          </div>

          <button
            onClick={onNewEnvelope}
            className="btn btn-primary px-4 py-2 text-xs md:text-sm font-medium gap-1.5 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Create</span>
          </button>
        </div>
      </div>

      {/* Workspace Pulse - real counts from the ledger, only once there is
          anything to count. Numbers use tabular figures so they align. */}
      {envelopeStats && envelopeStats.total > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-[#e5e3df] bg-white px-4 py-3 shadow-[0px_1px_2px_0px_rgba(15,15,15,0.04)]">
            <p className="text-[11px] font-medium text-[#787671]">Envelopes</p>
            <p className="mt-0.5 text-xl font-semibold text-[#1a1a1a] tabular-nums">{envelopeStats.total}</p>
          </div>
          <div className="rounded-lg border border-[#e5e3df] bg-white px-4 py-3 shadow-[0px_1px_2px_0px_rgba(15,15,15,0.04)]">
            <p className="text-[11px] font-medium text-[#787671]">Awaiting signature</p>
            <p className="mt-0.5 text-xl font-semibold text-[#9a5b00] tabular-nums">{envelopeStats.pending}</p>
          </div>
          <div className="rounded-lg border border-[#e5e3df] bg-white px-4 py-3 shadow-[0px_1px_2px_0px_rgba(15,15,15,0.04)]">
            <p className="text-[11px] font-medium text-[#787671]">Sealed &amp; complete</p>
            <p className="mt-0.5 text-xl font-semibold text-[#116229] tabular-nums">{envelopeStats.completed}</p>
          </div>
        </div>
      )}

      {/* Welcome banner: first-run guidance only. Showing it forever was
          noise for everyone past their first envelope. */}
      {isFreshWorkspace && (
        <div className="p-6 rounded-xl bg-[#e6e0f5]/45 border border-[#d6b6f6]/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#1a1a1a] font-heading">Welcome to Docurama</h2>
            <p className="text-sm text-[#5d5b54] mt-1">Upload a PDF, place the signature fields, and send it for signing.</p>
          </div>
          <button
            onClick={onNewEnvelope}
            className="btn btn-primary shrink-0 px-5 py-2.5 text-sm font-medium gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Create your first envelope</span>
          </button>
        </div>
      )}

      {/* Dropzone */}
      <div
        onClick={handleDropzoneClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDropzoneClick(); } }}
        role="button"
        tabIndex={0}
        aria-label="Upload a document to sign"
        className="docurama-dropzone p-10 text-center cursor-pointer"
      >
        <div className="w-14 h-14 mx-auto rounded-xl bg-[#e6e0f5] text-[#5645d4] flex items-center justify-center mb-3">
          <Upload className="w-7 h-7" />
        </div>
        <h3 className="text-base font-semibold text-[#1a1a1a] font-heading">Drag and drop your PDF here, or browse</h3>
        <p className="text-xs text-[#787671] mt-1">PDF, DOCX and XLSX, sealed with PAdES and an RFC 3161 timestamp</p>
      </div>

      {/* Folders & Filters */}
      <div className="flex items-center justify-between gap-4 pt-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedFolderId('all')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 border ${
              selectedFolderId === 'all'
                ? 'bg-[#5645d4] text-white border-[#5645d4]'
                : 'bg-white text-[#5d5b54] border-[#e5e3df] hover:text-[#1a1a1a]'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            All Templates
          </button>

          {folders.map(f => (
            <div key={f.id} className="relative group shrink-0">
              <button
                onClick={() => setSelectedFolderId(f.id)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all border ${
                  selectedFolderId === f.id
                    ? 'bg-[#5645d4] text-white border-[#5645d4]'
                    : 'bg-white text-[#5d5b54] border-[#e5e3df] hover:text-[#1a1a1a]'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: f.color || '#5645d4' }} />
                {f.name}
              </button>
              <button
                onClick={(e) => handleDeleteFolder(f.id, e)}
                className="hidden group-hover:flex absolute -top-1.5 -right-1.5 p-1 bg-[#c92a2a] rounded-full text-white"
                aria-label={`Delete folder ${f.name}`}
                title="Delete folder"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}

          <button
            onClick={() => setShowFolderModal(true)}
            className="px-3 py-1.5 rounded-md text-xs font-semibold text-[#5645d4] bg-[#e6e0f5]/60 border border-[#d6b6f6]/70 hover:bg-[#e6e0f5] flex items-center gap-1 shrink-0 transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Folder
          </button>
        </div>
      </div>

      {/* Grid of Templates */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" aria-busy="true" aria-live="polite">
          <TemplateCardSkeleton count={6} />
        </div>
      ) : filtered.length === 0 ? (
        <Empty className="p-12">
          <EmptyMedia>
            <Inbox className="w-6 h-6" />
          </EmptyMedia>
          <EmptyTitle>No templates match “{search}”</EmptyTitle>
          <EmptyDescription>
            Try a shorter search term, or clear the search to see every template in this folder.
          </EmptyDescription>
          <EmptyAction>
            <button onClick={() => setSearch('')} className="btn btn-secondary px-4 py-2 text-xs font-medium">
              Clear search
            </button>
          </EmptyAction>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((item: any, i) => (
            <div
              key={item.id || i}
              className="group relative flex flex-col justify-between p-5 rounded-lg bg-white border border-[#e5e3df] hover:border-[#c8c4be] hover:shadow-[0px_4px_12px_0px_rgba(15,15,15,0.08)] transition-all shadow-[0px_1px_2px_0px_rgba(15,15,15,0.04)]"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-[#e6e0f5] border border-[#d6b6f6]/70 flex items-center justify-center text-[#5645d4] group-hover:scale-105 transition-transform">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(item.tags || []).map((tg: string) => (
                      <span key={tg} className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#f0eeec] text-[#5d5b54] border border-[#e5e3df]">
                        {tg}
                      </span>
                    ))}
                    {item.is_public_shared && (
                      <button
                        onClick={() => setShareTemplate(item)}
                        title="Share public link & embed"
                        aria-label={`Share ${item.title}`}
                        className="p-1.5 rounded-md bg-[#e6e0f5]/70 hover:bg-[#e6e0f5] text-[#5645d4] transition-colors"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <h3 className="text-base font-semibold text-[#1a1a1a] group-hover:text-[#5645d4] transition-colors font-heading">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-xs text-[#787671] line-clamp-2 leading-relaxed">
                  {item.description || 'Pre-configured workflow with automated signature routing and field validations.'}
                </p>
              </div>

              <div className="mt-5 pt-3 border-t border-[#f1f5f9] flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-[#787671] text-[11px] font-medium tabular-nums">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{item.roles_data?.length || 2} signers</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShareTemplate(item)}
                    className="px-2.5 py-1 rounded-md text-[#5d5b54] hover:text-[#1a1a1a] bg-[#fafaf9] border border-[#e5e3df] text-[11px] font-medium hover:bg-[#f6f5f4] transition-colors"
                  >
                    Share
                  </button>
                  <button
                    onClick={() => onSelectTemplate(item)}
                    className="btn btn-primary px-3 py-1 text-xs font-medium gap-1"
                  >
                    <span>Use</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-xl bg-white border border-[#e5e3df] p-6 space-y-4 shadow-[0px_16px_48px_-8px_rgba(15,15,15,0.16)] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1a1a1a] flex items-center gap-2 font-heading">
                <Folder className="w-4 h-4 text-[#5645d4]" />
                Create template folder
              </h3>
              <button onClick={() => setShowFolderModal(false)} className="text-[#787671] hover:text-[#1a1a1a]" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label htmlFor="folder-name" className="block text-xs font-medium text-[#37352f] mb-1.5">Folder name *</label>
                <input
                  id="folder-name"
                  type="text"
                  required
                  placeholder="e.g. Legal & Contracts"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-white border border-[#c8c4be] text-xs text-[#1a1a1a]"
                />
              </div>
              <div>
                <span className="block text-xs font-medium text-[#37352f] mb-1.5">Color marker</span>
                <div className="flex items-center gap-2">
                  {['#5645d4', '#2a9d99', '#1a7f37', '#dd5b00', '#a02e6d', '#5d5b54'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewFolderColor(c)}
                      aria-label={`Use color ${c}`}
                      aria-pressed={newFolderColor === c}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${newFolderColor === c ? 'scale-125 border-[#1a1a1a]' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFolderModal(false)}
                  className="btn btn-ghost px-4 py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary px-4 py-2 text-xs font-medium"
                >
                  Create folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share & Embed Modal */}
      {shareTemplate && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-white border border-[#e5e3df] p-6 space-y-5 shadow-[0px_16px_48px_-8px_rgba(15,15,15,0.16)] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1a1a1a] flex items-center gap-2 font-heading">
                <Share2 className="w-4 h-4 text-[#5645d4]" />
                Share &amp; embed
              </h3>
              <button onClick={() => setShareTemplate(null)} className="text-[#787671] hover:text-[#1a1a1a]" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-[#1a1a1a]">{shareTemplate.title}</h4>
              <p className="text-[11px] text-[#787671] mt-0.5">
                Anyone with this public link can fill in and sign this form.
              </p>
            </div>

            {/* Public Link */}
            <div className="space-y-1.5">
              <label htmlFor="share-url" className="block text-xs font-semibold text-[#37352f]">Public form URL</label>
              <div className="flex gap-2">
                <input
                  id="share-url"
                  type="text"
                  readOnly
                  value={getPublicLink(shareTemplate.public_slug)}
                  className="flex-1 px-3 py-2 rounded-md bg-[#fafaf9] border border-[#c8c4be] text-xs text-[#5645d4] font-mono"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(getPublicLink(shareTemplate.public_slug));
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="btn btn-primary px-3 py-2 text-xs font-medium"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedLink ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Embed Snippet */}
            <div className="space-y-1.5">
              <label htmlFor="share-embed" className="block text-xs font-semibold text-[#37352f] flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5 text-[#5645d4]" />
                Embed code (responsive iframe)
              </label>
              <textarea
                id="share-embed"
                readOnly
                rows={3}
                value={getEmbedCode(shareTemplate.public_slug)}
                className="w-full px-3 py-2 rounded-md bg-[#fafaf9] border border-[#c8c4be] text-[11px] text-[#5d5b54] font-mono leading-relaxed"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(getEmbedCode(shareTemplate.public_slug));
                  setCopiedEmbed(true);
                  setTimeout(() => setCopiedEmbed(false), 2000);
                }}
                className="btn btn-secondary w-full py-2 text-xs font-medium flex items-center justify-center gap-1.5"
              >
                {copiedEmbed ? <Check className="w-3.5 h-3.5 text-[#116229]" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedEmbed ? 'Snippet copied' : 'Copy embed code'}
              </button>
            </div>

            <div className="pt-2 border-t border-[#f1f5f9] flex justify-end">
              <button
                onClick={() => setShareTemplate(null)}
                className="btn btn-secondary px-4 py-2 text-xs font-medium"
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
