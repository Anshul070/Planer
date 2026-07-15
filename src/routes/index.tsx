import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { chatTurn } from "@/lib/chat.functions";
import { saveGoogleTokens, syncToCalendar } from "@/lib/calendar.functions";
import { getAnonymousUserId, todayDate } from "@/lib/anon-user";
import type { ChatMessage, DayDoc, Goal, Task } from "@/lib/dinplan-types";
import {
  Check,
  Send,
  Sparkles,
  RotateCcw,
  Loader2,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  MessageCircle,
  CalendarCheck,
  History,
  ChevronLeft,
  Flame,
  CalendarDays,
  CalendarPlus,
  Trash2,
  Edit2,
  Plus,
  X,
} from "lucide-react";
import { ProfileAuth } from "@/components/profile-auth";

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
  const [tab, setTab] = useState<Tab>("chat");
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
      .limit(60);
    if (data) setHistory(data as unknown as DayDoc[]);
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

  async function toggleTask(id: string) {
    if (!day) return;
    await persist({
      tasks: day.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    });
  }
  async function toggleGoal(id: string) {
    if (!day) return;
    await persist({
      goals: day.goals.map((g) => (g.id === id ? { ...g, done: !g.done } : g)),
    });
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

  const doneCount = useMemo(() => day?.tasks.filter((t) => t.done).length ?? 0, [day]);
  const totalCount = day?.tasks.length ?? 0;
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const streak = useMemo(() => computeStreak(history), [history]);


  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-border bg-background/85 px-5 py-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-2xl bg-primary text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-lg leading-none font-display">DinPlan</h1>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Aapka Hinglish day planner
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleVoiceMode}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  voiceMode
                    ? "border-accent bg-accent text-accent-foreground shadow-sm shadow-accent/20"
                    : "border-border bg-surface text-foreground/80 hover:bg-muted"
                }`}
                title="Voice Mode"
              >
                {voiceMode ? <Mic className="h-3.5 w-3.5 animate-pulse" /> : <Mic className="h-3.5 w-3.5" />} Voice Mode
              </button>
              <button
                onClick={newDay}
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground/80 hover:bg-muted"
                title="Naya din plan karo"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Naya din
              </button>
              <ProfileAuth />
            </div>
          </div>
        </header>

        {/* VOICE MODE OVERLAY */}
        {voiceMode && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-background/95 px-6 py-12 backdrop-blur-xl">
            <div className="w-full text-center mt-8">
              <p className="text-sm font-medium text-accent">Voice Mode</p>
              <h2 className="mt-4 text-2xl font-display text-foreground">
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
                  <div className="absolute inset-0 animate-ping rounded-full bg-accent/20" style={{ animationDuration: '3s' }} />
                  <div className="absolute inset-4 animate-pulse rounded-full bg-accent/30" />
                </>
              )}
              <div className="z-10 grid h-32 w-32 place-items-center rounded-full bg-accent text-accent-foreground shadow-lg shadow-accent/30">
                <Mic className="h-12 w-12" />
              </div>
              
              {listening && !sending && !transcribing && (
                <div className="absolute -bottom-8 flex flex-col items-center">
                  <div ref={recordingTimerRef} className="text-3xl font-mono font-bold text-accent">
                    28s
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Maximum</span>
                </div>
              )}
            </div>

            <div className="w-full mb-10">
              <p className="mb-10 text-center text-lg text-foreground/80 font-medium whitespace-pre-wrap max-h-40 overflow-y-auto">
                {day?.messages[day.messages.length - 1]?.role === "assistant" 
                    ? day.messages[day.messages.length - 1].content 
                    : ""}
              </p>
              <button
                onClick={toggleVoiceMode}
                className="mx-auto block rounded-full bg-secondary px-8 py-3 text-sm font-semibold text-secondary-foreground shadow-sm hover:bg-secondary/80"
              >
                Exit Voice Mode
              </button>
            </div>
          </div>
        )}

        {/* CHAT TAB */}
        {tab === "chat" && (
          <>
            <section className="flex-1 space-y-3 px-5 py-5">
              {streak > 0 && (
                <div className="flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent/10 px-3.5 py-2 text-sm text-accent-foreground">
                  <Flame className="h-4 w-4 shrink-0 text-accent" />
                  <span>
                    <span className="font-semibold">{streak} din</span> se on track ho, dost! Aise hi chalate raho.
                  </span>
                </div>
              )}

              {!day && (
                <div className="grid place-items-center py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
              {day?.messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap ${
                      m.role === "user" ? "bubble-user rounded-br-md" : "bubble-ai rounded-bl-md"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="bubble-ai flex items-center gap-2 rounded-2xl rounded-bl-md px-4 py-3 text-sm text-muted-foreground">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              {error && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
              <div ref={chatEndRef} />
            </section>

            {/* Composer */}
            <div className="sticky bottom-14 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
              {(listening || transcribing) && (
                <div className="mb-2 flex items-center gap-2 rounded-full bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                  </span>
                  {listening ? "Sun raha hu…" : "Samajh raha hu…"}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
                className="flex items-end gap-2"
              >
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
                  placeholder="Apna din batao… (ya mic dabao)"
                  className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-card px-4 py-2.5 text-[15px] leading-snug outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                  disabled={sending || !day}
                />
                {speechSupported && (
                  <button
                    type="button"
                    onClick={listening ? stopListening : startListening}
                    disabled={sending || !day}
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border transition disabled:opacity-40 ${
                      listening
                        ? "border-transparent bg-accent text-accent-foreground"
                        : "border-border bg-card text-foreground/80 hover:bg-muted"
                    }`}
                    aria-label={listening ? "Stop listening" : "Start voice input"}
                    title={listening ? "Stop" : "Bolo"}
                  >
                    {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={sending || !input.trim() || !day}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-soft transition disabled:opacity-40"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </form>
            </div>
          </>
        )}

        {/* PLAN TAB */}
        {tab === "plan" && (
          <section className="flex-1 px-5 py-5 pb-20">
            {!day && (
              <div className="grid place-items-center py-16 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
            {day && day.tasks.length === 0 && day.goals.length === 0 && (
              <div className="mt-10 rounded-3xl border border-dashed border-border bg-surface p-8 text-center">
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <CalendarCheck className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-display">Abhi plan khaali hai</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Chat tab mein jaake apna din batao — schedule yaha ban jayega.
                </p>
                <button
                  onClick={() => setTab("chat")}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  <MessageCircle className="h-4 w-4" /> Chat khol
                </button>
              </div>
            )}

            {day && (day.tasks.length > 0 || day.goals.length > 0) && (
              <div className="mb-6 flex items-center justify-center rounded-xl py-2 px-4 text-sm font-medium bg-primary/10 text-primary border border-primary/20">
                Live updating 🟢
              </div>
            )}

            {day && day.tasks.length > 0 && (
              <>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-xl font-display">Aaj ka schedule</h2>
                  <span className="text-xs font-medium text-muted-foreground">
                    {doneCount}/{totalCount} done
                  </span>
                </div>
                <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <ul className="space-y-2">
                  {day.tasks.map((t) => (
                    <li key={t.id} className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 transition ${
                          t.done
                            ? "border-transparent bg-muted/60"
                            : "border-border bg-card hover:border-primary/40"
                        }`}>
                        <button
                          onClick={() => toggleTask(t.id)}
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
                            t.done
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border"
                          }`}
                        >
                          {t.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                        </button>

                        {editingTaskId === t.id ? (
                          <div className="flex-1 min-w-0 flex flex-col gap-2">
                            <p className={`text-sm font-medium leading-tight ${t.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                              {t.task}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <input 
                                type="time" 
                                value={editStartTime}
                                onChange={e => setEditStartTime(e.target.value)}
                                className="bg-background border border-border text-xs rounded px-2 py-1"
                              />
                              <span className="text-muted-foreground text-xs">to</span>
                              <input 
                                type="time" 
                                value={editEndTime}
                                onChange={e => setEditEndTime(e.target.value)}
                                className="bg-background border border-border text-xs rounded px-2 py-1"
                              />
                              <button onClick={() => handleSaveTaskEdit(t.id)} className="bg-primary text-primary-foreground font-medium text-xs rounded px-3 py-1.5 ml-auto">
                                Save
                              </button>
                              <button onClick={() => setEditingTaskId(null)} className="bg-muted text-muted-foreground font-medium text-xs rounded px-3 py-1.5">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="min-w-0 flex-1 flex justify-between items-center">
                            <div className="flex-1 cursor-pointer" onClick={() => toggleTask(t.id)}>
                              <p
                                className={`text-sm font-medium leading-tight ${
                                  t.done ? "line-through text-muted-foreground" : "text-foreground"
                                }`}
                              >
                                {t.task}
                              </p>
                              <p 
                                className="mt-0.5 text-xs text-muted-foreground tabular-nums flex items-center gap-1 w-max cursor-pointer hover:text-primary transition-colors" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingTaskId(t.id);
                                  setEditStartTime(t.startTime);
                                  setEditEndTime(t.endTime);
                                }}
                              >
                                {t.startTime} – {t.endTime}
                                <Edit2 className="h-3 w-3 inline opacity-50" />
                              </p>
                            </div>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTask(t.id);
                              }}
                              className="p-2 -mr-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors shrink-0"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                    </li>
                  ))}
                </ul>

                {isAddingTask ? (
                  <div className="mt-4 p-4 rounded-2xl border border-border bg-card flex flex-col gap-3">
                    <p className="text-sm font-medium text-foreground">Add new task</p>
                    <input 
                      type="text" 
                      placeholder="Task name (e.g. Reading)"
                      value={newTaskName}
                      onChange={e => setNewTaskName(e.target.value)}
                      className="bg-background border border-border text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:border-primary"
                    />
                    <div className="flex items-center gap-2">
                      <input 
                        type="time" 
                        value={newStartTime}
                        onChange={e => setNewStartTime(e.target.value)}
                        className="bg-background border border-border text-sm rounded-lg px-2 py-1.5 flex-1 focus:outline-none focus:border-primary"
                      />
                      <span className="text-muted-foreground text-sm">to</span>
                      <input 
                        type="time" 
                        value={newEndTime}
                        onChange={e => setNewEndTime(e.target.value)}
                        className="bg-background border border-border text-sm rounded-lg px-2 py-1.5 flex-1 focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex justify-end gap-2 mt-1">
                      <button onClick={() => setIsAddingTask(false)} className="bg-muted text-muted-foreground font-medium text-sm rounded-lg px-4 py-2">
                        Cancel
                      </button>
                      <button onClick={handleAddTask} disabled={!newTaskName || !newStartTime || !newEndTime} className="bg-primary text-primary-foreground font-medium text-sm rounded-lg px-4 py-2 disabled:opacity-50">
                        Add Task
                      </button>
                    </div>
                  </div>
                ) : (
                  <button 
                    onClick={() => setIsAddingTask(true)}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-3.5 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors text-sm font-medium"
                  >
                    <Plus className="h-4 w-4" />
                    Add task
                  </button>
                )}
              </>
            )}

            {day && day.goals.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-base font-display text-foreground/90">Aaj ke goals</h3>
                <ul className="space-y-1.5">
                  {day.goals.map((g) => (
                    <li key={g.id}>
                      <button
                        onClick={() => toggleGoal(g.id)}
                        className="flex w-full items-start gap-2.5 rounded-xl bg-card px-3 py-2.5 text-left border border-border"
                      >
                        <span
                          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${
                            g.done
                              ? "border-accent bg-accent text-accent-foreground"
                              : "border-border"
                          }`}
                        >
                          {g.done && <Check className="h-3 w-3" strokeWidth={3} />}
                        </span>
                        <span
                          className={`text-sm ${
                            g.done ? "line-through text-muted-foreground" : "text-foreground"
                          }`}
                        >
                          {g.text}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {day && (day.tasks.length > 0 || day.goals.length > 0) && (
              <div className="mt-8 pt-6 border-t border-border space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Remind me before:</span>
                  <select 
                    value={reminderMin} 
                    onChange={e => setReminderMin(Number(e.target.value))}
                    className="bg-card border border-border text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value={5}>5 mins</option>
                    <option value={10}>10 mins</option>
                    <option value={15}>15 mins</option>
                    <option value={30}>30 mins</option>
                  </select>
                </div>
                
                {syncError && (
                  <div className="text-xs text-red-500 bg-red-500/10 rounded p-2">
                    {syncError}
                  </div>
                )}
                
                {syncError?.includes("disconnected") ? (
                  <button
                    onClick={async () => {
                      await supabase.auth.signInWithOAuth({
                        provider: "google",
                        options: {
                          queryParams: { access_type: "offline", prompt: "consent" },
                          scopes: "https://www.googleapis.com/auth/calendar.events"
                        }
                      });
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    <CalendarDays className="h-4 w-4" /> Connect Google Calendar
                  </button>
                ) : (
                  <button
                    disabled={day.tasks.length === 0 || syncing}
                    onClick={async () => {
                      if (!day || !userId) return;
                      if (userId.startsWith("anon_")) {
                        setSyncError("Please log in first to sync to calendar.");
                        return;
                      }
                      setSyncing(true);
                      setSyncError(null);
                      try {
                        const res = await runSync({
                          data: {
                            userId,
                            dayDate: day.day_date,
                            tasks: day.tasks,
                            goals: day.goals,
                            reminderMinutes: reminderMin,
                          }
                        });
                        if (res.success) {
                          const updated = { ...day, tasks: res.tasks, goals: res.goals, synced_event_ids: res.syncedEventIds };
                          setDay(updated);
                          await persist({ tasks: res.tasks, goals: res.goals, synced_event_ids: res.syncedEventIds });
                        }
                      } catch (e: any) {
                        setSyncError(e.message || "Failed to sync");
                      } finally {
                        setSyncing(false);
                      }
                    }}
                    className={`w-full py-4 rounded-xl font-bold text-white shadow-xl transition-all duration-300 transform ${
                      day.tasks.length === 0 || syncing
                        ? "bg-slate-300 shadow-none"
                        : "bg-primary hover:bg-primary/90"
                    }`}
                  >
                    {syncing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : day.synced_event_ids?.length ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <CalendarPlus className="h-4 w-4" />
                    )}
                    {syncing ? "Syncing..." : day.synced_event_ids?.length ? "Calendar par synced ✅" : "Google Calendar par bhejo"}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* HISTORY TAB */}
        {tab === "history" && (
          <section className="flex-1 px-5 py-5 pb-20">
            {viewingDay ? (
              <ReadOnlyDayView day={viewingDay} onBack={() => setViewingDay(null)} />
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3">
                  <Flame className="h-6 w-6 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="text-base font-display leading-tight">
                      {streak > 0
                        ? `${streak} din se on track ho!`
                        : "Aaj se streak shuru karo"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {streak > 0
                        ? "Roz plan banate raho — streak tootne mat dena."
                        : "Aaj ka plan banao aur roz aage badhao."}
                    </p>
                  </div>
                </div>

                <h2 className="mb-3 text-xl font-display">Beete din</h2>
                {history.filter((h) => h.day_date !== todayDate() && h.tasks.length > 0).length === 0 ? (
                  <div className="mt-6 rounded-3xl border border-dashed border-border bg-surface p-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      Abhi tak koi beeta din nahi hai. Roz plan banao — yaha history dikhegi.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {history
                      .filter((h) => h.day_date !== todayDate() && h.tasks.length > 0)
                      .map((h) => {
                        const done = h.tasks.filter((t) => t.done).length;
                        const total = h.tasks.length;
                        const goalsDone = h.goals.filter((g) => g.done).length;
                        const goalsTotal = h.goals.length;
                        const complete = total > 0 && done === total;
                        return (
                          <li key={h.id}>
                            <button
                              onClick={() => setViewingDay(h)}
                              className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left transition hover:border-primary/40"
                            >
                              <div
                                className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-xs font-semibold ${
                                  complete ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70"
                                }`}
                              >
                                {done}/{total}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground">
                                  {formatDayLabel(h.day_date)}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {done}/{total} tasks done
                                  {goalsTotal > 0 && ` • ${goalsDone}/${goalsTotal} goals`}
                                </p>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </>
            )}
          </section>
        )}

        {/* Bottom tab bar */}
        <nav className="sticky bottom-0 z-20 grid grid-cols-3 border-t border-border bg-background/95 backdrop-blur">
          <TabButton
            active={tab === "chat"}
            onClick={() => { setTab("chat"); setViewingDay(null); }}
            icon={<MessageCircle className="h-5 w-5" />}
            label="Chat"
          />
          <TabButton
            active={tab === "plan"}
            onClick={() => { setTab("plan"); setViewingDay(null); }}
            icon={<CalendarCheck className="h-5 w-5" />}
            label="Aaj ka Plan"
            badge={totalCount > 0 ? `${doneCount}/${totalCount}` : undefined}
          />
          <TabButton
            active={tab === "history"}
            onClick={() => { setTab("history"); setViewingDay(null); }}
            icon={<History className="h-5 w-5" />}
            label="Beete Din"
            badge={streak > 0 ? `🔥${streak}` : undefined}
          />
        </nav>

      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium transition ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <div className="relative">
        {icon}
        {badge && (
          <span className="absolute -right-4 -top-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-accent-foreground">
            {badge}
          </span>
        )}
      </div>
      <span>{label}</span>
    </button>
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
        className="mb-4 inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground/80 hover:bg-muted"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Beete din
      </button>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-display">{formatDayLabel(day.day_date)} ka plan</h2>
        <span className="text-xs font-medium text-muted-foreground">{done}/{total} done</span>
      </div>
      <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      {day.tasks.length > 0 && (
        <ul className="space-y-2">
          {day.tasks.map((t) => (
            <li
              key={t.id}
              className={`flex items-center gap-3 rounded-2xl border p-3.5 ${
                t.done ? "border-transparent bg-muted/60" : "border-border bg-card"
              }`}
            >
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                  t.done ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
              >
                {t.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium leading-tight ${t.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                  {t.task}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {t.startTime} – {t.endTime}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {day.goals.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-base font-display text-foreground/90">Us din ke goals</h3>
          <ul className="space-y-1.5">
            {day.goals.map((g) => (
              <li
                key={g.id}
                className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5"
              >
                <span
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 ${
                    g.done ? "border-accent bg-accent text-accent-foreground" : "border-border"
                  }`}
                >
                  {g.done && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className={`text-sm ${g.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                  {g.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

