# ReadyForge — Repository Audit & Enhancement Plan

Date: 2026-10-25 · Scope: local working tree (not remote repo)

---

## 1. Technology stack (verified)

| Layer | Technology |
|---|---|
| Workspace | npm workspaces (`server`, `client`) + `concurrently` |
| Frontend | React 19, Vite 6, TypeScript 5.7, Tailwind CSS 3.4 (`darkMode: 'class'`) |
| Routing/state | react-router 7, TanStack Query 5, zustand 5 |
| Forms | react-hook-form 7 + zod 3 (`@hookform/resolvers`) |
| UI libs | lucide-react (icons), recharts (charts). No component library — local `ui.tsx`. |
| Backend | Express 4, mongoose 8, zod, jsonwebtoken, helmet, rate-limit, multer |
| AI | FastAPI service on :8001 — Qwen2.5-0.5B-Instruct (generation), fine-tuned DistilBERT MNLI (conflict NLI) |
| Checks | `npm run typecheck` (both workspaces), `npm run build` (server tsc + client tsc -b/vite). **No linter, no test runner configured.** |

**Baseline (measured before any edit):**
- `server` tsc: ✅ clean · `client` tsc: ✅ clean · `client` production build: ✅ passes
- Bundle: `index.js` 1,037.95 kB (286 kB gzip), single chunk — Vite warns >500 kB
- API verification suite: 123/123 (AI up and AI down) — see VERIFICATION_REPORT.md
- All 19 frontend routes render with 0 console errors (browser pass, same date)

## 2. Architecture

- `client/src/App.tsx` — flat route table: 3 public pages + `/app` shell (dashboard, workspace, notifications, analytics, settings) + `projects/:projectId` layout with 15 sub-tabs.
- `client/src/components/` — `AppShell` (sidebar+header), `ui.tsx` (20 primitives), `widgets.tsx` (domain badges/meters/cards), `Toast`, `ErrorBoundary`.
- `lib/api.ts` — fetch wrapper: Bearer token in localStorage, silent refresh on 401, typed errors. No request timeout.
- `store/` — `auth` (zustand), `toast` (zustand). Theme in `localStorage.rf_theme`, applied only by `AppShell`.
- Server: layered routers (`routes/`), engines (`readiness`, `costAtRisk`, `contract`, `riskScore`, `preflight`), AI adapters with rule-engine fallback.

## 3. Page inventory (26 pages, all load — verified in browser)

| Page | Purpose / primary user | Key dependencies | Confirmed issues |
|---|---|---|---|
| Landing / Login / Register | Public entry, auth | forms + zod | No dark theme applied (theme class set only in AppShell) — P1 |
| Dashboard | Owner: readiness overview | projects list, judge-mode | KPI strip low-signal (workspace count ≠ readiness); "needs attention" not actionable (no links to blockers); no recent activity — P1 |
| CreateProject / CreateWorkspace | Onboarding | classify API | Works; validation errors shown inline ✓ |
| ProjectOverview | Lead: project hub | project detail | OK |
| InputWizard / KnowledgeLedger | Contributor: inputs | inputs API | OK (ledger has filters) |
| ConflictRoom | Lead/finance: resolve conflicts | conflicts API | Works; relies on plain buttons without focus rings — P2 |
| AssetsLibrary / RightsManager | Legal: licence clearance | assets API | OK |
| ReadinessDashboard / CostAtRiskDashboard | Owner: go/no-go | readiness/cost APIs | OK; heavy information density without table/list hierarchy — P2 |
| ContractPage | Approvers | contract API | OK |
| DraftLadder | Producer: gated generation | ladder/generate | OK; stage states rely on color+text ✓ (text present) |
| ScriptEditor / StoryboardEditor | Writer | plan API | OK |
| VerificationReportPage | Reviewer | verify API | OK |
| CampaignLabPage | Marketer: variants | intelligence API | OK |
| ProvenancePage | Auditor: export | provenance API | JSON export via client-side blob ✓; PDF endpoint exists server-side but no UI action — P3 |
| AnalyticsPage / SettingsPage / WorkspaceDetail / NotificationsPage | Workspace admin | workspace APIs | OK |

## 4. Findings (classified)

### P0 — critical functionality/usability
1. **Dropdown menus can't be dismissed** — workspace switcher and user menu (`AppShell.tsx`) toggle only on their own button: no outside-click close, no Escape, no `aria-expanded`/`aria-haspopup`, no arrow-key support. Users get stuck with open menus. 
2. **Modal a11y** (`ui.tsx Modal`): no focus trap, no focus restore, backdrop click not wired, close control is a bare "✕" character. Dialogs are unusable by keyboard alone.

### P1 — major UX/visual
3. **Theme system**: system preference ignored (`localStorage` default → light), dark class applied only after AppShell mounts → Login/Landing stay light and every load flashes. No FOUC guard.
4. **Project navigation**: 15 flat tabs in a horizontal scroll strip (`ProjectLayout.tsx`) — poor scanability, hidden overflow on mobile. Needs grouping.
5. **Dashboard doesn't answer "what blocks production?"**: attention list exists but isn't actionable; no path from a blocked project to its blockers (conflicts/rights/readiness).
6. **Sidebar**: fixed 5-item flat list, not collapsible, no sections; "PRINCIPLE" filler takes prime space.

### P2 — polish/productivity
7. **No breadcrumbs or page context in header**; no global search/command palette.
8. **Loading states**: single centered spinner (`Loading`) everywhere — no skeletons, layout jumps.
9. **Bundle**: 1.04 MB single chunk (build warning). react-hook-form and recharts load eagerly on first paint.
10. **Focus visibility**: raw `<button>`s (header toggles, nav arrows, table actions) lack `focus-visible` rings.
11. **Reduced motion**: `animate-fade-in` has no `prefers-reduced-motion` guard.
12. **`lib/api.ts` has no request timeout** — a hung API leaves infinite spinners.
13. **Visual token drift**: slate neutrals throughout; buttons `rounded-lg` vs cards `rounded-xl`; severity color pairs (amber/rose) fine but no single token source.

### P3 — optional
14. PDF export exists on the API (`/api/provenance/:id/export/pdf`) but the Provenance page only offers JSON.
15. No ESLint/test runner configured (DX gap; adding a linter = new dependency — deferred unless requested).
16. Access token in `localStorage` (XSS exposure). Standard tradeoff for this architecture; changing it would alter auth behavior — documented, not changed.

## 5. Prioritized implementation plan

| # | Priority | Files | Current issue | Solution | Benefit | Complexity | Verification |
|---|---|---|---|---|---|---|---|
| 1 | P0 | `ui.tsx`, `AppShell.tsx` | Menus/dialogs not keyboard-dismissable | `Menu` primitive w/ outside-click+Escape+ARIA; Modal focus trap/restore + backdrop + icon close | App usable without a mouse | Med | Browser keyboard pass |
| 2 | P1 | `index.html`, `index.css`, `AppShell` | Theme flashes, system pref ignored, public pages ignore theme | Inline theme-init script + `system` support + tokenized light/dark palettes (neutral-first) | Cohesive theming everywhere | Low | Browser light/dark check |
| 3 | P1 | `tailwind.config.js`, `index.css` | Scattered slate/brand values | Design tokens: surfaces `#09090B/#0F1013/#15171B/#191B20`, text zinc scale, semantic accent/status colors, mono stack, motion guard | Consistent, WCAG-conscious UI | Low | Build + visual |
| 4 | P1 | `AppShell.tsx` | Flat nav, no collapse | Grouped sidebar (Workspace / Production), collapsible with persisted state + tooltips, keep mobile drawer | Faster navigation | Med | Browser pass |
| 5 | P1 | `ProjectLayout.tsx` | 15 ungrouped tabs | Grouped tab bar (Knowledge / Governance / Readiness / Production / Insights) with scroll-spy active state; breadcrumbs in header | Findable features | Med | Browser pass |
| 6 | P2 | `AppShell.tsx`, new `CommandPalette.tsx` | No way to jump anywhere | Ctrl/Cmd+K palette over *existing* routes/actions only, full keyboard nav | Power-user speed | Med | Keyboard pass |
| 7 | P1 | `Dashboard.tsx` | Not decision-oriented | "Needs attention" list with direct links (conflicts, rights, readiness, contract), compact project rows w/ last-updated, keep real KPIs only | Answers "what blocks production" | Med | Browser + API |
| 8 | P2 | `ui.tsx` | Spinner-only loading | `Skeleton` primitive used in dashboard/project load paths | No layout jump | Low | Visual |
| 9 | P2 | `ui.tsx` + page sweep | Missing focus rings | Global `focus-visible` ring token + apply to raw buttons | Keyboard clarity | Low | Browser keyboard |
| 10 | P2 | `vite.config.ts` | 1 MB chunk | Route-level `React.lazy` for heavy pages (recharts/re-hook-form pages) + manualChunks | Faster first paint | Low | Build size compare |
| 11 | P2 | `lib/api.ts` | No timeout | AbortSignal.timeout(30s) w/ clear error message | No infinite spinners | Low | Suite re-run |
| 12 | P3 | `ProvenancePage.tsx` | PDF endpoint unused | Add PDF export action (server route already exists & tested) | Spec 15.7 in UI | Low | Click + file check |

Out of scope (explicitly): backend/API changes, schema changes, new npm dependencies, linter introduction.

---
*Evidence sources: file reads listed above, `npm run build` output, browser pass logs (0 console errors), API suite results in VERIFICATION_REPORT.md.*

---

## 6. Implemented enhancements (Stages B–E)

| File | Change |
|---|---|
| `client/index.html` | Inline theme-init script (no FOUC, system preference honored before React mounts), meta description |
| `client/tailwind.config.js` | Design-token palette (neutral-first surfaces, semantic status colors, mono font stack), brand scale |
| `client/src/index.css` | Tokenized light/dark themes, typography scale, global `focus-visible` ring, `prefers-reduced-motion` guard |
| `client/src/components/ui.tsx` | Modal: focus trap, focus restore, Escape, backdrop dismiss, **body scroll lock**; new `Dropdown` primitive (outside-click + Escape + `aria-haspopup/expanded`, focus return), `Skeleton`, `ConfirmDialog` |
| `client/src/components/AppShell.tsx` | Grouped collapsible sidebar (persisted), mobile drawer with backdrop, header breadcrumbs, workspace/account dropdowns with ARIA, theme toggle, notification badge, mobile header overflow fix (`gap-2 sm:gap-3`, `max-w-24` workspace label) |
| `client/src/components/CommandPalette.tsx` | New — Ctrl/Cmd+K palette over existing routes/actions only, full keyboard nav, ARIA combobox pattern |
| `client/src/pages/Dashboard.tsx` | Decision-oriented “Blocking production” panel with direct links to blockers, real KPIs only, skeletons on load |
| `client/src/pages/ProjectLayout.tsx` | 15 flat tabs → grouped section nav with active state |
| `client/src/pages/ProvenancePage.tsx` | PDF export action wired to existing `/api/provenance/:id/export/pdf` (JSON export kept) |
| `client/src/lib/api.ts` | 30 s request timeout with clear error (no infinite spinners) |
| `client/src/App.tsx` + `client/vite.config.ts` | Route-level `React.lazy` + manual vendor/chart chunking |

## 7. Validation report (Stage E — executed, not assumed)

| Check | Result |
|---|---|
| `npm run typecheck` (server + client, root workspace) | ✅ exit 0 |
| `cd client && npx tsc --noEmit` | ✅ exit 0 |
| `cd client && npm run build` | ✅ exit 0 — entry 47 kB, vendor-react 80 kB, vendor 309 kB, forms 90 kB, charts 338 kB (lazy) |
| Bundle vs baseline | 1,038 kB single chunk → initial ~436 kB across entry+vendors, heavy libs lazy |
| API verification suite (prior run, see `VERIFICATION_REPORT.md`) | ✅ 123/123 with AI up and down |
| Browser pass @ 1440×900 | ✅ shell, breadcrumbs, grouped tabs, dashboard blockers panel — 0 console errors |
| Command palette keyboard flow | ✅ opens via button, search + Enter navigates (`/app/risk` verified) |
| Theme: toggle, persistence, reload | ✅ `rf_theme` honored, `dark` class applied pre-paint, restored to light after testing |
| Dropdown a11y (P0 fix) | ✅ `aria-haspopup/expanded`, focus on open, Escape closes + restores focus, outside-click closes, items clickable |
| Modal a11y (P0 fix) | ✅ `aria-modal`, labelled close, focus enters dialog, Tab trap, Escape closes + restores focus to invoker, backdrop click closes |
| Body scroll lock behind modal | ✅ fixed & verified: `overflow: hidden` while open, restored on close |
| Responsive @ 390×844 | ✅ header overflow fixed (scrollWidth 381 ≤ 390), drawer opens/closes/navigates, tab strip scrolls internally, no page-level horizontal scroll |
| Notifications empty state | ✅ renders honest empty message |
| Provenance PDF export | ✅ live request: 200, `application/pdf`, 1,832 bytes |

**Known limitations (honest):**
- No linter or test runner is configured in the repo; none was introduced (new dependency rule). Typecheck + build + browser pass are the available gates.
- Landing/Login were verified by build/typecheck and route render earlier, not re-walked in this pass.
- Recharts pages were exercised previously for chart rendering; this pass did not re-run analytics with fresh data.
- Access token remains in `localStorage` (pre-existing auth contract, unchanged by design).

## 8. Final improvement summary

**What improved and why**
- **Cohesion**: one tokenized neutral-first palette with WCAG-conscious status colors replaced scattered slate/brand values; light + dark + system preference with no flash.
- **Navigability**: grouped collapsible sidebar, breadcrumbs, grouped project tabs, and a ⌘K palette over real routes only — users find features without a doc.
- **Decision clarity**: dashboard now answers “what blocks production?” with links to the actual blockers instead of decorative KPIs.
- **Accessibility**: the two P0 defects (non-dismissable menus, keyboard-unusable dialogs) are fixed and verified — ARIA, focus trap/restore, Escape, outside-click, focus rings, reduced-motion.
- **Honesty & resilience**: skeletons instead of layout jumps, 30 s timeout, real empty states, no invented metrics.
- **Performance**: initial JS ~57% smaller via route-level code splitting; charts/forms load on demand.
- **Fixed during verification**: mobile header overflow (28 px), background scroll behind modals.

**What remains unfinished**
- ESLint/test runner still absent (needs a new dependency — ask before adding).
- Tooltip primitive and a shared Table component are still page-local patterns.
- No stored Lighthouse/axe scores — accessibility verified by targeted DOM/keyboard checks only.

**Recommended next priorities**
1. Add ESLint + a smoke test (vitest + testing-library) so regressions are caught automatically.
2. Reusable Table/Filter patterns for the ledger, rights and analytics pages.
3. Lighthouse CI run for performance/a11y budgets on the landing and dashboard routes.