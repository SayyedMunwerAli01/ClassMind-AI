import { useState, useRef, useEffect, useCallback, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { detectLanguage } from '@/lib/helpers'
import { FALLBACK_MESSAGES, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/constants'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { Send, Bot, User, Loader2, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'

// Render simple markdown (**bold**, *italic*, ***bold italic***) to React nodes
function renderMarkdown(text: string): ReactNode[] {
  // Split by lines first to handle line breaks
  return text.split('\n').flatMap((line, lineIndex) => {
    if (lineIndex > 0) {
      // Preserve line breaks
      const nodes: ReactNode[] = [<br key={`br-${lineIndex}`} />]
      // Parse inline formatting for this line
      nodes.push(...parseInline(line, lineIndex))
      return nodes
    }
    return parseInline(line, lineIndex)
  })
}

function parseInline(text: string, lineKey: number): ReactNode[] {
  // Match ***bold italic***, **bold**, or *italic*
  const parts: ReactNode[] = []
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[2]) {
      // ***bold italic***
      parts.push(<strong key={`${lineKey}-${match.index}`} className="font-bold italic">{match[2]}</strong>)
    } else if (match[3]) {
      // **bold**
      parts.push(<strong key={`${lineKey}-${match.index}`} className="font-bold">{match[3]}</strong>)
    } else if (match[4]) {
      // *italic*
      parts.push(<em key={`${lineKey}-${match.index}`} className="italic">{match[4]}</em>)
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  // If no matches, return the whole text
  if (parts.length === 0) {
    parts.push(text)
  }

  return parts
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  language?: string
  timestamp: Date
}

interface AITutorChatProps {
  noteId: string
  notesContent: any
  className?: string
}

export default function AITutorChat({ noteId, notesContent, className }: AITutorChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hello! I\'m your AI Tutor. I can answer questions based on this lecture\'s content. Ask me anything in English, Urdu, or Roman Urdu!',
      language: 'english',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isLoading, scrollToBottom])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: input.trim(),
      language: detectLanguage(input.trim()),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || SUPABASE_ANON_KEY

      const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-tutor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          question: userMessage.content,
          noteId,
          notesContent,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.message || data?.error || `Server error (${response.status})`)
      }

      const answerText = data?.answer || FALLBACK_MESSAGES.en

      const assistantMessage: ChatMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: answerText,
        // FIX: previously trusted `data?.language` unconditionally, which
        // is how a fully-Urdu reply ended up tagged "English" in the UI.
        // `detectLanguage` is already used for the user's own messages —
        // run it on the actual reply text too and prefer that result,
        // falling back to the API's value only if detection comes back
        // empty.
        language: detectLanguage(answerText) || data?.language || 'english',
        timestamp: new Date(),
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (err: any) {
      const errorMessage: ChatMessage = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content: `I'm having trouble processing that right now. ${FALLBACK_MESSAGES.en}`,
        language: 'english',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, noteId, notesContent])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className={clsx('flex flex-col bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-accent-light/50 to-white">
        <div className="w-9 h-9 bg-gradient-to-br from-accent-blue to-accent-purple rounded-xl flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <h3 className="font-bold text-navy text-sm">AI Tutor</h3>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ maxHeight: '420px', minHeight: '200px' }}>
        {messages.map(msg => {
          // FIX: Roman Urdu is Latin script (reads ltr) — only real Urdu
          // script needs rtl. Previously nothing here had a `dir` at all,
          // so every bubble rendered ltr regardless of language, which is
          // why the numbered list in the screenshot showed "1." stuck on
          // the left with the Urdu term trailing off to its right instead
          // of the other way around.
          const isMsgUrdu = msg.language === 'urdu'
          return (
            <div
              key={msg.id}
              className={clsx(
                'flex gap-2.5 animate-fade-in',
                msg.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-xl bg-accent-blue/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-accent-blue" />
                </div>
              )}
              <div
                className={clsx(
                  'max-w-[80%] rounded-2xl px-4 py-3',
                  msg.role === 'user'
                    ? 'bg-navy text-white rounded-tr-md'
                    : 'bg-gray-50 text-navy rounded-tl-md border border-gray-100',
                )}
              >
                {msg.language && msg.role === 'assistant' && msg.id !== 'welcome' && (
                  <Badge color="blue" className="mb-1.5 text-[10px]">
                    {msg.language === 'urdu' ? 'اردو' : msg.language === 'roman-urdu' ? 'Roman Urdu' : 'English'}
                  </Badge>
                )}
                <p
                  className={clsx(
                    'text-sm leading-relaxed',
                    msg.role === 'assistant' && msg.id !== 'welcome' ? 'whitespace-normal' : 'whitespace-pre-wrap',
                    isMsgUrdu && 'text-right',
                  )}
                  dir={isMsgUrdu ? 'rtl' : 'ltr'}
                >
                  {msg.role === 'assistant' && msg.id !== 'welcome' ? renderMarkdown(msg.content) : msg.content}
                </p>
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-xl bg-navy/10 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-navy" />
                </div>
              )}
            </div>
          )
        })}
        {isLoading && (
          <div className="flex gap-2.5 justify-start animate-fade-in">
            <div className="w-8 h-8 rounded-xl bg-accent-blue/10 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-accent-blue" />
            </div>
            <div className="bg-gray-50 rounded-2xl px-5 py-3 border border-gray-100">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 bg-accent-blue/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-accent-blue/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-accent-blue/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about this lecture..."
            className="flex-1 resize-none px-4 py-2.5 rounded-xl border-2 border-gray-200 focus:border-accent-blue focus:ring-4 focus:ring-accent-blue/10 focus:outline-none text-sm bg-white transition-all"
            rows={2}
            disabled={isLoading}
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="self-end"
            variant="gradient"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-gray-300 mt-1.5 text-center">
          English · اردو · Roman Urdu
        </p>
      </div>
    </div>
  )
}