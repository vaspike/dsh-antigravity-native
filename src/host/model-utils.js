import { createHash } from 'node:crypto'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

export function optionValues(option) {
  return (option?.options ?? []).flatMap(entry =>
    'value' in entry ? [entry.value] : (entry.options ?? []).map(item => item.value),
  )
}

export function reasoningMetadata(option) {
  const efforts = optionValues(option).map(value => ({ id: ReasoningEffortId(value), name: value }))
  return {
    efforts,
    ...(option?.currentValue ? { defaultEffort: ReasoningEffortId(option.currentValue) } : {}),
  }
}

export function isHumanMessage(message) {
  if (message.role !== 'user') return false
  const kind = message.source?.kind
  return kind === undefined || kind === 'user'
}

export function messageText(message) {
  return message.content.flatMap(block => block.type === 'text' && block.text.trim() ? [block.text] : []).join('\n\n')
}

export function messageSignature(message) {
  return createHash('sha256').update(JSON.stringify(message.content)).digest('hex')
}

export function utilityPrompt(options) {
  const system = options.system ?? options.messages.find(message => message.role === 'system')?.content
    ?.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
  const messages = options.messages.flatMap(message => {
    if (message.role === 'system') return []
    const text = messageText(message)
    return text ? `${message.role.toUpperCase()}:\n${text}` : []
  })
  return [system && `SYSTEM:\n${system}`, ...messages].filter(Boolean).join('\n\n')
}
