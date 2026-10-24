import React from 'react';
import { ArrowRight, ArrowUpRight, Check, Image as ImageIcon, RefreshCw, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Spinner } from '../ui/Spinner';
import type { CreatorCard } from '../../services/MarketplaceService';
import '../../styles/marketplace.css';

export const marketplaceMoney = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(amount) || 0);
export const marketplaceDate = (value?: string | number) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const statusLabels: Record<string, string> = { creation_uncertain: 'Checking payment setup', pending_provider: 'Awaiting provider confirmation', cancel_scheduled: 'Cancellation scheduled', review_required: 'Under review', not_published: 'Awaiting publication' };
export function StatusPill({ value = 'draft' }: { value?: string }) { return <span className={`market-status market-status-${value.toLowerCase().replace(/[^a-z_-]/g, '')}`}>{statusLabels[value.toLowerCase()] || value.replace(/_/g, ' ').replace(/\b\w/g, word => word.toUpperCase())}</span>; }
export function MarketLoading({ label = 'Getting things ready…' }: { label?: string }) { return <div className="market-loading" role="status"><Spinner size={25} /><span>{label}</span></div>; }
export function MarketError({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div className="market-error" role="alert"><p>{message}</p>{onRetry && <button className="text-button" onClick={onRetry}><RefreshCw size={15} />Try again</button>}</div>; }
export function CreatorAvatar({ creator, size = 'normal' }: { creator: CreatorCard; size?: 'normal' | 'large' }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [creator.avatarUrl, creator.avatar]);
  return <span className={`creator-avatar creator-avatar-${size}`}>{(creator.avatarUrl || creator.avatar) && !failed ? <img src={creator.avatarUrl || creator.avatar} alt="" onError={() => setFailed(true)} /> : creator.id === 'booyahstudio' ? <Sparkles size={size === 'large' ? 35 : 25} strokeWidth={1.4} /> : <span>{creator.displayName?.trim().charAt(0).toUpperCase() || 'C'}</span>}</span>;
}
export function CreatorProfileCard({ creator }: { creator: CreatorCard }) {
  const { navigate } = useApp();
  return <article className="creator-card"><div className="creator-card-art" aria-hidden="true"><span /><span /><i /></div><div className="creator-card-content"><CreatorAvatar creator={creator} /><div className="creator-card-name"><h2>{creator.displayName}</h2>{(creator.isPlatform || creator.id === 'booyahstudio') && <span className="creator-platform-label"><Check size={12} />Studio collection</span>}</div><p>{creator.headline || 'Digital goods, made with a personal touch.'}</p><div className="creator-card-foot"><span>{typeof creator.productCount === 'number' ? `${creator.productCount} ${creator.productCount === 1 ? 'product' : 'products'}` : 'Explore the collection'}</span><button onClick={() => navigate(`/creators/${encodeURIComponent(creator.slug)}`)} aria-label={`Explore ${creator.displayName}`}>Visit creator<ArrowUpRight size={16} /></button></div></div></article>;
}
export function MarketEmpty({ title, description, action, onAction, icon: Icon = ImageIcon }: { title: string; description: string; action?: string; onAction?: () => void; icon?: React.ElementType }) { return <div className="market-empty"><span><Icon size={30} strokeWidth={1.4} /></span><h2>{title}</h2><p>{description}</p>{action && onAction && <button className="btn btn-primary" onClick={onAction}>{action}<ArrowRight size={16} /></button>}</div>; }
export function MarketPageHeading({ kicker, title, emphasis, description, children }: { kicker: string; title: string; emphasis?: string; description: string; children?: React.ReactNode }) { return <header className="market-page-heading"><div><p className="eyebrow">{kicker}</p><h1>{title}{emphasis && <><br /><em>{emphasis}</em></>}</h1><p>{description}</p></div>{children}</header>; }
