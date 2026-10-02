import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, MessageSquare, Loader2, User } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { chatWithPatient } from "@/backend/simulsaude-chat.functions";

export const PatientChat: React.FC<{ case: any }> = ({ case: caseData }) => {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatFn = useServerFn(chatWithPatient);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const response = await chatFn({
        data: {
          caseId: caseData.id,
          message: userMsg,
          history: messages,
          caseContext: caseData,
        }
      });
      
      setMessages(prev => [...prev, { role: "assistant", content: response as string }]);
    } catch (err) {
      console.error("Chat error:", err);
      setMessages(prev => [...prev, { role: "assistant", content: "Desculpe, tive um problema ao responder agora." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="flex flex-col h-[600px]">
      <CardHeader>
        <CardTitle>Chat com Paciente (IA)</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-4 overflow-hidden">
        <ScrollArea className="flex-1 border rounded-md p-4 bg-muted/5" viewportRef={scrollRef}>
          <div className="space-y-4 pr-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full py-20 text-muted-foreground">
                <div className="bg-muted p-4 rounded-full mb-3">
                  <MessageSquare className="h-8 w-8 opacity-20" />
                </div>
                <p className="text-sm">Inicie a conversa com o paciente acima.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  {m.role === 'user' ? <User className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                </div>
                <div className={`max-w-[80%] rounded-lg p-3 text-sm leading-relaxed ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-white border shadow-sm'}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
                <div className="bg-white border rounded-lg p-3 text-sm italic text-muted-foreground">
                  Digitando...
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="flex gap-2">
          <Input 
            placeholder="Perguntar ao paciente (ex: Como é a sua alimentação?)..." 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={loading}
          />
          <Button onClick={handleSend} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
