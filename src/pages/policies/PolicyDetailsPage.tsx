import React, { useEffect } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { BUSINESS } from '../../config/business';
import { LegalContent } from '../../components/LegalContent';
import { policyData, POLICY_REDIRECTS, SUPPORTED_POLICY_SLUGS, type SupportedPolicySlug } from '../../data/policyData';
import '../../styles/content.css';

export const PolicyDetailsPage: React.FC<{ slug: string }> = ({ slug }) => {
  const { navigate } = useApp();
  const activeSlug = (POLICY_REDIRECTS[slug] || slug) as SupportedPolicySlug;
  const policy = policyData[activeSlug];
  useEffect(() => { const target = POLICY_REDIRECTS[slug]; if (target) navigate('/policies/' + target); }, [slug, navigate]);
  useEffect(() => { if (policy) document.title = policy.title + ` | ${BUSINESS.name}`; }, [policy]);
  if (!policy) return <div className="content-page content-empty-state"><h1>We couldn’t find that policy.</h1><p>Find our current terms, privacy, refund and delivery details below.</p><button type="button" className="content-button" onClick={() => navigate('/policies/terms')}>View our terms <ArrowUpRight size={17} /></button></div>;
  return <><nav className="legal-policy-tabs" aria-label="Store policies">{SUPPORTED_POLICY_SLUGS.map(key => <button type="button" key={key} aria-current={key === activeSlug ? 'page' : undefined} onClick={() => navigate('/policies/' + key)}>{policyData[key].title}</button>)}</nav><LegalContent title={policy.title} subtitle={policy.subtitle} lastUpdated={policy.lastUpdated} quickSummary={policy.quickSummary} sections={policy.sections} /></>;
};
