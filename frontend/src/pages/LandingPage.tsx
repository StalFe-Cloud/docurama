import React, { useState, useRef } from 'react';
import { 
  ShieldCheck, 
  PenTool, 
  Smartphone, 
  Cloud, 
  ArrowRight, 
  Check, 
  Lock, 
  ChevronRight,
  ExternalLink,
  Shield,
  Clock,
  Fingerprint,
  Cpu,
  FileText,
  Sparkles,
  Users,
  CheckCircle2
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
    const rotateX = -(y / (rect.height / 2)) * 4;
    const rotateY = (x / (rect.width / 2)) * 4;
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
    <div className="w-full bg-white text-[#37352f]">
      
      {/* 1. Signature Notion Deep Navy Hero Band */}
      <div className="w-full bg-[#0a1530] text-white pt-16 pb-24 px-4 relative overflow-hidden">
        {/* Subtle decorative mesh and sticky-note dots */}
        <div className="absolute top-12 left-10 w-3 h-3 rounded-full bg-[#ff64c8] opacity-75 hidden md:block" />
        <div className="absolute top-24 right-16 w-3.5 h-3.5 rounded-full bg-[#f5d75e] opacity-80 hidden md:block" />
        <div className="absolute bottom-20 left-24 w-2.5 h-2.5 rounded-full bg-[#2a9d99] opacity-75 hidden md:block" />
        <div className="absolute top-40 left-1/4 w-2 h-2 rounded-full bg-[#ff7a17] opacity-60 hidden lg:block" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          
          {/* Decorative sticky-note tags */}
          <div className="inline-flex items-center gap-2 mb-6">
            <span className="badge-tag-purple">X.509 Cryptographic Seals</span>
            <span className="badge-tag-green">RFC 3161 Verified</span>
            <span className="badge-tag-orange">MCP AI Agents</span>
          </div>

          {/* Hero Display Headline in Notion 600 weight */}
          <h1 className="hero-display text-white mb-6 font-display">
            The all-in-one workspace for documents and signatures.
          </h1>

          <p className="text-base sm:text-lg text-[#a4a097] max-w-2xl mx-auto font-normal leading-relaxed mb-8">
            Write, fill, digitally seal, and automate multi-signer sequences with legal cryptographic certainty. Programmatically accessible via Model Context Protocol.
          </p>

          {/* Dual CTAs: Signature Purple Primary (8px rectangle) + Outlined Secondary on Dark */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-14">
            <button
              onClick={onGetStarted}
              className="btn btn-primary px-6 h-11 text-sm font-medium rounded-md shadow-md flex items-center space-x-2"
            >
              <span>Get Docurama free</span>
              <ArrowRight className="w-4 h-4 ml-1 stroke-[2]" />
            </button>
            <button
              onClick={scrollToFeatures}
              className="btn btn-secondary-on-dark px-6 h-11 text-sm font-medium rounded-md"
            >
              Explore capabilities
            </button>
          </div>

          {/* Embedded Real Workspace Mockup Card with Deep Diffuse Drop Shadow */}
          <div className="relative max-w-3xl mx-auto text-left">
            <div
              ref={cardRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              style={{
                transform: `perspective(1000px) rotateX(${rotate.x}deg) rotateY(${rotate.y}deg)`,
                transition: 'transform 0.15s ease-out'
              }}
              className="workspace-mockup-card p-6 sm:p-8 select-none text-[#37352f]"
            >
              {/* Document Workspace Title Bar */}
              <div className="flex items-center justify-between border-b border-[#e5e3df] pb-4 mb-6">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-md bg-[#f6f5f4] border border-[#e5e3df] flex items-center justify-center text-[#5645d4]">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-[#1a1a1a]">Master_Service_Agreement_2026.pdf</div>
                    <div className="text-xs text-[#787671] flex items-center gap-2 mt-0.5">
                      <span>3 Signatories</span>
                      <span>&bull;</span>
                      <span className="font-mono text-[11px]">SHA-256: 8f4b...19c2</span>
                    </div>
                  </div>
                </div>
                <span className="badge-tag-green">
                  RFC 3161 Timestamped
                </span>
              </div>

              {/* Document Workspace Kanban Mockup Rows */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                <div className="p-3 bg-[#f6f5f4] rounded-lg border border-[#e5e3df]">
                  <div className="text-[11px] font-semibold text-[#787671] uppercase mb-1">First Signer</div>
                  <div className="text-xs font-medium text-[#1a1a1a]">Sarah Connor</div>
                  <div className="text-[11px] text-[#1aae39] mt-0.5 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Signed &amp; Sealed
                  </div>
                </div>

                <div className="p-3 bg-[#f6f5f4] rounded-lg border border-[#e5e3df]">
                  <div className="text-[11px] font-semibold text-[#787671] uppercase mb-1">Second Signer</div>
                  <div className="text-xs font-medium text-[#1a1a1a]">Legal Counsel</div>
                  <div className="text-[11px] text-[#dd5b00] mt-0.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> In Review
                  </div>
                </div>

                <div className="p-3 bg-[#f6f5f4] rounded-lg border border-[#e5e3df]">
                  <div className="text-[11px] font-semibold text-[#787671] uppercase mb-1">Compliance TSA</div>
                  <div className="text-xs font-medium text-[#1a1a1a]">DigiCert Authority</div>
                  <div className="text-[11px] text-[#5645d4] mt-0.5 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> PAdES-LTV Ready
                  </div>
                </div>
              </div>

              {/* Signature Interactive Pad Preview */}
              <div className="bg-[#fafaf9] rounded-lg p-4 border border-[#e5e3df] flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-[#787671] uppercase tracking-wider mb-1">
                    Authorized Digital Seal
                  </div>
                  <svg className="w-36 sm:w-44 h-9" viewBox="0 0 200 60" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M10 40C30 15 50 48 70 30C90 12 110 50 135 25C150 10 160 45 190 28"
                      stroke="#5645d4"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[#787671]">Verification Fingerprint</div>
                  <div className="text-xs font-medium text-[#1a1a1a] font-mono">Docurama Root CA G2</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 2. Pastel Feature Cards Palette Section (Echoing Notion Database Properties) */}
      <div id="features" className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <div className="text-[12px] font-semibold text-[#5645d4] uppercase tracking-wider mb-2">
            ALL-IN-ONE WORKSPACE
          </div>
          <h2 className="heading-1 text-[#1a1a1a] mb-3 font-display">
            Keep work moving 24/7.
          </h2>
          <p className="text-[#5d5b54] text-base leading-relaxed">
            One connected system for cryptographic verification, multi-signer workflows, and autonomous AI agents.
          </p>
        </div>

        {/* Feature Grid with Notion Pastel Tints */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 1: Bold Yellow High-Emphasis Banner (2 cols) */}
          <div className="card-feature card-tint-yellow-bold md:col-span-2 p-8 flex flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="badge-tag-orange">Model Context Protocol</span>
                <span className="text-xs font-semibold text-[#793400]">Autonomous AI Agents</span>
              </div>
              <h3 className="heading-2 text-[#1a1a1a] mb-3">
                Ask your on-demand assistants.
              </h3>
              <p className="text-[#37352f] text-sm leading-relaxed max-w-xl">
                Docurama exposes native MCP server endpoints so Claude, Cursor, and custom frontier coding agents can inspect PDF signatures, verify certificate chains, and dispatch envelopes automatically.
              </p>
            </div>
            <div className="mt-8 pt-4 border-t border-[#793400]/15 flex items-center justify-between text-xs text-[#793400] font-medium">
              <span>JSON-RPC 2.0 Ready</span>
              <span>&bull;</span>
              <span>5 Native Agent Tools</span>
              <span>&bull;</span>
              <span>Bearer Authentication</span>
            </div>
          </div>

          {/* Card 2: Mint Pastel Tint Card */}
          <div className="card-feature card-tint-mint p-8 flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-lg bg-white/70 border border-[#1aae39]/20 flex items-center justify-center mb-4 text-[#1aae39]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-semibold text-[#1a1a1a] mb-2">RFC 3161 Timestamping</h3>
              <p className="text-[#37352f] text-xs leading-relaxed">
                Embedded cryptographic timestamps with CRL and OCSP responses ensure legal validity under eIDAS and ESIGN standards.
              </p>
            </div>
            <div className="mt-6 pt-3 border-t border-[#1aae39]/15 text-xs text-[#1aae39] font-semibold">
              PAdES-LTV Long-Term Validation
            </div>
          </div>

          {/* Card 3: Lavender Pastel Tint Card */}
          <div className="card-feature card-tint-lavender p-8 flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-lg bg-white/70 border border-[#7b3ff2]/20 flex items-center justify-center mb-4 text-[#7b3ff2]">
                <PenTool className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-semibold text-[#1a1a1a] mb-2">Sequential Routing</h3>
              <p className="text-[#37352f] text-xs leading-relaxed">
                Configure deterministic signing orders, automatic reminder intervals, and real-time delivery alerts across SMS and email.
              </p>
            </div>
            <div className="mt-6 pt-3 border-t border-[#7b3ff2]/15 text-xs text-[#391c57] font-semibold">
              Multi-Party Automation
            </div>
          </div>

          {/* Card 4: Peach Pastel Tint Card (2 cols) */}
          <div className="card-feature card-tint-peach md:col-span-2 p-8 flex flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="badge-tag-green">Self-Hosted Deployment</span>
                <span className="text-xs font-semibold text-[#793400]">Data Sovereignty</span>
              </div>
              <h3 className="heading-3 text-[#1a1a1a] mb-2">
                Your documents. Your infrastructure. Total isolation.
              </h3>
              <p className="text-[#37352f] text-xs leading-relaxed max-w-lg">
                Run on Docker, Kubernetes, or private VPS with PostgreSQL storage, zero external telemetry leaks, and complete regulatory audit trails.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-[#793400]/15 flex items-center justify-between text-xs text-[#793400] font-medium">
              <span>Docker Compose</span>
              <span>&bull;</span>
              <span>PostgreSQL &amp; Redis</span>
              <span>&bull;</span>
              <span>Zero Vendor Lock-in</span>
            </div>
          </div>

        </div>
      </div>

      {/* 3. Notion 4-Tier Pricing Comparison Surface */}
      <div className="w-full bg-[#f6f5f4] py-20 border-t border-b border-[#e5e3df]">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="heading-1 text-[#1a1a1a] mb-2 font-display">
              One tool for your whole organization.
            </h2>
            <p className="text-[#5d5b54] text-base">
              Free for individuals. Powerful cryptographic tiers for growing teams and enterprises.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Tier 1: Free */}
            <div className="bg-white rounded-lg p-6 border border-[#e5e3df] flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#1a1a1a]">Free</h3>
                <p className="text-xs text-[#787671] mt-1 mb-4">For organizing personal document workflows</p>
                <div className="text-3xl font-bold text-[#1a1a1a] mb-4">$0</div>
                <ul className="space-y-2.5 text-xs text-[#37352f]">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Unlimited templates</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Self-service intake forms</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Basic audit trail</li>
                </ul>
              </div>
              <button onClick={onGetStarted} className="btn btn-secondary w-full text-xs mt-6 rounded-md">
                Get started
              </button>
            </div>

            {/* Tier 2: Plus */}
            <div className="bg-white rounded-lg p-6 border border-[#e5e3df] flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#1a1a1a]">Plus</h3>
                <p className="text-xs text-[#787671] mt-1 mb-4">A collaborative space for small teams</p>
                <div className="text-3xl font-bold text-[#1a1a1a] mb-4">$10<span className="text-xs font-normal text-[#787671]"> / user</span></div>
                <ul className="space-y-2.5 text-xs text-[#37352f]">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Automated reminders</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Custom branding &amp; logos</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> SMS notifications</li>
                </ul>
              </div>
              <button onClick={onGetStarted} className="btn btn-secondary w-full text-xs mt-6 rounded-md">
                Try Plus
              </button>
            </div>

            {/* Tier 3: Business (Featured with Purple Border) */}
            <div className="bg-[#ffffff] rounded-lg p-6 border-2 border-[#5645d4] shadow-notion-feature flex flex-col justify-between relative">
              <span className="badge-popular absolute -top-3 right-6">
                Most Popular
              </span>
              <div>
                <h3 className="text-lg font-semibold text-[#1a1a1a]">Business</h3>
                <p className="text-xs text-[#787671] mt-1 mb-4">Connect several teams and tools</p>
                <div className="text-3xl font-bold text-[#1a1a1a] mb-4">$18<span className="text-xs font-normal text-[#787671]"> / user</span></div>
                <ul className="space-y-2.5 text-xs text-[#37352f]">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> RFC 3161 TSA timestamps</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> 21 CFR Part 11 compliance</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> MCP Agent Server token access</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> REST API webhooks</li>
                </ul>
              </div>
              <button onClick={onGetStarted} className="btn btn-primary w-full text-xs mt-6 rounded-md">
                Try Business
              </button>
            </div>

            {/* Tier 4: Enterprise */}
            <div className="bg-white rounded-lg p-6 border border-[#e5e3df] flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#1a1a1a]">Enterprise</h3>
                <p className="text-xs text-[#787671] mt-1 mb-4">Advanced security and dedicated controls</p>
                <div className="text-3xl font-bold text-[#1a1a1a] mb-4">Custom</div>
                <ul className="space-y-2.5 text-xs text-[#37352f]">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Custom PKCS#12 root certs</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Hardware Security Module (HSM)</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> SAML SSO &amp; SCIM user provisioning</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Dedicated SLA</li>
                </ul>
              </div>
              <button onClick={onGetStarted} className="btn btn-secondary w-full text-xs mt-6 rounded-md">
                Contact sales
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Notion Multi-Column Footer */}
      <footer className="w-full bg-white border-t border-[#e5e3df] py-16 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#787671]">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-[#1aae39]" />
            <span className="font-medium text-[#1a1a1a]">Docurama Workspace</span>
            <span>&bull;</span>
            <span>All systems operational</span>
            <span>&bull;</span>
            <span className="text-[#5645d4] font-medium">PAdES-LTV Compliant</span>
          </div>
          <div className="font-mono text-[11px] text-[#787671]">
            RFC 3161 TSA &bull; X.509 PKI &bull; Notion Design System
          </div>
        </div>
      </footer>
    </div>
  );
};
