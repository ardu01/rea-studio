import type { AppState, ReaBridge } from '../src/shared/types'

export function bridgeFor(state: AppState): ReaBridge {
  return {
    async getState() {
      return state
    },
    async chooseWorkspace() {
      return null
    },
    async chooseFile() {
      return null
    },
    async acceptNotice() {
      return state
    },
    async updateSettings() {
      return state
    },
    async detectTools() {
      return []
    },
    async setSecret() {
      return state
    },
    async clearSecret() {
      return state
    },
    async checkProvider(id) {
      return { id, state: 'not-configured', detail: 'No configurado', evidence: 'not-run' }
    },
    async listChat() {
      return []
    },
    async listJobs() {
      return []
    },
    async startJob() {
      throw new Error('no usado')
    },
    async cancelJob() {
      throw new Error('no usado')
    },
    async readLog() {
      return ''
    },
    async listArtifacts() {
      return []
    },
    async readArtifact() {
      throw new Error('no usado')
    },
    async prepareCloud() {
      throw new Error('no usado')
    },
    async sendCloud() {
      throw new Error('no usado')
    },
    async cancelCloud() {
      return undefined
    },
    async openDocs() {
      return undefined
    },
    onJobEvent() {
      return () => undefined
    },
    onChatEvent() {
      return () => undefined
    },
    async listOllamaModels() {
      return { available: false, base: null, models: [], detail: 'Sin Ollama en la prueba.' }
    },
    async pullOllamaModel() {
      throw new Error('no usado')
    },
    async cancelOllamaPull() {
      return undefined
    },
    onOllamaEvent() {
      return () => undefined
    },
  }
}
