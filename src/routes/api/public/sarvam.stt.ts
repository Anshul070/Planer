import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/sarvam/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.SARVAM_API_KEY;
        if (!key) {
          return Response.json({ error: "SARVAM_API_KEY missing" }, { status: 500 });
        }
        try {
          const incoming = await request.formData();
          const file = incoming.get("file");
          if (!(file instanceof Blob)) {
            return Response.json({ error: "No audio file" }, { status: 400 });
          }

          const upstream = new FormData();
          // Saarika = code-mixed Hindi+English STT (preserves Hinglish output).
          upstream.append("model", "saarika:v2.5");
          upstream.append("language_code", "unknown");
          // Sarvam requires a bare MIME (no codec params). Re-wrap the blob so
          // "audio/webm;codecs=opus" becomes "audio/webm".
          const rawType = (file as File).type || "audio/webm";
          const baseType = rawType.split(";")[0].trim() || "audio/webm";
          const ext = baseType.includes("wav")
            ? "wav"
            : baseType.includes("mp4") || baseType.includes("m4a")
            ? "m4a"
            : baseType.includes("ogg")
            ? "ogg"
            : "webm";
          const cleanBlob = new Blob([await file.arrayBuffer()], { type: baseType });
          upstream.append("file", cleanBlob, `recording.${ext}`);

          const res = await fetch("https://api.sarvam.ai/speech-to-text", {
            method: "POST",
            headers: { "api-subscription-key": key },
            body: upstream,
          });
          const text = await res.text();
          if (!res.ok) {
            console.error("Sarvam STT error", res.status, text);
            return Response.json(
              { error: `Sarvam STT ${res.status}: ${text}` },
              { status: 502 },
            );
          }
          const json = JSON.parse(text);
          return Response.json({ transcript: json.transcript ?? "" });
        } catch (e) {
          console.error("STT handler crash", e);
          return Response.json(
            { error: e instanceof Error ? e.message : "STT failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
