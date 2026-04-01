export class AsyncMutex {
  private queue: (() => void)[] = []
  private locked = false

  acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.locked = false
            if (this.queue.length > 0) {
              const next = this.queue.shift()!
              next()
            }
          })
        } else {
          this.queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }
}
