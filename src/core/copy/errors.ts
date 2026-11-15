/** Convierte un error técnico en una frase clara para la pantalla sencilla. */
export function simplifyCopyError(message: string): string {
  const text = message.trim()
  const rules: Array<[RegExp, string]> = [
    [/cancelad/i, 'Se ha cancelado la copia.'],
    [/no he reconocido|no reconoc/i, text],
    [/plantilla para copiarlo/i, text],
    [/modelo local no responde|fetch failed|ECONNREFUSED|11434/i, 'No he podido hablar con el modelo local. Comprueba que Ollama está en marcha y pulsa Reintentar.'],
    [/elige un modelo|modelo en Ajustes|model\.trim|no hay un modelo/i, 'Hace falta un modelo local para copiar la aplicación. Elige o descarga uno.'],
    [/localhost|endpoint del proveedor/i, 'El agente solo usa un modelo local. Revisa el proveedor compatible en Ajustes.'],
    [/no se encuentra git|hace falta git/i, 'Hace falta git para crear el proyecto y poder deshacer. Instálalo y pulsa Reintentar.'],
    [/ya existe .+ y no está vacía/i, 'Esa carpeta ya existe y no está vacía. Elige otro destino y pulsa Reintentar.'],
    [/no puede estar dentro de la carpeta de análisis/i, 'El destino no puede estar dentro de la carpeta de análisis. Elige otra carpeta.'],
    [/ficha|artefactos elegidos no tienen datos|EMPTY_ANALYSIS|NEED_ANALYSIS/i, 'El análisis no ha dado datos suficientes para copiar la aplicación. Pulsa Reintentar o prueba con otro programa.'],
    [/tiempo agotado|timed.?out/i, 'El análisis ha tardado demasiado y se ha detenido. Pulsa Reintentar.'],
    [/no está java|hace falta java/i, 'Falta Java, necesario para Ghidra o JADX. En el instalador de Windows va incluido. Pulsa Reintentar cuando esté listo.'],
    [/EACCES|permission denied/i, 'No he podido escribir en la carpeta de destino. Elige otra o revisa los permisos.'],
    [/ENOENT|no such file/i, 'No encuentro el archivo o la carpeta. ¿Sigue en el mismo sitio?'],
    [/Ollama está en marcha/i, text],
  ]
  for (const [re, phrase] of rules) {
    if (re.test(text)) return phrase.startsWith('No ') || phrase.startsWith('Se ') || phrase.startsWith('Esa ') || phrase.startsWith('El ') || phrase.startsWith('Hace ') || phrase.startsWith('Falta ') || phrase.startsWith('El análisis') ? phrase : phrase
  }
  if (text && !/Error:|at |TypeError|E[A-Z]{3,}/.test(text) && text.length <= 240) return text
  return 'No he podido completar la copia. Pulsa Reintentar. Si vuelve a ocurrir, mira Ver detalles.'
}
