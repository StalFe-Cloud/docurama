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
  ShieldCheck
} from 'lucide-react';
import { api, TemplateItem } from '../lib/api';

interface TemplatesPageProps {
  onSelectTemplate: (template: TemplateItem) => void;
  onNewEnvelope: () => void;
}

export const TemplatesPage: React.FC<TemplatesPageProps> = ({
  onSelectTemplate,
  onNewEnvelope,
}) => {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const data = await api.listTemplates();
      setTemplates(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
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
      tag: 'Legal & IP',
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
      tag: 'HR & People',
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
      tag: 'Sales & Revenue',
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
      tag: 'Operations',
      color: 'from-amber-500/20 to-orange-500/10'
    }
  ];

  const allItems = templates.length > 0 ? templates : (defaultTemplates as unknown as TemplateItem[]);
  const filtered = allItems.filter(t => 
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    (t.description || '').toLowerCase().includes(search.toLowerCase())
  );

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
              Templates Studio
            </h1>
            <p className="mt-1.5 text-sm text-slate-400 max-w-xl">
              Create, customize, and dispatch cryptographic document packages. Pre-configured with recipient signing orders, verification rules, and PAdES-LTV seals.
            </p>
          </div>
          <button
            onClick={onNewEnvelope}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white btn-primary-glow shrink-0"
          >
            <Plus className="w-4 h-4" />
            Create From Scratch
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search templates or tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
          />
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2 self-end sm:self-center">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>All templates include automated Docurama Root CA audit certificate</span>
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((item: any, i) => (
          <div
            key={item.id || i}
            className="group relative flex flex-col justify-between p-6 rounded-2xl glass-card border border-white/10 hover:border-indigo-500/40 transition-all"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-400/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                  <FileText className="w-5 h-5" />
                </div>
                {item.tag && (
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-white/5">
                    {item.tag}
                  </span>
                )}
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

              <button
                onClick={() => onSelectTemplate(item)}
                className="flex items-center gap-1.5 font-semibold text-indigo-400 hover:text-indigo-300 transition-colors group-hover:translate-x-1 duration-200"
              >
                Use Template
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};
