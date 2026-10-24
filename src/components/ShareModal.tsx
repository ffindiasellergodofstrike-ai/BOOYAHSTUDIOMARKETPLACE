import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check, Share2, MessageCircle, Twitter, Facebook, Linkedin } from 'lucide-react';
import { Modal } from './Modal';
import { AsyncButton } from './ui/AsyncButton';
import { useToast } from '../context/ToastContext';
import { BUSINESS } from '../config/business';

interface ShareModalProps { isOpen: boolean; onClose: () => void; title: string; description: string; path: string; }
export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, title, description, path }) => {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  useEffect(() => { if (!isOpen) { setCopied(false); clearTimeout(copiedTimer.current); } }, [isOpen]);
  const cleanPath = path.split('?')[0].replace(/\/$/, '') || '/';
  const url = `${BUSINESS.url}${cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`}`;
  async function share() {
    if (sharing) return;
    setSharing(true);
    try { await navigator.share({ title, text: description, url }); onClose(); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) showToast('error', 'Could not share', 'You can copy the link below instead.'); }
    finally { setSharing(false); }
  }
  async function copy() {
    if (copying) return;
    setCopying(true);
    try { await navigator.clipboard.writeText(url); setCopied(true); clearTimeout(copiedTimer.current); copiedTimer.current = setTimeout(() => setCopied(false), 2500); }
    catch { showToast('error', 'Could not copy the link', 'Select the link below and copy it manually.'); }
    finally { setCopying(false); }
  }
  const options = [
    { name: 'WhatsApp', icon: MessageCircle, url: `https://api.whatsapp.com/send?text=${encodeURIComponent(`${title}\n${url}`)}` },
    { name: 'X', icon: Twitter, url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}` },
    { name: 'Facebook', icon: Facebook, url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { name: 'LinkedIn', icon: Linkedin, url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` },
  ];
  return <Modal isOpen={isOpen} onClose={onClose} title="Good finds are worth sharing." maxWidth="md"><div className="studio-share"><p>{title}</p>{typeof navigator !== 'undefined' && Boolean(navigator.share) && <AsyncButton busy={sharing} busyLabel="Opening share options…" onClick={share} className="btn-primary"><Share2 size={17} />Share this template</AsyncButton>}<div className="studio-share-options">{options.map(option => <a key={option.name} href={option.url} target="_blank" rel="noopener noreferrer"><option.icon size={20} /><span>{option.name}</span></a>)}</div><label htmlFor="share-product-link">Or send a link</label><div className="studio-share-link"><input id="share-product-link" type="url" readOnly value={url} onFocus={event => event.target.select()} /><AsyncButton busy={copying} busyLabel="Copying…" onClick={copy} className="btn-primary">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy'}</AsyncButton></div><span className="sr-only" role="status">{copied ? 'Link copied to clipboard.' : ''}</span></div></Modal>;
};
