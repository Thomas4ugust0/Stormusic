"""Entrega de arquivos por streaming com suporte a Range."""
import re
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import quote

from fastapi.responses import Response, StreamingResponse

from app.core.errors import APIError
from app.services.converter import MIME
from app.services.storage import ascii_fallback

CHUNK = 256 * 1024
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


def content_disposition(name: str) -> str:
    return f"attachment; filename=\"{ascii_fallback(name)}\"; filename*=UTF-8''{quote(name, safe='')}"


def _iter(path: Path, start: int, length: int) -> Iterator[bytes]:
    with path.open("rb") as f:
        f.seek(start)
        left = length
        while left > 0:
            chunk = f.read(min(CHUNK, left))
            if not chunk:
                break
            left -= len(chunk)
            yield chunk


def stream_file(path: Path, ext: str, name: str, range_header: str | None) -> Response:
    size = path.stat().st_size
    headers = {"Accept-Ranges": "bytes", "Content-Disposition": content_disposition(name),
               "Cache-Control": "private, no-store"}
    media = MIME.get(ext, "application/octet-stream")
    if range_header:
        m = _RANGE.match(range_header.strip())
        if not m or (not m.group(1) and not m.group(2)):
            raise APIError(416, "range_not_satisfiable", "Cabeçalho Range inválido.",
                           headers={"Content-Range": f"bytes */{size}"})
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        else:
            start, end = max(0, size - int(m.group(2))), size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            raise APIError(416, "range_not_satisfiable", "Intervalo fora do arquivo.",
                           headers={"Content-Range": f"bytes */{size}"})
        length = end - start + 1
        headers |= {"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(length)}
        return StreamingResponse(_iter(path, start, length), status_code=206, media_type=media, headers=headers)
    headers["Content-Length"] = str(size)
    return StreamingResponse(_iter(path, 0, size), media_type=media, headers=headers)
