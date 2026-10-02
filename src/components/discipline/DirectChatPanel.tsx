import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useServerFn } from "@tanstack/react-start";
import { sendDirectMessage } from "@/backend/direct-messages.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Send, MessageCircle, ArrowLeft, Search, Check, CheckCheck } from "lucide-react";
import { toast } from "sonner";

interface DMRow {
  id: string;
  discipline_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  profile_type: string;
}

export function DirectChatPanel({
  disciplineId,
  isTeacher,
  teacherId,
  initialContactId,
}: {
  disciplineId: string;
  isTeacher: boolean;
  teacherId: string;
  initialContactId?: string | null;
}) {
  const { user } = useAuth();
  const sendFn = useServerFn(sendDirectMessage);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [activeContact, setActiveContact] = useState<string | null>(initialContactId ?? null);
  const [messages, setMessages] = useState<DMRow[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [unreadByContact, setUnreadByContact] = useState<Record<string, number>>({});
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // ---- Load contacts ---------------------------------------------------
  const loadContacts = useCallback(async () => {
    if (!user) return;
    setLoadingContacts(true);
    try {
      if (isTeacher) {
        const { data: enrolled } = await supabase
          .from("discipline_students")
          .select("student_id")
          .eq("discipline_id", disciplineId);
        const ids = (enrolled ?? []).map((r) => r.student_id);
        if (ids.length === 0) { setContacts([]); return; }
        const { data } = await supabase.rpc("get_profiles_safe", { _ids: ids });
        const list: Contact[] = (data ?? []).map((p) => ({ id: p.id, name: p.name || "Aluno(a)", profile_type: p.profile_type }));
        list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        setContacts(list);
      } else {
        const { data } = await supabase.rpc("get_profiles_safe", { _ids: [teacherId] });
        const p = data?.[0];
        setContacts(p ? [{ id: p.id, name: p.name || "Professor(a)", profile_type: p.profile_type }] : []);
        if (p && !activeContact) setActiveContact(p.id);
      }
    } finally {
      setLoadingContacts(false);
    }
  }, [user, isTeacher, disciplineId, teacherId, activeContact]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // ---- Unread counts per contact --------------------------------------
  const loadUnread = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("direct_messages")
      .select("sender_id")
      .eq("discipline_id", disciplineId)
      .eq("recipient_id", user.id)
      .is("read_at", null);
    const map: Record<string, number> = {};
    for (const row of data ?? []) map[row.sender_id] = (map[row.sender_id] ?? 0) + 1;
    setUnreadByContact(map);
  }, [user, disciplineId]);

  useEffect(() => { loadUnread(); }, [loadUnread]);

  // ---- Load thread with active contact --------------------------------
  const loadThread = useCallback(async (contactId: string) => {
    if (!user) return;
    setLoadingMsgs(true);
    const { data, error } = await supabase
      .from("direct_messages")
      .select("*")
      .eq("discipline_id", disciplineId)
      .or(
        `and(sender_id.eq.${user.id},recipient_id.eq.${contactId}),and(sender_id.eq.${contactId},recipient_id.eq.${user.id})`,
      )
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) toast.error(error.message);
    setMessages((data ?? []) as DMRow[]);
    setLoadingMsgs(false);

    // Mark received messages as read
    const unreadIds = (data ?? [])
      .filter((m) => m.recipient_id === user.id && !m.read_at)
      .map((m) => m.id);
    if (unreadIds.length) {
      await supabase.from("direct_messages")
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds);
      loadUnread();
    }
  }, [user, disciplineId, loadUnread]);

  useEffect(() => {
    if (activeContact) loadThread(activeContact);
    else setMessages([]);
  }, [activeContact, loadThread]);

  // ---- Realtime -------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`dm-${disciplineId}-${user.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "direct_messages",
        filter: `discipline_id=eq.${disciplineId}`,
      }, async (payload) => {
        const msg = payload.new as DMRow;
        if (msg.sender_id !== user.id && msg.recipient_id !== user.id) return;
        const otherId = msg.sender_id === user.id ? msg.recipient_id : msg.sender_id;
        if (otherId === activeContact) {
          setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
          if (msg.recipient_id === user.id) {
            await supabase.from("direct_messages")
              .update({ read_at: new Date().toISOString() }).eq("id", msg.id);
          }
        } else if (msg.recipient_id === user.id) {
          setUnreadByContact((prev) => ({ ...prev, [otherId]: (prev[otherId] ?? 0) + 1 }));
        }
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "direct_messages",
        filter: `discipline_id=eq.${disciplineId}`,
      }, (payload) => {
        const msg = payload.new as DMRow;
        if (msg.sender_id === user.id || msg.recipient_id === user.id) {
          setMessages((prev) => prev.map(m => m.id === msg.id ? msg : m));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, disciplineId, activeContact]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ---- Send -----------------------------------------------------------
  const send = async () => {
    if (!body.trim() || !activeContact || !user) return;
    setSending(true);
    const text = body.trim();
    setBody("");
    try {
      await sendFn({ data: {
        disciplineId,
        recipientId: activeContact,
        body: text,
      }});
      // Realtime will populate the message list; do a quick reload as fallback.
      loadThread(activeContact);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar mensagem");
      setBody(text);
    } finally {
      setSending(false);
    }
  };

  const filteredContacts = useMemo(() => {
    if (!filter.trim()) return contacts;
    const q = filter.toLowerCase();
    return contacts.filter((c) => c.name.toLowerCase().includes(q));
  }, [contacts, filter]);

  const activeContactObj = contacts.find((c) => c.id === activeContact) ?? null;

  return (
    <div className="flex h-[70vh] rounded-xl border bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
      {/* Left: contacts */}
      <div className={`${activeContact ? "hidden md:flex" : "flex"} w-full md:w-72 border-r flex-col bg-muted/20`}>
        <div className="border-b p-3 text-sm font-medium flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          {isTeacher ? "Alunos" : "Professor"}
        </div>
        {isTeacher && (
          <div className="p-2 border-b bg-card">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar aluno..." className="pl-7 h-8 text-sm" />
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {loadingContacts ? (
            <div className="p-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline text-primary" /></div>
          ) : filteredContacts.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">
              {isTeacher ? "Nenhum aluno matriculado ainda." : "Professor(a) indisponível."}
            </p>
          ) : filteredContacts.map((c) => {
            const unread = unreadByContact[c.id] ?? 0;
            const active = activeContact === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setActiveContact(c.id)}
                className={`w-full text-left px-3 py-2 border-b flex items-center justify-between gap-2 hover:bg-muted/50 ${active ? "bg-primary/10" : ""}`}
              >
                <div className="min-w-0">
                  <div className={`text-sm truncate ${unread > 0 ? "font-semibold" : "font-medium"}`}>{c.name}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">
                    {c.profile_type === "teacher" ? "professor(a)" : c.profile_type === "student" ? "aluno(a)" : c.profile_type}
                  </div>
                </div>
                {unread > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: thread */}
      <div className={`${activeContact ? "flex" : "hidden md:flex"} flex-1 flex-col`}>
        {activeContactObj ? (
          <>
            <div className="border-b p-3 text-sm font-medium flex items-center gap-2">
              <Button variant="ghost" size="icon" className="md:hidden h-7 w-7" onClick={() => setActiveContact(null)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <div>{activeContactObj.name}</div>
                <div className="text-[10px] text-muted-foreground capitalize">
                  {activeContactObj.profile_type === "teacher" ? "professor(a)" : "aluno(a)"}
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/10">
              {loadingMsgs ? (
                <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
              ) : messages.length === 0 ? (
                <p className="text-sm text-center text-muted-foreground py-12">Envie a primeira mensagem.</p>
              ) : messages.map((m) => {
                const mine = m.sender_id === user?.id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words flex flex-col ${
                      mine ? "bg-primary text-primary-foreground items-end" : "bg-card border items-start"
                    }`}>
                      {m.body}
                      <div className={`text-[10px] mt-0.5 flex items-center gap-1 ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        {mine && (
                          m.read_at ? (
                            <CheckCheck className="h-3 w-3 text-blue-300" />
                          ) : (
                            <Check className="h-3 w-3 opacity-70" />
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <div className="border-t p-3 flex gap-2 items-end bg-card">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={`Mensagem para ${activeContactObj.name}...`}
                rows={2}
                maxLength={4000}
                className="resize-none"
              />
              <Button onClick={send} disabled={!body.trim() || sending}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
            {isTeacher ? "Selecione um aluno na lista para iniciar uma conversa." : "Nenhum professor disponível para contato."}
          </div>
        )}
      </div>
    </div>
  );
}