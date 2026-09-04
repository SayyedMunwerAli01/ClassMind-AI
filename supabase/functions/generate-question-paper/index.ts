// supabase/functions/generate-question-paper/index.ts
/**
 * Generate Question Paper - Creates exam papers from lecture notes
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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { notesContent, subjectName, paperType, customCounts, extraInstructions } = body

    if (!notesContent) {
      throw new Error("Missing required field: notesContent")
    }

    // Build composition prompt based on paper type
    let compositionPrompt = ""
    if (paperType === 'custom' && customCounts) {
      const mcqs = customCounts.mcqs || 0
      const short = customCounts.shortAnswers || 0
      const long = customCounts.longAnswers || 0
      const totalMarks = mcqs * 2 + short * 5 + long * 10
      const duration = Math.ceil(totalMarks * 1.5)
      compositionPrompt = `Create exactly: ${mcqs} MCQs (2 marks each), ${short} short-answer questions (5 marks each), ${long} long-answer questions (10 marks each). Total marks: ${totalMarks}. Duration: ${duration} minutes.`
    } else {
      switch (paperType) {
        case 'mcq':
          compositionPrompt = "Create ONLY 15 MCQs (2 marks each). Total marks: 30. Duration: 30 minutes. No short or long answer questions."
          break
        case 'short':
          compositionPrompt = "Create ONLY 6 short-answer questions (5 marks each). Total marks: 30. Duration: 45 minutes. No MCQs or long answer questions."
          break
        case 'long':
          compositionPrompt = "Create ONLY 4 long-answer questions (10 marks each). Total marks: 40. Duration: 60 minutes. No MCQs or short answer questions."
          break
        case 'short-long':
          compositionPrompt = "Create 4 short-answer questions (5 marks each) and 3 long-answer questions (10 marks each). Total marks: 50. Duration: 75 minutes. No MCQs."
          break
        case 'combined':
        default:
          compositionPrompt = "Create 10 MCQs (2 marks each), 4 short-answer questions (5 marks each), and 2 long-answer questions (10 marks each). Total marks: 60. Duration: 90 minutes."
          break
      }
    }

    const extraInstructionsText = extraInstructions ? `\nADDITIONAL INSTRUCTIONS FROM TEACHER: ${extraInstructions}` : ''

    const systemPrompt = `You are an exam paper creator for Pakistani universities.
Based on the lecture notes provided, create a comprehensive question paper.

${compositionPrompt}
Subject: ${subjectName || "Subject"}
${extraInstructionsText}

IMPORTANT: Create questions ONLY from the provided lecture content. Vary cognitive levels (knowledge, comprehension, application, analysis).

Respond in JSON format:
{
  "mcqs": [{"question": "Q", "options": ["A", "B", "C", "D"], "correctIndex": 0, "marks": 2, "cognitiveLevel": "knowledge"}],
  "shortAnswers": [{"question": "Q", "answer": "Expected answer points", "marks": 5, "cognitiveLevel": "comprehension"}],
  "longAnswers": [{"question": "Q", "answer": "Detailed expected answer", "marks": 10, "cognitiveLevel": "analysis"}],
  "totalMarks": 60,
  "durationMinutes": 90
}`

    let result: any = null

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
                  parts: [{ text: JSON.stringify(notesContent) }],
                },
              ],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 6000,
                responseMimeType: "application/json",
              },
            }),
          }
        )

        if (response.status === 429 || response.status === 404) continue

        if (!response.ok) continue

        const data = await response.json()
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ""
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0])
          break
        }
      } catch (err) {
        continue
      }
    }

    return new Response(
      JSON.stringify({ success: true, questionPaper: result }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
