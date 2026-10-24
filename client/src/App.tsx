import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { Loading } from './components/ui';
import { AppShell } from './components/AppShell';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import CreateWorkspace from './pages/CreateWorkspace';
import WorkspaceDetail from './pages/WorkspaceDetail';
import CreateProject from './pages/CreateProject';
import ProjectLayout from './pages/ProjectLayout';
import ProjectOverview from './pages/ProjectOverview';
import InputWizard from './pages/InputWizard';
import KnowledgeLedger from './pages/KnowledgeLedger';
import ConflictRoom from './pages/ConflictRoom';
import AssetsLibrary from './pages/AssetsLibrary';
import RightsManager from './pages/RightsManager';
import ReadinessDashboard from './pages/ReadinessDashboard';
import CostAtRiskDashboard from './pages/CostAtRiskDashboard';
import ContractPage from './pages/ContractPage';
import NotificationsPage from './pages/NotificationsPage';
import DraftLadder from './pages/DraftLadder';
import ScriptEditor from './pages/ScriptEditor';
import StoryboardEditor from './pages/StoryboardEditor';
import VerificationReportPage from './pages/VerificationReportPage';
import ProvenancePage from './pages/ProvenancePage';
import CampaignLabPage from './pages/CampaignLabPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';

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
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="workspaces/new" element={<CreateWorkspace />} />
        <Route path="workspaces/:workspaceId" element={<WorkspaceDetail />} />
        <Route path="projects/new" element={<CreateProject />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="workspaces/:workspaceId/analytics" element={<AnalyticsPage />} />
        <Route path="workspaces/:workspaceId/settings" element={<SettingsPage />} />

        <Route path="projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<ProjectOverview />} />
          <Route path="inputs" element={<InputWizard />} />
          <Route path="ledger" element={<KnowledgeLedger />} />
          <Route path="conflicts" element={<ConflictRoom />} />
          <Route path="assets" element={<AssetsLibrary />} />
          <Route path="rights" element={<RightsManager />} />
          <Route path="readiness" element={<ReadinessDashboard />} />
          <Route path="risk" element={<CostAtRiskDashboard />} />
          <Route path="contract" element={<ContractPage />} />
          <Route path="ladder" element={<DraftLadder />} />
          <Route path="script" element={<ScriptEditor />} />
          <Route path="storyboard" element={<StoryboardEditor />} />
          <Route path="verification" element={<VerificationReportPage />} />
          <Route path="lab" element={<CampaignLabPage />} />
          <Route path="provenance" element={<ProvenancePage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
