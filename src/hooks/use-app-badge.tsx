import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export function useAppBadge() {
  const { user } = useAuth();
  const [totalUnread, setTotalUnread] = useState(0);

  const loadUnreadCount = useCallback(async () => {
    if (!user) return;
    
    // 1. Unread notifications
    const { count: notifCount } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);

    // 2. Unread direct messages
    const { count: dmCount } = await supabase
      .from("direct_messages")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .is("read_at", null);

    const total = (notifCount || 0) + (dmCount || 0);
    setTotalUnread(total);
    
    if (typeof navigator !== "undefined" && "setAppBadge" in navigator) {
      if (total > 0) {
        navigator.setAppBadge(total).catch(() => {});
      } else {
        navigator.clearAppBadge().catch(() => {});
      }
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      if (typeof navigator !== "undefined" && "clearAppBadge" in navigator) {
        navigator.clearAppBadge().catch(() => {});
      }
      return;
    }

    loadUnreadCount();

    // Periodic re-fetch to ensure sync (every 30 seconds)
    const interval = setInterval(loadUnreadCount, 30000);

    // Subscribe to changes
    const notifChannel = supabase
      .channel(`badge-notifs-${user.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, () => loadUnreadCount())
      .subscribe();

    const dmChannel = supabase
      .channel(`badge-dms-${user.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "direct_messages",
        filter: `recipient_id=eq.${user.id}`,
      }, () => loadUnreadCount())
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(dmChannel);
    };
  }, [user, loadUnreadCount]);

  return totalUnread;
}
