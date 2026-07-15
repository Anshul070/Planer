import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { chatTurn } from "@/lib/chat.functions";
import { saveGoogleTokens, syncToCalendar } from "@/lib/calendar.functions";
import { getAnonymousUserId, todayDate } from "@/lib/anon-user";
import type { ChatMessage, DayDoc, Goal, Task } from "@/lib/dinplan-types";

import { ProfileAvatar, LoginModal } from "@/components/profile-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";


export const Route = createFileRoute("/")({ component: DinPlanApp });

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Namaste! 🌼 Main DinPlan hu. Aaj ka din kaisa plan karna hai? Mujhe apna poora din batao — subah se raat tak jo bhi karna hai.",
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const getSortValue = (time: string) => {
      if (!time) return 0;
      const [h, m] = time.split(":").map(Number);
      const hour = h < 4 ? h + 24 : h;
      return hour * 60 + (m || 0);
    };
    return getSortValue(a.startTime) - getSortValue(b.startTime);
  });
}

function applyActions(
  prevTasks: Task[],
  prevGoals: Goal[],
  actions: any[]
): { tasks: Task[]; goals: Goal[] } {
  let tasks = [...prevTasks];
  let goals = [...prevGoals];

  for (const act of actions) {
    if (!act || typeof act.op !== "string") continue;
    switch (act.op) {
      case "add_task":
        if (act.task && act.startTime && act.endTime) {
          const existingIdx = tasks.findIndex(t => t.task.toLowerCase() === act.task.toLowerCase() && t.startTime === act.startTime);
          if (existingIdx !== -1) {
            tasks[existingIdx] = { ...tasks[existingIdx], endTime: act.endTime };
          } else {
            tasks.push({
              id: uid(),
              task: act.task,
              startTime: act.startTime,
              endTime: act.endTime,
              done: false,
            });
          }
        }
        break;
      case "remove_task":
        if (act.task) {
          tasks = tasks.filter(t => t.task.toLowerCase() !== act.task.toLowerCase());
        }
        break;
      case "add_goal":
        if (act.text) {
          const exists = goals.find(g => g.text.toLowerCase() === act.text.toLowerCase());
          if (!exists) {
            goals.push({ id: uid(), text: act.text, done: false });
          }
        }
        break;
      case "remove_goal":
        if (act.text) {
          goals = goals.filter(g => g.text.toLowerCase() !== act.text.toLowerCase());
        }
        break;
      case "clear_all":
        tasks = [];
        goals = [];
        break;
    }
  }

  return { tasks: sortTasks(tasks), goals };
}

// Sarvam-backed voice: record via MediaRecorder, POST to our server route
// which proxies to Sarvam STT. TTS goes through another route that returns
// base64 WAV played via an <audio> element.

async function transcribeWithSarvam(blob: Blob): Promise<string> {
  const fd = new FormData();
  fd.append("file", blob, "recording.webm");
  const res = await fetch("/api/public/sarvam/stt", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`STT ${res.status}`);
  const json = (await res.json()) as { transcript?: string; error?: string };
  if (json.error) throw new Error(json.error);
  return (json.transcript || "").trim();
}

async function speakWithSarvam(text: string, audioEl: HTMLAudioElement | null, onEnded?: () => void) {
  if (!audioEl || !text.trim()) {
    if (onEnded) onEnded();
    return;
  }
  try {
    const res = await fetch("/api/public/sarvam/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      if (onEnded) onEnded();
      return;
    }
    const json = (await res.json()) as { audio?: string };
    if (!json.audio) {
      if (onEnded) onEnded();
      return;
    }
    audioEl.pause();
    audioEl.src = `data:audio/wav;base64,${json.audio}`;
    audioEl.onended = () => {
      if (onEnded) onEnded();
    };
    await audioEl.play().catch(() => {
      if (onEnded) onEnded();
    });
  } catch {
    if (onEnded) onEnded();
  }
}

type Tab = "chat" | "plan" | "history";

function formatDayLabel(dateStr: string): string {
  // dateStr = YYYY-MM-DD
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - dt.getTime()) / 86400000);
  if (diff === 0) return "Aaj";
  if (diff === 1) return "Kal";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${dt.getDate()} ${months[dt.getMonth()]}`;
}

function computeStreak(days: { day_date: string; tasks: Task[] }[]): number {
  const planned = new Set(
    days.filter((d) => (d.tasks?.length ?? 0) > 0).map((d) => d.day_date),
  );
  if (planned.size === 0) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Start from today if planned, else yesterday
  const startOffset = planned.has(toISO(today)) ? 0 : 1;
  let streak = 0;
  for (let i = startOffset; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (planned.has(toISO(d))) streak++;
    else break;
  }
  return streak;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


function DinPlanApp() {
  const chat = useServerFn(chatTurn);
  const [userId, setUserId] = useState<string>("");
  const [day, setDay] = useState<DayDoc | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("plan");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  
  const [syncing, setSyncing] = useState(false);
  const [reminderMin, setReminderMin] = useState(10);
  const [syncError, setSyncError] = useState<string | null>(null);
  const saveTokens = useServerFn(saveGoogleTokens);
  const runSync = useServerFn(syncToCalendar);

  // Voice Mode States
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const autoSendRafRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const isSpeakingRef = useRef<boolean>(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<HTMLDivElement>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevConfirmedRef = useRef<boolean>(false);
  const [history, setHistory] = useState<DayDoc[]>([]);
  const [viewingDay, setViewingDay] = useState<DayDoc | null>(null);

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Past tasks states
  const [pastTasksToAsk, setPastTasksToAsk] = useState<Task[]>([]);
  const [isPastTasksDialogOpen, setIsPastTasksDialogOpen] = useState(false);
  const [checkedPastTasks, setCheckedPastTasks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!day || !day.tasks || day.tasks.length === 0) return;
    
    if (day.day_date !== todayDate()) return;
    
    // Check if we already prompted today for this session/user
    const storageKey = `dinplan_past_prompt_${todayDate()}_${userId}`;
    if (localStorage.getItem(storageKey) === "true") return;

    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTimeVal = currentHours * 60 + currentMinutes;

    const incompletePastTasks = day.tasks.filter(t => {
      if (t.done) return false;
      const [hStr, mStr] = (t.endTime || "").split(":");
      const h = Number(hStr);
      const m = Number(mStr);
      if (isNaN(h) || isNaN(m)) return false;
      const endHours = h < 4 ? h + 24 : h; // handle past midnight
      const endVal = endHours * 60 + m;
      return endVal < currentTimeVal;
    });

    if (incompletePastTasks.length > 0) {
      setPastTasksToAsk(incompletePastTasks);
      
      const initialChecked: Record<string, boolean> = {};
      incompletePastTasks.forEach(t => {
         initialChecked[t.id] = false;
      });
      setCheckedPastTasks(initialChecked);
      setIsPastTasksDialogOpen(true);
      localStorage.setItem(storageKey, "true");
    }
  }, [day, userId]);

  async function handlePastTasksDone() {
    if (!day) return;
    const newTasks = day.tasks.map(t => {
      if (checkedPastTasks[t.id]) {
        return { ...t, done: true };
      }
      return t;
    });
    setDay({ ...day, tasks: newTasks });
    await persist({ tasks: newTasks });
    setIsPastTasksDialogOpen(false);
  }

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");

  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newStartTime, setNewStartTime] = useState("");
  const [newEndTime, setNewEndTime] = useState("");

  async function handleDeleteTask(taskId: string) {
    if (!day) return;
    const newTasks = day.tasks.filter(t => t.id !== taskId);
    setDay({ ...day, tasks: newTasks });
    await persist({ tasks: newTasks });
  }

  async function handleSaveTaskEdit(taskId: string) {
    if (!day) return;
    const newTasks = day.tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, startTime: editStartTime, endTime: editEndTime };
      }
      return t;
    });
    const sorted = sortTasks(newTasks);
    setDay({ ...day, tasks: sorted });
    await persist({ tasks: sorted });
    setEditingTaskId(null);
  }

  async function handleAddTask() {
    if (!day || !newTaskName || !newStartTime || !newEndTime) return;
    const newTask: Task = {
      id: uid(),
      task: newTaskName,
      startTime: newStartTime,
      endTime: newEndTime,
      done: false,
    };
    const newTasks = sortTasks([...day.tasks, newTask]);
    setDay({ ...day, tasks: newTasks });
    await persist({ tasks: newTasks });
    setIsAddingTask(false);
    setNewTaskName("");
    setNewStartTime("");
    setNewEndTime("");
  }

  async function loadHistory(id: string) {
    const { data } = await supabase
      .from("days")
      .select("*")
      .eq("user_id", id)
      .order("day_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    if (data) {
      const allDays = data as unknown as DayDoc[];
      const uniqueDays = [];
      const seen = new Set();
      for (const d of allDays) {
        if (!seen.has(d.day_date)) {
          seen.add(d.day_date);
          uniqueDays.push(d);
        }
      }
      setHistory(uniqueDays);
    }
  }

  async function toggleTask(taskId: string) {
    if (!day) return;
    if (userId.startsWith("anon_")) {
      setShowLoginModal(true);
      return;
    }
    const newTasks = day.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
    setDay({ ...day, tasks: newTasks });
    await persist({ tasks: newTasks });
  }

  async function toggleGoal(goalId: string) {
    if (!day) return;
    if (userId.startsWith("anon_")) {
      setShowLoginModal(true);
      return;
    }
    const newGoals = day.goals.map((g) => (g.id === goalId ? { ...g, done: !g.done } : g));
    setDay({ ...day, goals: newGoals });
    await persist({ goals: newGoals });
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = !!(navigator.mediaDevices && typeof MediaRecorder !== "undefined");
    setSpeechSupported(ok);
    if (typeof Audio !== "undefined") ttsAudioRef.current = new Audio();
  }, []);

  // Init & Auth Migration
  useEffect(() => {
    async function loadData(id: string) {
      const date = todayDate();
      const { data, error: fetchErr } = await supabase
        .from("days")
        .select("*")
        .eq("user_id", id)
        .eq("day_date", date)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchErr && fetchErr.code !== "PGRST116") {
        console.error("Error fetching day:", fetchErr);
      }

      if (data) {
        const d = data as unknown as DayDoc;
        setDay(d);
        prevConfirmedRef.current = d.confirmed;
      } else {
        const { data: created, error: cErr } = await supabase
          .from("days")
          .insert({
            user_id: id,
            day_date: date,
            tasks: [],
            goals: [],
            messages: [GREETING],
            confirmed: false,
          })
          .select("*")
          .single();
        if (cErr) setError(cErr.message);
        else setDay(created as unknown as DayDoc);
      }
      void loadHistory(id);
    }

    async function migrateIfNeeded(authId: string) {
      const anonId = window.localStorage.getItem("dinplan.userId");
      if (anonId && anonId.startsWith("anon_")) {
        const { data: anonDays } = await supabase.from("days").select("*").eq("user_id", anonId);
        const hasData = anonDays?.some(d => (d.tasks as any[])?.length > 0 || (d.goals as any[])?.length > 0);
        
        if (hasData) {
          console.log(`[MIGRATION] Migrating data from ${anonId} to ${authId}`);
          await supabase.from("days").update({ user_id: authId }).eq("user_id", anonId);
        } else {
          console.log(`[MIGRATION] Skipping ${anonId}, no tasks found.`);
          await supabase.from("days").delete().eq("user_id", anonId); // Cleanup empty rows
        }
        window.localStorage.removeItem("dinplan.userId");
      }
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      let activeId = getAnonymousUserId();
      if (session?.user) {
        activeId = session.user.id;
        await migrateIfNeeded(activeId);
      }
      setUserId(activeId);
      await loadData(activeId);
    });

    let authChangeHandled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "INITIAL_SESSION") return; // Handled by getSession above
      
      if (event === "SIGNED_IN" && session?.user) {
        if (session.provider_token && session.provider_refresh_token) {
          saveTokens({
            data: {
              userId: session.user.id,
              providerToken: session.provider_token,
              providerRefreshToken: session.provider_refresh_token,
            }
          }).catch(console.error);
        }

        if (authChangeHandled) return;
        authChangeHandled = true;
        
        const authId = session.user.id;
        await migrateIfNeeded(authId);
        
        setUserId(authId);
        await loadData(authId);
        setTimeout(() => { authChangeHandled = false; }, 2000);
      } else if (event === "SIGNED_OUT") {
        const anonId = getAnonymousUserId();
        setUserId(anonId);
        await loadData(anonId);
      }
    });

    return () => subscription.unsubscribe();
  }, []);


  useEffect(() => {
    if (tab === "chat") chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [day?.messages.length, sending, tab]);

  useEffect(() => {
    if (!sending && tab === "chat") inputRef.current?.focus();
  }, [sending, day?.id, tab]);

  async function persist(patch: Partial<DayDoc>) {
    let nextDoc: DayDoc | null = null;
    
    setDay((prev) => {
      if (!prev) return prev;
      nextDoc = { ...prev, ...patch };
      return nextDoc;
    });

    // Wait for nextDoc to be populated synchronously
    if (!nextDoc) {
      if (day) {
        nextDoc = { ...day, ...patch };
      } else {
        return;
      }
    }

    console.log(`[DB SAVE] userId: ${nextDoc.user_id}, date: ${nextDoc.day_date}, tasks: ${nextDoc.tasks.length}, confirmed: ${nextDoc.confirmed}`);

    const { error } = await supabase
      .from("days")
      .update({
        tasks: nextDoc.tasks,
        goals: nextDoc.goals,
        messages: nextDoc.messages,
        confirmed: nextDoc.confirmed,
        synced_event_ids: nextDoc.synced_event_ids,
      })
      .eq("id", nextDoc.id);
      
    if (error) console.error("DB Save Error:", error);

    setHistory((prev) => {
      if (!nextDoc) return prev;
      const others = prev.filter((h) => h.id !== nextDoc!.id);
      return [nextDoc, ...others].sort((a, b) => b.day_date.localeCompare(a.day_date));
    });
  }


  async function handleSend(overrideInput?: string) {
    const textToSend = overrideInput !== undefined ? overrideInput : input;
    if (!textToSend.trim() || !day || sending) return;
    setError(null);
    const userMsg: ChatMessage = { role: "user", content: textToSend.trim() };
    const newMessages = [...day.messages, userMsg];
    if (overrideInput === undefined) setInput("");
    setSending(true);
    setDay({ ...day, messages: newMessages });
    
    // Save user message immediately so it isn't lost if AI errors out
    await persist({ messages: newMessages });

    try {
      const res = await chat({
        data: {
          messages: newMessages,
          currentTasks: day.tasks.map((t) => ({
            task: t.task,
            startTime: t.startTime,
            endTime: t.endTime,
          })),
          currentGoals: day.goals.map((g) => g.text),
        },
      });

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: res.reply || "…",
      };
      console.log("[STATE] Before actions:", day.tasks.map(t => t.task));
      console.log("[STATE] Actions to apply:", res.actions);
      const { tasks: updatedTasks, goals: updatedGoals } = applyActions(day.tasks, day.goals, res.actions || []);
      console.log("[STATE] After actions:", updatedTasks.map(t => t.task));
      
      await persist({
        messages: [...newMessages, assistantMsg],
        tasks: updatedTasks,
        goals: updatedGoals,
      });

      // Voice reply via Sarvam only if in Voice Mode
      if (voiceModeRef.current) {
        void speakWithSarvam(res.ttsReply || assistantMsg.content, ttsAudioRef.current, () => {
          if (voiceModeRef.current) {
            startListening();
          }
        });
      }

      // Auto-switch to Plan tab on first task generation
      if (day.tasks.length === 0 && updatedTasks.length > 0) {
        if (voiceModeRef.current) {
          setVoiceMode(false);
          voiceModeRef.current = false;
        }
        setTab("plan");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kuch gadbad hui");
      setDay({ ...day, messages: newMessages });
    } finally {
      setSending(false);
    }
  }

  async function startListening() {
    if (listening || transcribing || sending) return;
    if (!navigator.mediaDevices || typeof MediaRecorder === "undefined") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      if (voiceModeRef.current) {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContext();
        if (ctx.state === "suspended") void ctx.resume();
        audioContextRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.minDecibels = -60; 
        analyser.smoothingTimeConstant = 0.2;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyserRef.current = analyser;
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        isSpeakingRef.current = false;
        silenceStartRef.current = null;
        let listeningStartTime = performance.now();
        
        const checkSilence = () => {
          if (!voiceModeRef.current || !analyserRef.current || mediaRecorderRef.current?.state !== "recording") return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let maxVol = 0;
          for (let i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > maxVol) maxVol = dataArray[i];
          }

          const elapsed = performance.now() - listeningStartTime;
          
          if (recordingTimerRef.current) {
            const left = Math.max(0, 28 - elapsed / 1000);
            recordingTimerRef.current.innerText = `${Math.ceil(left)}s`;
          }

          if (elapsed >= 28000) {
            stopListening();
            return;
          }

          if (maxVol > 15) { 
            isSpeakingRef.current = true;
            silenceStartRef.current = null;
          } else if (isSpeakingRef.current) { 
            if (!silenceStartRef.current) {
              silenceStartRef.current = performance.now();
            } else if (performance.now() - silenceStartRef.current > 1500) {
              stopListening();
              return;
            }
          } else {
            // If they haven't spoken for 7 seconds initially, just restart the loop
            if (elapsed > 7000) {
              stopListening();
              return;
            }
          }
          autoSendRafRef.current = requestAnimationFrame(checkSilence);
        };
        autoSendRafRef.current = requestAnimationFrame(checkSilence);
      }

      rec.onstop = async () => {
        if (autoSendRafRef.current) cancelAnimationFrame(autoSendRafRef.current);
        if (audioContextRef.current && audioContextRef.current.state !== "closed") {
          void audioContextRef.current.close().catch(() => {});
        }
        analyserRef.current = null;

        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type });
        if (blob.size < 800) {
          setTranscribing(false);
          if (voiceModeRef.current) setTimeout(() => startListening(), 500);
          return;
        }
        setTranscribing(true);
        try {
          const text = await transcribeWithSarvam(blob);
          if (text) {
             if (voiceModeRef.current) {
                void handleSend(text);
             } else {
                setInput((prev) => (prev ? `${prev} ${text}` : text));
             }
          } else if (voiceModeRef.current) {
             setTimeout(() => startListening(), 500);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Sun nahi paaya");
          if (voiceModeRef.current) setTimeout(() => startListening(), 1000);
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = rec;
      setListening(true);
      rec.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mic access nahi mila");
      setListening(false);
    }
  }

  function stopListening() {
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      /* ignore */
    }
    if (autoSendRafRef.current) cancelAnimationFrame(autoSendRafRef.current);
    mediaRecorderRef.current = null;
    setListening(false);
  }

  async function newDay() {
    if (!userId || !day) return;
    
    const resetState = {
      tasks: [],
      goals: [],
      messages: [GREETING],
      confirmed: false,
    };

    const next = { ...day, ...resetState };
    setDay(next);
    prevConfirmedRef.current = false;
    setTab("chat");

    await supabase
      .from("days")
      .update(resetState)
      .eq("id", day.id);
  }

  function toggleVoiceMode() {
    const next = !voiceMode;
    setVoiceMode(next);
    voiceModeRef.current = next;
    if (next) {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
      }
      void startListening();
    } else {
      stopListening();
    }
  }

  const doneCount = day?.tasks.filter((t) => t.done).length || 0;
  const totalCount = day?.tasks.length || 0;
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  // If anonymous, streak is always 0.
  const streak = userId.startsWith("anon_") ? 0 : computeStreak(history);

  useEffect(() => {
    if (userId && !userId.startsWith("anon_") && typeof streak === "number") {
      const timeout = setTimeout(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user) {
            (supabase as any).from("profiles").upsert({
              id: user.id,
              full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "DinPlanner",
              avatar_url: user.user_metadata?.avatar_url || "",
              streak: streak,
              last_active: new Date().toISOString()
            }).then(({ error }: { error: any }) => {
              if (error) console.error("Failed to sync profile:", error);
            });
          }
        });
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }, [userId, streak]);

  function toggleTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  }

  return (
    <div className="antialiased text-on-surface font-body-md min-h-screen flex flex-col relative pb-32 bg-background">
      {/* Top App Bar */}
      <header className="bg-surface dark:bg-surface-dim w-full top-0 sticky shadow-sm flex items-center justify-between px-container-margin py-3 min-h-[64px] z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary shrink-0">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>auto_awesome</span>
          </div>
          <div className="flex flex-col">
            <h1 className="font-display text-2xl text-on-surface tracking-tight leading-tight">DinPlan</h1>
            <p className="text-[11px] text-on-surface-variant leading-tight mt-0.5">Aapka Hinglish day<br />planner</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={toggleTheme}
            className="hover:bg-surface-container-high transition-transform active:scale-95 p-1 rounded-full flex items-center justify-center text-primary"
            title="Toggle Theme"
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>contrast</span>
          </button>
          <ProfileAvatar onLoginClick={() => setShowLoginModal(true)} />
        </div>
      </header>

      {/* Main Content Canvas */}
      <main className="flex-grow px-container-margin pt-6 max-w-2xl mx-auto w-full">
        {/* VOICE MODE OVERLAY */}
        {voiceMode && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-surface/95 px-6 py-12 backdrop-blur-xl">
            <div className="w-full text-center mt-8">
              <p className="text-sm text-tertiary">Voice Mode</p>
              <h2 className="mt-4 font-display text-headline-lg text-primary">
                {sending
                  ? "Samajh raha hu..."
                  : transcribing
                  ? "Likha ja raha hai..."
                  : listening
                  ? "Bolo, sun raha hu..."
                  : "Mera jawab suno..."}
              </h2>
            </div>

            <div className="relative flex flex-col items-center justify-center h-48 w-48 mt-10">
              {(listening || sending || transcribing) && (
                <>
                  <div className="absolute inset-0 animate-ping rounded-full bg-primary/20" style={{ animationDuration: '3s' }} />
                  <div className="absolute inset-4 animate-pulse rounded-full bg-primary/30" />
                </>
              )}
              <div className="z-10 grid h-32 w-32 place-items-center rounded-full bg-primary text-on-primary soft-shadow">
                <span className="material-symbols-outlined text-[48px]">mic</span>
              </div>
              
              {listening && !sending && !transcribing && (
                <div className="absolute -bottom-8 flex flex-col items-center">
                  <div ref={recordingTimerRef} className="text-3xl font-body-lg text-primary">
                    28s
                  </div>
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant mt-1">Maximum</span>
                </div>
              )}
            </div>

            <div className="w-full mb-10">
              <p className="mb-10 text-center font-body-lg text-on-surface whitespace-pre-wrap max-h-40 overflow-y-auto">
                {day?.messages[day.messages.length - 1]?.role === "assistant" 
                    ? day.messages[day.messages.length - 1].content 
                    : ""}
              </p>
              <button
                onClick={toggleVoiceMode}
                className="mx-auto block rounded-full bg-surface-variant px-8 py-3 font-label-md text-label-md text-on-surface shadow-sm hover:bg-surface-container"
              >
                Exit Voice Mode
              </button>
            </div>
          </div>
        )}

        {/* CHAT TAB */}
        {tab === "chat" && (
          <div className="flex flex-col h-full relative">
            <div className="flex-1 space-y-4 pb-40">
              {streak > 0 && (
                <div className="flex items-center gap-2 rounded-2xl border border-tertiary/30 bg-tertiary-container/30 px-4 py-3 text-sm text-on-tertiary-container">
                  <span className="material-symbols-outlined text-tertiary">local_fire_department</span>
                  <span>
                    <span className="">{streak} din</span> se on track ho, dost!
                  </span>
                </div>
              )}

              {!day && (
                <div className="grid place-items-center py-16 text-primary">
                  <span className="material-symbols-outlined animate-spin text-[32px]">progress_activity</span>
                </div>
              )}
              {day?.messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 font-body-md text-body-md whitespace-pre-wrap ${
                      m.role === "user" ? "bg-primary text-on-primary rounded-br-sm" : "bg-surface-container-high text-on-surface border border-outline-variant rounded-bl-sm"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-surface-container-high border border-outline-variant flex items-center gap-2 rounded-2xl rounded-bl-sm px-4 py-4 text-on-surface-variant">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              {error && (
                <div className="rounded-xl border border-error/30 bg-error-container/30 px-4 py-3 font-label-md text-error">
                  {error}
                </div>
              )}
              <div ref={chatEndRef} className="h-10" />
            </div>

            {/* Composer fixed at bottom above nav */}
            <div className="fixed bottom-32 left-0 right-0 px-4 max-w-2xl mx-auto z-30">
               {(listening || transcribing) && (
                <div className="mb-2 flex items-center gap-2 w-max mx-auto rounded-full bg-surface-container-high px-4 py-2 font-label-sm text-label-sm text-primary border border-outline-variant">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  {listening ? "Sun raha hu…" : "Samajh raha hu…"}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
                className="flex items-center gap-2 bg-surface-container-high p-2 rounded-3xl border border-outline-variant"
              >
                {speechSupported && (
                  <button
                    type="button"
                    onClick={listening ? stopListening : startListening}
                    disabled={sending || !day}
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-full transition disabled:opacity-40 ${
                      listening
                        ? "bg-primary text-on-primary"
                        : "text-on-surface-variant hover:bg-surface-variant hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: listening ? "'FILL' 1" : "'FILL' 0" }}>
                      {listening ? "mic_off" : "mic"}
                    </span>
                  </button>
                )}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  rows={1}
                  placeholder="Apna din batao..."
                  className="max-h-32 min-h-[48px] flex-1 resize-none bg-transparent px-2 py-3 font-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
                  disabled={sending || !day}
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim() || !day}
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition disabled:opacity-40 active:scale-95"
                >
                  {sending ? (
                    <span className="material-symbols-outlined animate-spin">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* PLAN TAB */}
        {tab === "plan" && (
          <div className="pb-24">
            {!day && (
              <div className="grid place-items-center py-16 text-primary">
                <span className="material-symbols-outlined animate-spin text-[32px]">progress_activity</span>
              </div>
            )}
            
            {day && day.tasks.length === 0 && day.goals.length === 0 && (
              <div className="mt-10 rounded-2xl border border-dashed border-outline-variant bg-surface-variant p-8 text-center">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
                  <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>calendar_today</span>
                </div>
                <h2 className="font-headline-md text-headline-md text-on-surface">Abhi plan khaali hai</h2>
                <p className="mt-2 font-body-md text-on-surface-variant">
                  Chat tab mein jaake apna din batao — schedule yaha ban jayega.
                </p>
                <button
                  onClick={() => setTab("chat")}
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-label-md text-label-md text-on-primary active:scale-95 transition-transform"
                >
                  <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>chat_bubble</span> Chat khol
                </button>
              </div>
            )}

            {day && (day.tasks.length > 0 || day.goals.length > 0) && (
              <>
                <div className="mb-section-gap">
                  <div className="flex justify-between items-end mb-3">
                    <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-primary">Aaj ka Plan</h2>
                    <span className="font-label-sm text-label-sm text-secondary">{doneCount}/{totalCount} done</span>
                  </div>
                  <div className="w-full bg-surface-container-high rounded-full h-2.5">
                    <div className="bg-primary h-2.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }}></div>
                  </div>
                </div>

                {day.tasks.length > 0 && (
                  <div className="flex flex-col gap-stack-gap mb-section-gap relative">
                    {/* Connecting Line (Visual only) */}
                    <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-outline-variant/30 -z-10"></div>
                    
                    {day.tasks.map((t) => (
                      <div key={t.id} className={`rounded-xl p-card-padding flex items-start gap-4 transition-all duration-500 ease-in-out ${t.done ? 'bg-emerald-900/80 dark:bg-purple-900/40 border-transparent [transform:rotateX(360deg)] opacity-70' : 'bg-surface-variant border border-outline-variant/30 [transform:rotateX(0deg)] opacity-100'}`}>
                        <div className="flex-shrink-0 mt-1 cursor-pointer" onClick={() => toggleTask(t.id)}>
                          <span className={`material-symbols-outlined ${t.done ? 'text-emerald-200 dark:text-purple-300' : 'text-outline'}`} style={{ fontVariationSettings: t.done ? "'FILL' 1" : "'FILL' 0" }}>
                            {t.done ? 'check_circle' : 'radio_button_unchecked'}
                          </span>
                        </div>
                        
                        {editingTaskId === t.id ? (
                          <div className="flex-grow flex flex-col gap-2">
                             <input 
                                type="text" 
                                value={newTaskName}
                                onChange={e => setNewTaskName(e.target.value)}
                                className="bg-background border border-outline-variant text-on-surface font-label-md text-label-md rounded-lg px-2 py-1 w-full focus:outline-none focus:border-primary"
                                placeholder={t.task}
                              />
                             <div className="flex items-center gap-2">
                              <input 
                                type="time" 
                                value={editStartTime}
                                onChange={e => setEditStartTime(e.target.value)}
                                className="bg-background border border-outline-variant text-on-surface font-label-sm text-label-sm rounded-lg px-2 py-1 flex-1 focus:outline-none focus:border-primary"
                              />
                              <span className="text-on-surface-variant font-label-sm text-label-sm">to</span>
                              <input 
                                type="time" 
                                value={editEndTime}
                                onChange={e => setEditEndTime(e.target.value)}
                                className="bg-background border border-outline-variant text-on-surface font-label-sm text-label-sm rounded-lg px-2 py-1 flex-1 focus:outline-none focus:border-primary"
                              />
                            </div>
                            <div className="flex gap-2 justify-end mt-2">
                              <button onClick={() => setEditingTaskId(null)} className="font-label-sm text-label-sm text-on-surface-variant px-3 py-1.5 rounded-lg border border-outline-variant">Cancel</button>
                              <button onClick={() => { handleSaveTaskEdit(t.id); setNewTaskName(""); }} className="font-label-sm text-label-sm bg-primary text-on-primary px-3 py-1.5 rounded-lg">Save</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-grow cursor-pointer" onClick={() => toggleTask(t.id)}>
                            <h3 className={`font-label-md text-label-md ${t.done ? 'text-emerald-100 dark:text-purple-200 line-through decoration-emerald-300/50 dark:decoration-purple-300/50' : 'text-on-surface'}`}>
                              {t.task}
                            </h3>
                            <div className={`flex items-center gap-1 mt-1 ${t.done ? 'text-emerald-200/70 dark:text-purple-300/70' : 'text-secondary'}`} onClick={(e) => { e.stopPropagation(); setEditingTaskId(t.id); setEditStartTime(t.startTime); setEditEndTime(t.endTime); setNewTaskName(t.task); }}>
                              <span className="material-symbols-outlined text-[14px]">schedule</span>
                              <span className="font-label-sm text-label-sm">{t.startTime}–{t.endTime}</span>
                              <span className="material-symbols-outlined text-[12px] ml-1 opacity-50 hover:opacity-100">edit</span>
                            </div>
                          </div>
                        )}
                        <button onClick={() => handleDeleteTask(t.id)} className="text-outline hover:text-error transition-colors p-2 -mr-2">
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      </div>
                    ))}
                    
                    {isAddingTask ? (
                      <div className="bg-surface-variant rounded-xl p-card-padding border border-outline-variant/30 flex flex-col gap-3">
                         <p className="font-label-md text-label-md text-on-surface">Add new task</p>
                          <input 
                            type="text" 
                            placeholder="Task name"
                            value={newTaskName}
                            onChange={e => setNewTaskName(e.target.value)}
                            className="bg-background border border-outline-variant text-on-surface font-body-md text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:border-primary"
                          />
                          <div className="flex items-center gap-2">
                            <input 
                              type="time" 
                              value={newStartTime}
                              onChange={e => setNewStartTime(e.target.value)}
                              className="bg-background border border-outline-variant text-on-surface font-label-sm text-sm rounded-lg px-2 py-1.5 flex-1 focus:outline-none focus:border-primary"
                            />
                            <span className="text-on-surface-variant text-sm">to</span>
                            <input 
                              type="time" 
                              value={newEndTime}
                              onChange={e => setNewEndTime(e.target.value)}
                              className="bg-background border border-outline-variant text-on-surface font-label-sm text-sm rounded-lg px-2 py-1.5 flex-1 focus:outline-none focus:border-primary"
                            />
                          </div>
                          <div className="flex justify-end gap-2 mt-1">
                            <button onClick={() => setIsAddingTask(false)} className="font-label-sm text-label-sm text-on-surface-variant px-4 py-2 rounded-lg border border-outline-variant hover:bg-surface-container">
                              Cancel
                            </button>
                            <button onClick={handleAddTask} disabled={!newTaskName || !newStartTime || !newEndTime} className="font-label-sm text-label-sm bg-primary text-on-primary px-4 py-2 rounded-lg disabled:opacity-50">
                              Add Task
                            </button>
                          </div>
                      </div>
                    ) : (
                      <button onClick={() => setIsAddingTask(true)} className="flex items-center justify-center gap-2 py-3 px-4 border border-dashed border-primary/50 rounded-xl text-primary hover:bg-primary-container/10 transition-colors">
                        <span className="material-symbols-outlined text-[20px]">add</span>
                        <span className="font-label-md text-label-md">Add task</span>
                      </button>
                    )}
                  </div>
                )}

                {day.goals.length > 0 && (
                  <div className="mb-section-gap">
                    <h3 className="font-label-md text-label-md text-secondary mb-3 uppercase tracking-wider">Aaj ke Goals</h3>
                    <div className="flex flex-wrap gap-inline-gap">
                      {day.goals.map((g) => (
                        <div 
                          key={g.id} 
                          onClick={() => toggleGoal(g.id)}
                          className={`px-4 py-2 rounded-xl font-label-sm text-label-sm flex items-center gap-2 cursor-pointer transition-colors border ${
                            g.done ? "bg-primary text-on-primary border-primary" : "bg-surface-container-high text-primary border-primary/20 hover:bg-surface-container-highest"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {g.done ? "check_circle" : "flag"}
                          </span>
                          <span className={g.done ? "line-through opacity-80" : ""}>{g.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-8 mb-12 flex flex-col items-center">
                  <div className="w-full flex items-center justify-between mb-4">
                    <span className="font-label-md text-label-md text-on-surface">Remind me before:</span>
                    <select 
                      value={reminderMin} 
                      onChange={e => setReminderMin(Number(e.target.value))}
                      className="bg-surface-container border border-outline-variant font-label-sm text-on-surface rounded-lg px-3 py-2 focus:outline-none focus:border-primary"
                    >
                      <option value={5}>5 mins</option>
                      <option value={10}>10 mins</option>
                      <option value={15}>15 mins</option>
                      <option value={30}>30 mins</option>
                    </select>
                  </div>
                  
                  {syncError && (
                    <div className="mb-4 text-sm text-error bg-error-container/30 rounded-lg p-3 w-full text-center">
                      {syncError}
                    </div>
                  )}

                  {syncError?.includes("disconnected") ? (
                    <button
                      onClick={async () => {
                        await supabase.auth.signInWithOAuth({
                          provider: "google",
                          options: { queryParams: { access_type: "offline", prompt: "consent" }, scopes: "https://www.googleapis.com/auth/calendar.events" }
                        });
                      }}
                      className="w-full bg-primary text-on-primary font-label-md text-label-md py-4 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform soft-shadow"
                    >
                      <span className="material-symbols-outlined">event</span> Connect Google Calendar
                    </button>
                  ) : (
                    <button
                      disabled={day.tasks.length === 0 || syncing}
                      onClick={async () => {
                        if (!day || !userId) return;
                        if (userId.startsWith("anon_")) { setShowLoginModal(true); return; }
                        setSyncing(true); setSyncError(null);
                        try {
                          const res = await runSync({ data: { userId, dayDate: day.day_date, tasks: day.tasks, goals: day.goals, reminderMinutes: reminderMin } });
                          if (res.success) {
                            const updated = { ...day, tasks: res.tasks, goals: res.goals, synced_event_ids: res.syncedEventIds };
                            setDay(updated);
                            await persist({ tasks: res.tasks, goals: res.goals, synced_event_ids: res.syncedEventIds });
                          }
                        } catch (e: any) { setSyncError(e.message || "Failed to sync"); } finally { setSyncing(false); }
                      }}
                      className={`w-full font-label-md text-label-md py-4 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform ${
                        day.tasks.length === 0 || syncing ? "bg-surface-container text-on-surface-variant border border-outline-variant" : "bg-primary text-on-primary soft-shadow"
                      }`}
                    >
                      {syncing ? (
                        <span className="material-symbols-outlined animate-spin">progress_activity</span>
                      ) : day.synced_event_ids?.length ? (
                        <span className="material-symbols-outlined">check_circle</span>
                      ) : (
                        <span className="material-symbols-outlined">event</span>
                      )}
                      {syncing ? "Syncing..." : day.synced_event_ids?.length ? "Calendar par synced" : "Google Calendar par bhejo"}
                    </button>
                  )}
                  {!day.synced_event_ids?.length && !syncing && (
                    <span className="text-secondary font-label-sm text-label-sm mt-3 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">sync_problem</span> Not synced
                    </span>
                  )}
                </div>

                <div className="mt-12 pt-6 border-t border-outline-variant flex justify-center pb-8">
                  <button 
                    onClick={newDay}
                    className="text-error hover:bg-error-container/30 px-4 py-2 rounded-full font-label-md text-label-md transition-colors flex items-center gap-2"
                    title="Naya din plan karo"
                  >
                    <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 0" }}>restart_alt</span>
                    Reset Plan (Naya Din)
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === "history" && (
          <div className="pb-24">
            {viewingDay ? (
              <ReadOnlyDayView day={viewingDay} onBack={() => setViewingDay(null)} />
            ) : (
              <>
                <div className="bg-surface-container-high rounded-xl p-4 mb-6 flex items-start gap-4 border border-outline-variant">
                  <span className="material-symbols-outlined text-primary text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
                  <div className="flex-1">
                    {userId.startsWith("anon_") ? (
                      <>
                        <h3 className="font-label-md text-label-md text-on-surface">
                          Login to track your streak!
                        </h3>
                        <p className="font-body-md text-sm text-on-surface-variant mt-1 mb-2">
                          Track your daily progress and maintain a streak by logging in.
                        </p>
                        <button 
                          onClick={() => setShowLoginModal(true)}
                          className="bg-primary text-on-primary font-label-sm text-xs px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                        >
                          Sign In
                        </button>
                      </>
                    ) : (
                      <>
                        <h3 className="font-label-md text-label-md text-on-surface">
                          {streak > 0 ? `${streak} din se on track ho!` : "Aaj se streak shuru karo"}
                        </h3>
                        <p className="font-body-md text-sm text-on-surface-variant mt-1">
                          {streak > 0 ? "Roz plan banate raho — streak tootne mat dena." : "Aaj ka plan banao aur roz aage badhao."}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-primary mb-4">Beete Din</h2>
                
                {history.filter((h) => h.day_date !== todayDate() && h.tasks.length > 0).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-outline-variant bg-surface-variant p-8 text-center mt-4">
                    <p className="font-body-md text-on-surface-variant">
                      Abhi tak koi beeta din nahi hai. Roz plan banao — yaha history dikhegi.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {history.filter((h) => h.day_date !== todayDate() && h.tasks.length > 0).map((h) => {
                      const done = h.tasks.filter((t) => t.done).length;
                      const total = h.tasks.length;
                      const goalsDone = h.goals.filter((g) => g.done).length;
                      const goalsTotal = h.goals.length;
                      const complete = total > 0 && done === total;
                      return (
                        <div 
                          key={h.id} 
                          onClick={() => setViewingDay(h)}
                          className="bg-surface-variant border border-outline-variant/30 rounded-xl p-4 flex items-center justify-between cursor-pointer hover:bg-surface-container-high transition-colors"
                        >
                          <div>
                            <h3 className="font-label-md text-label-md text-on-surface">{formatDayLabel(h.day_date)}</h3>
                            <p className="font-label-sm text-label-sm text-secondary mt-1">
                              {done}/{total} tasks done {goalsTotal > 0 && ` • ${goalsDone}/${goalsTotal} goals`}
                            </p>
                          </div>
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-label-sm ${complete ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>
                            {Math.round((done / total) * 100)}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* Bottom Nav Bar Wrapper for cutout shadow */}
      <div className="fixed bottom-0 w-full z-50 drop-shadow-[0px_-4px_10px_rgba(0,0,0,0.1)] dark:drop-shadow-[0px_-4px_10px_rgba(0,0,0,0.4)] pointer-events-none">
        
        {/* The Voice FAB placed outside the nav mask */}
        <button 
          onClick={toggleVoiceMode}
          className={`absolute left-1/2 -translate-x-1/2 -top-6 bg-primary text-on-primary rounded-full w-14 h-14 flex items-center justify-center active:scale-90 transition-transform z-10 pointer-events-auto shadow-md ${voiceMode ? 'animate-pulse' : ''}`}
        >
          <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>mic</span>
        </button>

        {/* The Masked Nav Bar */}
        <nav 
          className="bg-surface/95 dark:bg-surface-dim/95 backdrop-blur-md w-full rounded-t-[1.5rem] flex justify-between items-end h-24 pb-3 px-2 pointer-events-auto"
          style={{ 
            maskImage: "radial-gradient(circle at 50% 0%, transparent 38px, black 39px)", 
            WebkitMaskImage: "radial-gradient(circle at 50% 0%, transparent 38px, black 39px)"
          }}
        >
          {/* Left Side Tabs */}
          <div className="flex-1 flex justify-evenly">
            <TabButton
              active={tab === "chat" && !showLeaderboard}
              onClick={() => { setTab("chat"); setViewingDay(null); setShowLeaderboard(false); }}
              icon="chat_bubble"
              label="Chat"
            />
            <TabButton
              active={tab === "plan" && !showLeaderboard}
              onClick={() => { setTab("plan"); setViewingDay(null); setShowLeaderboard(false); }}
              icon="calendar_today"
              label="Aaj ka Plan"
            />
          </div>
          
          {/* Spacer for FAB Cutout */}
          <div className="w-16 flex-shrink-0"></div>

          {/* Right Side Tabs */}
          <div className="flex-1 flex justify-evenly">
            <TabButton
              active={showLeaderboard}
              onClick={() => setShowLeaderboard(true)}
              icon="trophy"
              label="Leaderboard"
            />
            <TabButton
              active={tab === "history" && !showLeaderboard}
              onClick={() => { setTab("history"); setViewingDay(null); setShowLeaderboard(false); }}
              icon="history"
              label="Beete Din"
            />
          </div>
        </nav>
      </div>


      <Dialog open={isPastTasksDialogOpen} onOpenChange={setIsPastTasksDialogOpen}>
        <DialogContent className="sm:max-w-md w-[95%] max-w-[400px] mx-auto rounded-3xl p-6 bg-surface border border-outline-variant shadow-soft data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          <DialogHeader>
            <DialogTitle className="font-headline-md text-on-surface">Missed any tasks?</DialogTitle>
            <DialogDescription className="font-body-md text-on-surface-variant">
              It looks like the time for these tasks has passed. Did you complete them?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4 max-h-[50vh] overflow-y-auto">
            {pastTasksToAsk.map((task) => (
              <label key={task.id} className="flex items-center gap-3 p-3 rounded-xl border border-outline-variant cursor-pointer hover:bg-surface-container transition-colors">
                <Checkbox 
                  checked={checkedPastTasks[task.id] || false}
                  onCheckedChange={(checked) => setCheckedPastTasks(prev => ({ ...prev, [task.id]: !!checked }))}
                />
                <div className="flex flex-col">
                  <span className="font-body-md text-on-surface">{task.task}</span>
                  <span className="font-label-sm text-tertiary">{task.startTime} - {task.endTime}</span>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button 
              onClick={handlePastTasksDone}
              className="w-full bg-primary text-on-primary font-label-md py-4 rounded-xl flex items-center justify-center cursor-pointer active:scale-[0.98] transition-transform"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modals */}
      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <LeaderboardModal isOpen={showLeaderboard} onClose={() => setShowLeaderboard(false)} currentUserId={userId} />
    </div>
  );
}

function LeaderboardModal({ isOpen, onClose, currentUserId }: { isOpen: boolean, onClose: () => void, currentUserId: string }) {
  const [leaders, setLeaders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      (supabase as any).from("profiles").select("*").gt("streak", 0).order("streak", { ascending: false }).limit(50)
        .then(({ data }: { data: any }) => {
           if (data) setLeaders(data);
           setLoading(false);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col animate-in slide-in-from-bottom-4 duration-300">
      <header className="bg-surface sticky top-0 px-container-margin h-16 flex items-center justify-between border-b border-outline-variant/30">
        <button onClick={onClose} className="p-2 -ml-2 text-on-surface hover:bg-surface-container-high rounded-full transition-colors">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h2 className="font-headline text-lg text-primary flex items-center gap-2">
          <span className="material-symbols-outlined text-tertiary" style={{ fontVariationSettings: "'FILL' 1" }}>trophy</span>
          Leaderboard
        </h2>
        <div className="w-10"></div>
      </header>

      <main className="flex-1 overflow-y-auto p-container-margin pb-24">
        {loading ? (
           <div className="flex justify-center p-8">
             <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
           </div>
        ) : leaders.length === 0 ? (
           <div className="flex flex-col items-center justify-center mt-12 text-center">
             <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 mb-4" style={{ fontVariationSettings: "'FILL' 1" }}>social_leaderboard</span>
             <p className="text-on-surface-variant font-body">No planners yet. Start building your streak!</p>
           </div>
        ) : (
           <div className="flex flex-col gap-3">
             {leaders.map((l, idx) => (
                <div key={l.id} className={`flex items-center gap-4 p-4 rounded-2xl ${l.id === currentUserId ? 'bg-primary/10 border border-primary/30' : 'bg-surface-container-high border border-outline-variant/20'}`}>
                   <div className="font-headline text-on-surface-variant w-6 text-center">
                     {idx + 1}
                   </div>
                   {l.avatar_url ? (
                     <img src={l.avatar_url} alt={l.full_name} className="w-10 h-10 rounded-full object-cover" />
                   ) : (
                     <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-sm">
                       {l.full_name?.charAt(0).toUpperCase() || 'U'}
                     </div>
                   )}
                   <div className="flex-1 min-w-0">
                     <p className="font-label-md text-on-surface">{l.full_name || "Anonymous User"}</p>
                     {l.id === currentUserId && <p className="text-[10px] text-primary uppercase tracking-wider mt-0.5">You</p>}
                   </div>
                   <div className="flex items-center gap-1 bg-surface-variant/50 px-3 py-1 rounded-full border border-outline-variant/30">
                     <span className="material-symbols-outlined text-tertiary text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>local_fire_department</span>
                     <span className="font-label text-on-surface">{l.streak}</span>
                   </div>
                </div>
             ))}
           </div>
        )}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, isCenter }: { active: boolean; onClick: () => void; icon: string; label: string; isCenter?: boolean }) {
  return (
    <div 
      onClick={onClick}
      className={`flex flex-col items-center justify-center transition-all duration-200 active:scale-90 hover:bg-surface-container-high p-2 rounded-lg cursor-pointer ${isCenter ? 'mt-2 w-full' : 'w-16'} ${active ? 'text-primary ' : 'text-secondary'}`}
    >
      <span className="material-symbols-outlined mb-1" style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>{icon}</span>
      <span className="font-label-sm text-label-sm text-[10px] text-center leading-tight">{label}</span>
    </div>
  );
}

function ReadOnlyDayView({ day, onBack }: { day: DayDoc; onBack: () => void }) {
  const done = day.tasks.filter((t) => t.done).length;
  const total = day.tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 font-label-sm text-label-sm text-on-surface hover:bg-surface-container-high"
      >
        <span className="material-symbols-outlined text-[16px]">chevron_left</span> Wapas
      </button>
      <div className="mb-section-gap">
        <div className="flex justify-between items-end mb-3">
          <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-primary">{formatDayLabel(day.day_date)}</h2>
          <span className="font-label-sm text-label-sm text-secondary">{done}/{total} done</span>
        </div>
        <div className="w-full bg-surface-container-high rounded-full h-2.5">
          <div className="bg-primary h-2.5 rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>
      
      {day.tasks.length > 0 && (
        <div className="flex flex-col gap-stack-gap mb-section-gap relative">
          <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-outline-variant/30 -z-10"></div>
          {day.tasks.map((t) => (
            <div key={t.id} className={`rounded-xl p-card-padding flex items-start gap-4 transition-all duration-500 ease-in-out ${t.done ? 'bg-emerald-900/80 dark:bg-purple-900/40 border-transparent [transform:rotateX(360deg)] opacity-70' : 'bg-surface-variant border border-outline-variant/30 [transform:rotateX(0deg)] opacity-100'}`}>
              <div className="flex-shrink-0 mt-1">
                <span className={`material-symbols-outlined ${t.done ? 'text-emerald-200 dark:text-purple-300' : 'text-outline'}`} style={{ fontVariationSettings: t.done ? "'FILL' 1" : "'FILL' 0" }}>
                  {t.done ? 'check_circle' : 'radio_button_unchecked'}
                </span>
              </div>
              <div className="flex-grow">
                <h3 className={`font-label-md text-label-md ${t.done ? 'text-emerald-100 dark:text-purple-200 line-through decoration-emerald-300/50 dark:decoration-purple-300/50' : 'text-on-surface'}`}>
                  {t.task}
                </h3>
                <div className={`flex items-center gap-1 mt-1 ${t.done ? 'text-emerald-200/70 dark:text-purple-300/70' : 'text-secondary'}`}>
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  <span className="font-label-sm text-label-sm">{t.startTime} - {t.endTime}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {day.goals.length > 0 && (
        <div className="mb-section-gap">
          <h3 className="font-label-md text-label-md text-secondary mb-3 uppercase tracking-wider">Goals</h3>
          <div className="flex flex-wrap gap-inline-gap">
            {day.goals.map((g) => (
              <div 
                key={g.id} 
                className={`px-4 py-2 rounded-xl font-label-sm text-label-sm flex items-center gap-2 border ${g.done ? "bg-primary text-on-primary border-primary" : "bg-surface-container-high text-primary border-primary/20"}`}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {g.done ? "check_circle" : "flag"}
                </span>
                <span className={g.done ? "line-through opacity-80" : ""}>{g.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

