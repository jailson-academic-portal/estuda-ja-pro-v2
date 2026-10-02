import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { sendChatMessage, markChatMessageAsRead } from "@/backend/chat.functions";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Trash2, MessageSquare, Users, MessageCircle, Eye, Bell } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DirectChatPanel } from "./DirectChatPanel";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppBadge } from "@/hooks/use-app-badge";

interface Msg {
  id: string;
  discipline_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export function ChatModule({
  disciplineId,
  isTeacher,
  teacherId,
}: {
  disciplineId: string;
  isTeacher: boolean;
  teacherId: string;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { name: string; profile_type: string }>>({});
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"group" | "direct">(() => {
    if (typeof window === "undefined") return "group";
    const p = new URLSearchParams(window.location.search);
    return p.get("dm") ? "direct" : "group";
  });
  const initialDmContact = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("dm")
    : null;
  const [totalDmUnread, setTotalDmUnread] = useState(0);
  const [messageReads, setMessageReads] = useState<Record<string, string[]>>({}); // messageId -> list of userIds who read it
  const markReadFn = useServerFn(markChatMessageAsRead);

  // Track DM unread count for tab badge (all direct messages to me in this discipline)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from("direct_messages")
        .select("id", { count: "exact", head: true })
        .eq("discipline_id", disciplineId)
        .eq("recipient_id", user.id)
        .is("read_at", null);
      if (!cancelled) setTotalDmUnread(count ?? 0);
    };
    load();
    const channel = supabase
      .channel(`dm-badge-${disciplineId}-${user.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "direct_messages",
        filter: `recipient_id=eq.${user.id}`,
      }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user, disciplineId]);

  const loadProfiles = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const missing = Array.from(new Set(ids));
    const { data } = await supabase.rpc("get_profiles_safe", { _ids: missing });
    if (data) {
      setProfiles((prev) => {
        const next = { ...prev };
        for (const p of data) next[p.id] = { name: p.name, profile_type: p.profile_type };
        return next;
      });
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("chat_messages").select("*")
      .eq("discipline_id", disciplineId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) toast.error(error.message);
    const items = (data ?? []) as Msg[];
    setMessages(items);
    
    // Load reads for all visible messages
    const { data: reads } = await supabase
      .from("chat_message_reads")
      .select("message_id, user_id")
      .in("message_id", items.map(m => m.id));
    
    const readMap: Record<string, string[]> = {};
    reads?.forEach(r => {
      if (!readMap[r.message_id]) readMap[r.message_id] = [];
      readMap[r.message_id].push(r.user_id);
    });
    setMessageReads(readMap);

    await loadProfiles(items.map((m) => m.sender_id));
    
    // Mark last visible message as read if it's from someone else
    const lastMsg = items[items.length - 1];
    if (lastMsg && lastMsg.sender_id !== user?.id) {
      markReadFn({ data: { messageId: lastMsg.id } });
    }
    
    setLoading(false);
  }, [disciplineId, loadProfiles, user?.id, markReadFn]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`chat-${disciplineId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `discipline_id=eq.${disciplineId}` },
        async (payload) => {
          const msg = payload.new as Msg;
          setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
          await loadProfiles([msg.sender_id]);
          
          // Auto-mark as read if I'm viewing the tab and it's not my message
          if (tab === "group" && msg.sender_id !== user?.id) {
            markReadFn({ data: { messageId: msg.id } });
          }
        })
      .on("postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages", filter: `discipline_id=eq.${disciplineId}` },
        (payload) => {
          const old = payload.old as { id: string };
          setMessages((prev) => prev.filter((m) => m.id !== old.id));
        })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_message_reads" },
        (payload) => {
          const read = payload.new as { message_id: string, user_id: string };
          setMessageReads(prev => ({
            ...prev,
            [read.message_id]: Array.from(new Set([...(prev[read.message_id] || []), read.user_id]))
          }));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [disciplineId, loadProfiles, tab, user?.id, markReadFn]);

  useEffect(() => {
    if (tab === "group") endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, tab]);

  const sendMessageFn = useServerFn(sendChatMessage);

  const send = async () => {
    if (!body.trim() || !user) return;
    setSending(true);
    const text = body.trim();
    setBody("");
    
    try {
      await sendMessageFn({
        data: {
          disciplineId,
          body: text
        }
      });
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar mensagem");
      setBody(text);
    }
    setSending(false);
  };




  const remove = async (id: string) => {
    const { error } = await supabase.from("chat_messages").delete().eq("id", id);
    if (error) toast.error(error.message);
  };

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "group" | "direct")} className="space-y-3">
      <TabsList className="grid w-full sm:w-auto sm:inline-grid grid-cols-2 sm:grid-cols-none sm:flex">
        <TabsTrigger value="group" className="gap-2">
          <Users className="h-4 w-4" /> Chat da turma
        </TabsTrigger>
        <TabsTrigger value="direct" className="gap-2 relative">
          <MessageCircle className="h-4 w-4" /> Chat direto
          {totalDmUnread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground animate-in zoom-in duration-300">
              {totalDmUnread > 9 ? "9+" : totalDmUnread}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="group" className="mt-0">
    <div className="flex flex-col h-[70vh] rounded-xl border bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="border-b p-3 text-sm font-medium flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        Chat da turma
        <span className="text-xs opacity-70 ml-auto">{messages.length} mensagem(ns)</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-center text-muted-foreground py-12">Nenhuma mensagem ainda. Seja o primeiro!</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === user?.id;
            const author = profiles[m.sender_id];
            const isAuthorTeacher = author?.profile_type === "teacher";
            const canDelete = mine || isTeacher;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] group flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}>
                  <div className="text-[10px] text-muted-foreground px-1 flex items-center gap-1">
                    <span className="font-medium">{author?.name ?? "…"}</span>
                    {isAuthorTeacher && <span className="text-primary">· professor(a)</span>}
                    <span>· {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className={`relative rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                    mine ? "bg-primary text-primary-foreground" :
                    isAuthorTeacher ? "bg-accent text-accent-foreground border" :
                    "bg-card border"
                  }`}>
                    {m.body}
                    {canDelete && (
                      <button
                        onClick={() => remove(m.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                        title="Excluir"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  
                  {/* Read receipts for teacher group messages */}
                  {isAuthorTeacher && !mine && (
                    <div className="flex items-center gap-1 mt-0.5 px-1 text-[10px] text-muted-foreground">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 cursor-help">
                              <Eye className="h-3 w-3" />
                              <span>Lido por {(messageReads[m.id]?.length || 0)} aluno(s)</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-[10px] max-w-xs">
                              {messageReads[m.id]?.length > 0 
                                ? "Visualizado por alunos desta turma"
                                : "Nenhum aluno visualizou ainda"}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t p-3 flex gap-2 items-end bg-card">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Escreva uma mensagem... (Enter envia, Shift+Enter quebra linha)"
          rows={2}
          maxLength={4000}
          className="resize-none"
        />
        <Button onClick={send} disabled={!body.trim() || sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
      </TabsContent>

      <TabsContent value="direct" className="mt-0">
        <DirectChatPanel
          disciplineId={disciplineId}
          isTeacher={isTeacher}
          teacherId={teacherId}
          initialContactId={initialDmContact}
        />
      </TabsContent>
    </Tabs>
  );
}