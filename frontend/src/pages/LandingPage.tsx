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
  Cpu
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
    const rotateX = -(y / (rect.height / 2)) * 6;
    const rotateY = (x / (rect.width / 2)) * 6;
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
    <div className="py-6 bg-[#0a0a0a] text-white">
      {/* Hero Header */}
      <div className="relative z-10 max-w-4xl mx-auto text-center px-4 pt-8 pb-10">
        {/* Section Eyebrow */}
        <div className="caption-mono mb-4 text-[#7d8187] tracking-[1.4px]">
          CRYPTOGRAPHIC E-SIGNATURES &bull; RFC 3161 TIMESTAMPED
        </div>

        {/* Main Headline in xAI Display Ladder */}
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-normal tracking-[-0.04em] text-white leading-[1.06] mb-6 font-display">
          Engineered cryptographic document intelligence.
        </h1>

        <p className="text-base sm:text-lg text-[#dadbdf] max-w-2xl mx-auto font-normal leading-relaxed mb-8">
          High-assurance digital document signing with hardware-backed X.509 certificates, RFC 3161 timestamps, PAdES-LTV long-term validation, and native MCP agent interfaces.
        </p>

        {/* CTAs: Primary White Pill & Secondary Outline Pill */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="btn btn-primary font-normal px-7 h-10 text-xs flex items-center space-x-2"
          >
            <span>Launch Platform</span>
            <ArrowRight className="w-4 h-4 ml-1 stroke-[2]" />
          </button>
          <button
            onClick={scrollToFeatures}
            className="btn btn-outline font-normal px-6 h-10 text-xs"
          >
            Explore Architecture
          </button>
        </div>
      </div>

      {/* Interactive Cryptographic Document Inspector Card */}
      <div className="relative z-10 max-w-2xl mx-auto px-4 my-8">
        <div
          ref={cardRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{
            transform: `perspective(1000px) rotateX(${rotate.x}deg) rotateY(${rotate.y}deg)`,
            transition: 'transform 0.15s ease-out'
          }}
          className="bg-[#191919] rounded-lg p-6 sm:p-8 border border-[#212327] cursor-pointer select-none"
        >
          {/* Document Header */}
          <div className="flex items-center justify-between border-b border-[#212327] pb-4 mb-6">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 inline-flex items-center justify-center">
                <img src="/logo.svg" alt="Docurama" className="w-8 h-8 object-contain" />
              </div>
              <div>
                <div className="font-normal text-white text-sm leading-tight">Partnership_Agreement_2026.pdf</div>
                <div className="text-[11px] text-[#7d8187] font-mono mt-0.5">SHA-256: 8f4b...19c2 &bull; 3 Signers</div>
              </div>
            </div>
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[#1a1c20] text-[#a0c3ec] border border-[#212327] text-xs font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-[#a0c3ec] stroke-[2]" />
              <span>RFC 3161 Verified</span>
            </div>
          </div>

          {/* Document Mock Body */}
          <div className="space-y-3 mb-6">
            <div className="h-2 bg-[#212327] rounded-full w-full" />
            <div className="h-2 bg-[#212327] rounded-full w-5/6" />
            <div className="h-2 bg-[#212327] rounded-full w-4/6" />
          </div>

          {/* Interactive Signature Block */}
          <div className="bg-[#1a1c20] rounded-lg p-4 border border-[#212327] flex items-center justify-between">
            <div>
              <div className="caption-mono-sm text-[10px] text-[#7d8187] mb-1">
                Authorized Digital Seal
              </div>
              <svg className="w-40 sm:w-44 h-10" viewBox="0 0 200 60" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M10 40C30 15 50 48 70 30C90 12 110 50 135 25C150 10 160 45 190 28"
                  stroke="#ffffff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[#7d8187]">Verification Timestamp</div>
              <div className="text-xs font-normal text-[#dadbdf] font-mono">Docurama Root CA</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bento Grid: Core Capabilities */}
      <div id="features" className="relative z-10 max-w-5xl mx-auto px-4 mt-16 mb-12">
        <div className="text-center max-w-xl mx-auto mb-10">
          <div className="caption-mono mb-2 text-[#7d8187]">SPECIFICATIONS</div>
          <h2 className="text-2xl md:text-3xl font-normal text-white tracking-[-0.03em] mb-2 font-display">
            Built for cryptographic assurance
          </h2>
          <p className="text-[#7d8187] text-sm">
            Deterministic digital seals, automated signing sequences, and direct AI agent integration.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Bento Item 1 (Wide: 2 cols) */}
          <div className="md:col-span-2 p-6 flex flex-col justify-between bg-[#191919] rounded-lg border border-[#212327]">
            <div>
              <div className="w-10 h-10 rounded-full bg-[#1a1c20] border border-[#212327] text-white flex items-center justify-center mb-4">
                <PenTool className="w-4 h-4 stroke-[1.5]" />
              </div>
              <h3 className="text-lg font-normal text-white mb-2">Automated Multi-Party Sequences</h3>
              <p className="text-[#dadbdf] text-xs leading-relaxed max-w-lg">
                Configure sequential and parallel signing workflows with instant webhook callbacks, automated reminder schedules, and cryptographic tamper detection.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-[#212327] flex items-center justify-between text-xs text-[#7d8187] font-mono">
              <span>Multi-signer routing</span>
              <span>&bull;</span>
              <span>Cadence control</span>
              <span>&bull;</span>
              <span>SMS &amp; Email dispatch</span>
            </div>
          </div>

          {/* Bento Item 2 */}
          <div className="p-6 flex flex-col justify-between bg-[#191919] rounded-lg border border-[#212327]">
            <div>
              <div className="w-10 h-10 rounded-full bg-[#1a1c20] border border-[#212327] text-[#a0c3ec] flex items-center justify-center mb-4">
                <ShieldCheck className="w-4 h-4 stroke-[1.5]" />
              </div>
              <h3 className="text-lg font-normal text-white mb-2">RFC 3161 TSA &amp; PAdES-LTV</h3>
              <p className="text-[#dadbdf] text-xs leading-relaxed">
                Cryptographic digital timestamping with embedded CRL and OCSP responses for long-term document validity.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-[#212327] text-xs text-[#a0c3ec] font-mono">
              eIDAS &amp; ESIGN Verified
            </div>
          </div>

          {/* Bento Item 3 */}
          <div className="p-6 flex flex-col justify-between bg-[#191919] rounded-lg border border-[#212327]">
            <div>
              <div className="w-10 h-10 rounded-full bg-[#1a1c20] border border-[#212327] text-[#c4b5fd] flex items-center justify-center mb-4">
                <Smartphone className="w-4 h-4 stroke-[1.5]" />
              </div>
              <h3 className="text-lg font-normal text-white mb-2">Adaptive Mobile Signing</h3>
              <p className="text-[#dadbdf] text-xs leading-relaxed">
                Hardware-accelerated touch canvas rendering on mobile web browsers with zero installation prerequisites.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-[#212327] text-xs text-[#c4b5fd] font-mono">
              Zero Friction Studio
            </div>
          </div>

          {/* Bento Item 4 (Wide: 2 cols) */}
          <div className="md:col-span-2 p-6 flex flex-col justify-between bg-[#191919] rounded-lg border border-[#212327]">
            <div>
              <div className="w-10 h-10 rounded-full bg-[#1a1c20] border border-[#212327] text-white flex items-center justify-center mb-4">
                <Cpu className="w-4 h-4 stroke-[1.5]" />
              </div>
              <h3 className="text-lg font-normal text-white mb-2">Model Context Protocol (MCP) Server</h3>
              <p className="text-[#dadbdf] text-xs leading-relaxed max-w-lg">
                Expose signature verification, document dispatch, and audit logs directly to frontier AI coding agents such as Cursor, Windsurf, and Claude.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-[#212327] flex items-center justify-between text-xs text-[#7d8187] font-mono">
              <span>JSON-RPC Tools</span>
              <span>&bull;</span>
              <span>Autonomous Agents</span>
              <span>&bull;</span>
              <span>Token Scopes</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Status Bar */}
      <div className="relative z-10 max-w-5xl mx-auto px-4 mt-8 pt-6 border-t border-[#212327] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#7d8187]">
        <div className="flex items-center space-x-2 font-mono text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#a0c3ec]" />
          <span className="text-[#dadbdf]">Docurama Engine</span>
          <span>&bull;</span>
          <span>Cryptographic Pipeline</span>
          <span>&bull;</span>
          <span className="text-white">PAdES-LTV Ready</span>
        </div>
        <div className="font-mono text-[11px] text-[#7d8187]">
          RFC 3161 TSA &bull; X.509 Public Key Infrastructure
        </div>
      </div>
    </div>
  );
};
