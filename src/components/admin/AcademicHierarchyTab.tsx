import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { CoursesTab } from "./CoursesTab";
import { ClassesTab } from "./ClassesTab";
import { BookOpen, Users, GraduationCap } from "lucide-react";

export function AcademicHierarchyTab() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tight text-teal-900">Hierarquia Acadêmica</h2>
        <p className="text-muted-foreground">Gerencie os alicerces educacionais da sua instituição.</p>
      </div>

      <Tabs defaultValue="courses" className="w-full">
        <TabsList className="bg-muted/50 p-1 mb-6">
          <TabsTrigger value="courses" className="flex items-center gap-2 data-[state=active]:bg-teal-600 data-[state=active]:text-white">
            <BookOpen className="h-4 w-4" /> Cursos & Disciplinas
          </TabsTrigger>
          <TabsTrigger value="classes" className="flex items-center gap-2 data-[state=active]:bg-teal-600 data-[state=active]:text-white">
            <Users className="h-4 w-4" /> Turmas
          </TabsTrigger>
          <TabsTrigger value="professors" className="flex items-center gap-2 data-[state=active]:bg-teal-600 data-[state=active]:text-white">
            <GraduationCap className="h-4 w-4" /> Professores
          </TabsTrigger>
        </TabsList>

        <TabsContent value="courses">
          <CoursesTab />
        </TabsContent>

        <TabsContent value="classes">
          <ClassesTab />
        </TabsContent>

        <TabsContent value="professors">
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center space-y-3">
              <div className="bg-teal-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                <GraduationCap className="h-8 w-8 text-teal-600" />
              </div>
              <div className="max-w-md mx-auto">
                <h3 className="text-lg font-semibold text-teal-900">Gestão de Docentes</h3>
                <p className="text-sm text-muted-foreground">
                  Em breve: Vinculação tripla (Professor + Disciplina + Turma) para controle total da carga horária.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
