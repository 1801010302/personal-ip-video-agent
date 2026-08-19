import {
  Bot,
  ChevronRight,
  CircleUserRound,
  Clapperboard,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Mic2,
  Plus,
  Settings2,
  TicketCheck,
  GraduationCap,
  PlayCircle,
  X,
} from "lucide-react";
import { useState } from "react";
import type { AccessStatus } from "@/types/api";
import { Brand } from "./Brand";
import { StatusBadge } from "./StatusBadge";

interface ShellProps {
  path: string;
  access: AccessStatus;
  userName: string;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
  children: React.ReactNode;
}

const navItems = [
  { path: "/dashboard", label: "工作台", icon: LayoutDashboard },
  { path: "/create", label: "开始创作", icon: Plus, primary: true },
  { path: "/projects", label: "我的项目", icon: FolderKanban },
  { path: "/avatars", label: "数字人", icon: Bot },
  { path: "/voices", label: "声音", icon: Mic2 },
  { path: "/videos", label: "成片库", icon: Clapperboard },
  { path: "/settings/provider", label: "API 设置", icon: Settings2 },
];

const mobileItems = navItems.filter((item) =>
  ["/dashboard", "/create", "/projects", "/avatars", "/settings/provider"].includes(item.path),
);

export function AppShell({ path, access, userName, onNavigate, onSignOut, children }: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = (nextPath: string) => {
    setMobileOpen(false);
    onNavigate(nextPath);
  };

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-head">
          <Brand />
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(false)} aria-label="关闭导航"><X size={20} /></button>
        </div>
        <button className="sidebar-create" onClick={() => navigate("/create")}><Plus size={19} />开始一条新视频</button>
        <button className={`tutorial-nav-feature ${path === "/tutorial" ? "active" : ""}`} onClick={() => navigate("/tutorial")}>
          <span><GraduationCap size={20} /></span><div><small>新手必看</small><strong>新手教学</strong></div><PlayCircle size={19} />
        </button>
        <nav className="side-nav" aria-label="主导航">
          {navItems.filter((item) => !item.primary).map(({ path: itemPath, label, icon: Icon }) => (
            <button key={itemPath} className={path === itemPath ? "nav-item active" : "nav-item"} onClick={() => navigate(itemPath)} aria-current={path === itemPath ? "page" : undefined}>
              <Icon size={19} /><span>{label}</span>{path === itemPath && <ChevronRight size={15} className="nav-caret" />}
            </button>
          ))}
          {access.role === "admin" && (
            <button className={path.startsWith("/admin") ? "nav-item active admin-nav-item" : "nav-item admin-nav-item"} onClick={() => navigate("/admin")} aria-current={path.startsWith("/admin") ? "page" : undefined}>
              <TicketCheck size={19} /><span>管理后台</span>{path.startsWith("/admin") && <ChevronRight size={15} className="nav-caret" />}
            </button>
          )}
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" onClick={() => navigate("/account")}><CircleUserRound size={19} /><span>账号设置</span></button>
          <button className="nav-item signout" onClick={onSignOut}><LogOut size={19} /><span>退出登录</span></button>
        </div>
      </aside>

      {mobileOpen && <button className="nav-scrim mobile-only" onClick={() => setMobileOpen(false)} aria-label="关闭导航遮罩" />}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-only" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Menu size={21} /></button>
            <div className="mobile-only"><Brand compact /></div>
          </div>
          <div className="topbar-actions">
            <StatusBadge tone={access.providerConnected && access.deepseekConnected && access.imagegenConnected ? "success" : "warning"}>{access.providerConnected && access.deepseekConnected && access.imagegenConnected ? "三项 API 已就绪" : "API 尚未配齐"}</StatusBadge>
            <button className="user-chip" onClick={() => navigate("/account")}><span>{userName.slice(0, 1).toUpperCase()}</span><strong>{userName}</strong></button>
          </div>
        </header>
        <main className="content" id="main-content">{children}</main>
      </div>

      <nav className="bottom-nav mobile-only" aria-label="手机端主导航">
        {mobileItems.map(({ path: itemPath, label, icon: Icon, primary }) => (
          <button key={itemPath} className={`${path === itemPath ? "active" : ""} ${primary ? "bottom-primary" : ""}`} onClick={() => navigate(itemPath)} aria-current={path === itemPath ? "page" : undefined}>
            <Icon size={primary ? 22 : 20} /><span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
