export function extractJsonObject(content: string): string | null {
  let text = content.trim()
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim()
  }
  const match = text.match(/\{[\s\S]*\}/)
  return match ? match[0] : null
}

export function extractJsonArray(content: string): string | null {
  let text = content.trim()
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim()
  }
  const match = text.match(/\[[\s\S]*\]/)
  return match ? match[0] : null
}
