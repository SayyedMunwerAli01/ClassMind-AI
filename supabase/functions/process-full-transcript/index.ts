// supabase/functions/process-full-transcript/index.ts
/**
 * Process Full Transcript - Generates notes, quizzes, and study materials using Google Gemini
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

// Gemini API keys (support up to 10 for rotation)
const GEMINI_API_KEYS = [
  Deno.env.get("GEMINI_API_KEY_1") || "",
  Deno.env.get("GEMINI_API_KEY_2") || "",
  Deno.env.get("GEMINI_API_KEY_3") || "",
  Deno.env.get("GEMINI_API_KEY_4") || "",
  Deno.env.get("GEMINI_API_KEY_5") || "",
  Deno.env.get("GEMINI_API_KEY_6") || "",
  Deno.env.get("GEMINI_API_KEY_7") || "",
  Deno.env.get("GEMINI_API_KEY_8") || "",
  Deno.env.get("GEMINI_API_KEY_9") || "",
  Deno.env.get("GEMINI_API_KEY_10") || "",
].filter(key => key.length > 0)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Helper: Call Gemini with key rotation
async function callGeminiWithRotation(
  prompt: string,
  systemPrompt: string,
  maxOutputTokens: number = 8000,
  temperature: number = 0.3
): Promise<any> {
  const errors: string[] = []

  for (const apiKey of GEMINI_API_KEYS) {
    const keyPrefix = apiKey.substring(0, 10) + '...'
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: systemPrompt }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature,
              maxOutputTokens,
              topP: 0.9,
              topK: 40,
              responseMimeType: "application/json",
            },
          }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        const errMsg = `Key ${keyPrefix}: HTTP ${response.status} - ${errorText.substring(0, 200)}`
        console.error(errMsg)
        errors.push(errMsg)
        continue
      }

      const data = await response.json()
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ""
      return text
    } catch (err) {
      console.error("Gemini call error:", err)
      continue
    }
  }

  throw new Error(`All ${GEMINI_API_KEYS.length} Gemini key(s) failed: ${errors.join(' | ')}`)
}

// Helper: Parse JSON from Gemini response
function parseGeminiJSON(text: string): any {
  if (!text || text.trim().length === 0) {
    throw new Error("Gemini returned empty response")
  }

  const cleaned = text.trim()

  // 1. Try direct parse first
  try {
    return JSON.parse(cleaned)
  } catch { /* continue */ }

  // 2. Try code blocks: ```json ... ``` or ``` ... ```
  const codeBlockPatterns = [
    /```json\s*\n([\s\S]*?)\n?\s*```/,
    /```\s*\n([\s\S]*?)\n?\s*```/,
    /```json([\s\S]*?)```/,
    /```([\s\S]*?)```/,
  ]
  for (const pattern of codeBlockPatterns) {
    const match = cleaned.match(pattern)
    if (match) {
      try {
        return JSON.parse(match[1].trim())
      } catch { /* continue */ }
    }
  }

  // 3. Find the outermost { ... } block (greedy)
  const outerMatch = cleaned.match(/\{[\s\S]*\}/)
  if (outerMatch) {
    try {
      return JSON.parse(outerMatch[0])
    } catch {
      // 4. Try fixing common JSON issues: trailing commas
      let fixed = outerMatch[0]
        .replace(/,\s*([\]}])/g, '$1')    // remove trailing commas before ] or }
        .replace(/'/g, '"')                // single quotes → double quotes
      try {
        return JSON.parse(fixed)
      } catch { /* continue */ }
    }
  }

  // 5. Try finding an array [ ... ]
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0])
    } catch { /* continue */ }
  }

  // 6. Last resort: wrap the text in a basic structure
  console.error("Could not parse Gemini response as JSON. Raw text (first 500 chars):", cleaned.substring(0, 500))
  return {
    summary: cleaned.substring(0, 500),
    summary_en: cleaned.substring(0, 500),
    sections: [{ title: "Lecture Notes", notes: [cleaned.substring(0, 1000)] }],
    sections_en: [{ title: "Lecture Notes", notes: [cleaned.substring(0, 1000)] }],
    notes: [cleaned.substring(0, 1000)],
    notes_en: [cleaned.substring(0, 1000)],
    glossary: [],
    glossary_en: [],
    todos: [],
    mindmap: { central: "Lecture", branches: [] },
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { sessionId, subjectId, teacherId } = body

    if (!sessionId || !subjectId || !teacherId) {
      throw new Error("Missing required fields: sessionId, subjectId, teacherId")
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Get accumulated transcript
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session_transcripts")
      .select("*")
      .eq("session_id", sessionId)
      .single()

    if (sessionError || !sessionData) {
      throw new Error("Session transcript not found")
    }

    const fullTranscript = sessionData.accumulated_text
    const chunkCount = sessionData.chunk_count

    // Estimate lecture duration
    const estimatedMinutes = Math.max(5, Math.round(fullTranscript.length / 150))

    // Determine token budgets based on duration
    let notesTokens = 4000
    let studyTokens = 6000
    if (estimatedMinutes > 60) {
      notesTokens = 32000
      studyTokens = 9000
    } else if (estimatedMinutes > 45) {
      notesTokens = 24000
      studyTokens = 8000
    } else if (estimatedMinutes > 30) {
      notesTokens = 16000
      studyTokens = 7000
    }

    // System prompts
    const todayDate = new Date().toISOString().split('T')[0]

    const notesSystemPrompt = `You are an expert educational content creator for Pakistani universities. 
You will receive a lecture transcript in Urdu (with some English technical terms).
Today's date is: ${todayDate}

Your task is to create organized, bilingual (Urdu and English) study notes.

CRITICAL REQUIREMENTS:
1. Generate notes in BOTH Urdu and English
2. Organize into clear sections with individual notes
3. Include ALL examples, analogies, and real-world applications the teacher mentioned — these are very important
4. Each example/analogy should be clearly marked with "Example:" or "Analogy:" prefix
5. Include a summary in both languages
6. Extract a glossary of key terms (bilingual)
7. Create a mind map structure
8. All content must be accurate to the transcript
9. For todos/assignments: use ABSOLUTE dates in YYYY-MM-DD format. If the teacher says "tomorrow", calculate from today (${todayDate}). If "next week", add 7 days. If "after 5 days", add 5 days.

Respond in JSON format with this exact structure:
{
  "summary": "Urdu summary of the entire lecture",
  "summary_en": "English summary of the entire lecture",
  "sections": [{"title": "Section title in Urdu", "notes": ["note in Urdu", "Example: real-world example the teacher gave"]}],
  "sections_en": [{"title": "Section title in English", "notes": ["note in English", "Example: real-world example the teacher gave"]}],
  "notes": ["individual Urdu notes including examples and analogies"],
  "notes_en": ["individual English notes including examples and analogies"],
  "examples": [{"topic": "topic name", "example": "the example/analogy the teacher used", "context": "why it was mentioned"}],
  "examples_en": [{"topic": "topic name", "example": "the example/analogy the teacher used", "context": "why it was mentioned"}],
  "glossary": [{"term": "Urdu term", "definition": "Urdu definition"}],
  "glossary_en": [{"term": "English term", "definition": "English definition"}],
  "todos": [{"task": "task description", "deadline": "YYYY-MM-DD", "type": "assignment/quiz/reading/custom"}],
  "mindmap": {
    "central": "Main topic",
    "branches": [{"topic": "Sub-topic", "subtopics": ["detail 1", "detail 2"]}]
  }
}`

    const studySystemPrompt = `You are an expert quiz creator for Pakistani universities.
Today's date is: ${todayDate}
Based on the lecture transcript provided, generate:
1. A 10-question multiple-choice quiz (bilingual)
2. Short answer Q&A pairs (bilingual)
3. To-do items for students with ABSOLUTE deadlines in YYYY-MM-DD format. If the teacher says "tomorrow" calculate from today (${todayDate}), "next week" = +7 days, "after 5 days" = +5 days.

Respond in JSON format with this exact structure:
{
  "quiz": [{"question": "Urdu question", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "Urdu explanation"}],
  "quiz_en": [{"question": "English question", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "English explanation"}],
  "shortQA": [{"question": "Urdu question", "answer": "Urdu answer"}],
  "shortQA_en": [{"question": "English question", "answer": "English answer"}],
  "todos": [{"task": "task", "deadline": "YYYY-MM-DD", "type": "assignment/quiz/reading/custom"}]
}`

    // Generate notes and study materials in parallel
    const [notesText, studyText] = await Promise.all([
      callGeminiWithRotation(fullTranscript, notesSystemPrompt, notesTokens, 0.3),
      callGeminiWithRotation(fullTranscript, studySystemPrompt, studyTokens, 0.3),
    ])

    const notesContent = parseGeminiJSON(notesText)
    const quizContent = parseGeminiJSON(studyText)

    // Clean up session data
    await supabaseAdmin
      .from("session_transcripts")
      .delete()
      .eq("session_id", sessionId)

    await supabaseAdmin
      .from("active_sessions")
      .delete()
      .eq("session_id", sessionId)

    return new Response(
      JSON.stringify({
        success: true,
        notesContent,
        quizContent,
        estimatedMinutes,
        chunkCount,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: any) {
    console.error("Error in process-full-transcript:", err)
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
