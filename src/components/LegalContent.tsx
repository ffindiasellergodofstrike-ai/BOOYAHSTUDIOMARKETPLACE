import React from 'react';
import { Clock3, FileText } from 'lucide-react';
import { Breadcrumb } from './Breadcrumb';
import '../styles/content.css';

interface LegalSection { id: string; title: string; content: string | React.ReactNode; }
interface LegalContentProps { title: string; subtitle: string; lastUpdated: string; sections: LegalSection[]; quickSummary?: string[]; }

export const LegalContent: React.FC<LegalContentProps> = ({ title, subtitle, lastUpdated, sections, quickSummary }) => <div className="content-page legal-page">
  <Breadcrumb items={[{ label: 'Policies', path: '/policies/terms' }, { label: title }]} />
  <header className="legal-heading"><span className="content-kicker">THE DETAILS, MADE CLEAR</span><h1>{title}</h1><p>{subtitle}</p><span className="legal-updated"><Clock3 size={14} />Last updated: {lastUpdated}</span></header>
  {Boolean(quickSummary?.length) && <section className="legal-summary" aria-label="Policy summary"><h2><FileText size={18} />At a glance</h2><ul>{quickSummary!.map((point, index) => <li key={index}>{point}</li>)}</ul></section>}
  <div className="legal-layout"><aside className="legal-contents"><h2>On this page</h2><nav aria-label="Policy sections">{sections.map(section => <a key={section.id} href={'#' + section.id}>{section.title}</a>)}</nav></aside><div className="legal-articles">{sections.map((section, index) => <section id={section.id} key={section.id} className="legal-article"><div className="legal-section-title"><span>{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2></div><div className="legal-section-body">{section.content}</div></section>)}</div></div>
</div>;
