import React, { useState } from 'react';
import {
  X,
  Check,
  Zap,
  Building2,
  Server,
  Cloud,
  Sparkles,
  ShieldCheck,
  ArrowRight,
  Lock,
  Mail,
  Users,
  Smartphone,
  Globe
} from 'lucide-react';
import { AccountUsage } from '../lib/api';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  usage?: AccountUsage | null;
  onSelectPlan?: (plan: string, interval: 'monthly' | 'annual') => void;
}

export const PricingModal: React.FC<PricingModalProps> = ({
  isOpen,
  onClose,
  usage,
  onSelectPlan
}) => {
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('annual');

  if (!isOpen) return null;

  const currentPlan = usage?.plan?.toLowerCase() || 'plus';
  const isTrial = Boolean(usage?.is_trial);

  const handleChoose = (planKey: string) => {
    if (planKey === 'enterprise') {
      const subject = encodeURIComponent('Docurama Enterprise Sovereignty & Custom Deployment Inquiry');
      const body = encodeURIComponent(
        `Hello Docurama Enterprise Team,\n\nI am interested in learning more about Docurama Enterprise options (Dedicated Private Cloud / On-Premises / Managed Public Cloud).\n\nWorkspace: ${usage?.account_name || 'N/A'}\nAccount ID: ${usage?.account_id || 'N/A'}\nEstimated Monthly Volume: 500+ envelopes\nDeployment Target: [Dedicated EU Private Cloud / On-Premises Air-Gapped / Managed Cloud]\n\nPlease contact me with technical documentation and pricing details.`
      );
      window.open(`mailto:sales@docurama.eu?subject=${subject}&body=${body}`, '_blank');
      return;
    }

    if (onSelectPlan) {
      onSelectPlan(planKey, billingInterval);
    } else {
      const subject = encodeURIComponent(`Docurama ${planKey.toUpperCase()} Subscription Request (${billingInterval})`);
      const body = encodeURIComponent(
        `Hello,\n\nI would like to activate the ${planKey.toUpperCase()} subscription (${billingInterval} billing) for workspace:\nAccount ID: ${usage?.account_id || 'N/A'}\nAccount Name: ${usage?.account_name || 'N/A'}\n\nPlease send checkout and invoice details.`
      );
      window.open(`mailto:sales@docurama.eu?subject=${subject}&body=${body}`, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-5xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-8">
        
        {/* Top Header */}
        <div className="relative px-6 pt-8 pb-6 text-center border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white">
          <button
            onClick={onClose}
            className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200/80 text-[11px] font-bold text-[#1D72FE] uppercase tracking-wider mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            Transparent European Pricing
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight font-heading">
            Sovereign E-Signatures with Zero Lock-In
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-slate-600 max-w-xl mx-auto">
            Choose the ideal plan for your organisation. All plans feature cryptographically binding PAdES-LTV signatures and RFC 3161 timestamps.
          </p>

          {/* Billing Switcher */}
          <div className="mt-6 inline-flex items-center p-1 bg-slate-100 rounded-2xl border border-slate-200/80">
            <button
              onClick={() => setBillingInterval('monthly')}
              className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all ${
                billingInterval === 'monthly'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Monthly Billing
            </button>
            <button
              onClick={() => setBillingInterval('annual')}
              className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${
                billingInterval === 'annual'
                  ? 'bg-[#1D72FE] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Annual Billing</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                -20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50/50">
          
          {/* 1. PLUS TIER */}
          <div className={`relative flex flex-col justify-between p-6 rounded-2xl bg-white border transition-all ${
            currentPlan === 'plus' && !isTrial
              ? 'border-blue-300 ring-2 ring-blue-100 shadow-md'
              : 'border-slate-200 hover:border-slate-300 shadow-sm'
          }`}>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Professionals
                </span>
                {currentPlan === 'plus' && isTrial && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                    Active Trial
                  </span>
                )}
                {currentPlan === 'plus' && !isTrial && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-[#1D72FE]">
                    Current Plan
                  </span>
                )}
              </div>

              <h3 className="mt-2 text-xl font-bold text-slate-900">Plus</h3>
              <p className="text-xs text-slate-500 mt-1 min-h-[32px]">
                Essential cryptographic signing for independent professionals and executives.
              </p>

              <div className="mt-5 pb-5 border-b border-slate-100">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl sm:text-4xl font-extrabold text-slate-900">
                    {billingInterval === 'annual' ? '€15' : '€19'}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">/ month</span>
                </div>
                <div className="text-[11px] text-emerald-600 font-semibold mt-1">
                  {billingInterval === 'annual' ? '€180 billed annually (Save €48)' : 'Billed monthly, cancel anytime'}
                </div>
                <div className="mt-2 text-[11px] font-medium text-slate-600 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>14-day free trial, no credit card required</span>
                </div>
              </div>

              {/* Features List */}
              <ul className="mt-5 space-y-2.5 text-xs text-slate-600">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span><strong>30 envelopes</strong> per month</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span><strong>1 team seat</strong></span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>PAdES-LTV X.509 digital certificates</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>RFC 3161 trusted timestamping</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Automated email &amp; SMS OTP authentication</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Visual Document Studio &amp; AcroForm auto-detect</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Permanent read-only archive access</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-4">
              <button
                onClick={() => handleChoose('plus')}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 ${
                  currentPlan === 'plus' && !isTrial
                    ? 'bg-slate-100 text-slate-700 cursor-default'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                <span>{currentPlan === 'plus' && !isTrial ? 'Current Plan' : isTrial ? 'Extend Plus Plan' : 'Start 14-Day Trial'}</span>
                {!(currentPlan === 'plus' && !isTrial) && <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* 2. BUSINESS TEAM TIER (RECOMMENDED) */}
          <div className={`relative flex flex-col justify-between p-6 rounded-2xl bg-white border-2 transition-all shadow-lg ${
            currentPlan === 'business'
              ? 'border-[#1D72FE] ring-2 ring-blue-100'
              : 'border-[#1D72FE]/80 hover:border-[#1D72FE]'
          }`}>
            {/* Ribbon Badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#1D72FE] text-white shadow-sm flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Most Popular for Teams
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#1D72FE]">
                  Growing Companies
                </span>
                {currentPlan === 'business' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-[#1D72FE]">
                    Current Plan
                  </span>
                )}
              </div>

              <h3 className="mt-2 text-xl font-bold text-slate-900">Business Team</h3>
              <p className="text-xs text-slate-500 mt-1 min-h-[32px]">
                Collaborative signing, branded subdomains, multi-channel OTP, and developer APIs.
              </p>

              <div className="mt-5 pb-5 border-b border-slate-100">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl sm:text-4xl font-extrabold text-slate-900">
                    {billingInterval === 'annual' ? '€39' : '€49'}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">/ month</span>
                </div>
                <div className="text-[11px] text-emerald-600 font-semibold mt-1">
                  {billingInterval === 'annual' ? '€468 billed annually (Save €120)' : 'Billed monthly, cancel anytime'}
                </div>
                <div className="mt-2 text-[11px] font-medium text-slate-600 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-[#1D72FE]" />
                  <span>3 seats included (+€15/additional seat)</span>
                </div>
              </div>

              {/* Features List */}
              <ul className="mt-5 space-y-2.5 text-xs text-slate-600">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span><strong>250 pooled envelopes</strong> per month</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span><strong>3 team seats</strong> included with role permissions</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Multi-channel OTP: <strong>WhatsApp, Telegram, SMS</strong></span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Custom workspace subdomain (e.g. yourco.docurama.eu)</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Custom verified domain with DKIM, SPF &amp; CNAME routing</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Developer REST API keys &amp; webhook dispatchers</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>CSV bulk send with automated recipient batching</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Full white-label branding &amp; custom email styling</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-4">
              <button
                onClick={() => handleChoose('business')}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all shadow-md bg-[#1D72FE] hover:bg-[#165ECC] text-white flex items-center justify-center gap-2"
              >
                <span>{currentPlan === 'business' ? 'Current Plan' : 'Upgrade to Business Team'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 3. ENTERPRISE TIER */}
          <div className={`relative flex flex-col justify-between p-6 rounded-2xl bg-white border transition-all ${
            currentPlan === 'enterprise'
              ? 'border-purple-300 ring-2 ring-purple-100 shadow-md'
              : 'border-slate-200 hover:border-slate-300 shadow-sm'
          }`}>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-600">
                  Sovereignty &amp; Scale
                </span>
                {currentPlan === 'enterprise' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                    Current Plan
                  </span>
                )}
              </div>

              <h3 className="mt-2 text-xl font-bold text-slate-900">Enterprise</h3>
              <p className="text-xs text-slate-500 mt-1 min-h-[32px]">
                Dedicated private cloud, on-premises air-gapped, or sovereign EU hosting with custom HSM.
              </p>

              <div className="mt-5 pb-5 border-b border-slate-100">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl sm:text-4xl font-extrabold text-slate-900">Custom</span>
                </div>
                <div className="text-[11px] text-purple-700 font-semibold mt-1">
                  Tailored to enterprise volume &amp; compliance
                </div>
                <div className="mt-2 text-[11px] font-medium text-slate-600 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
                  <span>EU data residency, GDPR program, PAdES cryptographic evidence</span>
                </div>
              </div>

              {/* Deployment Options */}
              <div className="mt-4 p-3 rounded-xl bg-purple-50/60 border border-purple-100 space-y-1.5 text-[11px] text-purple-900">
                <div className="font-bold flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-purple-600" />
                  Four Deployment Models:
                </div>
                <div className="text-slate-600">
                  1. <strong>Managed Public Cloud</strong>
                </div>
                <div className="text-slate-600">
                  2. <strong>Managed Private Cloud</strong>
                </div>
                <div className="text-slate-600">
                  3. <strong>On-Premises</strong> (customer-controlled)
                </div>
                <div className="text-slate-600">
                  4. <strong>Air-Gapped</strong> (where technically appropriate)
                </div>
              </div>

              {/* Features List */}
              <ul className="mt-4 space-y-2.5 text-xs text-slate-600">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span><strong>10,000+ envelopes</strong> per month, per contract</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span><strong>Seats per contract</strong> with SSO (SAML 2.0, OIDC)</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span>Custom PKI &amp; Hardware Security Module (HSM) integration</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span>Dedicated support with contractual SLA options</span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <span>Custom legal hold &amp; strict data retention rules</span>
                </li>
              </ul>
            </div>

            <div className="mt-8 pt-4">
              <button
                onClick={() => handleChoose('enterprise')}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all shadow-sm bg-purple-700 hover:bg-purple-800 text-white flex items-center justify-center gap-2"
              >
                <span>Contact Enterprise Sales</span>
                <Mail className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

        </div>

        {/* Trust Footnote */}
        <div className="px-6 py-4 bg-slate-100 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#1D72FE]" />
            <span>
              GDPR compliance program with data residency in European data centres.
            </span>
          </div>
          <div className="text-[11px] text-slate-500 text-center sm:text-right">
            14-day Plus trial · No credit card required · Fair Exit on annual billing
          </div>
        </div>

      </div>
    </div>
  );
};
