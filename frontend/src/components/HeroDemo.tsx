import React from 'react';
import { MousePointer2, ShieldCheck, CheckCircle2, Clock } from 'lucide-react';

/**
 * Self-playing signing sequence layered over the landing hero mockup (Sprint 8).
 *
 * Pure CSS on one master 9s timeline: a cursor glides in, draws the signature,
 * the pending signer flips to signed, and a PAdES seal pops. Everything loops
 * in phase; prefers-reduced-motion collapses to the completed static state.
 * The overlay is pointer-events-none and purely decorative (aria-hidden).
 */
export const HeroDemoOverlay: React.FC = () => (
  <div aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-visible z-10">
    {/* 1. Animated cursor */}
    <div className="hero-demo-cursor absolute" style={{ opacity: 0 }}>
      <MousePointer2 className="w-4 h-4 text-[#1a1a1a] fill-white drop-shadow" />
      <span className="absolute -top-3.5 -left-3.5 w-5 h-5 rounded-full bg-[#5645d4]/20" />
    </div>

    {/* 2. PAdES seal chip - pops after the signature lands */}
    <div className="hero-demo-seal absolute top-3 right-3" style={{ opacity: 0 }}>
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white bg-[#1aae39] rounded-full px-2.5 py-1 shadow-md">
        <ShieldCheck className="w-3 h-3" />
        Sealed · PAdES-LTV
      </span>
    </div>

    {/* 3. PAdES seal chip - pops after the signature lands */}
    <div className="hero-demo-seal absolute top-3 right-3" style={{ opacity: 0 }}>
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-white bg-[#1aae39] rounded-full px-2.5 py-1 shadow-md">
        <ShieldCheck className="w-3 h-3" />
        Sealed · PAdES-LTV
      </span>
    </div>
  </div>
);

/**
 * The second signer's status line, animated: "Pending Signature" cross-fades
 * to "Signed & Sealed" at 62% of the shared 9s loop, mirroring the cursor's
 * visit. Rendered inside the real signer card so alignment holds on every
 * breakpoint. Reduced motion collapses to the signed state.
 */
export const HeroSignerStatusFlip: React.FC = () => (
  <span className="relative inline-flex">
    <span className="hero-demo-pending inline-flex items-center gap-1 text-[11px] font-medium text-[#dd5b00]">
      <Clock className="w-3.5 h-3.5" /> Pending Signature
    </span>
    <span
      className="hero-demo-signed absolute left-0 top-0 inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-[#1aae39]"
      style={{ opacity: 0 }}
    >
      <CheckCircle2 className="w-3.5 h-3.5" /> Signed &amp; Sealed
    </span>
  </span>
);

/**
 * The drawing signature path. Swapped in for the hero mockup's static
 * signature SVG: identical geometry, but with pathLength normalization so
 * the dash-offset draw animation works regardless of true path length.
 */
export const HeroSignaturePath: React.FC = () => (
  <svg className="w-36 sm:w-44 h-9" viewBox="0 0 200 60" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M10 40C30 15 50 48 70 30C90 12 110 50 135 25C150 10 160 45 190 28"
      stroke="#5645d4"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={100}
      className="hero-demo-signature"
    />
  </svg>
);
