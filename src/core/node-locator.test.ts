import { describe, it, expect } from 'vitest'
import { parseMarkdown, NodeLocator, normalizeTitle, levenshteinDistance, fuzzyMatchTitle } from './node-locator.js'

describe('normalizeTitle', () => {
  it('should lowercase and remove punctuation', () => {
    expect(normalizeTitle('Hello, World!')).toBe('hello world')
  })

  it('should normalize whitespace', () => {
    expect(normalizeTitle('  Hello   World  ')).toBe('hello world')
  })

  it('should preserve Chinese characters', () => {
    expect(normalizeTitle('Rust 异步编程指南')).toBe('rust 异步编程指南')
  })

  it('should handle empty string', () => {
    expect(normalizeTitle('')).toBe('')
  })

  it('should remove special characters', () => {
    const result = normalizeTitle('# Tauri 2.0 - 桌面应用')
    expect(result).not.toMatch(/[#.\-]/)
    expect(result).toContain('tauri')
    expect(result).toContain('桌面应用')
  })
})

describe('levenshteinDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0)
  })

  it('should return correct distance', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
  })

  it('should handle empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3)
    expect(levenshteinDistance('abc', '')).toBe(3)
    expect(levenshteinDistance('', '')).toBe(0)
  })
})

describe('fuzzyMatchTitle', () => {
  it('should match identical strings', () => {
    expect(fuzzyMatchTitle('hello world', 'hello world')).toBe(true)
  })

  it('should match substrings', () => {
    expect(fuzzyMatchTitle('hello', 'hello world')).toBe(true)
    expect(fuzzyMatchTitle('hello world', 'hello')).toBe(true)
  })

  it('should match within edit distance', () => {
    expect(fuzzyMatchTitle('tauri', 'taurii')).toBe(true)
  })

  it('should reject strings beyond edit distance', () => {
    expect(fuzzyMatchTitle('abcdef', 'xyzuvw')).toBe(false)
  })
})

describe('parseMarkdown', () => {
  it('should parse headings with correct levels', () => {
    const content = `# Title 1

## Subtitle 1.1

Content here.

### Section 1.1.1

More content.

# Title 2

Another section.`

    const headings = parseMarkdown(content, '/test.md')
    expect(headings).toHaveLength(2)
    expect(headings[0].title).toBe('Title 1')
    expect(headings[0].level).toBe(1)
    expect(headings[0].children).toHaveLength(1)
    expect(headings[0].children[0].type).toBe('heading')
    expect((headings[0].children[0] as any).title).toBe('Subtitle 1.1')
    expect(headings[1].title).toBe('Title 2')
  })

  it('should parse code blocks', () => {
    const content = `# Code Example

Some text.

\`\`\`typescript
const x = 1
\`\`\`

More text.

\`\`\`python
print("hello")
\`\`\``

    const headings = parseMarkdown(content, '/test.md')
    expect(headings).toHaveLength(1)
    const heading = headings[0]
    expect(heading.children.length).toBeGreaterThanOrEqual(2)
    expect(heading.children[0].type).toBe('paragraph')
    const codeBlocks = heading.children.filter(c => c.type === 'code')
    expect(codeBlocks.length).toBeGreaterThanOrEqual(1)
    expect((codeBlocks[0] as any).language).toBe('typescript')
  })

  it('should track line numbers correctly', () => {
    const content = `# First

content

## Second

more content`

    const headings = parseMarkdown(content, '/test.md')
    expect(headings[0].lineStart).toBe(0)
    expect(headings[0].children[0].lineStart).toBe(2)
    expect(headings[0].children[0].lineEnd).toBe(2)
  })

  it('should handle empty content', () => {
    const headings = parseMarkdown('', '/test.md')
    expect(headings).toHaveLength(0)
  })

  it('should parse list items', () => {
    const content = `# List Example

- item 1
- item 2
- item 3

1. numbered 1
2. numbered 2`

    const headings = parseMarkdown(content, '/test.md')
    expect(headings).toHaveLength(1)
    expect(headings[0].children[0].type).toBe('list')
    expect((headings[0].children[0] as any).ordered).toBe(false)
    expect((headings[0].children[0] as any).items).toEqual(['item 1', 'item 2', 'item 3'])
  })
})

describe('NodeLocator', () => {
  const locator = new NodeLocator()

  const sampleMarkdown = `# Project Overview

This is the project overview.

## Architecture

### Frontend

Vue 3 + TypeScript

### Backend

Rust + Tauri

## API Reference

### Endpoints

GET /api/memory

POST /api/memory

\`\`\`typescript
interface Response {
  data: string
}
\`\`\`

# Getting Started

Install dependencies first.`

  const headings = parseMarkdown(sampleMarkdown, '/test.md')

  it('should locate by heading path', () => {
    const found = locator.locateByHeadingPath(headings, ['Architecture', 'Frontend'])
    expect(found).not.toBeNull()
    expect(found!.title).toBe('Frontend')
  })

  it('should return null for non-existent path', () => {
    const found = locator.locateByHeadingPath(headings, ['NonExistent'])
    expect(found).toBeNull()
  })

  it('should fuzzy match heading titles', () => {
    const found = locator.locateByHeadingPath(headings, ['Api Reference'])
    expect(found).not.toBeNull()
    expect(found!.title).toBe('API Reference')
  })

  it('should extract content with children', () => {
    const found = locator.locateByHeadingPath(headings, ['Architecture'])
    expect(found).not.toBeNull()
    const content = locator.extractContent(found!)
    expect(content).toContain('Frontend')
    expect(content).toContain('Backend')
  })

  it('should locate code blocks by language', () => {
    const blocks = locator.locateCodeBlocks(headings, { language: 'typescript' })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].language).toBe('typescript')
    expect(blocks[0].content).toContain('interface Response')
  })

  it('should locate code blocks under heading', () => {
    const blocks = locator.locateCodeBlocks(headings, { underHeading: 'Endpoints' })
    expect(blocks).toHaveLength(1)
  })

  it('should return empty for no matching code blocks', () => {
    const blocks = locator.locateCodeBlocks(headings, { language: 'python' })
    expect(blocks).toHaveLength(0)
  })

  it('should extract full heading tree content', () => {
    const content = locator.extractContent(headings[0])
    expect(content).toContain('Project Overview')
    expect(content).toContain('Vue 3 + TypeScript')
  })
})
