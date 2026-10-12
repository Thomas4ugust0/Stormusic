"""/search e /related: app FastAPI real, YtDlpSource real, apenas o yt_dlp.YoutubeDL é falso (sem rede)."""
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import extractor
from app.services.extractor import YtDlpSource

TOPIC = {"id": "fJ9rUzIMcZQ", "title": "Bohemian Rhapsody", "channel": "Queen - Topic", "duration": 355}
VEVO = {"id": "0J2QdDbelmY", "title": "Seven Nation Army", "channel": "TheWhiteStripesVEVO", "duration": 231}
VLOG = {"id": "abcdefghijk", "title": "meu vlog", "channel": "Fulano"}
SONG = {"id": "bpOSxM0rNPM", "title": "Do I Wanna Know?", "artists": ["Arctic Monkeys"], "album": "AM",
        "duration": 272.0}
PLAYLIST = {"id": "PLxxxxxxxxxxxxxxxx", "title": "uma playlist"}


class FakeYDL:
    """Responde por URL: `responses[prefixo] = lista de entries` ou uma Exception."""

    responses: dict[str, Any] = {}
    calls: list[str] = []

    def __init__(self, opts: dict[str, Any]) -> None:
        self.opts = opts

    def __enter__(self) -> "FakeYDL":
        return self

    def __exit__(self, *a: object) -> None:
        return None

    def extract_info(self, url: str, download: bool = False) -> dict[str, Any]:
        FakeYDL.calls.append(url)
        for prefix, r in FakeYDL.responses.items():
            if url.startswith(prefix):
                if isinstance(r, Exception):
                    raise r
                return {"entries": r}
        raise AssertionError(f"URL inesperada: {url}")


@pytest.fixture
def ydl(monkeypatch: pytest.MonkeyPatch) -> type[FakeYDL]:
    FakeYDL.responses, FakeYDL.calls = {}, []
    monkeypatch.setattr(extractor.yt_dlp, "YoutubeDL", FakeYDL)
    return FakeYDL


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_methods_live_on_concrete_source() -> None:
    # Regressão: search_music foi parar no Protocol AudioSource em vez de YtDlpSource.
    for name in ("search_music", "related_music", "_music_entries"):
        assert name in vars(YtDlpSource), name


def test_search_music_tab(client: TestClient, ydl: type[FakeYDL]) -> None:
    ydl.responses = {"https://music.youtube.com/search": [SONG, PLAYLIST, SONG]}
    r = client.get("/api/v1/audio/search", params={"q": "arctic  monkeys"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["query"] == "arctic monkeys"
    assert body["results"] == [{"id": "bpOSxM0rNPM", "title": "Do I Wanna Know?", "artist": "Arctic Monkeys",
                                "album": "AM", "duration": 272.0}]
    assert ydl.calls[0].endswith("q=arctic+monkeys#songs")


def test_search_fallback_keeps_only_official_music(client: TestClient, ydl: type[FakeYDL]) -> None:
    ydl.responses = {"https://music.youtube.com/": RuntimeError("HTTP Error 400"), "ytsearch": [VLOG, TOPIC, VEVO]}
    r = client.get("/api/v1/audio/search", params={"q": "rock"})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert [x["id"] for x in res] == [TOPIC["id"], VEVO["id"]]
    assert res[0]["artist"] == "Queen" and res[1]["artist"] == "TheWhiteStripes"


def test_search_cached(client: TestClient, ydl: type[FakeYDL]) -> None:
    ydl.responses = {"https://music.youtube.com/search": [SONG]}
    client.get("/api/v1/audio/search", params={"q": "am"})
    client.get("/api/v1/audio/search", params={"q": "AM"})
    assert len(ydl.calls) == 1


def test_search_reports_real_error(client: TestClient, ydl: type[FakeYDL]) -> None:
    ydl.responses = {"https://music.youtube.com/": RuntimeError("Sign in to confirm"), "ytsearch": RuntimeError("boom")}
    r = client.get("/api/v1/audio/search", params={"q": "x"})
    assert r.status_code == 503
    err = r.json()["error"]
    assert err["code"] == "search_failed" and "Sign in to confirm" in err["message"] and "boom" in err["message"]


def test_search_validation(client: TestClient, ydl: type[FakeYDL]) -> None:
    assert client.get("/api/v1/audio/search").status_code == 422
    assert client.get("/api/v1/audio/search", params={"q": "x", "limit": 99}).status_code == 422


def test_related_radio_excludes_seed(client: TestClient, ydl: type[FakeYDL]) -> None:
    seed = SONG["id"]
    ydl.responses = {"https://music.youtube.com/watch": [SONG, TOPIC, VEVO]}
    r = client.get("/api/v1/audio/related", params={"id": seed})
    assert r.status_code == 200, r.text
    assert [x["id"] for x in r.json()["results"]] == [TOPIC["id"], VEVO["id"]]
    assert f"list=RDAMVM{seed}" in ydl.calls[0]


def test_related_fallback_official_only(client: TestClient, ydl: type[FakeYDL]) -> None:
    ydl.responses = {"https://music.youtube.com/": RuntimeError("x"), "https://www.youtube.com/watch": [VLOG, TOPIC]}
    r = client.get("/api/v1/audio/related", params={"id": SONG["id"]})
    assert [x["id"] for x in r.json()["results"]] == [TOPIC["id"]]


def test_related_rejects_bad_id(client: TestClient, ydl: type[FakeYDL]) -> None:
    assert client.get("/api/v1/audio/related", params={"id": "../../etc"}).status_code == 422
