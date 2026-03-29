export type MemoryNodeType = 'heading' | 'paragraph' | 'code' | 'list'

export interface BaseNode {
  type: MemoryNodeType
  lineStart: number
  lineEnd: number
  content: string
}

export interface HeadingNode extends BaseNode {
  type: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6
  title: string
  normalizedTitle: string
  children: MemoryNode[]
}

export interface ParagraphNode extends BaseNode {
  type: 'paragraph'
}

export interface CodeBlockNode extends BaseNode {
  type: 'code'
  language: string
  raw: string
}

export interface ListNode extends BaseNode {
  type: 'list'
  ordered: boolean
  items: string[]
}

export type MemoryNode = HeadingNode | ParagraphNode | CodeBlockNode | ListNode
