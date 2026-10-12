import pytest

from app.core.config import get_settings
from app.core.errors import JobError
from app.services.url_validator import validate_youtube_url

ID = "dQw4w9WgXcQ"
CANON = f"https://www.youtube.com/watch?v={ID}"


def v(url: str):  # type: ignore[no-untyped-def]
    return validate_youtube_url(url, get_settings().allowed_hosts)


@pytest.mark.parametrize("url", [
    f"https://www.youtube.com/watch?v={ID}",
    f"https://youtube.com/watch?v={ID}&t=10",
    f"https://m.youtube.com/watch?v={ID}",
    f"https://music.youtube.com/watch?v={ID}&list=RDAMVM{ID}",
    f"https://youtu.be/{ID}",
    f"https://youtu.be/{ID}?si=abc",
    f"https://www.youtube.com/shorts/{ID}",
    f"https://www.youtube.com/embed/{ID}",
    f"https://www.youtube-nocookie.com/embed/{ID}",
    f"https://www.youtube.com/live/{ID}",
    f"https://www.youtube.com:443/watch?v={ID}",
    f"https://WWW.YOUTUBE.COM/watch?v={ID}",
    f"https://www.youtube.com/watch?v={ID}&list=PL1234567890",
])
def test_valid_urls_canonicalize(url: str) -> None:
    c = v(url)
    assert c.video_id == ID and c.url == CANON


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/watch?v=dQw4w9WgXcQ",
    f"http://www.youtube.com/watch?v={ID}",
    f"file:///etc/passwd?v={ID}",
    f"ftp://youtube.com/watch?v={ID}",
    f"gopher://youtube.com/watch?v={ID}",
    f"https://youtube.com.evil.com/watch?v={ID}",
    f"https://evil.com/youtube.com/watch?v={ID}",
    f"https://evilyoutube.com/watch?v={ID}",
    f"https://user:pass@www.youtube.com/watch?v={ID}",
    f"https://www.youtube.com@evil.com/watch?v={ID}",
    f"https://www.youtube.com:8080/watch?v={ID}",
    f"https://142.250.1.1/watch?v={ID}",
    f"https://[::1]/watch?v={ID}",
    f"https://xn--yutube-wqa.com/watch?v={ID}",
    f"https://yоutube.com/watch?v={ID}",  # 'о' cirílico
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=aaaaaaaaaaa",
    "https://www.youtube.com/watch",
    "https://youtu.be/",
    "https://www.youtube.com/watch?v=dQw4w9WgXc!",
    "https://www.youtube.com/watch?v=" + "a" * 2050,
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ\n",
    "https://www.you tube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com\\@evil.com/watch?v=dQw4w9WgXcQ",
    "not a url",
    "",
    "https://www.youtube.com:abc/watch?v=dQw4w9WgXcQ",
])
def test_invalid_urls(url: str) -> None:
    with pytest.raises(JobError) as e:
        v(url)
    assert e.value.code == "invalid_url"


@pytest.mark.parametrize("url", [
    "https://www.youtube.com/playlist?list=PL1234567890",
    "https://www.youtube.com/channel/UC123",
    "https://www.youtube.com/@someone",
    "https://www.youtube.com/results?search_query=x",
    "https://www.youtube.com/c/foo",
])
def test_unsupported_sources(url: str) -> None:
    with pytest.raises(JobError) as e:
        v(url)
    assert e.value.code == "unsupported_source"
