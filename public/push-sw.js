/* Dedicated Web Push service worker. Separate from the app-shell SW. */
self.addEventListener("install", (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let payload = { title: "Nova notificação", body: "", link: "/" };
  try {
    if (event.data) payload = Object.assign(payload, event.data.json());
  } catch (_) {
    try { payload.body = event.data ? event.data.text() : ""; } catch (_e) {}
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "EstudaJá", {
      body: payload.body || "",
      icon: payload.icon || "/apple-touch-icon.png",
      badge: "/apple-touch-icon.png",
      tag: payload.tag || undefined,
      data: { link: payload.link || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      try {
        const u = new URL(client.url);
        if (u.origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) { try { await client.navigate(link); } catch (_) {} }
          return;
        }
      } catch (_) {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(link);
  })());
});