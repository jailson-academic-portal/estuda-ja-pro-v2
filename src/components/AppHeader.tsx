import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import { OwlLogo } from "./OwlLogo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { LogOut, GraduationCap, ShieldCheck, Image as ImageIcon } from "lucide-react";
import owlAvatar from "@/assets/owl-logo.png";
import { NotificationsBell } from "./NotificationsBell";
import { HelpManualButton } from "./HelpManualButton";
import { PushPermissionBanner } from "./PushPermissionBanner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const profileLabel: Record<string, string> = {
  admin: "Administrador",
  institution: "Instituição",
  teacher: "Professor(a)",
  student: "Estudante",
  gestor: "Gestor",
};

function getDisplayName(profile: { full_name?: string | null; name?: string | null; email?: string | null } | null): string {
  if (!profile) return "Usuário";
  return profile.full_name?.trim() || profile.name?.trim() || profile.email?.trim() || "Usuário";
}

export function AppHeader() {
  const { profile, signOut, viewAs, setViewAs, effectiveProfileType } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login", search: { tab: "email" } });
  };

  const isAdmin = profile?.profile_type === "admin";
  const displayName = getDisplayName(profile);
  const isDisciplineRoute = location.pathname.startsWith("/disciplines/");
  const isTeacherView = isAdmin && (viewAs === "teacher" || isDisciplineRoute);

  const enterTeacherView = () => {
    setViewAs("teacher");
    navigate({ to: "/" });
  };

  const returnToAdminPanel = () => {
    setViewAs(null);
    navigate({ to: "/" });
  };

  return (
    <header
      className="text-white shadow-md z-50 relative"
      style={{ backgroundImage: "var(--gradient-header)" }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between">
        <Link to="/" className="text-white">
          <OwlLogo />
        </Link>
        {profile ? (
          <div className="flex items-center gap-2">
            {isAdmin && isTeacherView && (
              <Button
                size="sm"
                className="bg-white/95 text-slate-900 hover:bg-white font-semibold shadow-sm"
                onClick={returnToAdminPanel}
              >
                <ShieldCheck className="h-4 w-4 mr-1.5" />
                Voltar ao Admin
              </Button>
            )}
            {isAdmin && !isTeacherView && (
              <Button
                size="sm"
                className="bg-amber-400 text-slate-900 hover:bg-amber-300 font-semibold shadow-sm"
                onClick={enterTeacherView}
              >
                <GraduationCap className="h-4 w-4 mr-1.5" />
                Visão de Professor
              </Button>
            )}
            <NotificationsBell />
            <PushPermissionBanner />
            <HelpManualButton />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="text-white hover:bg-white/15 hover:text-white gap-2 pl-2">
                  <span className="hidden sm:inline max-w-[16ch] truncate" title={displayName}>
                    {displayName}
                  </span>
                  <span className="h-9 w-9 rounded-full bg-white/15 ring-2 ring-amber-400/70 flex items-center justify-center overflow-hidden">
                    <img src={owlAvatar} alt="Perfil" className="h-8 w-8 object-contain" />
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="font-medium">{displayName}</div>
                  <div className="text-xs text-muted-foreground">
                    {profileLabel[profile.profile_type]}
                    {isAdmin && viewAs ? ` · vendo como ${profileLabel[viewAs]}` : ""}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isAdmin && effectiveProfileType !== "admin" && (
                  <DropdownMenuItem onClick={() => setViewAs(null)}>
                    <ShieldCheck className="h-4 w-4 mr-2" /> Voltar ao Admin
                  </DropdownMenuItem>
                )}
                {isAdmin && effectiveProfileType === "admin" && (
                  <DropdownMenuItem onClick={enterTeacherView}>
                    <GraduationCap className="h-4 w-4 mr-2" /> Visão de Professor
                  </DropdownMenuItem>
                )}
                {(profile.profile_type === "teacher" || profile.profile_type === "institution" || profile.profile_type === "admin") && (
                  <DropdownMenuItem onClick={() => navigate({ to: "/branding" })}>
                    <ImageIcon className="h-4 w-4 mr-2" /> Identidade Visual
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button asChild variant="secondary" size="sm">
            <Link to="/login" search={{ tab: "email" }}>Entrar</Link>
          </Button>
        )}
      </div>
    </header>
  );
}