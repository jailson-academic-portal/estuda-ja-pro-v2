import React, { useState, useEffect } from 'react';
import { 
  Users, 
  MessageSquare, 
  CalendarCheck, 
  Sparkles, 
  BookOpen, 
  Dumbbell, 
  Stethoscope, 
  ClipboardList, 
  GraduationCap, 
  BarChart3, 
  CalendarDays, 
  NotebookPen, 
  Library, 
  ClipboardCheck,
  ShieldCheck,
  Database,
  Search,
  FileJson,
  TrendingUp,
} from 'lucide-react';
import { supabase } from "@/integrations/supabase/client";
import { StudentsModule } from './StudentsModule';
import { MaterialsModule } from './MaterialsModule';
import { ExercisesModule } from './ExercisesModule';
import { AssessmentsModule } from './AssessmentsModule';
import { GradesModule } from './GradesModule';
import { AttendanceModule } from './AttendanceModule';
import { SimulSaudeModule } from './SimulSaudeModule';
import { VirtualLabModule } from './VirtualLabModule';
import { MyDiaryModule } from './MyDiaryModule';
import { AIAssistantModule } from './AIAssistantModule';
import { ActivitiesModule } from './ActivitiesModule';
import { RubricsModule } from './RubricsModule';
import { CalendarModule } from './CalendarModule';

export type ModuleKey =
  | "students"
  | "chat"
  | "attendance"
  | "ai"
  | "materials"
  | "exercises"
  | "activities"
  | "academic_works"
  | "group_management"
  | "rubrics"
  | "grades"
  | "analytics"
  | "calendar"
  | "diary"
  | "simulsaude"
  | "assessments"
  | "online_exams"
  | "virtual_lab"
  | "data_tables";

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  description: string;
  illustration: string;
  color: string;
  icon: React.ElementType;
}

export const MODULES: ModuleDef[] = [
  {
    key: "students",
    label: "Alunos",
    description: "Lista, importação CSV e matrículas",
    illustration: "https://illustrations.popsy.co/teal/work-from-home.svg",
    color: "teal",
    icon: Users,
  },
  {
    key: "ai",
    label: "Assistente de IA",
    description: "Geração de conteúdos com IA",
    illustration: "https://illustrations.popsy.co/teal/robot.svg",
    color: "purple",
    icon: Sparkles,
  },
  {
    key: "activities",
    label: "Atividades Extras",
    description: "Redações, seminários, casos e mais",
    illustration: "https://illustrations.popsy.co/teal/notes.svg",
    color: "pink",
    icon: ClipboardList,
  },
  {
    key: "assessments",
    label: "Avaliações",
    description: "Provas com IA e correção automática",
    illustration: "https://illustrations.popsy.co/teal/checklist.svg",
    color: "orange",
    icon: ClipboardCheck,
  },
  {
    key: "online_exams",
    label: "Provas Online",
    description: "Aplicação no navegador com biometria",
    illustration: "https://illustrations.popsy.co/teal/shield.svg",
    color: "indigo",
    icon: ShieldCheck,
  },
  {
    key: "calendar",
    label: "Calendário",
    description: "Eventos, prazos e cronograma",
    illustration: "https://illustrations.popsy.co/teal/calendar.svg",
    color: "teal",
    icon: CalendarDays,
  },
  {
    key: "chat",
    label: "Chat",
    description: "Conversas com a turma",
    illustration: "https://illustrations.popsy.co/teal/messages.svg",
    color: "blue",
    icon: MessageSquare,
  },
  {
    key: "exercises",
    label: "Exercícios",
    description: "Listas e questões",
    illustration: "https://illustrations.popsy.co/teal/fitness.svg",
    color: "green",
    icon: Dumbbell,
  },
  {
    key: "attendance",
    label: "Diário Digital",
    description: "Chamada, grade de frequência e justificativas",
    illustration: "https://illustrations.popsy.co/teal/social-media-marketing.svg",
    color: "green",
    icon: CalendarCheck,
  },
  {
    key: "materials",
    label: "Materiais",
    description: "Apostilas, slides, leituras",
    illustration: "https://illustrations.popsy.co/teal/student-going-to-school.svg",
    color: "blue",
    icon: BookOpen,
  },
  {
    key: "diary",
    label: "Meu Diário",
    description: "Anotações pessoais da disciplina",
    illustration: "https://illustrations.popsy.co/teal/creative-writing.svg",
    color: "pink",
    icon: NotebookPen,
  },
  {
    key: "analytics",
    label: "Analytics & Desempenho",
    description: "Gráficos de frequência, notas e engajamento",
    illustration: "https://illustrations.popsy.co/teal/presentation.svg",
    color: "blue",
    icon: TrendingUp,
  },
  {
    key: "simulsaude",
    label: "SimulSaúde",
    description: "Simulação Clínica e IA",
    illustration: "https://illustrations.popsy.co/teal/science.svg",
    color: "blue",
    icon: Stethoscope,
  },
  {
    key: "virtual_lab",
    label: "Laboratório Virtual",
    description: "Casos simulados de análises clínicas",
    illustration: "https://illustrations.popsy.co/teal/medical-research.svg",
    color: "teal",
    icon: Database,
  },
  {
    key: "grades",
    label: "Notas",
    description: "Lançamento e composição de notas",
    illustration: "https://illustrations.popsy.co/teal/data-analysis.svg",
    color: "orange",
    icon: BarChart3,
  },
  {
    key: "academic_works",
    label: "Trabalhos Acadêmicos",
    description: "TCC, artigos e projetos",
    illustration: "https://illustrations.popsy.co/teal/graduated.svg",
    color: "purple",
    icon: GraduationCap,
  },
  {
    key: "group_management",
    label: "Gestão de Grupos",
    description: "Consulte equipes e integrantes dos trabalhos",
    illustration: "https://illustrations.popsy.co/teal/team.svg",
    color: "teal",
    icon: Users,
  },
];

export function ModuleGrid({
  onSelect,
  role = "teacher",
  accentColor,
  disciplineId,
}: {
  onSelect: (key: ModuleKey) => void;
  role?: "teacher" | "student";
  accentColor?: string;
  disciplineId?: string;
}) {
  const isStudent = role === "student";
  const [visibleModules, setVisibleModules] = useState<string[] | null>(null);

  useEffect(() => {
    if (disciplineId) {
      supabase
        .from("disciplines")
        .select("visible_modules")
        .eq("id", disciplineId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.visible_modules && Array.isArray(data.visible_modules)) {
            setVisibleModules(data.visible_modules as string[]);
          }
        });
    }
  }, [disciplineId]);
  
  const visible = MODULES
    .filter((m) => {
      // Gestão de Grupos permanece visível temporariamente para qualquer perfil e configuração.
      if (m.key === "group_management") return !isStudent;
      if (isStudent && m.key === "students") return false;
      if (visibleModules && !visibleModules.includes(m.key)) return false;
      return true;
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {visible.map((m) => {
        const label = m.label;
        const description = m.description;
        
        return (
          <button
            key={m.key}
            onClick={() => onSelect(m.key)}
            aria-label={label}
            title={description}
            className="group relative flex flex-col items-center justify-center gap-3 rounded-2xl p-4 bg-white/60 hover:bg-white shadow-sm hover:shadow-md transition-all aspect-square border border-white/40"
            style={
              accentColor
                ? {
                    borderBottom: `3px solid ${accentColor}`,
                  }
                : undefined
            }
          >
            <div 
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-1 group-hover:scale-110 transition-transform shadow-sm"
              style={{ backgroundColor: `var(--color-card-${m.color})`, opacity: 0.8 }}
            >
              <m.icon className="w-8 h-8 text-white" />
            </div>
            
            <div className="text-xs sm:text-sm font-semibold text-center leading-tight text-slate-800">
              {label}
            </div>
          </button>
        );
      })}
    </div>
  );
}
