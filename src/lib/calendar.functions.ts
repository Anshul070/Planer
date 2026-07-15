import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { Database } from "@/integrations/supabase/types";

// Create an admin client to bypass RLS for token storage/retrieval
function getAdminSupabase() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase URL or Service Role Key in .env");
  }
  return createClient<Database>(supabaseUrl, serviceRoleKey);
}

const TokenPayloadSchema = z.object({
  userId: z.string(),
  providerToken: z.string(),
  providerRefreshToken: z.string(),
});

export const saveGoogleTokens = createServerFn({ method: "POST" })
  .validator((data: z.infer<typeof TokenPayloadSchema>) => data)
  .handler(async ({ data }) => {
    const supabaseAdmin = getAdminSupabase();
    
    // 3600 seconds = 1 hour (Google access token standard expiry)
    // We add 3500 seconds from now to be safe
    const expiresAt = Math.floor(Date.now() / 1000) + 3500;

    const { error } = await supabaseAdmin.from("user_tokens").upsert(
      {
        user_id: data.userId,
        access_token: data.providerToken,
        refresh_token: data.providerRefreshToken,
        expires_at: expiresAt,
      },
      { onConflict: "user_id" }
    );

    if (error) {
      console.error("Failed to save google tokens:", error);
      throw new Error("Failed to save tokens securely");
    }

    return { success: true };
  });

const SyncPayloadSchema = z.object({
  userId: z.string(),
  dayDate: z.string(),
  tasks: z.array(z.object({
    id: z.string(),
    task: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    done: z.boolean(),
    googleEventId: z.string().optional(),
  })),
  goals: z.array(z.object({
    id: z.string(),
    text: z.string(),
    done: z.boolean(),
    googleEventId: z.string().optional(),
  })),
  reminderMinutes: z.number().default(10),
});

export const syncToCalendar = createServerFn({ method: "POST" })
  .validator((data: z.infer<typeof SyncPayloadSchema>) => data)
  .handler(async ({ data }) => {
    const supabaseAdmin = getAdminSupabase();
    
    // Fetch tokens
    const { data: tokenData, error: tokenErr } = await supabaseAdmin
      .from("user_tokens")
      .select("*")
      .eq("user_id", data.userId)
      .single();

    if (tokenErr || !tokenData) {
      throw new Error("Google Calendar disconnected. Please connect it first.");
    }

    let accessToken = tokenData.access_token;

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (now > tokenData.expires_at) {
      console.log("Access token expired, refreshing via Google...");
      
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) {
         throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET for token refresh");
      }

      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokenData.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to refresh Google token");
      }

      const refreshed = await res.json();
      accessToken = refreshed.access_token;
      
      await supabaseAdmin.from("user_tokens").update({
        access_token: accessToken,
        expires_at: now + refreshed.expires_in - 100, // subtract buffer
      }).eq("user_id", data.userId);
    }

    // Now sync events
    const updatedTasks = [...data.tasks];
    const newSyncedIds: string[] = [];
    
    for (let i = 0; i < updatedTasks.length; i++) {
      const t = updatedTasks[i];
      
      const tz = "Asia/Kolkata";
      
      // Calculate datetime
      const startSplit = t.startTime.split(":");
      const startDateTime = new Date(`${data.dayDate}T00:00:00+05:30`);
      startDateTime.setHours(parseInt(startSplit[0], 10), parseInt(startSplit[1], 10), 0, 0);

      const endSplit = t.endTime.split(":");
      const endDateTime = new Date(`${data.dayDate}T00:00:00+05:30`);
      endDateTime.setHours(parseInt(endSplit[0], 10), parseInt(endSplit[1], 10), 0, 0);

      if (endDateTime < startDateTime) {
         endDateTime.setDate(endDateTime.getDate() + 1); // Overnight task
      }

      const eventPayload = {
        summary: t.task,
        start: { dateTime: startDateTime.toISOString(), timeZone: tz },
        end: { dateTime: endDateTime.toISOString(), timeZone: tz },
        reminders: {
          useDefault: false,
          overrides: [{ method: "popup", minutes: data.reminderMinutes }],
        },
      };

      if (t.googleEventId) {
        // Update existing
        const req = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${t.googleEventId}`, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventPayload),
        });
        if (req.ok) {
          newSyncedIds.push(t.googleEventId);
        } else {
          console.error("Failed to update Google Event:", await req.text());
        }
      } else {
        // Create new
        const req = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventPayload),
        });
        if (req.ok) {
          const resJson = await req.json();
          t.googleEventId = resJson.id;
          newSyncedIds.push(resJson.id);
        } else {
          console.error("Failed to create Google Event:", await req.text());
        }
      }
    }

    let updatedGoals = [...data.goals];
    if (updatedGoals.length > 0) {
      const goalsList = updatedGoals.map(g => `- ${g.text}`).join("\n");
      const eventPayload = {
        summary: "DinPlan Goals",
        description: goalsList,
        start: { date: data.dayDate },
        end: { date: data.dayDate },
      };
      
      const existingGoalId = updatedGoals.find(g => g.googleEventId)?.googleEventId;
      
      if (existingGoalId) {
        const req = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingGoalId}`, {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventPayload),
        });
        if (req.ok) {
           newSyncedIds.push(existingGoalId);
        } else {
           console.error("Failed to update Google Event (Goal):", await req.text());
        }
      } else {
        const req = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventPayload),
        });
        if (req.ok) {
          const resJson = await req.json();
          const gId = resJson.id;
          newSyncedIds.push(gId);
          updatedGoals = updatedGoals.map(g => ({...g, googleEventId: gId}));
        } else {
          console.error("Failed to create Google Event (Goal):", await req.text());
        }
      }
    }

    // Now delete orphaned events
    const { data: dayRow } = await supabaseAdmin
      .from("days")
      .select("synced_event_ids")
      .eq("user_id", data.userId)
      .eq("day_date", data.dayDate)
      .single();
      
    if (dayRow && dayRow.synced_event_ids) {
      for (const oldId of dayRow.synced_event_ids) {
        if (!newSyncedIds.includes(oldId)) {
          console.log("Deleting orphaned event:", oldId);
          const req = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${oldId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${accessToken}` },
          });
          if (!req.ok) {
            console.error("Failed to delete event:", oldId, await req.text());
          }
        }
      }
    }

    return { 
      success: true, 
      tasks: updatedTasks, 
      goals: updatedGoals, 
      syncedEventIds: newSyncedIds 
    };
  });
