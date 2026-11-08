/// <reference types="vite/client" />

import type { ReaBridge } from '../../shared/types'

declare global {
  interface Window {
    reaStudio?: ReaBridge
  }
}

export {}
