import html2pdf from 'html2pdf.js'

interface PDFOptions {
  filename: string
  isUrdu?: boolean
}

/**
 * Generate a PDF from an HTML string with proper styling for EN/Urdu
 */
export async function generatePDF(htmlContent: string, options: PDFOptions): Promise<void> {
  const opt = {
    margin: [10, 10, 10, 10] as [number, number, number, number],
    filename: options.filename,
    image: { type: 'jpeg' as const, quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      letterRendering: true,
      scrollY: 0,
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait' as const,
    },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  }

  await html2pdf().set(opt).from(htmlContent).save()
}

/**
 * Build HTML string for notes PDF download
 */
export function buildNotesHTML(data: {
  subjectName: string
  teacherName: string
  date: string
  lang: 'en' | 'ur'
  summary?: string
  sections?: { title: string; notes: string[] }[]
  examples?: { topic: string; example: string; context?: string }[]
  glossary?: { term: string; definition: string }[]
  quiz?: { question: string; options: string[]; correctIndex: number; explanation?: string }[]
}): string {
  const isUrdu = data.lang === 'ur'

  // FIX: Urdu is a right-to-left script. The on-screen NoteViewer already
  // renders every Urdu block with dir="rtl" (summary, section titles,
  // notes, glossary). The PDF must match that, not force 'ltr'. Forcing
  // ltr was the root cause of headings, bullets, quiz-option letters and
  // the glossary grid all landing on the wrong side in the exported PDF.
  const dir = isUrdu ? 'rtl' : 'ltr'
  const align = isUrdu ? 'right' : 'left'

  const fontImport = isUrdu
    ? '@import url("https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;700&display=swap");'
    : '@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap");'
  const fontFamily = isUrdu ? "'Noto Nastaliq Urdu', serif" : "'Inter', sans-serif"

  let html = `
    <div dir="${dir}" style="direction: ${dir}; text-align: ${align}; font-family: ${fontFamily}; color: #1a1a2e; max-width: 700px; margin: 0 auto; padding: 20px; line-height: 1.6;">
      <style>
        ${fontImport}
        * { box-sizing: border-box; }
        .pdf-header { text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e5e7eb; }
        .pdf-header h1 { font-size: 22px; font-weight: 700; margin: 0 0 8px; color: #1a1a2e; }
        .pdf-meta { font-size: 12px; color: #6b7280; }
        .section-title { font-size: 16px; font-weight: 700; color: #1a1a2e; margin: 20px 0 10px; padding: 6px 0; border-bottom: 1px solid #e5e7eb; text-align: ${align}; }
        .summary-text { padding: 6px 0; font-size: 13px; line-height: 1.7; color: #374151; text-align: ${align}; }
        .note-item { padding: 6px 0; font-size: 13px; line-height: 1.7; color: #374151; text-align: ${align}; }
        .note-item::before { content: "• "; color: #3b82f6; font-weight: bold; }
        .example-box { background: #f8f4ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 12px; margin: 8px 0; text-align: ${align}; }
        .example-topic { font-weight: 700; font-size: 14px; color: #1a1a2e; }
        .example-text { font-size: 13px; color: #4b5563; margin-top: 4px; }
        .glossary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; direction: ${dir}; }
        .glossary-item { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; text-align: ${align}; }
        .glossary-term { font-weight: 700; font-size: 13px; color: #1a1a2e; }
        .glossary-def { font-size: 12px; color: #6b7280; margin-top: 2px; }
        .quiz-item { margin: 10px 0; padding: 10px; border: 1px solid #e5e7eb; border-radius: 8px; text-align: ${align}; }
        .quiz-question { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
        .quiz-option { font-size: 13px; padding: 3px 0; color: #4b5563; }
        .quiz-correct { color: #059669; font-weight: 600; }
        .quiz-explanation { font-size: 12px; color: #d97706; margin-top: 4px; font-style: italic; }
        .section-divider { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
      </style>

      <!-- Header -->
      <div class="pdf-header">
        <h1>${data.subjectName}</h1>
        <div class="pdf-meta">${data.date} · ${data.teacherName}</div>
      </div>
  `

  // Summary
  // FIX: previously reused the "note-item" class with an inert
  // `style="list-style:none"` override — that CSS property does nothing
  // against the ::before-generated bullet, so the overview paragraph was
  // getting an unwanted bullet dot. Use a dedicated class instead.
  if (data.summary) {
    html += `
      <div class="section-title">${isUrdu ? 'خلاصہ' : 'Overview'}</div>
      <div class="summary-text">${data.summary}</div>
    `
  }

  // Sections
  if (data.sections?.length) {
    for (const section of data.sections) {
      html += `<div class="section-title">${section.title}</div>`
      for (const note of section.notes) {
        html += `<div class="note-item">${note}</div>`
      }
    }
  }

  // Examples
  if (data.examples?.length) {
    html += `<hr class="section-divider"><div class="section-title">${isUrdu ? 'مثالیں' : 'Examples & Analogies'}</div>`
    for (const ex of data.examples) {
      html += `
        <div class="example-box">
          <div class="example-topic">${ex.topic}</div>
          <div class="example-text">${ex.example}</div>
          ${ex.context ? `<div class="example-text" style="font-style:italic;">${ex.context}</div>` : ''}
        </div>
      `
    }
  }

  // Glossary
  if (data.glossary?.length) {
    html += `<hr class="section-divider"><div class="section-title">${isUrdu ? 'اصطلاحات' : 'Key Terms'}</div><div class="glossary-grid">`
    for (const item of data.glossary) {
      html += `
        <div class="glossary-item">
          <div class="glossary-term">${item.term}</div>
          <div class="glossary-def">${item.definition}</div>
        </div>
      `
    }
    html += '</div>'
  }

  // Quiz
  if (data.quiz?.length) {
    html += `<hr class="section-divider"><div class="section-title">${isUrdu ? 'سوالات' : 'Quiz'}</div>`
    data.quiz.forEach((q, i) => {
      html += `<div class="quiz-item"><div class="quiz-question">Q${i + 1}. ${q.question}</div>`
      q.options.forEach((opt, oi) => {
        const isCorrect = oi === q.correctIndex
        html += `<div class="quiz-option ${isCorrect ? 'quiz-correct' : ''}">${String.fromCharCode(65 + oi)}) ${opt}${isCorrect ? ' ✓' : ''}</div>`
      })
      if (q.explanation) {
        html += `<div class="quiz-explanation">${isUrdu ? 'وجہ: ' : 'Why: '}${q.explanation}</div>`
      }
      html += '</div>'
    })
  }

  html += '</div>'
  return html
}

/**
 * Build HTML string for question paper PDF
 *
 * NOTE: this function currently has no `lang`/`isUrdu` branch at all, so
 * an Urdu question paper would hit the exact same left-alignment problem
 * that buildNotesHTML had. If you generate Urdu paper PDFs, apply the
 * same `dir`/`align`/`direction` treatment here (paperType, section
 * headers, questions, options, answers) before shipping it.
 */
export function buildPaperHTML(data: {
  subjectName: string
  date: string
  paperType: string
  totalMarks: number
  durationMinutes: number
  mcqs?: { question: string; options: string[]; correctIndex: number; marks: number }[]
  shortAnswers?: { question: string; answer: string; marks: number }[]
  longAnswers?: { question: string; answer: string; marks: number }[]
}): string {
  let html = `
    <div style="font-family: 'Inter', 'Georgia', serif; color: #1a1a2e; max-width: 700px; margin: 0 auto; padding: 20px; line-height: 1.5;">
      <style>
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap");
        * { box-sizing: border-box; }
        .paper-header { text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 3px double #1a1a2e; }
        .paper-header h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
        .paper-header h2 { font-size: 14px; font-weight: 600; margin: 0 0 8px; color: #4b5563; }
        .paper-info { font-size: 12px; color: #6b7280; display: flex; justify-content: space-between; }
        .section-header { font-size: 15px; font-weight: 700; color: #1a1a2e; margin: 20px 0 12px; padding: 8px 12px; background: #f3f4f6; border-radius: 6px; }
        .section-header .marks { float: right; font-weight: 600; font-size: 12px; color: #6b7280; }
        .question { margin: 12px 0; padding: 0 8px; }
        .question-text { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
        .option { font-size: 12px; padding: 2px 0 2px 20px; color: #374151; }
        .answer-key { font-size: 11px; color: #059669; font-weight: 600; margin-top: 4px; padding-left: 20px; }
        .short-answer { margin: 12px 0; padding: 0 8px; }
        .answer-text { font-size: 12px; color: #4b5563; margin-top: 4px; padding: 8px; background: #f9fafb; border-radius: 4px; border-left: 3px solid #059669; }
        .page-break { page-break-before: always; }
      </style>

      <!-- Header -->
      <div class="paper-header">
        <h1>${data.subjectName}</h1>
        <h2>Question Paper — ${data.paperType}</h2>
        <div class="paper-info">
          <span>Date: ${data.date}</span>
          <span>Total Marks: ${data.totalMarks}</span>
          <span>Duration: ${data.durationMinutes} min</span>
        </div>
      </div>
  `

  // MCQs Section
  if (data.mcqs?.length) {
    const mcqMarks = data.mcqs.reduce((sum, q) => sum + q.marks, 0)
    html += `<div class="section-header">Section A: Multiple Choice Questions <span class="marks">${mcqMarks} marks</span></div>`
    html += '<p style="font-size:11px; color:#6b7280; margin:0 0 8px 8px;">Choose the correct option for each question.</p>'
    data.mcqs.forEach((q, i) => {
      html += `<div class="question"><div class="question-text">Q${i + 1}. ${q.question} [${q.marks} marks]</div>`
      q.options.forEach((opt, oi) => {
        html += `<div class="option">${String.fromCharCode(65 + oi)}) ${opt}</div>`
      })
      html += `<div class="answer-key">Answer: ${String.fromCharCode(65 + q.correctIndex)}</div></div>`
    })
  }

  // Short Answers Section
  if (data.shortAnswers?.length) {
    const shortMarks = data.shortAnswers.reduce((sum, q) => sum + q.marks, 0)
    html += `<div class="${data.mcqs?.length ? 'page-break' : ''}"><div class="section-header">Section B: Short Answer Questions <span class="marks">${shortMarks} marks</span></div>`
    html += '<p style="font-size:11px; color:#6b7280; margin:0 0 8px 8px;">Answer the following questions briefly.</p>'
    data.shortAnswers.forEach((q, i) => {
      html += `<div class="short-answer"><div class="question-text">Q${i + 1}. ${q.question} [${q.marks} marks]</div>`
      html += `<div class="answer-text">${q.answer}</div></div>`
    })
    html += '</div>'
  }

  // Long Answers Section
  if (data.longAnswers?.length) {
    const longMarks = data.longAnswers.reduce((sum, q) => sum + q.marks, 0)
    html += `<div class="page-break"><div class="section-header">Section C: Long Answer Questions <span class="marks">${longMarks} marks</span></div>`
    html += '<p style="font-size:11px; color:#6b7280; margin:0 0 8px 8px;">Answer the following questions in detail.</p>'
    data.longAnswers.forEach((q, i) => {
      html += `<div class="short-answer"><div class="question-text">Q${i + 1}. ${q.question} [${q.marks} marks]</div>`
      html += `<div class="answer-text">${q.answer}</div></div>`
    })
    html += '</div>'
  }

  html += '</div>'
  return html
}