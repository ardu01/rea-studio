// Original REA Studio script. Ghidra compiles it inside analyzeHeadless.
// It writes a short static summary and does not execute the imported program.

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public class ExportSummary extends GhidraScript {
    @Override
    public void run() throws Exception {
        if (currentProgram == null) {
            println("REA Studio: no hay un programa abierto.");
            return;
        }
        if (getScriptArgs().length < 1) {
            println("REA Studio: falta la ruta del resumen.");
            return;
        }
        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        field(sb, "name", currentProgram.getName(), true);
        field(sb, "language", String.valueOf(currentProgram.getLanguage()), true);
        field(sb, "compiler", String.valueOf(currentProgram.getCompilerSpec()), true);
        field(sb, "imageBase", currentProgram.getImageBase().toString(), true);
        field(sb, "format", String.valueOf(currentProgram.getExecutableFormat()), true);
        int count = currentProgram.getFunctionManager().getFunctionCount();
        sb.append("  \"functionCount\": ").append(count).append(",\n");
        sb.append("  \"functions\": [\n");
        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        int shown = 0;
        boolean first = true;
        while (it.hasNext() && shown < 200) {
            Function fn = it.next();
            if (!first) sb.append(",\n");
            first = false;
            sb.append("    {\"name\": ").append(json(fn.getName()));
            sb.append(", \"entry\": ").append(json(fn.getEntryPoint().toString()));
            sb.append("}");
            shown++;
        }
        sb.append("\n  ],\n");
        sb.append("  \"truncated\": ").append(count > 200).append("\n");
        sb.append("}\n");
        Path output = Path.of(getScriptArgs()[0]);
        Files.writeString(output, sb.toString(), StandardCharsets.UTF_8);
        println("REA Studio: resumen en " + output);
    }

    private static void field(StringBuilder sb, String key, String value, boolean comma) {
        sb.append("  \"").append(key).append("\": ").append(json(value));
        if (comma) sb.append(",");
        sb.append("\n");
    }

    private static String json(String value) {
        if (value == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\\' || c == '"') sb.append('\\').append(c);
            else if (c == '\n') sb.append("\\n");
            else if (c == '\r') sb.append("\\r");
            else if (c < 0x20) sb.append(' ');
            else sb.append(c);
        }
        sb.append('"');
        return sb.toString();
    }
}
