import React, { useEffect, useMemo, useState } from 'react';
import { pricingApi, type PricingConfig } from '../lib/api';
import { useI18n } from '../i18n';
import { KB_ITEMS } from '../content/kb';
import { Skeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import { Check, Clock, ShieldCheck, Sparkles, ChevronDown, Globe, Lock, Server, FileCheck2 } from 'lucide-react';

const fmtEUR = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  return '€' + v.toFixed(2).replace(/\.00$/, '');
};

/**
 * Public pricing page — final commercial model.
 *
 * Exactly three commercial choices: Plus, Business Team, Enterprise. No free
 * tier and no free self-host plan exist anywhere. Renders the server's
 * pricing config verbatim — tier list, cycle constants, monthly/annual
 * intervals — and previews Fair Exit refunds by calling the same endpoints
 * the billing engine uses. No price math is invented client-side: totals
 * come from the /api/pricing calculators so the page can never drift from
 * what would actually be charged.
 */
export const PricingPage: React.FC<{ onNavigate?: (tab: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<string>('monthly');
  const [quoteTier, setQuoteTier] = useState<string>('plus');
  const [extraSeats, setExtraSeats] = useState<number>(0);
  const [quote, setQuote] = useState<any>(null);
  const [cyclesCompleted, setCyclesCompleted] = useState<number>(2);
  const [refund, setRefund] = useState<any>(null);

  useEffect(() => {
    let live = true;
    pricingApi
      .config()
      .then((c) => live && setConfig(c))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  // Server-side quotes for the selected tier+interval(+seats) and refund preview.
  useEffect(() => {
    if (!config) return;
    let live = true;
    pricingApi.quote(quoteTier, interval, extraSeats).then((q) => live && setQuote(q)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [config, quoteTier, interval, extraSeats]);

  useEffect(() => {
    if (!config) return;
    let live = true;
    pricingApi
      .refundQuote(quoteTier, interval, cyclesCompleted)
      .then((r) => live && setRefund(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [config, quoteTier, interval, cyclesCompleted]);

  const annual = interval === 'annual';
  const currentInterval = useMemo(
    () => config?.intervals.find((i) => i.id === interval),
    [config, interval]
  );
  const maxCycles = currentInterval?.cycles ?? 1;

  if (error) {
    return (
      <div className="py-20 text-center text-sm text-[#787671]" role="alert">
        {error}
      </div>
    );
  }
  if (!config) {
    return (
      <div className="py-10 space-y-4" aria-busy="true">
        <Skeleton className="h-10 w-2/3 mx-auto" />
        <div className="grid md:grid-cols-3 gap-5 mt-8">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const priceFor = (tier: PricingConfig['tiers'][number]): number | null => {
    if (tier.contact_sales || tier.list_price_eur === null) return null;
    if (annual && tier.annual_total_eur !== null && tier.annual_total_eur !== undefined) {
      return tier.annual_total_eur / 12;
    }
    return tier.list_price_eur;
  };

  return (
    <div className="space-y-10">
      {/* Premium positioning banner: cycle + trial, both server-truthed */}
      <div className="rounded-xl border border-[#e5e3df] bg-white p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#f3f0fb] text-[#5645d4] flex items-center justify-center shrink-0">
          <Clock className="w-4.5 h-4.5" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-[#1a1a1a]">{t('cycle.banner')}</p>
          <p className="text-xs text-[#787671] mt-0.5">
            {config.covered_days_per_year} {t('pricing.days')} / {config.bonus_days_per_year} {t('pricing.bonusdays')}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-[#f0faf4] border border-emerald-200 px-3 py-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="text-xs font-semibold text-emerald-700">
            {config.trial_days}-day free trial · No credit card required
          </p>
        </div>
      </div>

      <header className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-bold text-[#1a1a1a] text-balance">{t('pricing.title')}</h1>
        <p className="mt-3 text-sm md:text-base text-[#5d5b54] leading-6">{t('pricing.sub')}</p>
      </header>

      {/* Positioning pillars */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl mx-auto">
        {[
          { icon: Lock, label: t('pricing.pillar.trust') },
          { icon: FileCheck2, label: t('pricing.pillar.evidence') },
          { icon: Globe, label: t('pricing.pillar.sovereignty') },
          { icon: Server, label: t('pricing.pillar.deployment') },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2 justify-center rounded-lg border border-[#e5e3df] bg-white px-3 py-2.5">
            <Icon className="w-4 h-4 text-[#5645d4] shrink-0" />
            <span className="text-xs font-medium text-[#37352f]">{label}</span>
          </div>
        ))}
      </div>

      {/* Billing interval selector */}
      <div className="flex flex-wrap items-center justify-center gap-2" role="tablist" aria-label={t('pricing.interval')}>
        {(config.intervals ?? []).map((i) => (
          <button
            key={i.id}
            role="tab"
            aria-selected={interval === i.id}
            onClick={() => setInterval(i.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              interval === i.id
                ? 'bg-[#5645d4] text-white border-[#5645d4] shadow-sm'
                : 'bg-white text-[#37352f] border-[#e5e3df] hover:border-[#a4a097]'
            }`}
          >
            {i.id === 'monthly' ? t('pricing.interval.monthly') : t('pricing.interval.annual')}
          </button>
        ))}
        {annual && (
          <span className="text-xs font-semibold text-emerald-600">{t('pricing.annual.save')}</span>
        )}
      </div>

      {/* Tier cards */}
      <div className="grid md:grid-cols-3 gap-5 items-start max-w-5xl mx-auto">
        {config.tiers.map((tier) => {
          const isContact = tier.contact_sales;
          const highlighted = tier.id === 'business_team';
          const active = quoteTier === tier.id && !isContact;
          const price = priceFor(tier);
          const sellsSeats = tier.extra_seat_price_eur !== null && tier.extra_seat_price_eur !== undefined;
          return (
            <div
              key={tier.id}
              className={`rounded-xl border bg-white p-5 flex flex-col gap-4 relative ${
                highlighted ? 'border-[#5645d4] shadow-notion-modal' : 'border-[#e5e3df]'
              }`}
            >
              {highlighted && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-white bg-[#5645d4] rounded-full px-2.5 py-0.5">
                  <Sparkles className="w-3 h-3" /> {t('pricing.popular')}
                </span>
              )}
              <div>
                <h2 className="text-base font-bold text-[#1a1a1a]">{tier.display_name}</h2>
                <p className="text-xs text-[#787671] mt-0.5">{tier.tagline}</p>
              </div>
              <div>
                {isContact ? (
                  <>
                    <span className="text-3xl font-bold text-[#1a1a1a]">{t('pricing.custom')}</span>
                    {tier.reference_price && (
                      <p className="text-[11px] text-[#787671] mt-1">{tier.reference_price}</p>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-3xl font-bold text-[#1a1a1a] tabular-nums">{fmtEUR(price)}</span>
                    <span className="text-xs text-[#787671] ml-1.5">/ {t('pricing.month')}</span>
                    {annual && price !== null && (
                      <p className="text-[11px] text-[#787671] mt-1">
                        {t('pricing.billedannually')} {fmtEUR(tier.annual_total_eur)}
                      </p>
                    )}
                    {annual && tier.annual_total_eur !== null && (
                      <p className="text-[11px] text-emerald-600 font-semibold mt-0.5">
                        {t('pricing.savings')} {fmtEUR(tier.list_price_eur! * 12 - tier.annual_total_eur)}
                      </p>
                    )}
                  </>
                )}
                {!isContact && tier.id === 'plus' && (
                  <p className="text-[11px] text-emerald-700 font-medium mt-1.5">
                    {config.trial_days}-day free trial · No credit card required
                  </p>
                )}
                {!isContact && tier.seats !== null && (
                  <p className="text-[11px] text-[#787671] mt-1">
                    {tier.seats} {tier.seats === 1 ? t('pricing.seat') : t('pricing.seatsincl')} · {tier.envelopes_per_cycle} {t('pricing.envelopes')}
                  </p>
                )}
              </div>
              {/* Business Team extra seats */}
              {sellsSeats && !isContact && (
                <div className="flex items-center justify-between rounded-lg border border-[#e5e3df] bg-[#fbfbfa] px-3 py-2">
                  <label className="text-[11px] font-medium text-[#37352f]" htmlFor={`seats-${tier.id}`}>
                    {t('pricing.extraseats')}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={t('pricing.extraseats.remove')}
                      onClick={() => { setExtraSeats(Math.max(0, extraSeats - 1)); setQuoteTier(tier.id); }}
                      className="w-6 h-6 rounded-md border border-[#e5e3df] bg-white text-sm leading-none text-[#37352f] hover:border-[#a4a097]"
                    >−</button>
                    <input
                      id={`seats-${tier.id}`}
                      type="number"
                      min={0}
                      max={500}
                      value={extraSeats}
                      onChange={(e) => { setExtraSeats(Math.max(0, Math.min(500, Number(e.target.value) || 0))); setQuoteTier(tier.id); }}
                      className="w-12 h-6 text-center rounded-md border border-[#e5e3df] bg-white tabular-nums text-xs"
                      aria-label={t('pricing.extraseats')}
                    />
                    <button
                      type="button"
                      aria-label={t('pricing.extraseats.add')}
                      onClick={() => { setExtraSeats(Math.min(500, extraSeats + 1)); setQuoteTier(tier.id); }}
                      className="w-6 h-6 rounded-md border border-[#e5e3df] bg-white text-sm leading-none text-[#37352f] hover:border-[#a4a097]"
                    >+</button>
                    <span className="text-[10px] text-[#787671] ml-1">{fmtEUR(tier.extra_seat_price_eur)}/{t('pricing.mo')}</span>
                  </div>
                </div>
              )}
              <ul className="space-y-1.5 text-xs text-[#37352f]">
                {tier.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-px" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {/* Enterprise deployment options */}
              {isContact && tier.deployment_options && (
                <div className="flex flex-wrap gap-1.5">
                  {tier.deployment_options.map((d) => (
                    <Badge key={d} variant="neutral">{d}</Badge>
                  ))}
                </div>
              )}
              <div className="mt-auto pt-2">
                {isContact ? (
                  <a href="mailto:sales@docurama.eu" className="btn btn-ghost w-full justify-center h-9 text-xs border border-[#e5e3df]">
                    {t('pricing.talktosales')}
                  </a>
                ) : config.billing_enabled ? (
                  <button
                    onClick={() => onNavigate?.('signin')}
                    className="btn btn-primary w-full justify-center h-9 text-xs"
                  >
                    {tier.id === 'plus' ? t('pricing.starttrial') : t('pricing.choose')} {tier.display_name}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <button
                      onClick={() => onNavigate?.('signin')}
                      className="btn btn-primary w-full justify-center h-9 text-xs"
                    >
                      {tier.id === 'plus' ? t('pricing.starttrial') : t('pricing.choose')} {tier.display_name}
                    </button>
                    <p className="text-[10px] text-[#787671] text-center">{t('pricing.comingsoon')}</p>
                  </div>
                )}
                {!isContact && (
                  <button
                    onClick={() => setQuoteTier(tier.id)}
                    className={`mt-1.5 w-full text-center text-[11px] font-medium rounded-md py-1.5 transition-colors ${
                      active ? 'text-[#5645d4] bg-[#f3f0fb]' : 'text-[#787671] hover:text-[#1a1a1a] hover:bg-[#f6f5f4]'
                    }`}
                    aria-pressed={active}
                  >
                    {t('pricing.refundpreview')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quote + Fair Exit preview for selected tier */}
      {quote && !quote.error && (
        <div className="rounded-xl border border-[#e5e3df] bg-white p-5 grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          <div>
            <h3 className="text-sm font-bold text-[#1a1a1a] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#5645d4]" />
              {quote.display_name} · {interval === 'annual' ? t('pricing.interval.annual') : t('pricing.interval.monthly')}
              {quote.extra_seats > 0 && <span className="text-[#787671] font-normal">+ {quote.extra_seats} {t('pricing.seats')}</span>}
            </h3>
            <dl className="mt-3 space-y-1.5 text-xs text-[#37352f]">
              <div className="flex justify-between max-w-xs">
                <dt className="text-[#787671]">{t('pricing.percycle')}</dt>
                <dd className="font-semibold tabular-nums">{fmtEUR(quote.per_cycle_eur)}</dd>
              </div>
              {quote.extra_seats_total_eur > 0 && (
                <div className="flex justify-between max-w-xs">
                  <dt className="text-[#787671]">{t('pricing.extraseats')}</dt>
                  <dd className="font-semibold tabular-nums">{fmtEUR(quote.extra_seats_total_eur)}</dd>
                </div>
              )}
              <div className="flex justify-between max-w-xs">
                <dt className="text-[#787671]">{t('pricing.total')}</dt>
                <dd className="font-semibold tabular-nums">{fmtEUR(quote.total_eur)}</dd>
              </div>
              {quote.savings_eur > 0 && (
                <div className="flex justify-between max-w-xs text-emerald-600">
                  <dt>{t('pricing.savings')}</dt>
                  <dd className="font-semibold tabular-nums">{fmtEUR(quote.savings_eur)}</dd>
                </div>
              )}
              <div className="flex justify-between max-w-xs">
                <dt className="text-[#787671]">{t('pricing.covered')}</dt>
                <dd className="font-semibold tabular-nums">{quote.covered_days} {t('pricing.days')}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#1a1a1a] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              {t('pricing.refundpreview')}
            </h3>
            <p className="text-xs text-[#787671] mt-1">
              {t('pricing.refundquestion')}{' '}
              <input
                type="number"
                min={0}
                max={maxCycles}
                value={cyclesCompleted}
                onChange={(e) => setCyclesCompleted(Math.max(0, Math.min(maxCycles, Number(e.target.value) || 0)))}
                className="w-16 h-7 text-center rounded-md border border-[#e5e3df] bg-[#fbfbfa] tabular-nums text-xs"
                aria-label={t('pricing.refundcycles')}
              />{' '}
              {t('pricing.refundcycles')}:
            </p>
            {refund && !refund.error && (
              <div className="mt-3 rounded-lg bg-[#f6f5f4] p-3.5">
                <p className="text-lg font-bold text-[#1a1a1a] tabular-nums">
                  {refund.refund_type === 'cash' && fmtEUR(refund.refund_amount_eur)}
                  {refund.refund_type === 'cash' && <span className="text-xs font-medium text-[#787671] ml-1.5">{t('pricing.refundcash')}</span>}
                  {refund.refund_type === 'period_end' && t('pricing.refundperiodend')}
                </p>
                {refund.guarantee && (
                  <Badge className="mt-2" variant="success">
                    <ShieldCheck className="w-3 h-3 mr-1 text-emerald-600" />
                    {refund.guarantee}
                  </Badge>
                )}
                <p className="text-[11px] text-[#787671] mt-2 leading-5">{refund.note}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fair Exit explainer */}
      <section className="rounded-xl border border-[#e5e3df] bg-[#f3f0fb]/40 p-5 sm:p-7 max-w-5xl mx-auto">
        <h2 className="text-lg font-bold text-[#1a1a1a] flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[#5645d4]" />
          {t('pricing.fairexit.title')}
        </h2>
        <p className="mt-2 text-sm text-[#37352f] leading-6 max-w-3xl">{t('pricing.fairexit.body')}</p>
      </section>

      {/* Pricing FAQ */}
      <PricingFaq />
    </div>
  );
};

const PRICING_FAQ_IDS = ['kb-015', 'kb-016', 'kb-017', 'kb-018'];

const PricingFaq: React.FC = () => {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>('kb-015');
  const items = KB_ITEMS.filter((k) => PRICING_FAQ_IDS.includes(k.id));
  return (
    <section>
      <h2 className="text-lg font-bold text-[#1a1a1a] mb-3">{t('pricing.faq')}</h2>
      <div className="divide-y divide-[#e5e3df] rounded-xl border border-[#e5e3df] bg-white overflow-hidden">
        {items.map((item: any) => (
          <div key={item.id}>
            <button
              onClick={() => setOpen(open === item.id ? null : item.id)}
              className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left text-sm font-semibold text-[#1a1a1a] hover:bg-[#fbfbfa] transition-colors"
              aria-expanded={open === item.id}
            >
              {item.q}
              <ChevronDown className={`w-4 h-4 text-[#787671] shrink-0 transition-transform ${open === item.id ? 'rotate-180' : ''}`} />
            </button>
            {open === item.id && (
              <p className="px-4 pb-4 text-xs text-[#5d5b54] leading-6">{item.a}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};
