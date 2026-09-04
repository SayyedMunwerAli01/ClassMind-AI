// supabase/functions/process-audio-chunk/index.ts
/**
 * Process Audio Chunk - Transcribes audio using Groq Whisper API
 * Uses verbose_json format for better debugging and quality info
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") || ""
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    if (!GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "GROQ_API_KEY is not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const body = await req.json()
    const { sessionId, teacherId, subjectId, audioData, mimeType, chunkIndex, isFinal = false } = body

    if (!audioData || !sessionId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing: audioData or sessionId" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Decode base64 to binary
    const binaryData = Uint8Array.from(atob(audioData), (c: string) => c.charCodeAt(0))
    const ext = mimeType?.includes("mp4") ? "mp4"
      : mimeType?.includes("ogg") ? "ogg"
      : mimeType?.includes("wav") ? "wav"
      : "webm"
    const blob = new Blob([binaryData], { type: mimeType || "audio/webm" })

    console.log(`[Chunk ${chunkIndex}] Size: ${binaryData.length} bytes, type: ${mimeType}, ext: ${ext}`)

    // Skip tiny chunks (< 2KB likely silence/noise)
    if (binaryData.length < 2048) {
      console.log(`[Chunk ${chunkIndex}] Skipped: too small (${binaryData.length} bytes)`)
      // Still fetch accumulated text from DB
      const { data: existing } = await supabaseAdmin
        .from("session_transcripts")
        .select("accumulated_text")
        .eq("session_id", sessionId)
        .maybeSingle()
      return new Response(
        JSON.stringify({
          success: true,
          transcript: "",
          fullText: existing?.accumulated_text || "",
          chunkIndex: chunkIndex + 1,
          skipped: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Build FormData for Groq Whisper API
    const formData = new FormData()
    formData.append("file", blob, `chunk_${chunkIndex}.${ext}`)
    formData.append("model", "whisper-large-v3-turbo")
    formData.append("response_format", "verbose_json")
    formData.append("temperature", "0")

    // Call Groq Whisper API
    console.log(`[Chunk ${chunkIndex}] Calling Groq API...`)
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: formData,
      }
    )

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text()
      console.error(`[Chunk ${chunkIndex}] Groq error ${groqResponse.status}: ${errorText.substring(0, 300)}`)
      return new Response(
        JSON.stringify({
          success: false,
          error: `Groq error ${groqResponse.status}: ${errorText.substring(0, 200)}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const groqResult = await groqResponse.json()
    const transcript = groqResult.text?.trim() || ""

    // Log quality info from verbose_json
    console.log(`[Chunk ${chunkIndex}] Transcript: "${transcript.substring(0, 80)}..."`)
    if (groqResult.segments) {
      for (const seg of groqResult.segments) {
        console.log(`  Segment [${seg.start?.toFixed(1)}s-${seg.end?.toFixed(1)}s] no_speech: ${seg.no_speech_prob?.toFixed(3)}, text: "${seg.text?.substring(0, 50)}"`)
      }
    }

    // Store in session_transcripts table
    let fullAccumulatedText = ""

    if (transcript) {
      const { data: existingSession } = await supabaseAdmin
        .from("session_transcripts")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle()

      if (existingSession) {
        fullAccumulatedText = existingSession.accumulated_text + " " + transcript
        await supabaseAdmin
          .from("session_transcripts")
          .update({
            accumulated_text: fullAccumulatedText,
            chunk_count: (existingSession.chunk_count || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("session_id", sessionId)
      } else {
        fullAccumulatedText = transcript
        await supabaseAdmin
          .from("session_transcripts")
          .insert({
            session_id: sessionId,
            teacher_id: teacherId,
            subject_id: subjectId,
            accumulated_text: transcript,
            chunk_count: 1,
          })

        // The teacher dashboard registers the live session row BEFORE the
        // first chunk arrives (part-lock acquisition). Only insert when this
        // session is genuinely new so we never duplicate lock rows.
        const { data: existingActive } = await supabaseAdmin
          .from("active_sessions")
          .select("id")
          .eq("session_id", sessionId)
          .maybeSingle()

        if (!existingActive) {
          await supabaseAdmin
            .from("active_sessions")
            .insert({
              session_id: sessionId,
              teacher_id: teacherId,
              subject_id: subjectId,
            })
        }
      }
    } else {
      const { data: existing } = await supabaseAdmin
        .from("session_transcripts")
        .select("accumulated_text")
        .eq("session_id", sessionId)
        .maybeSingle()
      fullAccumulatedText = existing?.accumulated_text || ""
      console.log(`[Chunk ${chunkIndex}] Empty transcript. Accumulated so far: "${fullAccumulatedText.substring(0, 80)}"`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        transcript,
        fullText: fullAccumulatedText,
        chunkIndex: chunkIndex + 1,
        isFinal,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (err: any) {
    console.error("Error in process-audio-chunk:", err)
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
