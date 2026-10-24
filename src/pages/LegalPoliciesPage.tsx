import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { policyData } from '../data/policyData';
import { useApp } from '../context/AppContext';
import '../styles/content.css';
export const LegalPoliciesPage: React.FC = () => {
  const { navigate } = useApp();
  return <div className="content-page"><header className="content-intro"><span className="content-kicker">THE DETAILS, MADE CLEAR</span><h1>Shop with<br /><em>everything in view.</em></h1><p className="content-lead">How we handle orders, payments, digital delivery<br />and your personal information.</p></header><div className="policy-index-grid">{Object.values(policyData).map(policy => <button type="button" key={policy.slug} onClick={() => navigate('/policies/' + policy.slug)}><span className="policy-index-icon"><ArrowUpRight size={24} /></span><h2>{policy.title}</h2><p>{policy.quickSummary[0]}</p><span className="content-text-link">Read policy <ArrowUpRight size={15} /></span></button>)}</div></div>;
};
