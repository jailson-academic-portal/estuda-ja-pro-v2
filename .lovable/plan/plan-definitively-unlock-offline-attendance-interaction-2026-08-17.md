# Plan: Definitively Unlock Offline Attendance Interaction

The goal is to ensure attendance buttons are 100% interactive offline by bypassing UI library limitations, removing CSS-based locks, and forcing an immediate local-first event handler.

## Proposed Changes

### 1. Hard-Unlock `QuickAttendanceDialog.tsx`
- Replace UI library `<Button>` with native `<button>` for "Confirmar presença" and "Ler QR Code".
- Force `disabled={false}` and remove all opacity/pointer-event classes conditional on network status.
- Implement `e.preventDefault()` at the start of `submitCode` to handle offline saving before any other validation.

### 2. Hard-Unlock `CurrentPresencePanel.tsx`
- Replace UI library `<Button>` with native `<button>` for "Confirmar Presença" (Student) and "Ler QR Code".
- Remove network-related `disabled` attributes.
- Ensure `onClick` and `onSubmit` handlers immediately check `isOnline()` and fallback to `enqueuePresenceBySession` without waiting for the UI library's busy state.

### 3. Service Worker Force-Update
- Modify `src/pwa/register-sw.ts` or `src/routes/__root.tsx` to automatically call `updateServiceWorker(true)` when a new version is detected, ensuring users get the "unlocked" interface without manual refresh.

### 4. Robust Offline Detection
- Update `src/lib/offline-attendance-queue.ts` to ensure `isOnline()` returns `false` if a heartbeat check fails, rather than just relying on `navigator.onLine`.

## Technical Details

### Component Modifications
- In `QuickAttendanceDialog.tsx` and `CurrentPresencePanel.tsx`, use standard Tailwind classes for styling instead of relying on shadcn/radix button variants that might include internal `disabled` logic.
- Remove `busy` state from disabling buttons; instead, show a loader but keep the button clickable to avoid "frozen UI" perceptions.

### Service Worker
- Register a listener for `onNeedRefresh` that triggers an immediate reload or update to clear cached "blocked" versions of the app.
