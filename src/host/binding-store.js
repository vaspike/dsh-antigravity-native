import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const bindingSchema = z.object({
  agySessionId: z.string().min(1),
  cwd: z.string().min(1),
  forwardedUserCount: z.number().int().nonnegative(),
  lastUserSignature: z.string(),
})

export const bindingDomain = defineDomain({
  name: 'antigravity_native',
  version: 1,
  tables: { bindings: domainTable(bindingSchema) },
})

export class BindingStore {
  constructor(domain) {
    this.domain = domain
    this.table = domain.table('bindings')
  }

  static async open(ctx) {
    return new BindingStore(await ctx.storageDomain.open(bindingDomain))
  }

  get(sessionId) {
    return this.table.get(sessionId)
  }

  async put(sessionId, record) {
    await this.table.put(sessionId, record)
  }

  async close() {
    await this.domain.close()
  }
}
