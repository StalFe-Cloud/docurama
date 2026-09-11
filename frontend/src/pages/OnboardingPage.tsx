import React, { useState } from 'react';
import { ArrowRight, ArrowLeft, AlertCircle, Check } from 'lucide-react';
import { api } from '../lib/api';

interface QuestionOption {
  value: string;
  label: string;
}

interface Question {
  key: 'role' | 'use_case' | 'monthly_volume' | 'team_size' | 'vertical';
  title: string;
  options: QuestionOption[];
}

// Keys and values must match the backend OnboardingAnswers model exactly.
const QUESTIONS: Question[] = [
  {
    key: 'role',
    title: 'What best describes your role?',
    options: [
      { value: 'founder', label: 'Founder or executive' },
      { value: 'ops', label: 'Operations' },
      { value: 'legal', label: 'Legal' },
      { value: 'hr', label: 'Human Resources' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    key: 'use_case',
    title: 'What will you send for signature most often?',
    options: [
      { value: 'contracts', label: 'Contracts' },
      { value: 'ndas', label: 'NDAs' },
      { value: 'invoices', label: 'Invoices' },
      { value: 'hr-docs', label: 'HR documents' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    key: 'monthly_volume',
    title: 'How many documents do you send each month?',
    options: [
      { value: '1-10', label: '1 to 10 documents' },
      { value: '10-50', label: '10 to 50 documents' },
      { value: '50-200', label: '50 to 200 documents' },
      { value: '200+', label: 'More than 200 documents' },
    ],
  },
  {
    key: 'team_size',
    title: 'How many people are on your team?',
    options: [
      { value: 'just-me', label: 'Just me' },
      { value: '2-10', label: '2 to 10 people' },
      { value: '11-50', label: '11 to 50 people' },
      { value: '50+', label: 'More than 50 people' },
    ],
  },
  {
    key: 'vertical',
    title: 'What industry are you in?',
    options: [
      { value: 'hr', label: 'Human Resources' },
      { value: 'sales', label: 'Sales' },
      { value: 'legal', label: 'Legal' },
      { value: 'real_estate', label: 'Real Estate' },
      { value: 'finance', label: 'Finance' },
    ],
  },
];

export const OnboardingPage: React.FC = () => {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const question = QUESTIONS[stepIndex];
  const isLast = stepIndex === QUESTIONS.length - 1;
  const selected = answers[question.key] || '';

  const choose = (value: string) => {
    setError('');
    setAnswers((prev) => ({ ...prev, [question.key]: value }));
  };

  const goBack = () => {
    setError('');
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const goNext = () => {
    if (!selected) {
      setError('Choose an option to continue.');
      return;
    }
    setError('');
    setStepIndex((i) => Math.min(QUESTIONS.length - 1, i + 1));
  };

  const handleSubmit = async () => {
    if (!selected) {
      setError('Choose an option to continue.');
      return;
    }
    setError('');
    try {
      setLoading(true);
      await api.submitOnboarding({ ...answers, completed: true });
      window.location.href = '/templates';
    } catch (err: any) {
      setError(err.message || 'Could not save your answers. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 relative overflow-hidden bg-[#f6f5f4]">
      <div className="w-full max-w-md bg-white rounded-lg p-8 md:p-10 border border-[#e5e3df] shadow-notion-card relative z-10">

        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center mb-2">
            <img src="/logo_horizontal.png" alt="Docurama: Documents Signed Simplified" className="h-11 object-contain" />
          </div>
          <p className="text-xs text-[#5d5b54] mt-1 font-medium">
            Electronic Signatures &amp; Document Intelligence
          </p>
        </div>

        <div className="mb-5">
          <div className="flex gap-1.5">
            {QUESTIONS.map((q, i) => (
              <div
                key={q.key}
                className={`h-1 flex-1 rounded-full transition-colors ${i <= stepIndex ? 'bg-[#5645d4]' : 'bg-[#e5e3df]'}`}
              />
            ))}
          </div>
          <p className="text-xs text-[#787671] mt-2">
            Step {stepIndex + 1} of {QUESTIONS.length}
          </p>
        </div>

        <h2 className="text-sm font-semibold text-[#1a1a1a] mb-4">{question.title}</h2>

        {error && (
          <div className="p-3 rounded-md bg-[#fde0ec] border border-[#ff64c8]/30 text-[#e03131] text-xs flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#e03131]" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-2">
          {question.options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => choose(option.value)}
              className={`w-full h-11 px-4 text-sm text-left rounded-md border flex items-center justify-between transition-colors ${
                selected === option.value
                  ? 'border-[#5645d4] bg-[#5645d4]/5 text-[#1a1a1a]'
                  : 'border-[#c8c4be] bg-white text-[#1a1a1a] hover:border-[#5645d4]'
              }`}
            >
              <span>{option.label}</span>
              {selected === option.value && <Check className="w-4 h-4 text-[#5645d4] shrink-0" />}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between pt-6">
          {stepIndex > 0 ? (
            <button
              type="button"
              onClick={goBack}
              disabled={loading}
              className="text-xs font-normal text-[#787671] hover:text-[#1a1a1a] flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          ) : (
            <span />
          )}
          {isLast ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !selected}
              className="btn btn-primary h-11 px-5 text-sm font-medium flex items-center justify-center gap-2 bg-[#5645d4] hover:bg-[#4534b3] text-white rounded-md transition-colors disabled:opacity-50"
            >
              <span>{loading ? 'Setting up...' : 'Set up my workspace'}</span>
              {!loading && <ArrowRight className="w-4 h-4 stroke-[2]" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!selected}
              className="btn btn-primary h-11 px-5 text-sm font-medium flex items-center justify-center gap-2 bg-[#5645d4] hover:bg-[#4534b3] text-white rounded-md transition-colors disabled:opacity-50"
            >
              <span>Next</span>
              <ArrowRight className="w-4 h-4 stroke-[2]" />
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
