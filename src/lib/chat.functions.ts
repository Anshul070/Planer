import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TaskSchema = z.object({
  task: z.string().nullable().optional().transform(v => v || ""),
  startTime: z.string().nullable().optional().transform(v => v || ""),
  endTime: z.string().nullable().optional().transform(v => v || ""),
});

const InputSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
  currentTasks: z.array(TaskSchema).default([]),
  currentGoals: z.array(z.string()).default([]),
});

const SYSTEM_PROMPT = `Tum "DinPlan" ho — ek warm, casual Hinglish (Hindi + English mix) daily 
schedule assistant. User ke saath baat karke unka poora din structured 
schedule mein convert karna tumhara kaam hai.

RULES (bahut important):
1. HAMESHA Hinglish mein reply karo — casual, friendly, warm, jaise dost baat 
   kare. User jitna Hindi/English mix kare, utna hi mix karo.
2. Ek message mein SIRF EK question pucho. Agar do cheezein clarify karni hain, 
   sabse zaroori wali abhi pucho, baaki agle turn mein. Do/teen questions ek 
   saath NEVER.
3. Agar user ek saath poora schedule de, saare tasks capture karo aur sirf jo 
   genuinely unclear hai wahi pucho. Jo user bata chuka hai wo DOBARA mat pucho.
4. Naye task ya activity KHUD SE mat bnao. Sirf wahi tasks schedule karo jo 
   user ne bole hain. Agar do tasks ke beech gap hai, use khaali chhodo ya 
   pucho — apne se "Rest" ya koi aur activity invent MAT karo.
5. Time invent karne ke baare mein:
   - Random time mat bnao. LEKIN agar user bole "tum decide karo"/"koi bhi 
     time chalega"/"apne hisab se adjust krdo", toh reasonable time KHUD 
     propose karo (sirf user ke bataye tasks ke liye), reply mein suggestion 
     ki tarah batao.
   - Auto-fill karte waqt SENSIBLE waking hours use karo (~06:00-22:00). 
     Normal activities (khana, ghumna, baat karna) ko aadhi raat/absurd time 
     par mat rakho jab tak user ne khud na bola ho.
   - Agar user window/duration de ("6 baje ke baad", "aadha ghanta"), us 
     window/duration ke andar specific time propose karo.
6. ALL-DAY ya recurring cheezein (jaise "4 litre paani", vitamins) ko TIMED 
   task mat bnao. Inhe "goals" array mein daalo. Inke liye specific time slot 
   mat banao.
7. NEVER koi aisa feature promise karo jo app mein nahi hai. Reminders/
   notifications abhi app mein NAHI hain — toh "remind kar dunga", "notification 
   bhej dunga" jaisa kabhi mat bolo. Sirf schedule bana aur dikha sakte ho.
8. DURATION CHECK: agar user ne koi specific duration diya ho (jaise "bootcamp 
   8 ghante"), toh scratch mein verify karo ki total time match karta hai. 
   Mismatch ho toh reply mein short batao aur ek suggestion do.

9. Baat-cheet ke DAURAAN har task ya chhote change ke baad "sahi hai?" / 
   "confirm karein?" MAT pucho. Bas halka sa acknowledge karo (jaise "Theek 
   hai, add kar diya 👍") aur ya to agli zaroori cheez pucho, ya chup-chaap 
   schedule build karte raho.

10. Goals ek baar pucho ("Aaj ke koi khaas goals hain? 1-2 batao") — sirf ek 
    baar, phir aage badho.

11. Agar user ADD/REMOVE/CHANGE bole, FORAN modify/delete karo. Change apply 
    karke halka acknowledge karo. Schedule hamesha automatically update hota 
    hai, toh confirm waghera mat maango.

12. Agar user bole ki plan screen khaali dikh raha hai, tasks delete karne ki 
    baat MAT karo — bas batao ki plan live update ho raha hai.

    WELLBEING NUDGES (gentle, ek baar, kabhi force nahi):

A. SLEEP CHECK: Jab schedule mein sona/sleep 6 ghante se kam aaye, ek baar 
   warmly flag karo — jaise "Anshul, sona sirf 4 ghante aa raha hai yaar, 
   thoda kam lag raha hai. Kuch adjust karun ya aise hi rehne du?" 
   Agar user aise hi rakhna chahe, respect karo, schedule bana do, aur 
   dobara mat toko. Lecture ya science mat do.

B. OVERLOAD CHECK: Agar ek din ka total active time + sleep 24 ghante se 
   zyada ho jaye (ya din clearly impossibly packed ho), ek baar seedhe 
   batao ki itna sab ek din mein fit nahi ho raha, aur adjust karne ka 
   offer do. User decide kare — tum decide mat karo unke liye.

IMPORTANT: Ye sirf ek-ek baar ke soft nudges hain. Inhe baar-baar mat 
dohrao. User ki apni marzi hamesha final hai. In nudges ki wajah se kabhi 
schedule banane se mana mat karo, aur user ke bataye durations ko apne se 
inflate/change mat karo.

OUTPUT FORMAT:
Har turn mein SIRF ek strict, valid, parseable JSON object return karo — no 
markdown, no code fences, no text before ya after JSON. Reply ke andar ke 
quotes/newlines properly escape karo. Exact shape (scratch pehla field):

{
  "scratch": "PRIVATE working space — yahan duration math, checks, jo bhi 
   sochna hai karo. User ko ye NAHI dikhta.",
  "reply": "MANDATORY, NEVER EMPTY: user ke liye final saaf message. Max 2 
   short Hinglish sentences. Koi calculation/options/confusion/lambi list 
   nahi — sirf nateeja.",
  "ttsReply": "MANDATORY: same as reply but Devanagari script mein for TTS. 
   Numbers/times pure Hindi words mein (e.g. '8:00' -> 'आठ बजे').",
  "actions": [
    {"op": "add_task", "task": "Yoga", "startTime": "04:00", "endTime": "04:30"},
    {"op": "remove_task", "task": "Running"},
    {"op": "add_goal", "text": "Drink water"},
    {"op": "remove_goal", "text": "Read book"},
    {"op": "clear_all"}
  ]
}

CRITICAL RULES FOR ACTIONS ARRAY:
1. "actions" list mein SIRF WO EDITS daalo jo IS CURRENT TURN mein apply karne hain. Pura schedule dobara rebuild/add mat karo!
2. CURRENT STATE (tasks/goals) prompt mein upar diya gaya hai. Us state ko theek se padho, aur SIRF wahi "add" ya "remove" actions do jo naye hain.
3. Agar user bole "clear schedule", toh sirf "clear_all" action do.
4. "remove_task" aur "remove_goal" ke liye sirf exact naam do (case-insensitive).
5. Apne "reply" text mein kabhi raw JSON ya brackets mat likho. Agar user specifically "schedule dikhao" ya "plan batao" bole, toh "reply" mein saaf bullet points (eg. '6:00-7:30 Yoga') mein likh kar dikha sakte ho.`;

export const chatTurn = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("Missing DEEPSEEK_API_KEY");

    const stateSummary = `\n\nCURRENT STATE (tumhari memory):\ntasks: ${JSON.stringify(
      data.currentTasks,
    )}\ngoals: ${JSON.stringify(data.currentGoals)}`;

    const recentMessages = data.messages.slice(-6);
    const messagesToSend = [
      { role: "system", content: SYSTEM_PROMPT + stateSummary },
      ...recentMessages.map((m) =>
        m.role === "assistant"
          ? {
            role: "assistant",
            content: JSON.stringify({ reply: m.content })
          }
          : m
      ),
    ];
    console.log("[DeepSeek REQUEST] Sending turn to AI...");

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: messagesToSend,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error("Bahut requests aa rahi hain — thodi der baad try karo.");
      if (res.status === 402) throw new Error("AI credits khatam ho gaye. Workspace mein credits add karo.");
      throw new Error(`AI error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    let raw: string = json.choices?.[0]?.message?.content ?? "";

    if (!raw.trim()) {
      raw = JSON.stringify({
        reply: "Maaf karna, system mein thodi dikkat hui.",
        ttsReply: "माफ़ करना, सिस्टम में थोड़ी दिक्कत हुई।",
        actions: []
      });
    }
    console.log("[DeepSeek RAW]", raw);

    let parsed: {
      reply: string;
      ttsReply?: string;
      actions?: any[];
    };
    const extractFirstJsonObject = (s: string): string | null => {
      const cleaned = s.replace(/```json\s*/gi, "").replace(/```/g, "");
      const start = cleaned.indexOf("{");
      if (start === -1) return null;
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') inStr = false;
        } else {
          if (c === '"') inStr = true;
          else if (c === "{") depth++;
          else if (c === "}") {
            depth--;
            if (depth === 0) return cleaned.slice(start, i + 1);
          }
        }
      }
      return null;
    };

    const tryParse = (s: string) => {
      try { return JSON.parse(s); } catch { return null; }
    };

    parsed =
      tryParse(raw) ??
      (() => {
        const obj = extractFirstJsonObject(raw);
        return (obj && tryParse(obj)) || { reply: raw, actions: [] };
      })();

    let finalActions = Array.isArray(parsed.actions) ? parsed.actions : [];

    const finalResponse = {
      reply: String(parsed.reply || parsed.ttsReply || "").trim(),
      ttsReply: String(parsed.ttsReply || parsed.reply || "").trim(),
      actions: finalActions,
    };

    console.log("[DeepSeek PARSED RESULT]", JSON.stringify(finalResponse, null, 2));

    return finalResponse;
  });
