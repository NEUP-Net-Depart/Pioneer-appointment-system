import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./ui";
import type { Home } from "./types";

// One polling owner per mounted workspace. Keep existing data while revalidating.
export function useField(campus: string, scene: string, sessionKey: string) {
  const [data, setData] = useState<Home | null>(null),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null),
    generation = useRef(0),
    last = useRef(0);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++generation.current;
    try {
      const result = await api<Home>(
        `/api/field/${["desk", "operations"].includes(scene) ? "board" : "home"}${campus ? "?campusId=" + encodeURIComponent(campus) : ""}`,
        { signal: controller.signal },
      );
      if (version === generation.current) {
        setData(result);
        setError("");
        last.current = Date.now();
      }
    } catch (error) {
      if (!controller.signal.aborted && version === generation.current) {
        if ((error as Error & { status: number }).status === 403 && ['desk', 'operations'].includes(scene)) {
          // The selected campus may no longer permit this work scene. Recover
          // its authorized home so navigation can offer the correct next step.
          try {
            const home = await api<Home>(`/api/field/home${campus ? '?campusId=' + encodeURIComponent(campus) : ''}`, { signal: controller.signal });
            if (version === generation.current) { setData(home); setError(''); last.current = Date.now(); }
            return;
          } catch { /* Keep the original access error when recovery is unavailable. */ }
        }
        if ([401, 403].includes((error as Error & { status: number }).status))
          setData(null);
        setError((error as Error).message);
      }
    }
  }, [campus, scene, sessionKey]);
  useEffect(() => {
    setData(null);
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 30000);
    const visibility = () => {
      if (document.hidden) {
        request.current?.abort();
        generation.current++;
      } else if (Date.now() - last.current >= 30000) refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      generation.current++;
      request.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh]);
  return { data, error, refresh };
}
