import React, { useState, useRef } from 'react';
import { HeroDemoOverlay, HeroSignerStatusFlip, HeroSignaturePath } from '../components/HeroDemo';
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
  CheckCircle2,
  XCircle,
  HelpCircle,
  FileCheck
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

  const scrollToComparison = () => {
    const el = document.getElementById('comparison');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="w-full bg-white text-[#37352f]">
      
      {/* 1. Modern Luminous Light Hero Section (No Dark, Inspired by designprompts.dev Minimal Swiss & Linear Light) */}
      <div className="w-full bg-gradient-to-b from-[#fafaf9] via-[#ffffff] to-[#f6f5f4] text-[#1a1a1a] pt-14 pb-20 px-4 relative overflow-hidden border-b border-[#e5e3df]">
        
        {/* Subtle luminous ambient radial glow */}
        <div 
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] pointer-events-none opacity-60"
          style={{
            background: 'radial-gradient(ellipse at 50% 0%, rgba(86, 69, 212, 0.12), transparent 70%)'
          }}
        />

        {/* Decorative pastel accents */}
        <div className="absolute top-16 left-12 w-2.5 h-2.5 rounded-full bg-[#5645d4]/40 hidden md:block" />
        <div className="absolute top-28 right-20 w-3 h-3 rounded-full bg-[#1aae39]/30 hidden md:block" />
        <div className="absolute bottom-28 left-20 w-2.5 h-2.5 rounded-full bg-[#dd5b00]/30 hidden md:block" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          
          {/* Top Announcement Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-[#e5e3df] shadow-sm text-xs font-medium text-[#37352f] mb-6 hover:border-[#5645d4]/40 transition-colors">
            <span className="flex h-2 w-2 rounded-full bg-[#1aae39]" />
            <span className="font-semibold text-[#5645d4]">X.509 PKI &bull; RFC 3161 Qualified</span>
            <span className="text-[#787671]">&bull;</span>
            <span>PAdES under eIDAS &amp; ESIGN</span>
          </div>

          {/* High-Impact Display Headline in Notion 600 weight */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-[#1a1a1a] max-w-4xl mx-auto leading-[1.12] mb-6 font-display">
            Sign, seal, and verify contracts with <span className="text-[#5645d4]">cryptographic certainty.</span>
          </h1>

          <p className="text-base sm:text-lg text-[#5d5b54] max-w-2xl mx-auto font-normal leading-relaxed mb-8">
            The enterprise platform for legally binding electronic signatures, RFC 3161 timestamps, and multi-party envelope automation. Self-host with complete data sovereignty or deploy in seconds.
          </p>

          {/* Dual CTAs: Signature Purple Primary (8px rectangle) + Light Secondary */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
            <button
              onClick={onGetStarted}
              className="btn btn-primary px-6 h-11 text-sm font-medium rounded-md shadow-md flex items-center space-x-2 bg-[#5645d4] hover:bg-[#4534b3] text-white transition-colors"
            >
              <span>Start Free Trial</span>
              <ArrowRight className="w-4 h-4 ml-1 stroke-[2]" />
            </button>
            <button
              onClick={scrollToComparison}
              className="btn btn-secondary px-6 h-11 text-sm font-medium rounded-md bg-white hover:bg-[#f6f5f4] text-[#1a1a1a] border border-[#c8c4be] transition-colors"
            >
              Compare Architecture
            </button>
          </div>

          {/* Micro Trust Indicators */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-[#787671] mb-12">
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#1aae39]" /> Unlimited Envelopes</span>
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#1aae39]" /> Offline Adobe Acrobat Proof</span>
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#1aae39]" /> 21 CFR Part 11 Audit Trail</span>
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#1aae39]" /> Zero Envelope Overages</span>
          </div>

          {/* Embedded Real Electronic Signature Envelope Mockup Card (Light Mode) */}
          <div className="relative max-w-3xl mx-auto text-left">
            <div
              ref={cardRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              style={{
                transform: `perspective(1000px) rotateX(${rotate.x}deg) rotateY(${rotate.y}deg)`,
                transition: 'transform 0.15s ease-out'
              }}
              className="bg-white rounded-xl p-6 sm:p-8 border border-[#e5e3df] shadow-[0_20px_50px_-15px_rgba(0,0,0,0.08),0_0_1px_1px_rgba(0,0,0,0.04)] select-none text-[#37352f] relative"
            >
              {/* Self-playing signing sequence (Sprint 8): cursor, signature draw,
                  signer flip, seal pop - one shared 9s CSS timeline. */}
              <HeroDemoOverlay />
              {/* Envelope Header Bar */}
              <div className="flex items-center justify-between border-b border-[#e5e3df] pb-4 mb-6">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-md bg-[#e6e0f5] border border-[#d6b6f6] flex items-center justify-center text-[#5645d4]">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-[#1a1a1a]">Master_Services_Agreement_and_Mutual_NDA.pdf</div>
                    <div className="text-xs text-[#787671] flex items-center gap-2 mt-0.5">
                      <span>Envelope: 3 Signatories</span>
                      <span>&bull;</span>
                      <span className="text-[#0075de] font-medium">Status: In Progress (2 of 3 Completed)</span>
                    </div>
                  </div>
                </div>
                <span className="badge-tag-green">
                  RFC 3161 Timestamped
                </span>
              </div>

              {/* Envelope Signers Progression Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                <div className="p-3 bg-[#fafaf9] rounded-lg border border-[#ede9e4]">
                  <div className="text-[11px] font-semibold text-[#787671] uppercase mb-1">First Signer</div>
                  <div className="text-xs font-semibold text-[#1a1a1a]">Sarah Connor</div>
                  <div className="text-[11px] text-[#1aae39] mt-1 flex items-center gap-1 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Signed &amp; Sealed
                  </div>
                  <div className="text-[10px] text-[#787671] mt-0.5 font-mono">2026-09-07 10:14 UTC</div>
                </div>

                <div className="p-3 bg-[#fafaf9] rounded-lg border border-[#ede9e4]">
                  <div className="text-[11px] font-semibold text-[#787671] uppercase mb-1">Second Signer</div>
                  <div className="text-xs font-semibold text-[#1a1a1a]">Legal Counsel</div>
                  <div className="mt-1">
                    <HeroSignerStatusFlip />
                  </div>
                  <div className="text-[10px] text-[#787671] mt-0.5 font-mono">Dispatched via Email</div>
                </div>

                <div className="p-3 bg-[#fafaf9] rounded-lg border border-[#ede9e4]">
                  <div className="text-[11px] font-semibold text-[#787671] uppercase mb-1">Compliance TSA</div>
                  <div className="text-xs font-semibold text-[#1a1a1a]">DigiCert Authority</div>
                  <div className="text-[11px] text-[#5645d4] mt-1 flex items-center gap-1 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5" /> PAdES-LTV Attached
                  </div>
                  <div className="text-[10px] text-[#787671] mt-0.5 font-mono">RFC 3161 Qualified</div>
                </div>
              </div>

              {/* Cryptographic Signature Pad Preview */}
              <div className="bg-[#f6f5f4] rounded-lg p-4 border border-[#e5e3df] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold text-[#787671] uppercase tracking-wider mb-1">
                    Authorized Digital Seal (X.509 Certificate)
                  </div>
                  <HeroSignaturePath />
                </div>
                <div className="text-left sm:text-right">
                  <div className="text-xs text-[#787671]">Offline Verification in Adobe Reader</div>
                  <div className="text-xs font-semibold text-[#1a1a1a] font-mono">Docurama Root CA G2 &bull; SHA-256</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 2. Feature Cards Section: The Architectural Advantage */}
      <div id="features" className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="text-[12px] font-semibold text-[#5645d4] uppercase tracking-wider mb-2">
            ENTERPRISE ARCHITECTURE
          </div>
          <h2 className="heading-1 text-[#1a1a1a] mb-3 font-display">
            Cryptographic certainty at every layer of document execution.
          </h2>
          <p className="text-[#5d5b54] text-base leading-relaxed">
            No artificial envelope caps, no seat penalties, and true cryptographic proof that stands up in any court of law worldwide.
          </p>
        </div>

        {/* Feature Grid with Pastel Tints */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 1: Bold Yellow High-Emphasis Banner (2 cols) */}
          <div className="card-feature card-tint-yellow-bold md:col-span-2 p-8 flex flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="badge-tag-orange">Model Context Protocol</span>
                <span className="text-xs font-semibold text-[#793400]">Autonomous AI Agents</span>
              </div>
              <h3 className="heading-2 text-[#1a1a1a] mb-3">
                The only e-signature platform built for AI agents.
              </h3>
              <p className="text-[#37352f] text-sm leading-relaxed max-w-xl">
                Docurama exposes native MCP server endpoints and REST APIs. Claude, Cursor, and internal autonomous agents can prepare, inspect, and dispatch signature envelopes with human-in-the-loop validation.
              </p>
            </div>
            <div className="mt-8 pt-4 border-t border-[#793400]/15 flex items-center justify-between text-xs text-[#793400] font-medium">
              <span>JSON-RPC 2.0 Ready</span>
              <span>&bull;</span>
              <span>5 Native Agent Tools</span>
              <span>&bull;</span>
              <span>Python &amp; Node SDKs</span>
            </div>
          </div>

          {/* Card 2: Mint Pastel Tint Card */}
          <div className="card-feature card-tint-mint p-8 flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-lg bg-white/70 border border-[#1aae39]/20 flex items-center justify-center mb-4 text-[#1aae39]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-semibold text-[#1a1a1a] mb-2">Offline Adobe Acrobat Proof</h3>
              <p className="text-[#37352f] text-xs leading-relaxed">
                Unlike simple drawn signatures, Docurama signs with true X.509 certificates and RFC 3161 qualified timestamps. Your signed PDFs remain verifiable in Adobe Acrobat Reader offline for decades without contacting third-party servers.
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
              <h3 className="text-xl font-semibold text-[#1a1a1a] mb-2">Sequential Signer Workflows</h3>
              <p className="text-[#37352f] text-xs leading-relaxed">
                Configure deterministic signing orders, conditional routing, automatic reminder intervals, and real-time delivery alerts across SMS and email without purchasing expensive add-on tiers.
              </p>
            </div>
            <div className="mt-6 pt-3 border-t border-[#7b3ff2]/15 text-xs text-[#391c57] font-semibold">
              Deterministic Signer Chains
            </div>
          </div>

          {/* Card 4: Peach Pastel Tint Card (2 cols) */}
          <div className="card-feature card-tint-peach md:col-span-2 p-8 flex flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="badge-tag-green">Data Sovereignty</span>
                <span className="text-xs font-semibold text-[#793400]">Private Cloud &amp; On-Prem</span>
              </div>
              <h3 className="heading-3 text-[#1a1a1a] mb-2">
                Your contracts never leave your private infrastructure.
              </h3>
              <p className="text-[#37352f] text-xs leading-relaxed max-w-lg">
                Run self-hosted on Docker, Kubernetes, or private VPS with PostgreSQL storage, zero external telemetry leaks, and complete regulatory audit trails.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-[#793400]/15 flex items-center justify-between text-xs text-[#793400] font-medium">
              <span>Docker Compose</span>
              <span>&bull;</span>
              <span>PostgreSQL &amp; Redis</span>
              <span>&bull;</span>
              <span>21 CFR Part 11 Ready</span>
            </div>
          </div>

        </div>
      </div>

      {/* 3. Direct Architecture Comparison Table */}
      <div id="comparison" className="w-full bg-[#fafaf9] py-20 border-t border-[#e5e3df]">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="text-[12px] font-semibold text-[#5645d4] uppercase tracking-wider mb-2">
              ARCHITECTURE COMPARISON
            </div>
            <h2 className="heading-1 text-[#1a1a1a] mb-2 font-display">
              How Docurama compares to traditional e-signature vendors.
            </h2>
            <p className="text-[#5d5b54] text-sm">
              Built from the ground up on modern cryptography, open APIs, and transparent pricing.
            </p>
          </div>

          <div className="bg-white rounded-lg border border-[#e5e3df] shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-[#f6f5f4] text-[#1a1a1a] border-b border-[#e5e3df]">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">Capability</th>
                  <th className="py-3.5 px-4 font-semibold text-[#5645d4] bg-[#e6e0f5]/30">Docurama Platform</th>
                  <th className="py-3.5 px-4 font-semibold text-[#787671]">Traditional E-Sign Vendors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ede9e4]">
                <tr className="hover:bg-[#fafaf9]">
                  <td className="py-3 px-4 font-medium text-[#1a1a1a]">Envelopes &amp; Templates</td>
                  <td className="py-3 px-4 font-semibold text-[#1aae39] bg-[#e6e0f5]/15 flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-[#1aae39]" /> Unlimited (No Overages)
                  </td>
                  <td className="py-3 px-4 text-[#787671]">Capped (Metered Overages)</td>
                </tr>
                <tr className="hover:bg-[#fafaf9]">
                  <td className="py-3 px-4 font-medium text-[#1a1a1a]">Cryptographic Long-Term Validation</td>
                  <td className="py-3 px-4 font-semibold text-[#1aae39] bg-[#e6e0f5]/15 flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-[#1aae39]" /> True X.509 PAdES-LTV Included
                  </td>
                  <td className="py-3 px-4 text-[#787671]">Basic Stamp (LTV requires add-on)</td>
                </tr>
                <tr className="hover:bg-[#fafaf9]">
                  <td className="py-3 px-4 font-medium text-[#1a1a1a]">Data Sovereignty &amp; Self-Hosting</td>
                  <td className="py-3 px-4 font-semibold text-[#1aae39] bg-[#e6e0f5]/15 flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-[#1aae39]" /> 100% Private Cloud / On-Prem
                  </td>
                  <td className="py-3 px-4 text-[#787671]">Multi-Tenant Public Cloud Only</td>
                </tr>
                <tr className="hover:bg-[#fafaf9]">
                  <td className="py-3 px-4 font-medium text-[#1a1a1a]">AI Agent MCP Server</td>
                  <td className="py-3 px-4 font-semibold text-[#1aae39] bg-[#e6e0f5]/15 flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-[#1aae39]" /> Native Model Context Protocol
                  </td>
                  <td className="py-3 px-4 text-[#787671]">Not Supported</td>
                </tr>
                <tr className="hover:bg-[#fafaf9]">
                  <td className="py-3 px-4 font-medium text-[#1a1a1a]">21 CFR Part 11 &amp; eIDAS Compliance</td>
                  <td className="py-3 px-4 font-semibold text-[#1aae39] bg-[#e6e0f5]/15 flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-[#1aae39]" /> Included in Standard Business
                  </td>
                  <td className="py-3 px-4 text-[#787671]">Expensive Enterprise Add-on</td>
                </tr>
                <tr className="hover:bg-[#fafaf9]">
                  <td className="py-3 px-4 font-medium text-[#1a1a1a]">REST API &amp; Webhooks Access</td>
                  <td className="py-3 px-4 font-semibold text-[#1aae39] bg-[#e6e0f5]/15 flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-[#1aae39]" /> Included in All Tiers
                  </td>
                  <td className="py-3 px-4 text-[#787671]">Gated by Developer Plans</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 4. 4-Tier Pricing Grid */}
      <div className="w-full bg-[#f6f5f4] py-20 border-t border-b border-[#e5e3df]">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="heading-1 text-[#1a1a1a] mb-2 font-display">
              Predictable pricing for electronic signatures.
            </h2>
            <p className="text-[#5d5b54] text-base">
              No envelope overages. No surprise annual true-ups. Simple, honest pricing for teams of any size.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Tier 1: Free */}
            <div className="bg-white rounded-lg p-6 border border-[#e5e3df] flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#1a1a1a]">Free</h3>
                <p className="text-xs text-[#787671] mt-1 mb-4">For individuals needing legally binding signatures</p>
                <div className="text-3xl font-bold text-[#1a1a1a] mb-4">$0</div>
                <ul className="space-y-2.5 text-xs text-[#37352f]">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Unlimited document templates</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Self-service intake forms</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Full cryptographic audit trail</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Standard X.509 signatures</li>
                </ul>
              </div>
              <button onClick={onGetStarted} className="btn btn-secondary w-full text-xs mt-6 rounded-md">
                Start Signing Free
              </button>
            </div>

            {/* Tier 2: Plus */}
            <div className="bg-white rounded-lg p-6 border border-[#e5e3df] flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#1a1a1a]">Plus</h3>
                <p className="text-xs text-[#787671] mt-1 mb-4">For small businesses and professional practices</p>
                <div className="text-3xl font-bold text-[#1a1a1a] mb-4">$10<span className="text-xs font-normal text-[#787671]"> / user</span></div>
                <ul className="space-y-2.5 text-xs text-[#37352f]">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Automated reminder sequences</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Custom branding and logos</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> SMS OTP mobile signing</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Real-time webhook notifications</li>
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
                <p className="text-xs text-[#787671] mt-1 mb-4">For growing teams needing strict compliance</p>
                <div className="text-3xl font-bold text-[#1a1a1a] mb-4">$18<span className="text-xs font-normal text-[#787671]"> / user</span></div>
                <ul className="space-y-2.5 text-xs text-[#37352f]">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> RFC 3161 qualified TSA timestamps</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> 21 CFR Part 11 strict compliance</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> MCP Agent Server token access</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Deterministic multi-signer routing</li>
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
                <p className="text-xs text-[#787671] mt-1 mb-4">Dedicated security controls and private cloud</p>
                <div className="text-3xl font-bold text-[#1a1a1a] mb-4">Custom</div>
                <ul className="space-y-2.5 text-xs text-[#37352f]">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Custom PKCS#12 root certificates</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Hardware Security Module (HSM)</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> SAML SSO &amp; SCIM user provisioning</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-[#1aae39]" /> Air-gapped private deployment</li>
                </ul>
              </div>
              <button onClick={onGetStarted} className="btn btn-secondary w-full text-xs mt-6 rounded-md">
                Contact sales
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Footer with Official Logo */}
      <footer className="w-full bg-white border-t border-[#e5e3df] py-14 px-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center space-x-3">
            <img 
              src="/logo_horizontal.png" 
              alt="Docurama: Documents Signed Simplified" 
              className="h-8 object-contain" 
            />
            <span className="text-xs text-[#787671] border-l border-[#e5e3df] pl-3">
              Cryptographic Electronic Signatures &amp; Document Intelligence
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#787671]">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#1aae39]" />
              <span className="font-medium text-[#1a1a1a]">Systems Operational</span>
            </span>
            <span>&bull;</span>
            <span className="text-[#5645d4] font-medium">PAdES-LTV Compliant</span>
            <span>&bull;</span>
            <span>RFC 3161 TSA</span>
            <span>&bull;</span>
            <span>21 CFR Part 11</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
