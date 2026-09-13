import React, { useState, useEffect } from 'react';
import { Shield, ShieldCheck, Lock, ArrowRight, AlertCircle, CheckCircle2, Server, Key, UserCheck } from 'lucide-react';
import { api } from '../lib/api';

interface AdminSetupPageProps {
  onSetupComplete?: (user: any) => void;
}

export const AdminSetupPage: React.FC<AdminSetupPageProps> = ({ onSetupComplete }) => {
  const [setupStatus, setSetupStatus] = useState<{
    needs_setup: boolean;
    admin_count: number;
    deployment_mode: string;
    platform_domain: string;
  } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setLoadingStatus(true);
      setStatusError('');
      const data = await api.getAdminSetupStatus();
      setSetupStatus(data);
    } catch (err: any) {
      setStatusError(err.message || 'Unable to query deployment admin status');
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 12) {
      setError('Password must be at least 12 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please verify both fields.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.setupAdmin({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        password,
        organization_name: orgName.trim() || undefined,
      });

      if (onSetupComplete) {
        onSetupComplete(res.user);
      } else {
        window.location.href = '/admin';
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initialize platform administrator.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-10 h-10 border-2 border-[#5645d4] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-xs font-medium text-[#787671]">Verifying deployment security status...</p>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="w-full max-w-md bg-white rounded-lg p-8 border border-[#e5e3df] shadow-notion-card text-center">
        <div className="w-12 h-12 rounded-full bg-[#fde0ec] flex items-center justify-center mx-auto mb-4 text-[#e03131]">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-base font-semibold text-[#1a1a1a]">Status Check Failed</h2>
        <p className="text-xs text-[#787671] mt-2 mb-6">{statusError}</p>
        <button
          onClick={loadStatus}
          className="btn-primary w-full h-10 text-xs font-semibold rounded-md bg-[#5645d4] text-white hover:bg-[#4738be] transition-colors"
        >
          Retry Verification
        </button>
      </div>
    );
  }

  // State A: Admin Already Configured
  if (setupStatus && !setupStatus.needs_setup) {
    return (
      <div className="w-full max-w-lg bg-white rounded-lg p-8 md:p-10 border border-[#e5e3df] shadow-notion-card">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#e6f4ea] text-[#137333] mb-4">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#eef2ff] text-[#5645d4] mb-2">
            Platform Security &amp; Governance
          </div>
          <h1 className="text-lg font-bold text-[#1a1a1a]">Administrator Configured</h1>
          <p className="text-xs text-[#5d5b54] mt-2 max-w-sm mx-auto leading-relaxed">
            The root platform administrator for this Docurama deployment has already been created.
          </p>
        </div>

        <div className="bg-[#f8f7f5] rounded-md p-4 border border-[#e5e3df] mb-6 space-y-2.5 text-xs text-[#37352f]">
          <div className="flex items-center justify-between">
            <span className="text-[#787671] font-medium flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-[#5d5b54]" /> Deployment Mode
            </span>
            <span className="font-semibold uppercase tracking-wider text-[11px] text-[#1a1a1a]">
              {setupStatus.deployment_mode === 'cloud' ? 'Public Cloud SaaS' : 'Self-Hosted Enterprise'}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-[#e5e3df] pt-2">
            <span className="text-[#787671] font-medium flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-[#5d5b54]" /> Security Posture
            </span>
            <span className="font-medium text-[#137333] flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Immutable Chained Ledger
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-[#e5e3df] pt-2">
            <span className="text-[#787671] font-medium flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-[#5d5b54]" /> Active Admin Accounts
            </span>
            <span className="font-semibold text-[#1a1a1a]">{setupStatus.admin_count}</span>
          </div>
        </div>

        <p className="text-xs text-[#787671] text-center mb-6 leading-relaxed">
          Sign in with your master credentials to access the platform console, review tenants, audit cryptographic events, and manage system signing certificates.
        </p>

        <div className="space-y-3">
          <a
            href="/admin"
            className="flex items-center justify-center gap-2 w-full h-11 text-xs font-semibold rounded-md bg-[#5645d4] text-white hover:bg-[#4738be] transition-colors shadow-sm"
          >
            <span>Sign In to Admin Console</span>
            <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="/"
            className="flex items-center justify-center w-full h-10 text-xs font-medium rounded-md border border-[#c8c4be] bg-white text-[#37352f] hover:bg-[#f6f5f4] transition-colors"
          >
            Return to Public Portal
          </a>
        </div>
      </div>
    );
  }

  // State B: Needs Initial Setup
  return (
    <div className="w-full max-w-lg bg-white rounded-lg p-8 md:p-10 border border-[#e5e3df] shadow-notion-card">
      <div className="text-center mb-7">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#f3f0ff] text-[#5645d4] mb-3">
          <Shield className="w-8 h-8" />
        </div>
        <div className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#f0efff] text-[#5645d4] mb-1.5">
          Initial Platform Bootstrap
        </div>
        <h1 className="text-lg font-bold text-[#1a1a1a]">Set Up Platform Administrator</h1>
        <p className="text-xs text-[#5d5b54] mt-1.5 max-w-sm mx-auto leading-relaxed">
          Configure the primary administrator account for this Docurama deployment. This master account manages system settings, tenants, and compliance ledgers.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-[#fde0ec] border border-[#ff64c8]/30 text-[#e03131] text-xs flex items-center gap-2 mb-5">
          <AlertCircle className="w-4 h-4 shrink-0 text-[#e03131]" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="form-control">
            <label className="text-xs font-medium text-[#787671] block mb-1.5">First name *</label>
            <input
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="base-input w-full h-10 px-3 text-xs bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
              placeholder="Admin"
            />
          </div>
          <div className="form-control">
            <label className="text-xs font-medium text-[#787671] block mb-1.5">Last name (optional)</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="base-input w-full h-10 px-3 text-xs bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
              placeholder="Operator"
            />
          </div>
        </div>

        <div className="form-control">
          <label className="text-xs font-medium text-[#787671] block mb-1.5">Administrator Email *</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="base-input w-full h-10 px-3 text-xs bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
            placeholder="admin@yourdomain.com"
          />
        </div>

        <div className="form-control">
          <label className="text-xs font-medium text-[#787671] block mb-1.5">Organization Name (optional)</label>
          <input
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="base-input w-full h-10 px-3 text-xs bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
            placeholder="Primary Organization"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="form-control">
            <label className="text-xs font-medium text-[#787671] block mb-1.5">Master Password *</label>
            <input
              type="password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="base-input w-full h-10 px-3 text-xs bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
              placeholder="Min. 12 characters"
            />
          </div>
          <div className="form-control">
            <label className="text-xs font-medium text-[#787671] block mb-1.5">Confirm Password *</label>
            <input
              type="password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="base-input w-full h-10 px-3 text-xs bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
              placeholder="Repeat password"
            />
          </div>
        </div>

        <div className="p-3 rounded bg-[#faf9f8] border border-[#e5e3df] text-[11px] text-[#5d5b54] space-y-1">
          <p className="font-semibold text-[#37352f] flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-[#5645d4]" /> Security Notice
          </p>
          <p>
            This setup action creates the deployment root administrator with full governance authority. The event is recorded immutably in the system security event ledger.
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full h-11 text-xs font-semibold rounded-md bg-[#5645d4] text-white hover:bg-[#4738be] disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          {submitting ? (
            <span>Creating Administrator Account...</span>
          ) : (
            <>
              <span>Initialize Admin &amp; Launch Console</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </div>
  );
};
