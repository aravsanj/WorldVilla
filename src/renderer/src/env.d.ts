/// <reference types="vite/client" />

import type { WorldVillaApi } from '../../preload'

declare global {
  interface Window {
    worldvilla: WorldVillaApi
  }
}
