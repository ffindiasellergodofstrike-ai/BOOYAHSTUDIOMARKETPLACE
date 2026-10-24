import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, Save, ShieldCheck } from 'lucide-react';
import { MarketplaceAdminService } from '../../services/MarketplaceAdminService';
import { marketplaceProviders, type MarketplaceProvider, MarketplaceSectionHeading, providerName, StatusBadge, useMarketplaceAdminData } from './AdminMarketplaceShared';

interface GatewaySettings {
  version: 1;
  enabled: Record<MarketplaceProvider, boolean>;
  defaultProvider: MarketplaceProvider;
  commissionBps: number;
}
interface GatewayReadiness {
  configured: boolean; enabled: boolean; environment: 'live' | 'test'; ready: boolean; isDefault: boolean;
  capabilities: { marketplace: boolean; subscriptions: boolean; automaticRenewal: boolean };
  readiness: string[];
}
interface GatewayResponse { settings: GatewaySettings; gateways: Record<MarketplaceProvider, GatewayReadiness>; activeProvider: MarketplaceProvider | null }

export function AdminMarketplaceGateways({ refreshKey }: { refreshKey: number }) {
  const state = useMarketplaceAdminData<GatewayResponse>('gateways', refreshKey);
  const [draft, setDraft] = useState<GatewaySettings | null>(null);
  const [commission, setCommission] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  // Refreshes do not discard a change in progress. Save always revalidates on the server.
  useEffect(() => {
    if (state.data && !dirty) { setDraft({ ...state.data.settings, enabled: { ...state.data.settings.enabled } }); setCommission(String(state.data.settings.commissionBps / 100)); }
  }, [state.data, dirty]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || saving || state.error) return;
    const percentage = Number(commission);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100 || !/^\d+(?:\.\d{1,2})?$/.test(commission)) { setError('Enter a commission between 0 and 100, with up to two decimal places.'); return; }
    if (reason.trim().length < 5) { setError('Add a reason of at least 5 characters for the audit record.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      await MarketplaceAdminService.saveGateways({ enabled: draft.enabled, defaultProvider: draft.defaultProvider, commissionBps: Math.round(percentage * 100), reason: reason.trim() });
      setDirty(false); setReason(''); setNotice('Gateway settings saved. New checkouts will use the available default provider.');
      await state.load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Gateway settings could not be saved.'); }
    finally { setSaving(false); }
  }
  return <div className="mpa-panel">
    <MarketplaceSectionHeading title="Payment gateways" description="Choose the provider for new payments after its account and capabilities are configured on the server." state={state} />
    <div className="mpa-alert mpa-alert-info"><ShieldCheck size={18} /><div>Existing orders, refunds and subscription mandates stay with their original provider. Turning off a gateway stops new checkouts; it does not stop payment webhooks or verification for earlier purchases.</div></div>
    {state.data && draft && <form onSubmit={save}>
      <div className="mpa-cards">{marketplaceProviders.map(provider => {
        const gateway = state.data?.gateways[provider];
        if (!gateway) return null;
        return <article className="mpa-card" key={provider}>
          <div className="mpa-card-head"><div><CreditCard size={22} className="mb-2" /><h4>{providerName(provider)}</h4></div><StatusBadge value={gateway.environment} /></div>
          <div className="mpa-stack"><StatusBadge value={gateway.configured ? 'configured' : 'unavailable'} label={gateway.configured ? 'Credentials configured' : 'Setup required'} /><StatusBadge value={gateway.ready ? 'verified' : 'pending'} label={gateway.ready ? 'Ready for new payments' : 'Readiness checks pending'} /></div>
          <div className="mpa-capabilities"><StatusBadge value={gateway.capabilities.marketplace ? 'enabled' : 'pending'} label={`Marketplace ${gateway.capabilities.marketplace ? 'available' : 'unavailable'}`} /><StatusBadge value={gateway.capabilities.subscriptions ? 'enabled' : 'pending'} label={`Subscriptions ${gateway.capabilities.subscriptions ? 'available' : 'unavailable'}`} /><StatusBadge value={gateway.capabilities.automaticRenewal ? 'enabled' : 'pending'} label={gateway.capabilities.automaticRenewal ? 'Automatic renewals available' : 'No automatic renewal'} /></div>
          {!!gateway.readiness?.length && <ul className="mpa-readiness">{gateway.readiness.map((item, index) => <li key={`${provider}-${index}`}>{item}</li>)}</ul>}
          <label className="mpa-check mt-5"><input type="checkbox" checked={!!draft.enabled[provider]} disabled={saving || !!state.error || !gateway.configured} onChange={event => { setDirty(true); setNotice(''); setDraft({ ...draft, enabled: { ...draft.enabled, [provider]: event.target.checked } }); }} /><span>Accept new payments<small>{gateway.configured ? 'Account readiness is checked again at checkout.' : 'Configure this provider externally before enabling it.'}</small></span></label>
        </article>;
      })}</div>
      <div className="mpa-form-grid">
        <label className="mpa-label">Default payment provider<select className="mpa-input" value={draft.defaultProvider} disabled={saving || !!state.error} onChange={event => { setDirty(true); setNotice(''); setDraft({ ...draft, defaultProvider: event.target.value as MarketplaceProvider }); }}>{marketplaceProviders.map(provider => <option key={provider} value={provider}>{providerName(provider)}</option>)}</select><small>The server accepts a default only when it can serve new payments.</small></label>
        <label className="mpa-label">Platform commission (%)<input className="mpa-input" type="number" min="0" max="100" step="0.01" value={commission} disabled={saving || !!state.error} onChange={event => { setDirty(true); setNotice(''); setCommission(event.target.value); }} required /><small>New creator orders snapshot this rate. Existing order earnings do not change.</small></label>
        <label className="mpa-label mpa-form-wide">Reason for this change<textarea className="mpa-input" value={reason} minLength={5} maxLength={500} rows={2} disabled={saving || !!state.error} onChange={event => setReason(event.target.value)} placeholder="Explain the gateway or commission change" required /></label>
      </div>
      {error && <div className="mpa-alert mpa-alert-error mt-4" role="alert"><AlertTriangle size={16} />{error}</div>}
      {notice && <div className="mpa-alert mpa-alert-info mt-4" role="status"><CheckCircle2 size={16} />{notice}</div>}
      <div className="mpa-form-actions"><button type="button" className="mpa-button mpa-button-secondary" disabled={!dirty || saving} onClick={() => { setDirty(false); setError(''); setReason(''); }}>Discard changes</button><button type="submit" className="mpa-button" disabled={!dirty || saving || !!state.error || state.loading}>{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{saving ? 'Saving settings…' : 'Save gateway settings'}</button></div>
    </form>}
  </div>;
}
