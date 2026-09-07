import React, { useState, useRef } from 'react';
import { 
  ShieldCheck, 
  PenTool, 
  Smartphone, 
  Layers, 
  Cloud, 
  ArrowRight, 
  Check, 
  CheckCircle2, 
  Lock, 
  ChevronRight,
  Sparkles,
  ExternalLink,
  Shield,
  Clock,
  Fingerprint
} from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotate, setRotate] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const rotateX = -(y / (rect.height / 2)) * 7;
    const rotateY = (x / (rect.width / 2)) * 7;
    setRotate({ x: rotateX, y: rotateY });
  };

  const handleMouseLeave = () => {
    setRotate({ x: 0, y: 0 });
  };

  const scrollToFeatures = () => {
    const el = document.getElementById('features');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="hero-spotlight-wrapper py-6">
      <div className="hero-spotlight" />
      <div className="bg-dot-grid absolute inset-0 opacity-40 pointer-events-none" />

      {/* Hero Header */}
      <div className="relative z-10 max-w-4xl mx-auto text-center px-4 pt-4 pb-10">
        {/* Announcement Pill */}
        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-200/70 text-blue-700 text-xs font-semibold mb-6 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
          <span>Enterprise Cryptographic E-Signatures</span>
          <span className="text-blue-400">|</span>
          <span className="font-normal text-blue-600">RFC 3161 Verified</span>
        </div>

        {/* Main Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-[#0F172A] leading-[1.15] mb-5 font-heading">
          Sign documents with{' '}
          <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 bg-clip-text text-transparent">
            confidence, speed &amp; precision
          </span>.
        </h1>

        <p className="text-base sm:text-lg md:text-xl text-[#475569] max-w-2xl mx-auto font-normal leading-relaxed mb-8">
          The modern document signing platform with cryptographic digital seals, automated multi-signer sequences, and tamper-evident audit trails.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          <button
            onClick={onGetStarted}
            className="btn btn-primary font-semibold px-8 h-12 rounded-xl text-base shadow-lg shadow-blue-500/25 flex items-center space-x-2"
          >
            <span>Get Started / Sign In</span>
            <ArrowRight className="w-5 h-5 ml-1" />
          </button>
          <button
            onClick={scrollToFeatures}
            className="btn btn-white font-medium px-6 h-12 rounded-xl text-base text-[#334155] border border-[#CBD5E1] shadow-sm"
          >
            Explore Capabilities
          </button>
        </div>
      </div>

      {/* Interactive 3D Document Canvas (Exact Aceternity 3D Card from Production) */}
      <div className="relative z-10 max-w-2xl mx-auto px-4 my-8 doc-3d-scene">
        <div
          ref={cardRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{
            transform: `perspective(1000px) rotateX(${rotate.x}deg) rotateY(${rotate.y}deg)`,
            transition: 'transform 0.15s ease-out'
          }}
          className="doc-3d-card bg-white rounded-2xl p-6 sm:p-8 border border-slate-200/80 shadow-xl cursor-pointer select-none"
        >
          {/* Document Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-5 mb-6">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 inline-flex items-center justify-center">
                <img src="/logo.svg" alt="Docurama" className="w-10 h-10 object-contain" />
              </div>
              <div>
                <div className="font-bold text-[#0F172A] text-base leading-tight">Partnership_Agreement_2026.pdf</div>
                <div className="text-xs text-[#94A3B8] font-mono mt-0.5">SHA-256: 8f4b...19c2 • 3 Signers</div>
              </div>
            </div>
            <div className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/60 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 stroke-[2.5]" />
              <span>RFC 3161 Certified</span>
            </div>
          </div>

          {/* Document Mock Body */}
          <div className="space-y-3 mb-8">
            <div className="h-2.5 bg-slate-100 rounded-full w-full" />
            <div className="h-2.5 bg-slate-100 rounded-full w-5/6" />
            <div className="h-2.5 bg-slate-100 rounded-full w-4/6" />
          </div>

          {/* Interactive Signature Block */}
          <div className="bg-slate-50/80 rounded-xl p-5 border border-slate-200/60 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider mb-1">
                Authorized Digital Signature
              </div>
              <svg className="w-44 sm:w-48 h-12" viewBox="0 0 200 60" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  className="signature-draw-path"
                  d="M10 40C30 15 50 48 70 30C90 12 110 50 135 25C150 10 160 45 190 28"
                  stroke="#1D72FE"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="text-right">
              <div className="text-xs text-[#94A3B8]">Timestamped</div>
              <div className="text-xs font-semibold text-[#334155] font-mono">DigiCert TSA</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bento Grid (Core Capabilities Matching Production Exactly) */}
      <div id="features" className="relative z-10 max-w-6xl mx-auto px-4 mt-16 mb-12">
        <div className="text-center max-w-xl mx-auto mb-12">
          <h2 className="text-3xl md:text-4xl font-extrabold text-[#0F172A] tracking-tight mb-3 font-heading">
            Built for Modern Document Workflows
          </h2>
          <p className="text-[#64748B] text-base">
            A unified platform engineered for legal compliance, high velocity, and complete data ownership.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Bento Item 1 (Wide: 2 cols) */}
          <div className="bento-card md:col-span-2 p-8 flex flex-col justify-between bg-white rounded-3xl border border-[#E2E8F0] shadow-sm hover:shadow-md transition-shadow">
            <div>
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center mb-6">
                <PenTool className="w-6 h-6 text-[#1D72FE]" />
              </div>
              <h3 className="text-2xl font-bold text-[#0F172A] mb-2">Automated Multi-Party Sequences</h3>
              <p className="text-[#64748B] text-base leading-relaxed max-w-lg">
                Configure complex multi-signatory execution orders with real-time tracking, automatic reminder cadence, and instant SMS &amp; email notifications.
              </p>
            </div>
            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between text-xs text-[#64748B] font-medium">
              <span>Multi-party routing</span>
              <span>•</span>
              <span>Automatic Reminders</span>
              <span>•</span>
              <span>SMS &amp; Email Dispatch</span>
            </div>
          </div>

          {/* Bento Item 2 */}
          <div className="bento-card p-8 flex flex-col justify-between bg-white rounded-3xl border border-[#E2E8F0] shadow-sm hover:shadow-md transition-shadow">
            <div>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-6">
                <ShieldCheck className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-2xl font-bold text-[#0F172A] mb-2">RFC 3161 Cryptographic Seals</h3>
              <p className="text-[#64748B] text-base leading-relaxed">
                Every signed PDF includes digital timestamping and tamper-evident cryptographic hash verification.
              </p>
            </div>
            <div className="mt-8 pt-6 border-t border-slate-100 text-xs text-emerald-600 font-semibold">
              eIDAS &amp; ESIGN Compliant
            </div>
          </div>

          {/* Bento Item 3 */}
          <div className="bento-card p-8 flex flex-col justify-between bg-white rounded-3xl border border-[#E2E8F0] shadow-sm hover:shadow-md transition-shadow">
            <div>
              <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center mb-6">
                <Smartphone className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-2xl font-bold text-[#0F172A] mb-2">Universal Mobile Signing</h3>
              <p className="text-[#64748B] text-base leading-relaxed">
                Smooth, touch-optimized signing experience across iOS, Android, tablets, and desktop browsers without installing apps.
              </p>
            </div>
            <div className="mt-8 pt-6 border-t border-slate-100 text-xs text-indigo-600 font-semibold">
              Zero friction for signers
            </div>
          </div>

          {/* Bento Item 4 (Wide: 2 cols) */}
          <div className="bento-card md:col-span-2 p-8 flex flex-col justify-between bg-white rounded-3xl border border-[#E2E8F0] shadow-sm hover:shadow-md transition-shadow">
            <div>
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 text-cyan-600 flex items-center justify-center mb-6">
                <Cloud className="w-6 h-6 text-cyan-600" />
              </div>
              <h3 className="text-2xl font-bold text-[#0F172A] mb-2">Self-Hosted Data Sovereignty</h3>
              <p className="text-[#64748B] text-base leading-relaxed max-w-lg">
                Deploy on your own infrastructure with total data isolation, complete privacy, direct REST API webhooks, and zero third-party telemetry.
              </p>
            </div>
            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between text-xs text-[#64748B] font-medium">
              <span>Private Cloud</span>
              <span>•</span>
              <span>REST API &amp; Webhooks</span>
              <span>•</span>
              <span>100% Data Isolation</span>
            </div>
          </div>
        </div>
      </div>

      {/* Production Footer Attribution Badge */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 mt-8 pt-6 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#64748B]">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="font-medium text-[#334155]">Docurama eSign System</span>
          <span>•</span>
          <span>Real-Time Cryptographic Engine</span>
          <span>•</span>
          <span className="font-semibold text-[#1D72FE]">PAdES-LTV Compliant</span>
        </div>
        <div className="text-slate-400 font-mono text-[11px]">
          RFC 3161 TSA • X.509 Digital Signatures
        </div>
      </div>
    </div>
  );
};
