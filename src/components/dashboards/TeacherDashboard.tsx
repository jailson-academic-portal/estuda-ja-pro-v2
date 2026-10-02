import { useAuth } from "@/lib/auth-context";
import { DisciplinesManager } from "../DisciplinesManager";
import { SubscriptionStatusCard } from "../SubscriptionStatusCard";

export function TeacherDashboard() {
  const { profile } = useAuth();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Olá, {profile?.name?.split(" ")[0] || "professor(a)"} 👋</h1>
        <p className="text-white/90 text-sm sm:text-base font-medium">Gerencie suas disciplinas e tudo que acontece dentro delas.</p>
      </div>
      <SubscriptionStatusCard />
      <DisciplinesManager />
    </div>
  );
}