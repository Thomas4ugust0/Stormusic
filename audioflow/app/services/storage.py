"""Armazenamento por ID aleatório + nomes de download sanitizados."""
import os
import re
import shutil
import unicodedata
from pathlib import Path

from app.core.config import Settings

_BAD = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]')


def sanitize_filename(name: str | None, ext: str, max_bytes: int = 120) -> str:
    base = unicodedata.normalize("NFC", name or "audio")
    base = _BAD.sub("_", base)
    base = "".join(c for c in base if unicodedata.category(c)[0] != "C")
    base = re.sub(r"\.{2,}", ".", base).strip(" ._") or "audio"
    suffix = f".{ext}"
    budget = max_bytes - len(suffix.encode())
    enc = base.encode()[:budget]
    base = enc.decode("utf-8", errors="ignore").rstrip(" ._") or "audio"
    return base + suffix


def ascii_fallback(name: str) -> str:
    a = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    a = re.sub(r"[^A-Za-z0-9._ -]", "_", a).strip(" ._")
    return a or "audio"


def job_tmp_dir(settings: Settings, job_id: str) -> Path:
    p = Path(settings.tmp_dir) / job_id
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    return p


def final_path(settings: Settings, job_id: str, ext: str) -> Path:
    d = Path(settings.storage_dir) / job_id[4:6]
    d.mkdir(parents=True, exist_ok=True, mode=0o750)
    return d / f"{job_id}.{ext}"


def store(src: Path, dst: Path) -> None:
    tmp = dst.with_suffix(dst.suffix + ".tmp")
    shutil.move(str(src), tmp)
    os.replace(tmp, dst)


def link_or_copy(src: Path, dst: Path) -> None:
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def remove_file(path: str | None) -> None:
    if path:
        Path(path).unlink(missing_ok=True)


def remove_tree(p: Path) -> None:
    shutil.rmtree(p, ignore_errors=True)


def cleanup_orphans(settings: Settings, active_ids: set[str]) -> int:
    root = Path(settings.tmp_dir)
    if not root.exists():
        return 0
    n = 0
    for d in root.iterdir():
        if d.is_dir() and d.name not in active_ids:
            remove_tree(d)
            n += 1
    return n


def free_disk_mb(path: str) -> float:
    p = Path(path)
    while not p.exists() and p != p.parent:
        p = p.parent
    return shutil.disk_usage(p).free / 1024 / 1024
