const CREDENTIAL_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi,
  /\bsk-[A-Za-z0-9]{12,}\b/g,
  /\bxai-[A-Za-z0-9_-]{12,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
]

export function scrubKnownSecrets(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) {
      out = out.split(secret).join('[REDACTED]')
    }
  }
  return out
}

export function scrubCredentialPatterns(text: string): string {
  let out = text
  for (const pattern of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]')
  }
  return out
}

export function scrubForLog(text: string, secrets: readonly string[]): string {
  return scrubKnownSecrets(text, secrets)
}

export function scrubProviderError(text: string, secrets: readonly string[]): string {
  return scrubCredentialPatterns(scrubKnownSecrets(text, secrets)).slice(0, 2000)
}

export function assertNoSecretFields(value: unknown, pathName = 'config'): void {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if (
      lower.includes('apikey') ||
      lower.includes('api_key') ||
      lower === 'secret' ||
      lower === 'token' ||
      lower === 'password' ||
      lower === 'authorization'
    ) {
      throw new Error(`El campo ${pathName}.${key} no se puede guardar aquí. Las claves van al almacén cifrado.`)
    }
    if (child && typeof child === 'object') assertNoSecretFields(child, `${pathName}.${key}`)
  }
}
