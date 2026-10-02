import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Bell, Check, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useNavigate } from "@tanstack/react-router";

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  data: any | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationsBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadDMs, setUnreadDMs] = useState<Record<string, number>>({}); // disciplineId -> count

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("id, kind, title, body, link, data, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data ?? []) as NotificationRow[]);
  }, [user]);

  const loadUnreadDMs = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("direct_messages")
      .select("discipline_id")
      .eq("recipient_id", user.id)
      .is("read_at", null);
    
    const counts: Record<string, number> = {};
    data?.forEach(msg => {
      counts[msg.discipline_id] = (counts[msg.discipline_id] || 0) + 1;
    });
    setUnreadDMs(counts);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    load();
    loadUnreadDMs();
    
    const notifChannel = supabase
      .channel(`notifications:${user.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, () => load())
      .subscribe();
      
    const dmChannel = supabase
      .channel(`dm-notifications:${user.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "direct_messages",
        filter: `recipient_id=eq.${user.id}`,
      }, () => loadUnreadDMs())
      .subscribe();

    return () => { 
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(dmChannel);
    };
  }, [user, load, loadUnreadDMs]);

  const totalUnreadDMs = useMemo(() => 
    Object.values(unreadDMs).reduce((sum, count) => sum + count, 0)
  , [unreadDMs]);

  const unread = items.filter((i) => !i.read_at).length;

  const markAllRead = async () => {
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
    load();
  };

  const handleClick = async (n: NotificationRow) => {
    if (!n.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      load();
    }

    if (n.link) {
      navigate({ to: n.link });
      return;
    }

    // Lógica de construção de rota baseada em metadados (data)
    if (n.data?.disciplineId || n.data?.discipline_id) {
      const dId = n.data.disciplineId || n.data.discipline_id;
      let targetPath = `/disciplines/${dId}`;
      
      // Mapeamento de abas baseado no tipo de notificação ou dados
      const kind = n.kind.toLowerCase();
      let searchParams: Record<string, string> = {};

      if (kind.includes("submission") || kind.includes("activity")) {
        searchParams.tab = "activities";
      } else if (kind.includes("work")) {
        searchParams.tab = "academic_works";
      } else if (kind.includes("clinical") || kind.includes("simulsaude")) {
        searchParams.tab = "simulsaude";
      } else if (kind.includes("exercise")) {
        searchParams.tab = "exercises";
      } else if (kind.includes("attendance")) {
        searchParams.tab = "attendance";
      } else if (kind.includes("grade")) {
        searchParams.tab = "grades";
      }

      navigate({ to: targetPath, search: searchParams });
    }
  };

  if (!user) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-white hover:bg-white/15 hover:text-white" aria-label="Notificações">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center px-1">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
          {totalUnreadDMs > 0 && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 border-2 border-[#0f172a] animate-in zoom-in duration-300">
              <MessageCircle className="h-2 w-2 text-white" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-semibold">Notificações</div>
          <div className="flex items-center gap-1">
            {totalUnreadDMs > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold">
                <MessageCircle className="h-3 w-3" />
                {totalUnreadDMs}
              </div>
            )}
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead} className="h-7 text-xs">
                <Check className="h-3 w-3 mr-1" /> Marcar todas
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-96 overflow-auto">
          {totalUnreadDMs > 0 && (
            <div className="bg-blue-50/50 p-2 border-b">
              <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1 px-1 flex items-center gap-1">
                <MessageCircle className="h-3 w-3" /> Mensagens não lidas
              </div>
              <div className="space-y-1">
                {Object.entries(unreadDMs).map(([dId, count]) => (
                  <button
                    key={dId}
                    onClick={() => {
                      navigate({ to: `/disciplines/${dId}`, search: (prev: any) => ({ ...prev, tab: "chat", dm: "1" }) });
                    }}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-blue-100/50 transition-colors text-xs"
                  >
                    <span className="font-medium text-blue-800">Ver mensagens na disciplina</span>
                    <span className="bg-blue-600 text-white px-1.5 rounded-full font-bold">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {items.length === 0 && totalUnreadDMs === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">Sem notificações</div>
          ) : items.map((n) => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-left px-3 py-2 border-b hover:bg-muted/80 transition-colors cursor-pointer ${!n.read_at ? "bg-primary/5" : ""}`}
            >
              <div className="text-sm font-medium">{n.title}</div>
              {n.body && <div className="text-xs text-muted-foreground line-clamp-2">{n.body}</div>}
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(n.created_at).toLocaleString("pt-BR")}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}