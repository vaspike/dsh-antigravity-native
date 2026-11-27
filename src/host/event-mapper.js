export class EventMapper {
  constructor() {
    this.blocks = new Map()
  }

  get hasText() {
    return Boolean(this.blocks.get('text')?.text)
  }

  update(update) {
    if (update.sessionUpdate !== 'agent_message_chunk' && update.sessionUpdate !== 'agent_thought_chunk') return []
    if (update.content.type !== 'text' || !update.content.text) return []
    const type = update.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'text'
    const chunks = []
    let block = this.blocks.get(type)
    if (!block) {
      block = { index: this.blocks.size, text: '' }
      this.blocks.set(type, block)
      chunks.push({ type: 'block-start', index: block.index, blockType: type })
    }
    block.text += update.content.text
    chunks.push(type === 'text'
      ? { type: 'text-delta', index: block.index, text: update.content.text }
      : { type: 'reasoning-delta', index: block.index, text: update.content.text })
    return chunks
  }

  end() {
    return [...this.blocks].map(([type, block]) => ({
      type: 'block-end',
      index: block.index,
      block: { type, text: block.text },
    }))
  }
}

export function finishReason(reason) {
  switch (reason) {
    case 'end_turn': return { kind: 'stop' }
    case 'max_tokens': return { kind: 'max-tokens' }
    case 'cancelled': return { kind: 'aborted', failure: { code: 'ABORTED', message: 'Antigravity generation was cancelled.' } }
    case 'refusal': return { kind: 'error', failure: { code: 'ACP_REFUSAL', message: 'Antigravity refused the prompt.' } }
    default: return { kind: 'error', failure: { code: 'ACP_STOP', message: 'Antigravity ended the turn without a clean stop.' } }
  }
}
