#!/usr/bin/env python3
"""Comprueba un ZIP de REA Studio para macOS Intel: integridad, Mach-O x86_64 y mínimo del sistema."""

from __future__ import annotations

import hashlib
import os
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

FAT_MAGIC = 0xCAFEBABE
FAT_CIGAM = 0xBEBAFECA
FAT_MAGIC_64 = 0xCAFEBABF
FAT_CIGAM_64 = 0xBFBAFECA
MH_MAGIC = 0xFEEDFACE
MH_CIGAM = 0xCEFAEDFE
MH_MAGIC_64 = 0xFEEDFACF
MH_CIGAM_64 = 0xCFFAEDFE
CPU_TYPE_X86_64 = 0x01000007
CPU_TYPE_ARM64 = 0x0100000C
LC_SEGMENT = 0x1
LC_SEGMENT_64 = 0x19
LC_VERSION_MIN_MACOSX = 0x24
LC_BUILD_VERSION = 0x32
CPU_NAMES = {
    CPU_TYPE_X86_64: "x86_64",
    CPU_TYPE_ARM64: "arm64",
    7: "i386",
    12: "arm",
}


def u32(data: bytes, offset: int, big: bool) -> int:
    return struct.unpack_from(">I" if big else "<I", data, offset)[0]


def version_text(value: int) -> str:
    return f"{value >> 16}.{(value >> 8) & 0xFF}.{value & 0xFF}"


def cpu_name(cputype: int) -> str:
    return CPU_NAMES.get(cputype, f"cpu_{cputype:#x}")


def load_min_versions(data: bytes, offset: int, little: bool, header_size: int) -> list[str]:
    ncmds = u32(data, offset + 16, not little)
    sizeofcmds = u32(data, offset + 20, not little)
    cursor = offset + header_size
    end = cursor + sizeofcmds
    found: list[str] = []
    while cursor + 8 <= end and cursor + 8 <= len(data):
        cmd = u32(data, cursor, not little)
        cmdsize = u32(data, cursor + 4, not little)
        if cmdsize < 8 or cursor + cmdsize > len(data):
            break
        if cmd == LC_VERSION_MIN_MACOSX and cmdsize >= 16:
            found.append(f"LC_VERSION_MIN_MACOSX {version_text(u32(data, cursor + 8, not little))}")
        elif cmd == LC_BUILD_VERSION and cmdsize >= 24:
            platform = u32(data, cursor + 8, not little)
            minos = version_text(u32(data, cursor + 12, not little))
            found.append(f"LC_BUILD_VERSION platform={platform} minos={minos}")
        cursor += cmdsize
    return found


def parse_macho(data: bytes) -> dict | None:
    if len(data) < 8:
        return None
    magic_le = u32(data, 0, False)
    magic_be = u32(data, 0, True)
    if magic_be in (FAT_MAGIC, FAT_CIGAM, FAT_MAGIC_64, FAT_CIGAM_64):
        big = magic_be in (FAT_MAGIC, FAT_MAGIC_64)
        count = u32(data, 4, big)
        slices = []
        arch_size = 32 if magic_be in (FAT_MAGIC_64, FAT_CIGAM_64) else 20
        for index in range(count):
            base = 8 + index * arch_size
            if base + 8 > len(data):
                break
            cputype = u32(data, base, big)
            offset = u32(data, base + 8, big) if arch_size == 20 else struct.unpack_from(">Q" if big else "<Q", data, base + 8)[0]
            slices.append({"cpu": cpu_name(cputype), "cputype": cputype, "offset": offset})
        mins: list[str] = []
        for sl in slices:
            off = int(sl["offset"])
            if off + 32 > len(data):
                continue
            magic = u32(data, off, False)
            little = magic in (MH_MAGIC, MH_MAGIC_64)
            is_64 = magic in (MH_MAGIC_64, MH_CIGAM_64)
            mins.extend(load_min_versions(data, off, little, 32 if is_64 else 28))
        return {"fat": True, "slices": slices, "mins": mins}
    if magic_le not in (MH_MAGIC, MH_CIGAM, MH_MAGIC_64, MH_CIGAM_64):
        return None
    little = magic_le in (MH_MAGIC, MH_MAGIC_64)
    is_64 = magic_le in (MH_MAGIC_64, MH_CIGAM_64)
    cputype = u32(data, 4, not little)
    header = 32 if is_64 else 28
    return {
        "fat": False,
        "slices": [{"cpu": cpu_name(cputype), "cputype": cputype, "offset": 0}],
        "mins": load_min_versions(data, 0, little, header),
        "bits": 64 if is_64 else 32,
    }


def major_of(text: str) -> int | None:
    token = text.strip().split()[-1]
    head = token.split(".", 1)[0]
    return int(head) if head.isdigit() else None


def main() -> int:
    if len(sys.argv) != 2:
        print("uso: verify-mac-zip.py <archivo.zip>", file=sys.stderr)
        return 2
    zip_path = Path(sys.argv[1]).resolve()
    if not zip_path.is_file():
        print(f"no existe {zip_path}", file=sys.stderr)
        return 1
    errors: list[str] = []
    notes: list[str] = []
    test = subprocess.run(["unzip", "-t", str(zip_path)], capture_output=True, text=True)
    notes.append(f"unzip_t_exit: {test.returncode}")
    if test.returncode != 0:
        errors.append("unzip -t falló")
        tail = (test.stderr or test.stdout).strip().splitlines()[-5:]
        notes.extend(tail)
    with zipfile.ZipFile(zip_path) as archive:
        names = archive.namelist()
        for name in names:
            lower = name.lower()
            if "arm64" in lower or "aarch64" in lower or "universal" in lower:
                errors.append(f"ruta no permitida en el ZIP: {name}")
    if zip_path.stat().st_size < 40 * 1024 * 1024:
        errors.append(f"el ZIP es demasiado pequeño ({zip_path.stat().st_size} bytes)")
    with tempfile.TemporaryDirectory(prefix="rea-mac-") as tmp:
        root = Path(tmp)
        extract = subprocess.run(["unzip", "-q", str(zip_path), "-d", str(root)], capture_output=True, text=True)
        if extract.returncode != 0:
            errors.append("no se pudo descomprimir el ZIP")
            notes.append((extract.stderr or extract.stdout).strip())
        apps = list(root.rglob("REA Studio.app"))
        app = next((path for path in apps if (path / "Contents" / "Info.plist").is_file()), None)
        if app is None:
            errors.append("no está REA Studio.app")
            plist = {}
        else:
            plist = plistlib.loads((app / "Contents" / "Info.plist").read_bytes())
        lsmin = str(plist.get("LSMinimumSystemVersion", ""))
        notes.append(f"LSMinimumSystemVersion: {lsmin or 'ausente'}")
        if not lsmin:
            errors.append("falta LSMinimumSystemVersion")
        else:
            major = major_of(lsmin)
            if major is not None and major > 15:
                errors.append(f"LSMinimumSystemVersion {lsmin} pide un macOS más nuevo que Sequoia 15")
            if major is not None and major < 13:
                errors.append(f"LSMinimumSystemVersion {lsmin} es anterior al mínimo real de Electron 45 (macOS 13)")
        machos: list[tuple[Path, dict]] = []
        seen: set[tuple[int, int]] = set()
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            key = (stat.st_dev, stat.st_ino)
            if key in seen:
                continue
            try:
                with path.open("rb") as handle:
                    data = handle.read(1024 * 1024)
            except OSError as exc:
                errors.append(f"no se pudo leer {path}: {exc}")
                continue
            parsed = parse_macho(data)
            if parsed is None:
                continue
            seen.add(key)
            machos.append((path, parsed))
        if not machos:
            errors.append("no hay ejecutables Mach-O")
        main_exe = None
        if app is not None:
            main_exe = app / "Contents" / "MacOS" / "REA Studio"
        main_info = None
        for path, parsed in machos:
            rel = path.relative_to(root).as_posix()
            cpus = [sl["cpu"] for sl in parsed["slices"]]
            file_out = subprocess.run(["file", "-b", str(path)], capture_output=True, text=True).stdout.strip()
            notes.append(f"macho: {rel} | {', '.join(cpus)} | {'; '.join(parsed['mins']) or 'sin minos'} | {file_out}")
            if parsed["fat"] or len(parsed["slices"]) != 1 or parsed["slices"][0]["cputype"] != CPU_TYPE_X86_64:
                errors.append(f"{rel} no es un Mach-O delgado x86_64 ({cpus})")
            if "arm64" in file_out.lower() or "universal" in file_out.lower():
                errors.append(f"file informa arm64 o universal en {rel}: {file_out}")
            if main_exe is not None and path.resolve() == main_exe.resolve():
                main_info = (parsed, file_out)
            for item in parsed["mins"]:
                if "minos=" in item:
                    major = major_of(item.split("minos=", 1)[1])
                    if major is not None and major > 15:
                        errors.append(f"{rel} exige macOS {item}")
        if main_exe is None or not main_exe.is_file():
            errors.append("falta el ejecutable Contents/MacOS/REA Studio")
        elif main_info is None:
            errors.append("el ejecutable principal no es Mach-O")
        else:
            parsed, file_out = main_info
            notes.append(f"main_file: {file_out}")
            notes.append("main_min: " + ("; ".join(parsed["mins"]) or "ausente"))
            if shutil.which("lipo"):
                lipo = subprocess.run(["lipo", "-info", str(main_exe)], capture_output=True, text=True)
                text = (lipo.stdout or lipo.stderr).strip()
                notes.append(f"lipo: {text}")
                if "arm64" in text or "x86_64" not in text:
                    errors.append(f"lipo no confirma x86_64 exclusivo: {text}")
            else:
                notes.append("lipo: no disponible en este sistema")
    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    out_dir = zip_path.parent
    dmgs = sorted(out_dir.glob("REA-Studio-*-mac-x64.dmg"))
    sums = [f"{digest}  {zip_path.name}"]
    for dmg in dmgs:
        dmg_digest = hashlib.sha256(dmg.read_bytes()).hexdigest()
        sums.append(f"{dmg_digest}  {dmg.name}")
    notes.append(f"sha256: {digest}")
    notes.append(f"bytes: {zip_path.stat().st_size}")
    notes.append("signing: identity null, notarize false, sin Developer ID")
    notes.append(f"dmg: {dmgs[0].name if dmgs else 'no generado'}")
    notes.append("launch_2019_macbook: no comprobado; este entorno no es ese equipo")
    (out_dir / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="ascii")
    min_line = next((line for line in notes if line.startswith("main_min:")), "main_min: ausente")
    ls_line = next((line for line in notes if line.startswith("LSMinimumSystemVersion:")), "LSMinimumSystemVersion: ausente")
    dmg_line = "No hay DMG en esta publicación." if not dmgs else f"También se adjunta `{dmgs[0].name}`."
    notas = f"""# REA Studio 0.1.0 para macOS Intel (vista previa)

Paquete ZIP x86_64 sin firmar y sin notarizar. No incluye arm64 ni binario universal. {dmg_line}

El instalador de Windows no se sustituye. Sigue en la publicación [v0.1.0](https://github.com/ardu01/rea-studio/releases/tag/v0.1.0): `REA-Studio-0.1.0-win-x64.exe`.

SHA-256 de `{zip_path.name}`:

`{digest}`

`SHA256SUMS` repite esa huella. `MAC-VALIDATION.txt` recoge `unzip -t`, el tipo Mach-O y el mínimo del sistema. {ls_line}. {min_line}. Esta build no se abrió en un MacBook Pro de 2019.

## Cómo comprobar el archivo

```bash
shasum -a 256 {zip_path.name}
cat SHA256SUMS
```

## Instalación

1. Descomprimir el ZIP.
2. Mover `REA Studio.app` a Aplicaciones.
3. Abrir REA Studio.

## Si Gatekeeper bloquea la aplicación

La aplicación no está firmada ni notarizada.

1. Clic secundario sobre REA Studio y elegir Abrir.
2. Ajustes del Sistema → Privacidad y seguridad → Abrir de todas formas.
3. Si sigue bloqueada:

```bash
xattr -dr com.apple.quarantine "/Applications/REA Studio.app"
```
"""
    (out_dir / "NOTAS-MACOS.md").write_text(notas, encoding="utf-8")
    validation = [
        "paquete: REA Studio macOS Intel x86_64",
        "comando: electron-builder --mac --x64",
        *notes,
        f"errores: {len(errors)}",
    ]
    if errors:
        validation.extend(f"error: {item}" for item in errors)
    (out_dir / "MAC-VALIDATION.txt").write_text("\n".join(validation) + "\n", encoding="utf-8")
    print("\n".join(validation))
    if errors:
        print("COMPROBACIÓN FALLIDA", file=sys.stderr)
        return 1
    print("COMPROBACIÓN CORRECTA")
    return 0


if __name__ == "__main__":
    sys.exit(main())
