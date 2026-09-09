// supabase/functions/process-full-transcript/index.ts
/**
 * Process Full Transcript - Generates notes, quizzes, and study materials using Google Gemini
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"
// jsonrepair is a purpose-built, well-tested library for exactly the class
// of problem we keep hitting: malformed LLM JSON output (truncation,
// missing commas/brackets, unescaped/special quotes, stray control
// characters, and more) — see https://github.com/josdejong/jsonrepair.
// It replaces most of the hand-rolled recovery heuristics below as the
// primary repair strategy; those heuristics stay in as a backstop in the
// rare case jsonrepair itself can't make sense of a response.
import { jsonrepair } from "https://esm.sh/jsonrepair@3.15.0"

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

// Gemini 3.5 Flash's hard output cap (input cap is 1M, irrelevant here).
const MODEL_MAX_OUTPUT_TOKENS = 65536

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface GeminiCallResult {
  text: string
  finishReason: string | undefined
  truncated: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// HTTP statuses worth retrying: transient overload / rate-limit / upstream
// hiccups. Gemini's 503 "high demand" error falls in here — it's temporary
// and usually clears within a few seconds, so failing instantly (especially
// with only one API key configured) throws away requests that would have
// succeeded a moment later.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])

// Helper: Call Gemini with key rotation
async function callGeminiWithRotation(
  prompt: string,
  systemPrompt: string,
  maxOutputTokens: number = 8000,
  temperature: number = 0.3
): Promise<GeminiCallResult> {
  const errors: string[] = []

  for (const apiKey of GEMINI_API_KEYS) {
    const keyPrefix = apiKey.substring(0, 10) + '...'

    // IMPORTANT: Gemini 3.x Flash models do NOT support disabling "thinking"
    // entirely (only Pro-tier models can go full thinking-off). Reasoning
    // tokens are deducted from the same maxOutputTokens budget as the visible
    // response, so an unset thinkingConfig silently defaults to "medium"
    // thinking and can eat most of the budget before the JSON is finished,
    // producing truncated/invalid JSON on longer, denser transcripts.
    // We use "low" (the smallest allowed) and, if we still get cut off
    // (finishReason === "MAX_TOKENS"), retry once on the same key with a
    // doubled budget before moving on.
    let currentMaxTokens = Math.min(maxOutputTokens, MODEL_MAX_OUTPUT_TOKENS)
    // Covers both kinds of retry this loop does: bumping the token budget
    // after a MAX_TOKENS truncation, and backing off after a transient
    // overload/rate-limit error.
    const maxAttemptsPerKey = 5
    let backoffMs = 1000 // 1s, 2s, 4s, 8s, capped at 8s

    for (let attempt = 1; attempt <= maxAttemptsPerKey; attempt++) {
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
                maxOutputTokens: currentMaxTokens,
                // NOTE: Gemini 3.x guidance recommends leaving topP/topK at
                // their defaults — reasoning is tuned around them, and
                // overriding them can itself increase malformed-output risk.
                responseMimeType: "application/json",
                thinkingConfig: { thinkingLevel: "low" },
              },
            }),
          }
        )

        if (!response.ok) {
          const errorText = await response.text()
          const errMsg = `Key ${keyPrefix} (attempt ${attempt}): HTTP ${response.status} - ${errorText.substring(0, 200)}`
          console.error(errMsg)
          errors.push(errMsg)

          if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxAttemptsPerKey) {
            console.warn(
              `Key ${keyPrefix}: transient error (HTTP ${response.status}), retrying in ${backoffMs}ms...`
            )
            await sleep(backoffMs)
            backoffMs = Math.min(backoffMs * 2, 8000)
            continue // retry same key
          }

          break // non-retryable (or out of attempts) — move to next key
        }

        const data = await response.json()
        const candidate = data?.candidates?.[0]
        const text = candidate?.content?.parts?.[0]?.text || ""
        const finishReason = candidate?.finishReason as string | undefined

        if (finishReason === "MAX_TOKENS") {
          if (attempt < maxAttemptsPerKey && currentMaxTokens < MODEL_MAX_OUTPUT_TOKENS) {
            const bumped = Math.min(currentMaxTokens * 2, MODEL_MAX_OUTPUT_TOKENS)
            console.warn(
              `Key ${keyPrefix}: hit MAX_TOKENS at budget ${currentMaxTokens}, retrying with ${bumped}`
            )
            currentMaxTokens = bumped
            continue // retry same key with bigger budget
          }
          console.error(
            `Key ${keyPrefix}: response truncated (MAX_TOKENS) even at ${currentMaxTokens} tokens`
          )
        }

        return { text, finishReason, truncated: finishReason === "MAX_TOKENS" }
      } catch (err) {
        // Network-level failure (fetch threw) — also worth a backoff retry,
        // it may just be a blip.
        const errMsg = `Key ${keyPrefix} (attempt ${attempt}): ${String(err)}`
        console.error("Gemini call error:", errMsg)
        errors.push(errMsg)
        if (attempt < maxAttemptsPerKey) {
          await sleep(backoffMs)
          backoffMs = Math.min(backoffMs * 2, 8000)
          continue
        }
        break
      }
    }
  }

  throw new Error(`All ${GEMINI_API_KEYS.length} Gemini key(s) failed: ${errors.join(' | ')}`)
}

// Gemini's responseMimeType:"application/json" mostly produces valid JSON,
// but on long multi-paragraph string fields it sometimes emits a literal
// newline/tab/control character inside a string value instead of escaping
// it (\n, \t, ...). Strict JSON.parse rejects raw control characters inside
// string literals, which breaks parsing even though the response is
// otherwise complete and well-formed. This walks the text and escapes any
// raw control character it finds while inside a string, leaving everything
// outside strings (formatting whitespace between tokens) untouched.
function sanitizeControlCharactersInStrings(text: string): string {
  let result = ''
  let inString = false
  let escape = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escape) {
        result += ch
        escape = false
        continue
      }
      if (ch === '\\') {
        result += ch
        escape = true
        continue
      }
      if (ch === '"') {
        inString = false
        result += ch
        continue
      }
      const code = text.charCodeAt(i)
      if (code <= 0x1f) {
        switch (ch) {
          case '\n': result += '\\n'; break
          case '\r': result += '\\r'; break
          case '\t': result += '\\t'; break
          case '\b': result += '\\b'; break
          case '\f': result += '\\f'; break
          default: result += '\\u' + code.toString(16).padStart(4, '0')
        }
        continue
      }
      result += ch
      continue
    }

    if (ch === '"') {
      inString = true
    }
    result += ch
  }

  return result
}

// Attempts to repair a truncated JSON string by closing any dangling
// string/array/object so we can recover the (mostly complete) content
// instead of discarding the whole response. Returns null if repair fails.
function attemptJSONRepair(text: string): any | null {
  const s = text.trim()
  if (!s) return null

  const stack: string[] = []
  let inString = false
  let escape = false

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }

  // Nothing open at all — not a truncation-shaped problem, repair won't help.
  if (!inString && stack.length === 0) return null

  let repaired = s

  // Trim a dangling trailing comma / partial token right before we close things.
  repaired = repaired.replace(/,\s*$/, '')

  if (inString) {
    repaired += '"'
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    repaired += stack[i] === '{' ? '}' : ']'
  }

  try {
    return JSON.parse(repaired)
  } catch {
    try {
      // One more pass: also strip trailing commas before closing brackets
      // introduced by the repair itself.
      const fixed = repaired.replace(/,\s*([\]}])/g, '$1')
      return JSON.parse(fixed)
    } catch {
      return null
    }
  }
}

// Gemini sometimes emits a literal, unescaped `"` inside a string value —
// e.g. quoting a term or figure for emphasis — instead of `\"`. That single
// stray quote makes JSON.parse think the string ended early, and everything
// after it looks like garbage (which also breaks the bracket-repair pass
// below, since its brace/quote bookkeeping goes out of sync from that point
// on). This walks the text and only treats a `"` encountered inside a string
// as a real closing quote if it's actually followed by JSON syntax (`,`,
// `}`, `]`, or `:`, ignoring whitespace) — otherwise it assumes it's an
// internal quote and escapes it instead.
function fixUnescapedQuotesInStrings(text: string): string {
  let result = ''
  let inString = false
  let escape = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (!inString) {
      result += ch
      if (ch === '"') inString = true
      continue
    }

    if (escape) {
      result += ch
      escape = false
      continue
    }
    if (ch === '\\') {
      result += ch
      escape = true
      continue
    }
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      const next = text[j]
      const looksLikeTerminator =
        next === undefined || next === ',' || next === '}' || next === ']' || next === ':'
      if (looksLikeTerminator) {
        inString = false
        result += ch
      } else {
        result += '\\"'
      }
      continue
    }
    result += ch
  }

  return result
}

function tryParse(candidate: string): any | null {
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

// Tries every combination of fixes against one candidate JSON-ish string,
// from least to most invasive, returning the first that parses.
function tryParseWithFixes(candidate: string): any | null {
  let result = tryParse(candidate)
  if (result) return result

  // jsonrepair first — it's purpose-built for this and handles far more
  // patterns in one pass (missing commas/brackets/quotes, truncation,
  // stray text, special quote characters, etc.) than the hand-rolled
  // fixes below. Guarded in try/catch: it throws rather than returning
  // null when it can't make sense of the input at all.
  try {
    const repairedByLib = jsonrepair(candidate)
    result = tryParse(repairedByLib)
    if (result) return result
  } catch (err) {
    console.warn("jsonrepair could not repair this response, falling back to manual heuristics:", String(err))
  }

  // Everything below is a backstop for the rare case jsonrepair itself
  // fails or isn't reachable (e.g. esm.sh hiccup) — kept rather than
  // removed, since it's cheap and has already proven useful on its own.
  const commaFixed = candidate.replace(/,\s*([\]}])/g, '$1')
  result = tryParse(commaFixed)
  if (result) return result

  const quoteFixed = fixUnescapedQuotesInStrings(candidate)
  result = tryParse(quoteFixed)
  if (result) return result

  const quoteAndCommaFixed = quoteFixed.replace(/,\s*([\]}])/g, '$1')
  result = tryParse(quoteAndCommaFixed)
  if (result) return result

  // Last: attempt bracket/string repair on the quote-fixed text, since
  // fixing stray quotes first is what makes the repair pass's open/closed
  // bookkeeping trustworthy for genuinely truncated responses.
  const repaired = attemptJSONRepair(quoteAndCommaFixed)
  if (repaired) repaired.__wasRepaired = true
  return repaired
}

// Helper: Parse JSON from Gemini response
function parseGeminiJSON(text: string, wasTruncated: boolean = false): any {
  if (!text || text.trim().length === 0) {
    throw new Error("Gemini returned empty response")
  }

  // Fix raw control characters inside string literals first (see comment
  // on sanitizeControlCharactersInStrings) — this alone resolves the most
  // common real-world cause of "valid-looking but unparseable" responses.
  const cleaned = sanitizeControlCharactersInStrings(text.trim())

  // 1. Try the full response as-is (with all fix combinations)
  let result = tryParseWithFixes(cleaned)
  if (result) return result

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
      result = tryParseWithFixes(match[1].trim())
      if (result) return result
    }
  }

  // 3. Find the outermost { ... } block (greedy) and retry all fixes on it
  const outerMatch = cleaned.match(/\{[\s\S]*\}/)
  if (outerMatch) {
    result = tryParseWithFixes(outerMatch[0])
    if (result) return result
  }

  // 4. Try finding an array [ ... ]
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    result = tryParseWithFixes(arrayMatch[0])
    if (result) return result
  }

  // 5. Last-ditch: try jsonrepair directly on the raw cleaned text (covers
  // cases where the outer-brace match itself was the problem, e.g. a
  // stray `}` inside a string earlier confused the greedy match), then
  // fall back to the manual bracket-repair heuristic.
  try {
    result = tryParse(jsonrepair(cleaned))
    if (result) return result
  } catch { /* fall through to manual repair below */ }

  const repaired = attemptJSONRepair(fixUnescapedQuotesInStrings(cleaned))
  if (repaired) {
    console.warn(
      `Recovered a ${wasTruncated ? "truncated" : "malformed"} Gemini response via JSON repair (some trailing content may be missing).`
    )
    repaired.__wasRepaired = true
    return repaired
  }

  // 6. Truly last resort: wrap the text in a basic structure.
  // Logging much more than a 500-char snippet here on purpose — a short
  // snippet only ever shows the *start* of the response, which is nearly
  // always well-formed; the actual break is usually further in. Logging
  // the length plus a large head and tail makes the next failure (if any)
  // actually diagnosable in one round trip instead of needing another
  // back-and-forth to see enough of the text.
  const total = cleaned.length
  console.error(
    `Could not parse or repair Gemini response as JSON${wasTruncated ? " (response was truncated by MAX_TOKENS)" : ""}. Length: ${total} chars.`
  )
  console.error("Raw text (first 2000 chars):", cleaned.substring(0, 2000))
  if (total > 2000) {
    console.error("Raw text (last 1000 chars):", cleaned.substring(Math.max(0, total - 1000)))
  }
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
    __parseFailed: true,
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

    // Determine token budgets based on duration.
    // Bumped up from the previous values to leave headroom for Gemini 3.5
    // Flash's mandatory "low" thinking overhead on top of the visible JSON,
    // and capped at the model's real 65536-token ceiling.
    let notesTokens = 6000
    let studyTokens = 9000
    if (estimatedMinutes > 60) {
      notesTokens = 40000
      studyTokens = 18000
    } else if (estimatedMinutes > 45) {
      notesTokens = 30000
      studyTokens = 14000
    } else if (estimatedMinutes > 30) {
      notesTokens = 20000
      studyTokens = 12000
    }
    notesTokens = Math.min(notesTokens, MODEL_MAX_OUTPUT_TOKENS)
    studyTokens = Math.min(studyTokens, MODEL_MAX_OUTPUT_TOKENS)

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

    const studySystemPrompt = `You are an expert university exam-paper setter for Pakistani university courses (BS/undergraduate level).
Today's date is: ${todayDate}

Based on the lecture transcript provided, generate EXAM-REALISTIC study material — the kind of questions that could genuinely appear in a real university midterm or final on this topic, not simple recall trivia.

CRITICAL REQUIREMENTS FOR DIFFICULTY AND REALISM:
1. Do not just ask "what is X" definition questions. Prefer questions that make the student apply a concept to a scenario, differentiate between two related concepts covered in the lecture, explain WHY something is true, or interpret/extend an example the teacher gave.
2. For every MCQ, the 3 incorrect options must be PLAUSIBLE, exam-quality distractors: common misconceptions, closely related terms, or near-miss answers a student who only half-understood the lecture might pick. Do not use obviously silly or unrelated wrong options — a good MCQ should require real understanding to answer confidently.
3. Short-answer questions should be phrased the way an actual exam paper would phrase them (e.g. "Differentiate between X and Y", "Explain why...", "What would happen if...", "Justify your answer with an example from the lecture") rather than one-line "what is" questions.
4. Spread the difficulty: roughly a third straightforward concept-check, a third application-level, and a third comparison/analysis-level — so this can double as genuine exam prep.
5. Every question, correct answer, and explanation must be strictly grounded in what was actually said in the transcript. Do not introduce outside facts, formulas, or examples not covered in the lecture, even if they are academically true elsewhere — students will be examined on this specific lecture's content.
6. Explanations should say not just why the correct option is right, but briefly why the main distractor(s) are tempting-but-wrong, the way a good answer key does.
7. To-do items for students with ABSOLUTE deadlines in YYYY-MM-DD format. If the teacher says "tomorrow" calculate from today (${todayDate}), "next week" = +7 days, "after 5 days" = +5 days.

Respond in JSON format with this exact structure:
{
  "quiz": [{"question": "Urdu exam-style question", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "Urdu explanation covering why the answer is correct and why the closest distractor is wrong"}],
  "quiz_en": [{"question": "English exam-style question", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "English explanation covering why the answer is correct and why the closest distractor is wrong"}],
  "shortQA": [{"question": "Urdu exam-style question (differentiate/explain/justify style)", "answer": "Urdu answer written at the length and depth expected in a real exam response"}],
  "shortQA_en": [{"question": "English exam-style question (differentiate/explain/justify style)", "answer": "English answer written at the length and depth expected in a real exam response"}],
  "todos": [{"task": "task", "deadline": "YYYY-MM-DD", "type": "assignment/quiz/reading/custom"}]
}`

    // Generate notes and study materials in parallel
    const [notesResult, studyResult] = await Promise.all([
      callGeminiWithRotation(fullTranscript, notesSystemPrompt, notesTokens, 0.3),
      callGeminiWithRotation(fullTranscript, studySystemPrompt, studyTokens, 0.3),
    ])

    const notesContent = parseGeminiJSON(notesResult.text, notesResult.truncated)
    const quizContent = parseGeminiJSON(studyResult.text, studyResult.truncated)

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
        // Surfaced so the client/logs can tell if content may be incomplete,
        // even though we did our best to recover it above.
        notesTruncated: notesResult.truncated || !!notesContent.__parseFailed,
        quizTruncated: studyResult.truncated || !!quizContent.__parseFailed,
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
