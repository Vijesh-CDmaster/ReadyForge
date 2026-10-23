import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  FileCheck2,
  GitMerge,
  Gauge,
  Route,
  ScrollText,
  ArrowRight,
} from 'lucide-react';

const features = [
  {
    icon: GitMerge,
    title: 'Consensus Graph & conflicts',
    body: 'Role-based inputs become knowledge nodes. Contradictions are detected, routed to the right decision-maker, and resolved before a single token is spent.',
  },
  {
    icon: Gauge,
    title: 'Readiness Score',
    body: 'Completeness, consistency, factual support, rights clearance, brand fit, accessibility and budget — scored transparently with reasons, not one opaque number.',
  },
  {
    icon: Route,
    title: 'Cost-at-Risk',
    body: '“Rendering now: 68% chance of rework. ₹612 at risk.” Every estimate shows its signals and how to reduce them.',
  },
  {
    icon: FileCheck2,
    title: 'Production Contract',
    body: 'A versioned contract of objective, approved claims, licensed assets, brand rules and required approvals. Nothing generates until it is approved.',
  },
  {
    icon: ShieldCheck,
    title: 'Rights & claim guardrails',
    body: 'Unlicensed assets and unsupported claims are flagged with evidence — and block final generation. Risk checks, never legal advice.',
  },
  {
    icon: ScrollText,
    title: 'Provenance & audit trail',
    body: 'Who supplied what, who approved what, which model ran, what it cost. Every action is audited end to end.',
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
            <ShieldCheck className="h-5 w-5" />
          </span>
          ReadyForge
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link to="/login" className="text-slate-300 hover:text-white">Sign in</Link>
          <Link
            to="/register"
            className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-500"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-4xl px-4 py-20 text-center">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            AI Production-Readiness Operating System
          </span>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Do not generate until
            <br />
            <span className="bg-gradient-to-r from-brand-400 to-fuchsia-400 bg-clip-text text-transparent">
              the project is ready.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-400">
            Other AI tools check output <em>after</em> generation. ReadyForge checks whether the humans
            are ready <em>before</em> generation begins — facts approved, conflicts resolved, assets
            licensed, budget verified, contract signed.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-3 font-medium shadow-lg shadow-brand-600/25 hover:bg-brand-500"
            >
              Start your first project <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/login" className="rounded-lg border border-slate-700 px-6 py-3 font-medium text-slate-200 hover:bg-slate-900">
              Sign in to demo workspace
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Demo: <span className="font-mono">demo@readyforge.ai</span> / <span className="font-mono">demo1234</span>
          </p>
        </section>

        {/* Flow */}
        <section className="mx-auto max-w-6xl px-4 pb-8">
          <div className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-6 sm:grid-cols-5">
            {['Inputs', 'Conflicts', 'Contract', 'Draft ladder', 'Provenance'].map((step, i) => (
              <div key={step} className="flex items-center gap-3 sm:flex-col sm:gap-2 sm:text-center">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold">
                  {i + 1}
                </span>
                <span className="text-sm font-medium text-slate-200">{step}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-center text-2xl font-semibold sm:text-3xl">
            Readiness before render
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-slate-400">
            A verified Production Contract stands between scattered ideas and expensive AI generation.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition hover:border-brand-600/60">
                <f.icon className="h-5 w-5 text-brand-400" />
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-4xl px-4 pb-24 text-center">
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-10">
            <h2 className="text-2xl font-semibold">Turn scattered inputs into a verified contract</h2>
            <p className="mx-auto mt-3 max-w-lg text-slate-400">
              Solo creators get guided questions and a readiness ladder. Teams get authority-aware conflict
              resolution and approvals.
            </p>
            <Link
              to="/register"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-3 font-medium hover:bg-brand-500"
            >
              Create your workspace <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        ReadyForge — “Do not generate until the project is ready.” · AI findings always show evidence or state
        that evidence is unavailable.
      </footer>
    </div>
  );
}
