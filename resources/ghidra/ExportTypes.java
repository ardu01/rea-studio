// Original REA Studio script. Ghidra compiles it inside analyzeHeadless.
// It writes the structures, unions and enums that the analysis found or
// imported (no built-in types) as JSON. It does not execute the program.

import ghidra.app.script.GhidraScript;
import ghidra.program.model.data.BuiltInDataType;
import ghidra.program.model.data.Composite;
import ghidra.program.model.data.DataType;
import ghidra.program.model.data.DataTypeComponent;
import ghidra.program.model.data.Enum;
import ghidra.program.model.data.Union;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;

public class ExportTypes extends GhidraScript {
    private static final int MAX_TYPES = 400;
    private static final int MAX_FIELDS = 64;

    @Override
    public void run() throws Exception {
        if (currentProgram == null) {
            println("REA Studio: no hay un programa abierto.");
            return;
        }
        if (getScriptArgs().length < 1) {
            println("REA Studio: falta la ruta de los tipos.");
            return;
        }
        StringBuilder sb = new StringBuilder();
        sb.append("{\n  \"types\": [\n");
        Iterator<DataType> it = currentProgram.getDataTypeManager().getAllDataTypes();
        int shown = 0;
        int total = 0;
        boolean first = true;
        while (it.hasNext()) {
            DataType type = it.next();
            if (type instanceof BuiltInDataType) continue;
            if (!(type instanceof Composite) && !(type instanceof Enum)) continue;
            total++;
            if (shown >= MAX_TYPES) continue;
            if (!first) sb.append(",\n");
            first = false;
            shown++;
            sb.append("    {\"name\": ").append(json(type.getName()));
            sb.append(", \"category\": ").append(json(type.getCategoryPath().getPath()));
            sb.append(", \"size\": ").append(type.getLength());
            if (type instanceof Enum) {
                Enum e = (Enum) type;
                sb.append(", \"kind\": \"enum\", \"values\": [");
                String[] names = e.getNames();
                for (int i = 0; i < names.length && i < MAX_FIELDS; i++) {
                    if (i > 0) sb.append(", ");
                    sb.append("{\"name\": ").append(json(names[i])).append(", \"value\": ").append(e.getValue(names[i])).append("}");
                }
                sb.append("], \"truncated\": ").append(names.length > MAX_FIELDS);
            } else {
                Composite c = (Composite) type;
                sb.append(", \"kind\": ").append(json(type instanceof Union ? "union" : "struct"));
                sb.append(", \"fields\": [");
                DataTypeComponent[] fields = c.getDefinedComponents();
                for (int i = 0; i < fields.length && i < MAX_FIELDS; i++) {
                    DataTypeComponent f = fields[i];
                    if (i > 0) sb.append(", ");
                    String name = f.getFieldName() != null ? f.getFieldName() : f.getDefaultFieldName();
                    sb.append("{\"name\": ").append(json(name));
                    sb.append(", \"type\": ").append(json(f.getDataType().getDisplayName()));
                    sb.append(", \"offset\": ").append(f.getOffset());
                    sb.append(", \"size\": ").append(f.getLength()).append("}");
                }
                sb.append("], \"truncated\": ").append(fields.length > MAX_FIELDS);
            }
            sb.append("}");
        }
        sb.append("\n  ],\n");
        sb.append("  \"total\": ").append(total).append(",\n");
        sb.append("  \"truncated\": ").append(total > MAX_TYPES).append("\n}\n");
        Path output = Path.of(getScriptArgs()[0]);
        Files.writeString(output, sb.toString(), StandardCharsets.UTF_8);
        println("REA Studio: tipos en " + output);
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
