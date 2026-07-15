import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/sarvam/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.SARVAM_API_KEY;
        if (!key) {
          return Response.json({ error: "SARVAM_API_KEY missing" }, { status: 500 });
        }
        try {
          const { text } = (await request.json()) as { text?: string };
          if (!text || !text.trim()) {
            return Response.json({ error: "No text" }, { status: 400 });
          }
          // Bulbul v2 supports Hindi/Hinglish. "anushka" = warm female Hindi voice.
          const res = await fetch("https://api.sarvam.ai/text-to-speech", {
            method: "POST",
            headers: {
              "api-subscription-key": key,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              inputs: [text.slice(0, 1500)],
              target_language_code: "hi-IN",
              speaker: "manisha",
              model: "bulbul:v2",
              enable_preprocessing: true,
            }),
          });
          const raw = await res.text();
          if (!res.ok) {
            console.error("Sarvam TTS error", res.status, raw);
            return Response.json(
              { error: `Sarvam TTS ${res.status}: ${raw}` },
              { status: 502 },
            );
          }
          const json = JSON.parse(raw);
          const audio = Array.isArray(json.audios) ? json.audios[0] : null;
          if (!audio) {
            return Response.json({ error: "No audio in response" }, { status: 502 });
          }
          return Response.json({ audio });
        } catch (e) {
          console.error("TTS handler crash", e);
          return Response.json(
            { error: e instanceof Error ? e.message : "TTS failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
