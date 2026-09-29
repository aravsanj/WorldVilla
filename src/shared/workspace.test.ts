import { describe, expect, it } from 'vitest'
import { workspaceManifestSchema } from './workspace'

describe('workspaceManifestSchema', () => {
  const validManifest = {
    formatVersion: 1,
    id: '1a0c1e4d-32cf-48d7-a3ea-81ddfe068f1c',
    name: 'The Seven Kingdoms',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  it('accepts a version 1 workspace manifest', () => {
    expect(workspaceManifestSchema.parse(validManifest)).toEqual(validManifest)
  })

  it('rejects unsupported workspace formats', () => {
    expect(() => workspaceManifestSchema.parse({ ...validManifest, formatVersion: 2 })).toThrow()
  })
})
