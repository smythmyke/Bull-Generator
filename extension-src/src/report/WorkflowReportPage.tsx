import React, { useEffect } from 'react';
import RiskProfileReport from './RiskProfileReport';
import CompanyLitigationReport from './CompanyLitigationReport';

const TITLES: Record<string, string> = {
  'risk-profile': 'Patent Risk Profile',
  'company-litigation': 'Company Litigation Lookup',
};

function getParams(): { workflow: string; number: string; company: string } {
  const p = new URLSearchParams(window.location.search);
  return {
    workflow: p.get('workflow') || 'risk-profile',
    number: p.get('number') || '',
    company: p.get('company') || '',
  };
}

const WorkflowReportPage: React.FC = () => {
  const { workflow, number, company } = getParams();
  const title = TITLES[workflow] || 'Workflow Report';

  useEffect(() => {
    document.title = `${title} — Workflow Report`;
  }, [title]);

  const known = workflow === 'risk-profile' || workflow === 'company-litigation';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-2.5">
          <img src="icons/icon128.png" alt="" className="h-7 w-7" />
          <span className="font-semibold text-sm text-slate-800">AI Patent Search Generator</span>
          <span className="text-slate-400 text-sm">— {title}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {workflow === 'risk-profile' && <RiskProfileReport initialNumber={number} />}
        {workflow === 'company-litigation' && <CompanyLitigationReport initialCompany={company} />}
        {!known && (
          <div className="text-center text-sm text-slate-500 py-20 border border-dashed border-slate-300 rounded-xl bg-white/60">
            This workflow is coming soon.
          </div>
        )}
      </main>
    </div>
  );
};

export default WorkflowReportPage;
