import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { Loading } from './components/ui';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';

// Authenticated pages load on demand — keeps the initial bundle small (UI_AUDIT plan #10).
const Dashboard = lazy(() => import('./pages/Dashboard'));
const CreateWorkspace = lazy(() => import('./pages/CreateWorkspace'));
const WorkspaceDetail = lazy(() => import('./pages/WorkspaceDetail'));
const CreateProject = lazy(() => import('./pages/CreateProject'));
const ProjectLayout = lazy(() => import('./pages/ProjectLayout'));
const ProjectOverview = lazy(() => import('./pages/ProjectOverview'));
const KnowledgeLayout = lazy(() => import('./pages/KnowledgeLayout'));
const KnowledgeOverview = lazy(() => import('./pages/KnowledgeOverview'));
const InputWizard = lazy(() => import('./pages/InputWizard'));
const KnowledgeLedger = lazy(() => import('./pages/KnowledgeLedger'));
const ConflictRoom = lazy(() => import('./pages/ConflictRoom'));
const AssetsLibrary = lazy(() => import('./pages/AssetsLibrary'));
const RightsManager = lazy(() => import('./pages/RightsManager'));
const ReadinessDashboard = lazy(() => import('./pages/ReadinessDashboard'));
const CostAtRiskDashboard = lazy(() => import('./pages/CostAtRiskDashboard'));
const ContractPage = lazy(() => import('./pages/ContractPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const DraftLadder = lazy(() => import('./pages/DraftLadder'));
const ScriptEditor = lazy(() => import('./pages/ScriptEditor'));
const StoryboardEditor = lazy(() => import('./pages/StoryboardEditor'));
const VideoEditor = lazy(() => import('./pages/VideoEditor'));
const VerificationReportPage = lazy(() => import('./pages/VerificationReportPage'));
const ProvenancePage = lazy(() => import('./pages/ProvenancePage'));
const CampaignLabPage = lazy(() => import('./pages/CampaignLabPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const TastePage = lazy(() => import('./pages/TastePage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const InvitePage = lazy(() => import('./pages/InvitePage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const GettingStarted = lazy(() => import('./pages/GettingStarted'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuthStore();
  const location = useLocation();
  if (status === 'loading' || status === 'idle') return <Loading label="Starting ReadyForge…" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <ErrorBoundary area="ReadyForge">
      <Suspense
        fallback={
          <div className="flex justify-center py-24">
            <Loading label="Loading page…" />
          </div>
        }
      >
      <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="start" element={<GettingStarted />} />
        <Route path="workspaces/new" element={<CreateWorkspace />} />
        <Route path="workspaces/:workspaceId" element={<WorkspaceDetail />} />
        <Route path="projects/new" element={<CreateProject />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="taste" element={<TastePage />} />
        <Route path="workspaces/:workspaceId/analytics" element={<AnalyticsPage />} />
        <Route path="workspaces/:workspaceId/settings" element={<SettingsPage />} />

        <Route path="projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<ProjectOverview />} />
          <Route path="knowledge" element={<KnowledgeLayout />}>
            <Route index element={<KnowledgeOverview />} />
            <Route path="inputs" element={<InputWizard />} />
            <Route path="ledger" element={<KnowledgeLedger />} />
          </Route>
          <Route path="inputs" element={<Navigate to="knowledge/inputs" replace />} />
          <Route path="ledger" element={<Navigate to="knowledge/ledger" replace />} />
          <Route path="conflicts" element={<ConflictRoom />} />
          <Route path="assets" element={<AssetsLibrary />} />
          <Route path="rights" element={<RightsManager />} />
          <Route path="readiness" element={<ReadinessDashboard />} />
          <Route path="risk" element={<CostAtRiskDashboard />} />
          <Route path="contract" element={<ContractPage />} />
          <Route path="ladder" element={<DraftLadder />} />
          <Route path="script" element={<ScriptEditor />} />
          <Route path="storyboard" element={<StoryboardEditor />} />
          <Route path="editor" element={<VideoEditor />} />
          <Route path="verification" element={<VerificationReportPage />} />
          <Route path="lab" element={<CampaignLabPage />} />
          <Route path="provenance" element={<ProvenancePage />} />
          <Route path="taste" element={<TastePage />} />
        </Route>
      </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
