import { createStart } from '@tanstack/react-start'
import { attachFreshAuth } from '@/lib/auth-function-middleware'

export const startInstance = createStart(() => ({
  functionMiddleware: [attachFreshAuth],
}))