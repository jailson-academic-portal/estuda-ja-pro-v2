import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "./StatCard";
import { Building2, GraduationCap, Mail, ArrowRight, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { UsersTab } from "../admin/UsersTab";
import { InvitationsTab } from "../admin/InvitationsTab";
import { ImportStudentsTab } from "../admin/ImportStudentsTab";
import { SubscriptionsTab } from "../admin/SubscriptionsTab";
import { CoursesTab } from "../admin/CoursesTab";
import { CatalogTab } from "../admin/CatalogTab";
import { MarketingTab } from "../admin/MarketingTab";

import { useServerFn } from "@tanstack/react-start";
import { adminListInstitutions, adminGetDashboardStats } from "@/backend/users.functions";
import { listInvitations } from "@/backend/invitations.functions";

export function AdminDashboard() {
  const [stats, setStats] = useState({ institutions: 0, teachers: 0, students: 0, activeInvitations: 0 });
  const [institutions, setInstitutions] = useState<{ id: string; name: string; email: string | null }[]>([]);
  const listInsts = useServerFn(adminListInstitutions);
  const listInvs = useServerFn(listInvitations);
  const getStatsFn = useServerFn(adminGetDashboardStats);

  useEffect(() => {
    (async () => {
      try {
        const [serverStats, insts, invs] = await Promise.all([
          getStatsFn(),
          listInsts(),
          listInvs(),
        ]);
        
        const safeInvs = Array.isArray(invs) ? (invs as { used_count: number; max_uses: number; expires_at: string | null; revoked_at: string | null }[]) : [];
        const activeInvitations = safeInvs.filter((i) =>
          !i.revoked_at &&
          i.used_count < i.max_uses &&
          (!i.expires_at || new Date(i.expires_at) >= new Date()),
        ).length;
        
        setStats({
          institutions: serverStats.institutions,
          teachers: serverStats.teachers,
          students: serverStats.students,
          activeInvitations,
        });
        setInstitutions(Array.isArray(insts) ? (insts as { id: string; name: string; email: string | null }[]) : []);
      } catch (e) {
        console.error("[admin] stats failed", e);
      }
    })();
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Painel do administrador</h1>
        <p className="text-white/90 text-sm sm:text-base font-medium">Visão global da plataforma EstudaJá Pro.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Instituições ativas" value={stats.institutions} icon={Building2} tone="blue" />
        <StatCard label="Professores globais" value={stats.teachers} icon={GraduationCap} tone="teal" />
        <StatCard label="Alunos cadastrados" value={stats.students} icon={Users} tone="green" />
        <StatCard label="Convites ativos" value={stats.activeInvitations} icon={Mail} tone="orange" />
      </div>

      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardHeader><CardTitle className="text-lg">Gestão de Alunos</CardTitle></CardHeader>
        <CardContent>
          <Tabs defaultValue="users" className="w-full">
            <TabsList className="grid grid-cols-2 sm:grid-cols-7 w-full">
              <TabsTrigger value="users">Gestão de Alunos</TabsTrigger>
              <TabsTrigger value="invites">Convites de Acesso</TabsTrigger>
              <TabsTrigger value="courses">Cursos</TabsTrigger>
              <TabsTrigger value="import">Importar Alunos</TabsTrigger>
              <TabsTrigger value="subs">Assinaturas</TabsTrigger>
              <TabsTrigger value="catalog">Catálogo</TabsTrigger>
              <TabsTrigger value="marketing">Material institucional</TabsTrigger>
            </TabsList>
            <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
            <TabsContent value="invites" className="mt-4"><InvitationsTab allowInstitution={true} /></TabsContent>
            <TabsContent value="courses" className="mt-4"><CoursesTab /></TabsContent>
            <TabsContent value="import" className="mt-4"><ImportStudentsTab /></TabsContent>
            <TabsContent value="subs" className="mt-4"><SubscriptionsTab /></TabsContent>
            <TabsContent value="catalog" className="mt-4"><CatalogTab /></TabsContent>
            <TabsContent value="marketing" className="mt-4"><MarketingTab /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-0" style={{ boxShadow: "var(--shadow-card)" }}>
        <CardHeader><CardTitle className="text-lg">Instituições Cadastradas</CardTitle></CardHeader>
        <CardContent>
          {institutions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma instituição cadastrada ainda.</p>
          ) : (
            <ul className="divide-y">
              {institutions.map((i) => (
                <li key={i.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{i.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{i.email || "—"}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="ghost">Ver Painel <ArrowRight className="h-3.5 w-3.5 ml-1" /></Button>
                    <Button size="sm" variant="outline">Gerenciar</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}