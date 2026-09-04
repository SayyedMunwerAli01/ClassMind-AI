export function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good Morning'
  if (hour < 17) return 'Good Afternoon'
  if (hour < 22) return 'Good Evening'
  return 'Good Night'
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-PK', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function getColorForIndex(index: number, palette: string[] = []): string {
  const colors = palette.length > 0 ? palette : ['#4A90D9', '#7B5EA7', '#27AE60', '#E74C3C', '#F39C12', '#1ABC9C']
  return colors[index % colors.length]
}

export function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

export function detectLanguage(text: string): 'urdu' | 'roman-urdu' | 'english' {
  const urduScript = /[\u0600-\u06FF]/.test(text)
  if (urduScript) return 'urdu'
  
  // Check for common Roman Urdu words
  const romanUrduWords = ['kya', 'kaise', 'kyun', 'kab', 'kahan', 'mein', 'hai', 'hain', 'nahi', 'aur', 'ya', 'wo', 'yeh', 'mera', 'apka', 'hum', 'tum']
  const words = text.toLowerCase().split(/\s+/)
  const romanUrduCount = words.filter(w => romanUrduWords.includes(w)).length
  
  if (romanUrduCount > 0) return 'roman-urdu'
  return 'english'
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}