// supabase/functions/ai-tutor/index.ts
/**
 * AI Tutor - Answers questions grounded in specific lecture notes
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GEMINI_API_KEYS = [
  Deno.env.get("GEMINI_API_KEY_1") || "",
  Deno.env.get("GEMINI_API_KEY_2") || "",
  Deno.env.get("GEMINI_API_KEY_3") || "",
].filter(key => key.length > 0)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const FALLBACK_MESSAGES = {
  en: "This topic was not covered in today's lecture. Please refer to your textbook or ask your teacher.",
  ur: "یہ موضوع آج کے لیکچر میں شامل نہیں تھا۔ براہ کرم اپنی نصابی کتاب دیکھیں یا اپنے استاد سے پوچھیں۔",
  romanUrdu: "Yeh topic aaj ke lecture mein shamil nahi tha. Barah-e-karam apni nisabi kitab dekhein ya apne ustaad se poochhein.",
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { question, noteId, notesContent } = body

    if (!question || !notesContent) {
      throw new Error("Missing required fields: question, notesContent")
    }

    // Build system prompt with grounding
    const systemPrompt = `You are an AI Tutor for a Pakistani university student.
You can ONLY answer questions based on the lecture notes provided below.
CRITICAL RULES:
1. ONLY use information from the provided lecture notes
2. If the question is NOT about topics in the notes, respond with the fallback message
3. Detect the language of the question:
   - If Urdu script (uses Arabic characters), respond in Urdu script
   - If Roman Urdu (Latin characters but Urdu words), respond in Roman Urdu
   - If English, respond in English
4. Be concise and educational
5. If the student asks about something partially covered, answer what's in the notes and note it's limited
6. Use minimal markdown: use **bold** only for key terms. Do NOT use italic (*text*) or ***bold italic***. Use plain numbered lists (1. 2. 3.) without any markdown formatting characters.

LECTURE NOTES CONTENT:
${JSON.stringify(notesContent, null, 2)}

FALLBACK MESSAGES:
- English: "${FALLBACK_MESSAGES.en}"
- Urdu: "${FALLBACK_MESSAGES.ur}"
- Roman Urdu: "${FALLBACK_MESSAGES.romanUrdu}"`

    // Detect language
    const hasUrduScript = /[\u0600-\u06FF]/.test(question)
    const romanUrduWords = ['kya', 'kaise', 'kyun', 'kab', 'kahan', 'mein', 'hai', 'hain', 'nahi', 'aur', 'ya', 'wo', 'yeh', 'mera', 'apka', 'hum', 'tum']
    const words = question.toLowerCase().split(/\s+/)
    const romanUrduCount = words.filter((w: string) => romanUrduWords.includes(w)).length
    const detectedLanguage = hasUrduScript ? 'urdu' : romanUrduCount > 0 ? 'roman-urdu' : 'english'

    let answer = FALLBACK_MESSAGES[detectedLanguage as keyof typeof FALLBACK_MESSAGES] || FALLBACK_MESSAGES.en

    for (const apiKey of GEMINI_API_KEYS) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: systemPrompt }],
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: question }],
                },
              ],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 2048,
                topP: 0.9,
              },
            }),
          }
        )

        if (response.status === 429 || response.status === 404) {
          continue
        }

        if (!response.ok) {
          const errorText = await response.text()
          console.error("Gemini error:", response.status, errorText.substring(0, 200))
          continue
        }

        const data = await response.json()
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ""
        if (text) {
          answer = text
        }
        break
      } catch (err) {
        console.error("Gemini call error:", err)
        continue
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        answer,
        language: detectedLanguage,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: any) {
    console.error("Error in ai-tutor:", err)
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message,
        answer: FALLBACK_MESSAGES.en,
        language: 'english',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
