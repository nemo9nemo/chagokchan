"use client";
export const AUTH_CHANNEL = "chagokchan-auth-change";
export function broadcastSignedOut() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(AUTH_CHANNEL);
  channel.postMessage({ type: "signed-out" });
  channel.close();
}
