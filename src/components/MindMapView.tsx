import { useRef, useState, useCallback } from 'react'
import { MINDMAP_COLORS } from '@/lib/constants'
import { clsx } from 'clsx'
import { RotateCcw, List, Network } from 'lucide-react'

interface MindMapViewProps {
  mindmap: {
    central: string
    branches: { topic: string; subtopics: string[] }[]
  }
  className?: string
}

const VIEWBOX_WIDTH = 1080
const VIEWBOX_HEIGHT = 780
const CENTER_X = VIEWBOX_WIDTH / 2
const CENTER_Y = VIEWBOX_HEIGHT / 2
const BRANCH_RADIUS = 155
const LEAF_RADIUS = 150

export default function MindMapView({ mindmap, className }: MindMapViewProps) {
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph')
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
    setScale(prev => Math.min(Math.max(prev * zoomFactor, 0.3), 3))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true)
    dragStart.current = { x: e.clientX - translate.x, y: e.clientY - translate.y }
  }, [translate])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return
    setTranslate({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    })
  }, [isDragging])

  const handleMouseUp = useCallback(() => setIsDragging(false), [])

  const resetView = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  const branches = mindmap.branches || []
  const branchAngleStep = (2 * Math.PI) / Math.max(branches.length, 1)

  const branchPositions = branches.map((_, index) => {
    const angle = index * branchAngleStep - Math.PI / 2
    return {
      x: CENTER_X + BRANCH_RADIUS * Math.cos(angle),
      y: CENTER_Y + BRANCH_RADIUS * Math.sin(angle),
      angle,
    }
  })

  const leafPositions = branches.map((branch, branchIndex) => {
    const baseAngle = branchIndex * branchAngleStep - Math.PI / 2
    const subAngleStep = (Math.PI / 3) / Math.max(branch.subtopics?.length || 1, 1)
    const startAngle = baseAngle - Math.PI / 6

    return (branch.subtopics || []).map((_, leafIndex) => {
      const angle = startAngle + leafIndex * subAngleStep
      const pos = branchPositions[branchIndex]
      return {
        x: pos.x + LEAF_RADIUS * Math.cos(angle),
        y: pos.y + LEAF_RADIUS * Math.sin(angle),
      }
    })
  })

  if (viewMode === 'list') {
    return (
      <div className={clsx('p-6', className)}>
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-navy flex items-center gap-2">
            <List className="w-5 h-5 text-accent-blue" />
            Lecture Structure
          </h3>
          <button
            onClick={() => setViewMode('graph')}
            className="flex items-center gap-1.5 text-accent-blue hover:text-accent-purple text-sm font-medium transition-colors"
          >
            <Network className="w-4 h-4" />
            Graph View
          </button>
        </div>
        <div className="space-y-5">
          <div className="bg-gradient-to-r from-navy to-navy-light text-white p-5 rounded-2xl text-center font-bold text-lg shadow-lg shadow-navy/20">
            {mindmap.central}
          </div>
          {branches.map((branch, i) => (
            <div key={i} className="border-l-4 pl-5 py-1" style={{ borderColor: MINDMAP_COLORS[i % MINDMAP_COLORS.length] }}>
              <h4 className="font-bold text-navy text-base mb-2">{branch.topic}</h4>
              <ul className="space-y-1.5 pl-3">
                {(branch.subtopics || []).map((sub, j) => (
                  <li key={j} className="text-gray-500 flex items-start gap-2 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: MINDMAP_COLORS[i % MINDMAP_COLORS.length] }} />
                    {sub}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={clsx('relative', className)}>
      {/* Controls */}
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <button
          onClick={resetView}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-lg text-xs font-medium text-navy shadow-sm border border-gray-200 hover:bg-white hover:shadow-md transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
        <button
          onClick={() => setViewMode('list')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-lg text-xs font-medium text-navy shadow-sm border border-gray-200 hover:bg-white hover:shadow-md transition-all"
        >
          <List className="w-3.5 h-3.5" />
          List
        </button>
      </div>
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Central node */}
        <g>
          <circle cx={CENTER_X} cy={CENTER_Y} r={65} fill="url(#centerGradient)" />
          <circle cx={CENTER_X} cy={CENTER_Y} r={60} fill="none" stroke="white" strokeWidth={2} opacity={0.2} />
          <defs>
            <radialGradient id="centerGradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#2A3578" />
              <stop offset="100%" stopColor="#1E2761" />
            </radialGradient>
          </defs>
          <text
            x={CENTER_X}
            y={CENTER_Y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize={15}
            fontWeight={700}
            fontFamily="Outfit, system-ui"
          >
            {mindmap.central?.length > 22 ? mindmap.central.substring(0, 20) + '...' : mindmap.central}
          </text>
        </g>

        {/* Branches */}
        {branches.map((branch, i) => {
          const pos = branchPositions[i]
          const color = MINDMAP_COLORS[i % MINDMAP_COLORS.length]

          return (
            <g key={i}>
              {/* Connection line from center */}
              <path
                d={`M ${CENTER_X} ${CENTER_Y} Q ${(CENTER_X + pos.x) / 2} ${(CENTER_Y + pos.y) / 2 - 20} ${pos.x} ${pos.y}`}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                opacity={0.3}
              />

              {/* Branch node */}
              <rect
                x={pos.x - 75}
                y={pos.y - 24}
                width={150}
                height={48}
                rx={24}
                fill={color}
                opacity={0.9}
              />
              <text
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="white"
                fontSize={12}
                fontWeight={600}
                fontFamily="Outfit, system-ui"
              >
                {branch.topic?.length > 20 ? branch.topic.substring(0, 18) + '...' : branch.topic}
              </text>

              {/* Leaf nodes */}
              {leafPositions[i]?.map((leafPos, j) => (
                <g key={j}>
                  <line
                    x1={pos.x}
                    y1={pos.y}
                    x2={leafPos.x}
                    y2={leafPos.y}
                    stroke={color}
                    strokeWidth={1.5}
                    opacity={0.3}
                  />
                  <rect
                    x={leafPos.x - 60}
                    y={leafPos.y - 18}
                    width={120}
                    height={36}
                    rx={18}
                    fill="white"
                    stroke={color}
                    strokeWidth={1.5}
                    opacity={0.95}
                  />
                  <text
                    x={leafPos.x}
                    y={leafPos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={color}
                    fontSize={10}
                    fontWeight={500}
                    fontFamily="Outfit, system-ui"
                  >
                    {branch.subtopics?.[j]?.length > 16
                      ? branch.subtopics[j].substring(0, 14) + '...'
                      : branch.subtopics?.[j]}
                  </text>
                </g>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
