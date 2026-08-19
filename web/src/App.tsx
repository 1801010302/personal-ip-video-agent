import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { usePath } from "@/hooks/usePath";
import { apiRequest } from "@/lib/api";
import { ActivatePage } from "@/pages/ActivatePage";
import { AdminInvitesPage, type AdminTab } from "@/pages/AdminInvitesPage";
import { AuthPage } from "@/pages/AuthPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { AvatarsPage } from "@/pages/AvatarsPage";
import { CreatePage } from "@/pages/CreatePage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { VideosPage } from "@/pages/VideosPage";
import { VoicesPage } from "@/pages/VoicesPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { ProviderSettingsPage } from "@/pages/ProviderSettingsPage";
import { PricingPage } from "@/pages/PricingPage";
import { TutorialPage } from "@/pages/TutorialPage";
import type { AccessStatus } from "@/types/api";

const defaultAccess: AccessStatus = {
  activated: false,
  accessStatus: "pending",
  accessSource: null,
  accessExpiresAt: null,
  role: "user",
  deepseekConnected: false,
  deepseekStatus: "not_connected",
  providerConnected: false,
  providerStatus: "not_connected",
  imagegenConnected: false,
  imagegenStatus: "not_connected",
};

function LoadingScreen() {
  return <main className="loading-screen"><span className="spinner large" /><strong>正在准备你的创作空间</strong><p>加载账号和安全设置…</p></main>;
}

function App() {
  const { path, navigate } = usePath();
  const { user, loading: authLoading, isAuthenticated, signOut } = useAuth();
  const [access, setAccess] = useState<AccessStatus>(defaultAccess);
  const [accessLoading, setAccessLoading] = useState(false);

  const refreshAccess = useCallback(async () => {
    if (!isAuthenticated) {
      setAccess(defaultAccess);
      return;
    }
    setAccessLoading(true);
    try {
      setAccess(await apiRequest<AccessStatus>("/api/access/status"));
    } finally {
      setAccessLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { void refreshAccess(); }, [refreshAccess]);

  const handleSignOut = async () => {
    await signOut();
    setAccess(defaultAccess);
    navigate("/login", true);
  };

  if (authLoading) return <LoadingScreen />;
  if (!isAuthenticated || !user) {
    if (path === "/pricing") return <PricingPage onNavigate={navigate} />;
    const mode = path === "/bootstrap" ? "bootstrap" : path === "/register" ? "register" : "login";
    return <AuthPage mode={mode} onNavigate={navigate} onAuthenticated={refreshAccess} />;
  }
  if (accessLoading && !access.activated) return <LoadingScreen />;
  if (path === "/pricing") return <PricingPage onNavigate={navigate} />;
  if (!access.activated) {
    return <ActivatePage email={user.email} onActivated={async () => { await refreshAccess(); navigate("/dashboard", true); }} onNavigate={navigate} onSignOut={handleSignOut} />;
  }

  const renderPage = () => {
    if (path.startsWith("/admin") && access.role === "admin") {
      const activeTab: AdminTab = path === "/admin/users" ? "users" : path === "/admin/jobs" ? "jobs" : path === "/admin/settings" ? "settings" : "overview";
      const openAdminTab = (tab: AdminTab) => navigate(tab === "overview" ? "/admin" : `/admin/${tab}`);
      return <AdminInvitesPage activeTab={activeTab} onTabChange={openAdminTab} />;
    }
    if (path === "/settings/provider") return <ProviderSettingsPage onConnectionChanged={refreshAccess} />;
    if (path === "/dashboard" || path === "/") return <DashboardPage access={access} onNavigate={navigate} />;
    if (path === "/create") return <CreatePage access={access} onNavigate={navigate} />;
    if (path === "/projects") return <ProjectsPage onNavigate={navigate} />;
    if (path === "/avatars") return <AvatarsPage />;
    if (path === "/voices") return <VoicesPage />;
    if (path === "/videos") return <VideosPage onNavigate={navigate} />;
    if (path === "/tutorial") return <TutorialPage onNavigate={navigate} />;
    return <PlaceholderPage title="账号设置" description="账号资料、登录安全、通知和数据删除将在这里管理。" onBack={() => navigate("/dashboard")} />;
  };

  return (
    <AppShell path={path === "/" ? "/dashboard" : path} access={access} userName={user.name || user.email.split("@")[0]} onNavigate={navigate} onSignOut={handleSignOut}>
      {renderPage()}
    </AppShell>
  );
}

export default App;
