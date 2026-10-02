import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Pencil, Copy, Archive, Trash2, Users, ArchiveRestore, CalendarDays, Clock, CalendarCheck } from "lucide-react";
import type { MouseEvent, KeyboardEvent } from "react";
import owlMascot from "@/assets/owl-logo.png";

export interface DisciplineCardData {
  id: string;
  name: string;
  semester: string;
  year: number;
  code?: string | null;
  group_name?: string | null;
  color: string;
  status: "active" | "archived";
  studentCount: number;
  start_date?: string | null;
  end_date?: string | null;
  week_days?: string[] | null;
  class_start_time?: string | null;
  class_end_time?: string | null;
}

const COLOR_TO_VAR: Record<string, string> = {
  teal: "var(--color-card-teal)",
  blue: "var(--color-card-blue)",
  green: "var(--color-card-green)",
  purple: "var(--color-card-purple)",
  pink: "var(--color-card-pink)",
  orange: "var(--color-card-orange)",
  indigo: "var(--color-card-indigo)",
  red: "var(--color-card-red)",
  amber: "var(--color-card-amber)",
  cyan: "var(--color-card-cyan)",
  lime: "var(--color-card-lime)",
  rose: "var(--color-card-rose)",
};

const WEEK_DAY_SHORT: Record<string, string> = {
  mon: "Seg", tue: "Ter", wed: "Qua", thu: "Qui", fri: "Sex", sat: "Sáb", sun: "Dom",
};

function formatDateBR(d?: string | null) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y.slice(2)}`;
}

export function DisciplineCard({
  discipline,
  canManage = true,
  href,
  onEdit,
  onCopy,
  onArchive,
  onUnarchive,
  onDelete,
  attendancePercent,
}: {
  discipline: DisciplineCardData;
  canManage?: boolean;
  href?: string;
  onEdit?: () => void;
  onCopy?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete?: () => void;
  attendancePercent?: number | null;
}) {
  const navigate = useNavigate();
  const bg = COLOR_TO_VAR[discipline.color] ?? COLOR_TO_VAR.teal;
  const menuAction = (action?: () => void) => (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    // Defer to next tick so the dropdown can close cleanly before
    // the action opens a dialog / navigates.
    setTimeout(() => action?.(), 0);
  };
  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    // Ignore clicks that originated inside the dropdown trigger or menu.
    const target = event.target as HTMLElement;
    if (target.closest("[data-no-card-nav]")) return;
    if (!href) return;
    navigate({ to: href });
  };
  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!href) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigate({ to: href });
    }
  };
  const Header = (
    <div className="h-36 relative text-primary-foreground" style={{ backgroundColor: bg }}>
      <img
        src={owlMascot}
        alt=""
        aria-hidden
        className="absolute right-2 bottom-0 h-24 w-auto object-contain opacity-25 pointer-events-none select-none"
      />
      <div className="absolute inset-0 p-4 flex flex-col justify-between">
        <div className="flex justify-between items-start">
          <div>
            {attendancePercent !== undefined && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-white/20 backdrop-blur-sm px-2.5 py-1 text-xs font-medium"
                title="Frequência nesta disciplina"
              >
                <CalendarCheck className="h-3.5 w-3.5" />
                Frequência: {attendancePercent == null ? "—" : `${attendancePercent}%`}
              </span>
            )}
          </div>
            {canManage && (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    data-no-card-nav
                    className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-56"
                  data-no-card-nav
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenuItem onSelect={menuAction(onEdit)}><Pencil className="h-4 w-4 mr-2" /> Editar</DropdownMenuItem>
                  <DropdownMenuItem onSelect={menuAction(onCopy)}><Copy className="h-4 w-4 mr-2" /> Copiar para novo semestre</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {discipline.status === "active" ? (
                    <DropdownMenuItem onSelect={menuAction(onArchive)}><Archive className="h-4 w-4 mr-2" /> Arquivar</DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={menuAction(onUnarchive)}><ArchiveRestore className="h-4 w-4 mr-2" /> Restaurar</DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={menuAction(onDelete)} className="text-destructive focus:text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" /> Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
        </div>
        <h3 className="font-semibold text-lg leading-tight line-clamp-2 pr-20">{discipline.name}</h3>
      </div>
    </div>
  );

  const Body = (
    <CardContent className="p-4 flex items-center justify-between text-sm">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-muted-foreground">
          {discipline.semester}º · {discipline.year}{discipline.group_name ? ` · ${discipline.group_name}` : ""}
        </span>
        {(discipline.start_date || discipline.end_date) && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            {formatDateBR(discipline.start_date)}
            {discipline.end_date ? ` – ${formatDateBR(discipline.end_date)}` : ""}
          </span>
        )}
        {(discipline.week_days?.length || discipline.class_start_time) && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {(discipline.week_days ?? []).map((d) => WEEK_DAY_SHORT[d] ?? d).join(", ")}
            {discipline.class_start_time ? ` · ${discipline.class_start_time.slice(0, 5)}` : ""}
            {discipline.class_end_time ? `–${discipline.class_end_time.slice(0, 5)}` : ""}
          </span>
        )}
      </div>
      <span className="inline-flex items-center gap-1 text-muted-foreground shrink-0">
        <Users className="h-4 w-4" /> {discipline.studentCount}
      </span>
    </CardContent>
  );

  return (
    <Card
      role={href ? "link" : undefined}
      tabIndex={href ? 0 : undefined}
      onClick={href ? handleCardClick : undefined}
      onKeyDown={href ? handleCardKeyDown : undefined}
      className="overflow-hidden border-0 hover:scale-[1.01] transition-transform cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
      style={{ boxShadow: "var(--shadow-card)", borderBottom: `4px solid ${bg}` }}
    >
      {Header}
      {Body}
    </Card>
  );
}