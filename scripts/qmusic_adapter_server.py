"""Local QQ music adapter with QR login and library endpoints.

This service exposes:
- GET /health
- GET /connect/qr/key
- GET /connect/qr/create?key=...&qrimg=true
- GET /connect/qr/check?key=...
- GET /connect/status
- GET /playlist/user
- GET /playlist/detail
- GET /song/url?mid=... (or /song/url?id=...)
- GET /song/lyric?mid=... (or /song/lyric?id=...)
- GET /recommend/daily
- GET /search/songs

It wraps qqmusic-api-python so frontend can keep a stable HTTP contract.
"""

from __future__ import annotations

import asyncio
import base64
import gzip
import json
import re
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any
from urllib.request import Request as UrlRequest, urlopen

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    import httpx
except Exception:  # pragma: no cover - optional dependency fallback
    httpx = None

from qqmusic_api import Credential
from qqmusic_api.login import QR, QRCodeLoginEvents, QRLoginType, check_qrcode, get_qrcode

try:
    from qqmusic_api.search import SearchType, search_by_type
except Exception:  # pragma: no cover - compatibility fallback
    SearchType = None
    search_by_type = None

try:
    from qqmusic_api.song import SongFileType, get_detail as get_song_detail, get_song_urls
except Exception:  # pragma: no cover - compatibility fallback
    SongFileType = None
    get_song_detail = None
    get_song_urls = None

try:
    from qqmusic_api.lyric import get_lyric
except Exception:  # pragma: no cover - compatibility fallback
    get_lyric = None

try:
    from qqmusic_api.songlist import add_songs, del_songs, get_detail
except Exception:  # pragma: no cover - compatibility fallback
    add_songs = None
    del_songs = None
    get_detail = None

try:
    from qqmusic_api.user import get_created_songlist, get_homepage
except Exception:  # pragma: no cover - compatibility fallback
    get_created_songlist = None
    get_homepage = None

try:
    from qqmusic_api.exceptions import ResponseCodeError
except Exception:  # pragma: no cover - compatibility fallback
    ResponseCodeError = None


def _disable_upstream_cache(*apis: Any) -> None:
    """Disable qqmusic-api-python in-memory cache for real-time sync paths."""
    for api in apis:
        if api is None:
            continue

        # ApiRequest object from qqmusic-api-python exposes these fields.
        if hasattr(api, 'cacheable'):
            setattr(api, 'cacheable', False)
        if hasattr(api, 'cache_ttl'):
            setattr(api, 'cache_ttl', 0)


_disable_upstream_cache(get_detail, get_created_songlist, get_homepage)


app = FastAPI(title="QQMusic Local Adapter", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['*'],
    allow_headers=['*'],
)


@dataclass
class QRCacheItem:
    identifier: str
    qr_type: QRLoginType
    mimetype: str
    payload_b64: str
    created_at: float


QR_TTL_SECONDS = 180
_QR_CACHE: dict[str, QRCacheItem] = {}
_QR_LOCK = Lock()
QQ_LIKED_VERIFY_DELAYS = (0.0, 0.35, 0.8, 1.4, 2.2)
QQ_LIKED_VERIFY_PAGE_SIZE = 200
QQ_LIKED_VERIFY_MAX_PAGES = 8

# Performance optimization caches
DAILY_PLAYLIST_CACHE_TTL_SECONDS = 600
SONG_MID_CACHE_TTL_SECONDS = 6 * 60 * 60
_DAILY_PLAYLIST_CACHE: dict[str, tuple[str, str, float]] = {}
_SONG_MID_CACHE: dict[int, tuple[str, float]] = {}
_HTTPX_CLIENT: httpx.AsyncClient | None = None
_CACHE_LOCK = Lock()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _success(data: Any) -> dict[str, Any]:
    return {
        "code": 0,
        "message": "Success",
        "data": data,
        "timestamp": _now_ms(),
    }


def _error(code: int, message: str, status_code: int = 400, data: Any = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "code": code,
            "message": message,
            "data": data,
            "timestamp": _now_ms(),
        },
    )


def _cleanup_expired_qr() -> None:
    deadline = time.time() - QR_TTL_SECONDS
    with _QR_LOCK:
        expired_keys = [k for k, item in _QR_CACHE.items() if item.created_at < deadline]
        for key in expired_keys:
            _QR_CACHE.pop(key, None)


def _cleanup_expired_local_cache() -> None:
    now = time.time()
    with _CACHE_LOCK:
        expired_daily = [k for k, (_, _, expires_at) in _DAILY_PLAYLIST_CACHE.items() if expires_at <= now]
        for key in expired_daily:
            _DAILY_PLAYLIST_CACHE.pop(key, None)
        expired_mid = [k for k, (_, expires_at) in _SONG_MID_CACHE.items() if expires_at <= now]
        for song_id in expired_mid:
            _SONG_MID_CACHE.pop(song_id, None)


def _parse_json_payload(raw_payload: str) -> dict[str, Any] | None:
    payload = raw_payload.strip()
    if not payload or not payload.startswith('{'):
        return None

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None

    return data if isinstance(data, dict) else None


def _extract_digits(value: Any) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    matched = re.search(r"(\d+)", text)
    return matched.group(1) if matched else None


def _extract_uin(raw_cookie: str) -> str | None:
    if not raw_cookie:
        return None

    match = re.search(r"(?:^|;\s*)(?:uin|p_uin|qqmusic_uin)=o?(\d+)", raw_cookie, re.IGNORECASE)
    if match:
        return match.group(1)

    payload = _parse_json_payload(raw_cookie)
    if isinstance(payload, dict):
        for key in ('musicid', 'str_musicid', 'uin', 'p_uin', 'qqmusic_uin', 'encrypt_uin', 'encryptUin'):
            resolved = _extract_digits(payload.get(key))
            if resolved:
                return resolved

    return None


def _parse_cookie_header(raw_cookie: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for part in raw_cookie.split(';'):
        segment = part.strip()
        if not segment or '=' not in segment:
            continue
        key, value = segment.split('=', 1)
        parsed[key.strip()] = value.strip()
    return parsed


def _cache_owner_key(raw_cookie: str, credential: Credential | None) -> str:
    """Generate cache key from cookie/credential."""
    owner = ''
    if credential:
        owner = str(getattr(credential, 'str_musicid', '') or getattr(credential, 'musicid', ''))
    if not owner:
        owner = _extract_uin(raw_cookie) or 'anonymous'
    return owner


def _read_daily_playlist_cache(owner_key: str) -> tuple[str, str] | None:
    """Read cached daily playlist (playlist_id, title)."""
    _cleanup_expired_local_cache()
    with _CACHE_LOCK:
        cached = _DAILY_PLAYLIST_CACHE.get(owner_key)
    if cached is None:
        return None
    playlist_id, title, _ = cached
    return playlist_id, title


def _write_daily_playlist_cache(owner_key: str, playlist_id: str, title: str) -> None:
    """Write daily playlist to cache."""
    expires_at = time.time() + DAILY_PLAYLIST_CACHE_TTL_SECONDS
    with _CACHE_LOCK:
        _DAILY_PLAYLIST_CACHE[owner_key] = (playlist_id, title, expires_at)


def _read_song_mid_cache(song_id: int) -> str:
    """Read cached song mid."""
    _cleanup_expired_local_cache()
    with _CACHE_LOCK:
        cached = _SONG_MID_CACHE.get(song_id)
    if cached is None:
        return ''
    mid, _ = cached
    return mid


def _write_song_mid_cache(song_id: int, song_mid: str) -> None:
    """Write song mid to cache."""
    if song_id <= 0 or not song_mid:
        return
    expires_at = time.time() + SONG_MID_CACHE_TTL_SECONDS
    with _CACHE_LOCK:
        _SONG_MID_CACHE[song_id] = (song_mid, expires_at)


def _get_httpx_client() -> httpx.AsyncClient:
    """Get or create shared httpx client."""
    global _HTTPX_CLIENT
    if httpx is None:
        raise RuntimeError('httpx is unavailable')
    with _CACHE_LOCK:
        if _HTTPX_CLIENT is None:
            _HTTPX_CLIENT = httpx.AsyncClient(follow_redirects=True, timeout=12)
        return _HTTPX_CLIENT


def _extract_raw_cookie(request: Request) -> str:
    raw_cookie = request.headers.get('cookie', '').strip()
    if raw_cookie:
        return raw_cookie

    authorization = request.headers.get('authorization', '').strip()
    if authorization.lower().startswith('bearer '):
        return authorization[7:].strip()

    token = request.headers.get('token', '').strip()
    if token.lower().startswith('bearer '):
        return token[7:].strip()
    return token


def _credential_from_payload(raw_cookie: str) -> Credential | None:
    payload = _parse_json_payload(raw_cookie)
    if isinstance(payload, dict):
        try:
            return Credential(
                openid=_pick_text(payload.get('openid')),
                refresh_token=_pick_text(payload.get('refresh_token')),
                access_token=_pick_text(payload.get('access_token')),
                expired_at=_to_int(payload.get('expired_at')),
                musicid=_to_int(payload.get('musicid') or payload.get('str_musicid')),
                musickey=_pick_text(payload.get('musickey'), payload.get('qqmusic_key')),
                unionid=_pick_text(payload.get('unionid')),
                str_musicid=_pick_text(payload.get('str_musicid')),
                refresh_key=_pick_text(payload.get('refresh_key')),
                encrypt_uin=_pick_text(payload.get('encrypt_uin'), payload.get('encryptUin')),
                login_type=_to_int(payload.get('login_type') or payload.get('loginType')),
            )
        except Exception:
            pass

    parsed_cookie = _parse_cookie_header(raw_cookie)
    if parsed_cookie:
        try:
            return Credential.from_cookies_dict(parsed_cookie)
        except Exception:
            pass

    try:
        return Credential.from_cookies_str(raw_cookie)
    except Exception:
        return None


def _build_qq_web_cookie_map(raw_cookie: str, credential: Credential | None) -> dict[str, str]:
    cookie_map = _parse_cookie_header(raw_cookie) if raw_cookie else {}

    music_id = ''
    music_key = ''
    if credential is not None:
        music_id = _pick_text(getattr(credential, 'str_musicid', ''), getattr(credential, 'musicid', ''))
        music_key = _pick_text(getattr(credential, 'musickey', ''), cookie_map.get('qqmusic_key'))

    if music_id:
        cookie_map.setdefault('uin', f'o{music_id}')
        cookie_map.setdefault('p_uin', f'o{music_id}')
        cookie_map.setdefault('qqmusic_uin', music_id)

    if music_key:
        cookie_map.setdefault('qqmusic_key', music_key)
        cookie_map.setdefault('qm_keyst', music_key)

    return {key: value for key, value in cookie_map.items() if _pick_text(value)}


async def _fetch_qq_mac_homepage(raw_cookie: str, credential: Credential | None) -> str:
    cookie_map = _build_qq_web_cookie_map(raw_cookie, credential)
    cookie_header = '; '.join(f'{key}={value}' for key, value in cookie_map.items())

    headers = {
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/122.0.0.0 Safari/537.36'
        ),
        'Referer': 'https://y.qq.com/',
        'Accept-Encoding': 'identity',
        **({'Cookie': cookie_header} if cookie_header else {}),
    }

    if httpx is not None:
        client = _get_httpx_client()
        resp = await client.get(
            'https://c.y.qq.com/node/musicmac/v6/index.html',
            headers=headers,
        )
        resp.raise_for_status()
        return resp.text

    def _request() -> str:
        req = UrlRequest(
            url='https://c.y.qq.com/node/musicmac/v6/index.html',
            headers=headers,
            method='GET',
        )

        with urlopen(req, timeout=12) as resp:
            body = resp.read()
            encoding = str(resp.headers.get('Content-Encoding') or '').lower()
            if encoding == 'gzip':
                body = gzip.decompress(body)
            return body.decode('utf-8', errors='ignore')

    return await asyncio.to_thread(_request)


def _extract_personal_daily_playlist(html: str) -> tuple[str, str] | None:
    if not html:
        return None

    item_pattern = re.compile(
        r'data-rid=\\?"(?P<rid>\d+)\\?"[^>]*>\s*<img[^>]*alt=\\?"(?P<title>[^"\\]+)',
        re.IGNORECASE,
    )
    for matched in item_pattern.finditer(html):
        title = _pick_text(matched.group('title'))
        if '今日私享' not in title:
            continue

        playlist_id = _pick_text(matched.group('rid'))
        if playlist_id:
            return playlist_id, title

    return None


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_timestamp_ms(value: Any) -> int:
    raw = _to_int(value, default=0)
    if raw <= 0:
        return 0

    # Treat 10-digit values as seconds and 13-digit values as milliseconds.
    if raw < 10_000_000_000:
        return raw * 1000

    return raw


def _pick_text(*candidates: Any) -> str:
    for candidate in candidates:
        if isinstance(candidate, str):
            text = candidate.strip()
            if text:
                return text
        elif candidate is not None:
            text = str(candidate).strip()
            if text:
                return text
    return ''


def _is_known_songlist_result_error(exc: Exception) -> bool:
    message = str(exc).strip().lower()
    if not message:
        return False

    if message in {'result', "'result'", '"result"'}:
        return True

    if 'result' not in message:
        return False

    return 'keyerror' in message or 'missing key' in message


def _is_known_songlist_code_error(exc: Exception, code: int) -> bool:
    if ResponseCodeError is not None and isinstance(exc, ResponseCodeError):
        return getattr(exc, 'code', None) == code

    message = str(exc).strip().lower()
    return f'[{code}]' in message


def _normalize_playlist_type(raw: dict[str, Any], playlist_id: str, songlist_id: str, dirid: str) -> str:
    raw_type = _pick_text(raw.get('type')).lower()
    if raw_type == 'collected':
        return 'collected'

    # QQ liked list is stable on dirid/songlist id 201.
    if playlist_id == '201' or songlist_id == '201' or dirid == '201':
        return 'liked'

    # Safe fallback: only trust explicit upstream marker.
    if raw_type == 'liked':
        return 'liked'

    return 'created'


def _normalize_playlist(raw: dict[str, Any]) -> dict[str, Any]:
    creator_info = raw.get('creator') if isinstance(raw.get('creator'), dict) else {}
    dir_info = raw.get('dirinfo') if isinstance(raw.get('dirinfo'), dict) else {}

    playlist_id = _pick_text(
        raw.get('songlistId'),
        raw.get('songlist_id'),
        raw.get('tid'),
        raw.get('id'),
        raw.get('dirid'),
        raw.get('dirId'),
        raw.get('dissid'),
        raw.get('disstid'),
        dir_info.get('dirid'),
    )

    songlist_id = _pick_text(
        raw.get('songlistId'),
        raw.get('songlist_id'),
        raw.get('id'),
        raw.get('tid'),
        raw.get('dirId'),
        raw.get('dissid'),
        raw.get('disstid'),
    )

    dirid = _pick_text(raw.get('dirid'), raw.get('dirId'), dir_info.get('dirid'))

    name = _pick_text(
        raw.get('diss_name'),
        raw.get('dissname'),
        raw.get('dirname'),
        raw.get('dirName'),
        raw.get('name'),
        raw.get('title'),
        dir_info.get('dirname'),
        dir_info.get('diss_name'),
        dir_info.get('name'),
    )

    cover_url = _pick_text(
        raw.get('coverUrl'),
        raw.get('cover_url_big'),
        raw.get('cover_url_medium'),
        raw.get('cover'),
        raw.get('coverurl'),
        raw.get('cover_url'),
        raw.get('bigpicUrl'),
        raw.get('picUrl'),
        raw.get('diss_cover'),
        raw.get('imgurl'),
        raw.get('picurl'),
        raw.get('logo'),
        dir_info.get('coverurl'),
        dir_info.get('cover_url'),
    )

    song_count = _to_int(
        raw.get('songCount')
        or raw.get('song_num')
        or raw.get('songnum')
        or raw.get('songNum')
        or raw.get('song_count')
        or raw.get('total_song_num')
        or raw.get('total_song_count')
        or raw.get('trackCount')
        or raw.get('track_count')
        or raw.get('total')
        or dir_info.get('song_num')
        or dir_info.get('song_count')
        or dir_info.get('total_song_num')
    )

    creator = _pick_text(
        raw.get('creator_name'),
        raw.get('hostname'),
        raw.get('nickname'),
        raw.get('nick'),
        raw.get('creator') if isinstance(raw.get('creator'), str) else None,
        creator_info.get('name'),
        creator_info.get('nickname'),
        creator_info.get('creator_name'),
        dir_info.get('creator_name'),
    )

    description = _pick_text(
        raw.get('description'),
        raw.get('desc'),
        raw.get('diss_desc'),
        raw.get('descInfo'),
        dir_info.get('desc'),
        dir_info.get('description'),
    )

    return {
        'id': playlist_id,
        'songlistId': songlist_id,
        'dirid': dirid,
        'name': name,
        'coverUrl': cover_url,
        'songCount': song_count,
        'creator': creator,
        'description': description,
        'type': _normalize_playlist_type(raw, playlist_id, songlist_id, dirid),
    }


def _needs_playlist_enrichment(item: dict[str, Any]) -> bool:
    if not _pick_text(item.get('name')):
        return True

    if _to_int(item.get('songCount')) <= 0:
        return True

    if not _pick_text(item.get('coverUrl')):
        return True

    return False


async def _enrich_playlist_item(item: dict[str, Any], credential: Credential | None = None) -> dict[str, Any]:
    if get_detail is None or not _needs_playlist_enrichment(item):
        return item

    songlist_id = _to_int(item.get('songlistId') or item.get('id'))
    dirid = _to_int(item.get('dirid'))

    attempt_pairs: list[tuple[int, int]] = []
    if songlist_id > 0:
        attempt_pairs.append((songlist_id, dirid))
        if dirid == 0:
            attempt_pairs.append((songlist_id, songlist_id))
    if dirid > 0:
        attempt_pairs.append((0, dirid))
        if songlist_id == 0:
            attempt_pairs.append((dirid, dirid))

    seen_pairs: set[tuple[int, int]] = set()
    deduped_pairs: list[tuple[int, int]] = []
    for pair in attempt_pairs:
        if pair not in seen_pairs:
            deduped_pairs.append(pair)
            seen_pairs.add(pair)

    for songlist_value, dir_value in deduped_pairs:
        try:
            detail = await get_detail(
                songlist_id=songlist_value,
                dirid=dir_value,
                num=1,
                page=1,
                onlysong=True,
                tag=False,
                userinfo=True,
                credential=credential,
            )
        except Exception:
            continue

        if not isinstance(detail, dict):
            continue

        dirinfo = detail.get('dirinfo') if isinstance(detail.get('dirinfo'), dict) else {}

        if not _pick_text(item.get('songlistId')):
            item['songlistId'] = _pick_text(
                item.get('songlistId'),
                detail.get('songlist_id'),
                detail.get('songlistId'),
                dirinfo.get('id'),
                dirinfo.get('songlist_id'),
                dirinfo.get('songlistId'),
                dirinfo.get('tid'),
                dirinfo.get('dissid'),
                dirinfo.get('disstid'),
            )

        if not _pick_text(item.get('dirid')):
            item['dirid'] = _pick_text(item.get('dirid'), detail.get('dirid'), dirinfo.get('dirid'), dirinfo.get('dirId'))

        if not _pick_text(item.get('name')):
            item['name'] = _pick_text(item.get('name'), dirinfo.get('dirname'), dirinfo.get('diss_name'))

        if not _pick_text(item.get('coverUrl')):
            item['coverUrl'] = _pick_text(
                item.get('coverUrl'),
                dirinfo.get('coverurl'),
                dirinfo.get('cover_url_big'),
                dirinfo.get('cover_url'),
                dirinfo.get('logo'),
            )

        if _to_int(item.get('songCount')) <= 0:
            item['songCount'] = _to_int(
                detail.get('total_song_num')
                or detail.get('songlist_size')
                or dirinfo.get('song_num')
                or dirinfo.get('song_count')
            )

        if not _pick_text(item.get('creator')):
            creator = dirinfo.get('creator') if isinstance(dirinfo.get('creator'), dict) else {}
            item['creator'] = _pick_text(
                item.get('creator'),
                dirinfo.get('creator_name'),
                creator.get('name'),
                creator.get('nickname'),
            )

        if not _pick_text(item.get('description')):
            item['description'] = _pick_text(item.get('description'), dirinfo.get('desc'), dirinfo.get('description'))

        if _pick_text(item.get('name')) and _to_int(item.get('songCount')) > 0:
            break

    return item


def _extract_song_numeric_id(raw_song: dict[str, Any]) -> int:
    resolved = _extract_digits(raw_song.get('id') or raw_song.get('songid'))
    return _to_int(resolved)


def _contains_song_id(raw_songs: list[Any], song_id: int) -> bool:
    for raw_song in raw_songs:
        if not isinstance(raw_song, dict):
            continue

        if _extract_song_numeric_id(raw_song) == song_id:
            return True

    return False


async def _is_song_in_qq_liked_playlist(song_id: int, credential: Credential) -> bool | None:
    if get_detail is None:
        return None

    try:
        first_page = await get_detail(
            songlist_id=201,
            dirid=201,
            num=QQ_LIKED_VERIFY_PAGE_SIZE,
            page=1,
            onlysong=True,
            tag=False,
            userinfo=False,
            credential=credential,
        )
    except Exception:
        return None

    if not isinstance(first_page, dict):
        return None

    first_songs = first_page.get('songlist', [])
    if isinstance(first_songs, list) and _contains_song_id(first_songs, song_id):
        return True

    total_song_num = _to_int(first_page.get('total_song_num') or first_page.get('songlist_size'))
    expected_pages = 1
    if total_song_num > 0:
        expected_pages = max(1, (total_song_num + QQ_LIKED_VERIFY_PAGE_SIZE - 1) // QQ_LIKED_VERIFY_PAGE_SIZE)

    max_pages = min(expected_pages, QQ_LIKED_VERIFY_MAX_PAGES)
    for page in range(2, max_pages + 1):
        try:
            next_page = await get_detail(
                songlist_id=201,
                dirid=201,
                num=QQ_LIKED_VERIFY_PAGE_SIZE,
                page=page,
                onlysong=True,
                tag=False,
                userinfo=False,
                credential=credential,
            )
        except Exception:
            return None

        if not isinstance(next_page, dict):
            return None

        next_songs = next_page.get('songlist', [])
        if not isinstance(next_songs, list) or not next_songs:
            break

        if _contains_song_id(next_songs, song_id):
            return True

    return False


async def _verify_qq_liked_state(song_id: int, expected_liked: bool, credential: Credential) -> tuple[bool, bool | None, int]:
    latest_observed: bool | None = None
    attempts = 0

    for delay in QQ_LIKED_VERIFY_DELAYS:
        if delay > 0:
            await asyncio.sleep(delay)

        attempts += 1
        observed = await _is_song_in_qq_liked_playlist(song_id, credential)
        if observed is None:
            continue

        latest_observed = observed
        if observed == expected_liked:
            return True, observed, attempts

    return False, latest_observed, attempts


def _song_identity_key(raw: dict[str, Any]) -> str:
    song_id = _pick_text(raw.get('id'), raw.get('songid'), raw.get('songId'))
    if song_id:
        return f'id:{song_id}'

    song_mid = _pick_text(raw.get('mid'), raw.get('songmid'))
    if song_mid:
        return f'mid:{song_mid}'

    return ''


def _normalize_song(raw: dict[str, Any]) -> dict[str, Any]:
    song_id = _pick_text(raw.get('id'), raw.get('songid'), raw.get('songId'))
    song_mid = _pick_text(raw.get('mid'), raw.get('songmid'))
    album = raw.get('album') if isinstance(raw.get('album'), dict) else {}
    album_name = _pick_text(album.get('name'), raw.get('albumname'), raw.get('album'), raw.get('albumName'))
    album_mid = _pick_text(album.get('mid'), raw.get('albummid'), raw.get('albumMid'))

    cover_url = _pick_text(raw.get('coverUrl'), raw.get('picurl'), raw.get('albumpic'), raw.get('cover'))
    if not cover_url and album_mid:
        cover_url = f'https://y.gtimg.cn/music/photo_new/T002R300x300M000{album_mid}.jpg'

    singers = raw.get('singer')
    singer_names: list[str] = []
    if isinstance(singers, list):
        for singer in singers:
            if isinstance(singer, dict):
                name = _pick_text(singer.get('name'))
                if name:
                    singer_names.append(name)
    if not singer_names:
        fallback_singer = _pick_text(raw.get('artist'), raw.get('singername'), raw.get('singerName'))
        if fallback_singer:
            singer_names = [part.strip() for part in fallback_singer.split('/') if part.strip()]

    duration_seconds = _to_int(raw.get('interval'))
    duration_ms = duration_seconds * 1000 if duration_seconds > 0 else _to_int(raw.get('duration'))
    added_at_ms = _to_timestamp_ms(
        raw.get('addedAt')
        or raw.get('join_time')
        or raw.get('joinTime')
        or raw.get('add_time')
        or raw.get('addTime')
        or raw.get('addtime')
        or raw.get('ctime')
        or raw.get('create_time')
        or raw.get('createTime')
    )

    return {
        'id': song_id or song_mid,
        'mid': song_mid,
        'name': _pick_text(raw.get('name'), raw.get('title'), raw.get('songname')),
        'artist': '/'.join(singer_names),
        'album': album_name,
        'duration': duration_ms,
        'coverUrl': cover_url,
        'addedAt': added_at_ms,
    }


@app.on_event('shutdown')
async def _shutdown_httpx_client() -> None:
    """Close shared httpx client on shutdown."""
    global _HTTPX_CLIENT
    client: httpx.AsyncClient | None = None
    with _CACHE_LOCK:
        client = _HTTPX_CLIENT
        _HTTPX_CLIENT = None
    if client is not None:
        await client.aclose()


@app.get('/health')
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "qmusic-local-adapter",
        "timestamp": _now_ms(),
    }


@app.get('/connect/qr/key')
async def connect_qr_key() -> Any:
    _cleanup_expired_qr()

    try:
        qr = await get_qrcode(QRLoginType.QQ)
    except Exception as exc:  # pragma: no cover - upstream errors
        return _error(-1, f"Failed to request QQ QR code: {exc}", status_code=500)

    payload_b64 = base64.b64encode(qr.data).decode('ascii')
    item = QRCacheItem(
        identifier=qr.identifier,
        qr_type=qr.qr_type,
        mimetype=qr.mimetype or 'image/png',
        payload_b64=payload_b64,
        created_at=time.time(),
    )

    with _QR_LOCK:
        _QR_CACHE[item.identifier] = item

    return _success(
        {
            "unikey": item.identifier,
            "qr_data": item.payload_b64,
            "mimetype": item.mimetype,
        }
    )


@app.get('/connect/qr/create')
async def connect_qr_create(key: str = Query(...), qrimg: bool = Query(True)) -> Any:
    _cleanup_expired_qr()

    with _QR_LOCK:
        item = _QR_CACHE.get(key)

    if not item:
        return _error(-801, 'QR code expired, please refresh.', status_code=404)

    qrimg_value = f"data:{item.mimetype};base64,{item.payload_b64}" if qrimg else None
    return _success(
        {
            "qrurl": item.payload_b64,
            "qrimg": qrimg_value,
            "mimetype": item.mimetype,
        }
    )


@app.get('/connect/qr/check')
async def connect_qr_check(key: str = Query(...)) -> Any:
    _cleanup_expired_qr()

    with _QR_LOCK:
        item = _QR_CACHE.get(key)

    if not item:
        return _success({"status": -1, "cookie": None})

    qr = QR(
        data=base64.b64decode(item.payload_b64),
        qr_type=item.qr_type,
        mimetype=item.mimetype,
        identifier=item.identifier,
    )

    try:
        event, credential = await check_qrcode(qr)
    except Exception as exc:  # pragma: no cover - upstream errors
        return _error(-1, f"Failed to check QQ QR status: {exc}", status_code=500)

    status_map = {
        QRCodeLoginEvents.SCAN: 0,
        QRCodeLoginEvents.CONF: 1,
        QRCodeLoginEvents.DONE: 2,
        QRCodeLoginEvents.TIMEOUT: -1,
        QRCodeLoginEvents.REFUSE: -1,
        QRCodeLoginEvents.OTHER: -1,
    }
    status = status_map.get(event, -1)

    cookie_payload = None
    if status == 2 and credential is not None:
        cookie_payload = credential.as_json()

    if status in (2, -1):
        with _QR_LOCK:
            _QR_CACHE.pop(key, None)

    return _success({"status": status, "cookie": cookie_payload})


@app.get('/connect/status')
async def connect_status(request: Request) -> Any:
    raw_cookie = _extract_raw_cookie(request)

    if not raw_cookie:
        return _error(-1, 'Missing auth cookie.', status_code=401)

    credential = _credential_from_payload(raw_cookie)

    if credential is not None and get_homepage is not None:
        try:
            result = await get_homepage(credential.encrypt_uin, credential=credential)
            info = result['Info']['BaseInfo']
            return _success(
                {
                    "id": credential.musicid,
                    "name": info.get('Name') or 'QQ Music User',
                    "avatar": info.get('Avatar') or '',
                }
            )
        except Exception:
            # Fallback to lightweight local parsing below.
            pass

    guessed_uin = _extract_uin(raw_cookie)
    if not guessed_uin and credential is not None:
        guessed_uin = _extract_digits(getattr(credential, 'musicid', None))

    return _success(
        {
            "id": guessed_uin or 'unknown',
            "name": 'QQ Music User',
            "avatar": '',
        }
    )


@app.get('/playlist/user')
async def playlist_user(
    request: Request,
    uin: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
) -> Any:
    if get_created_songlist is None:
        return _error(-1, 'qqmusic-api-python does not support playlist endpoint.', status_code=501)

    raw_cookie = _extract_raw_cookie(request)
    credential = _credential_from_payload(raw_cookie) if raw_cookie else None

    # Prefer live auth cookie-derived identity over caller-provided uin to avoid stale-account reads.
    target_uin = ''
    if credential is not None:
        target_uin = _extract_digits(getattr(credential, 'musicid', None)) or ''

    if not target_uin and raw_cookie:
        guessed_uin = _extract_uin(raw_cookie)
        if guessed_uin:
            target_uin = guessed_uin

    if not target_uin:
        target_uin = _extract_digits(uin) or ''

    if not target_uin:
        return _error(-1, 'Missing uin and cannot derive it from cookie.', status_code=400)

    try:
        raw_playlists = await get_created_songlist(target_uin, credential=credential)
    except Exception as exc:  # pragma: no cover - upstream errors
        return _error(-1, f'Failed to load QQ playlists: {exc}', status_code=500)

    normalized: list[dict[str, Any]] = []
    if isinstance(raw_playlists, list):
        for item in raw_playlists[:limit]:
            if isinstance(item, dict):
                normalized_item = _normalize_playlist(item)
                if normalized_item['id']:
                    normalized.append(normalized_item)

    if normalized and get_detail is not None:
        sem = asyncio.Semaphore(6)

        async def enrich_with_limit(item: dict[str, Any]) -> dict[str, Any]:
            async with sem:
                return await _enrich_playlist_item(item, credential)

        normalized = await asyncio.gather(*(enrich_with_limit(item) for item in normalized))

    return _success(
        {
            'uin': target_uin,
            'total': len(normalized),
            'playlists': normalized,
        }
    )


@app.get('/playlist/detail')
async def playlist_detail(
    request: Request,
    id: str = Query(...),
    dirid: str | None = Query(default=None),
    limit: int = Query(default=300, ge=1, le=500),
) -> Any:
    if get_detail is None:
        return _error(-1, 'qqmusic-api-python does not support playlist detail endpoint.', status_code=501)

    raw_cookie = _extract_raw_cookie(request)
    credential = _credential_from_payload(raw_cookie) if raw_cookie else None

    songlist_id = _to_int(id)
    explicit_dirid = _to_int(dirid) if dirid else 0

    attempt_pairs: list[tuple[int, int]] = []
    if songlist_id > 0:
        attempt_pairs.append((songlist_id, explicit_dirid))
        if explicit_dirid == 0:
            attempt_pairs.append((songlist_id, songlist_id))
    if explicit_dirid > 0:
        attempt_pairs.append((0, explicit_dirid))
        if songlist_id == 0:
            attempt_pairs.append((explicit_dirid, explicit_dirid))

    # De-duplicate attempts while preserving order.
    seen_pairs: set[tuple[int, int]] = set()
    deduped_pairs: list[tuple[int, int]] = []
    for pair in attempt_pairs:
        if pair not in seen_pairs:
            deduped_pairs.append(pair)
            seen_pairs.add(pair)

    detail_data: dict[str, Any] | None = None
    selected_pair: tuple[int, int] | None = None
    last_error: Exception | None = None

    for songlist_value, dir_value in deduped_pairs:
        try:
            candidate = await get_detail(
                songlist_id=songlist_value,
                dirid=dir_value,
                num=limit,
                page=1,
                onlysong=True,
                tag=False,
                userinfo=True,
                credential=credential,
            )

            if not isinstance(candidate, dict):
                continue

            candidate_dirinfo = candidate.get('dirinfo') if isinstance(candidate.get('dirinfo'), dict) else {}
            candidate_songlist_id = _to_int(
                candidate.get('songlist_id')
                or candidate.get('songlistId')
                or candidate_dirinfo.get('id')
                or candidate_dirinfo.get('songlist_id')
                or candidate_dirinfo.get('songlistId')
                or candidate_dirinfo.get('tid')
                or candidate_dirinfo.get('dissid')
                or candidate_dirinfo.get('disstid')
            )
            candidate_dir_id = _to_int(
                candidate.get('dirid')
                or candidate_dirinfo.get('dirid')
                or candidate_dirinfo.get('dirId')
            )

            if explicit_dirid > 0 and candidate_dir_id > 0 and candidate_dir_id != explicit_dirid:
                continue

            if songlist_id > 0 and explicit_dirid == 0 and candidate_songlist_id > 0 and candidate_songlist_id != songlist_id:
                continue

            # Prefer the first non-empty candidate. If all are empty, keep the first matching one.
            candidate_songs = candidate.get('songlist', [])
            if detail_data is None:
                detail_data = candidate
                selected_pair = (songlist_value, dir_value)

            if isinstance(candidate_songs, list) and candidate_songs:
                detail_data = candidate
                selected_pair = (songlist_value, dir_value)
                break
        except Exception as exc:  # pragma: no cover - upstream errors
            last_error = exc

    if detail_data is None:
        message = f'Failed to load QQ playlist detail: {last_error}' if last_error else 'Failed to load QQ playlist detail.'
        return _error(-1, message, status_code=500)

    raw_songs = detail_data.get('songlist', []) if isinstance(detail_data, dict) else []
    if not isinstance(raw_songs, list):
        raw_songs = []

    page_size = max(1, min(limit, 500))
    total_song_num = _to_int(detail_data.get('total_song_num') if isinstance(detail_data, dict) else 0)
    if total_song_num <= 0:
        total_song_num = _to_int(detail_data.get('songlist_size') if isinstance(detail_data, dict) else 0)

    if selected_pair is not None and total_song_num > len(raw_songs):
        expected_pages = max(1, (total_song_num + page_size - 1) // page_size)
        seen_song_keys: set[str] = set()
        for song in raw_songs:
            if not isinstance(song, dict):
                continue
            key = _song_identity_key(song)
            if key:
                seen_song_keys.add(key)

        for page in range(2, expected_pages + 1):
            try:
                next_detail = await get_detail(
                    songlist_id=selected_pair[0],
                    dirid=selected_pair[1],
                    num=page_size,
                    page=page,
                    onlysong=True,
                    tag=False,
                    userinfo=False,
                    credential=credential,
                )
            except Exception as exc:  # pragma: no cover - upstream errors
                last_error = exc
                break

            if not isinstance(next_detail, dict):
                break

            next_raw_songs = next_detail.get('songlist', [])
            if not isinstance(next_raw_songs, list) or not next_raw_songs:
                break

            appended = 0
            for song in next_raw_songs:
                if not isinstance(song, dict):
                    continue

                key = _song_identity_key(song)
                if key and key in seen_song_keys:
                    continue

                if key:
                    seen_song_keys.add(key)

                raw_songs.append(song)
                appended += 1

            # Upstream may return repeated page-1 data for later pages.
            if appended == 0:
                break

            if len(raw_songs) >= total_song_num:
                break

    normalized_songs: list[dict[str, Any]] = []
    for item in raw_songs:
        if isinstance(item, dict):
            normalized_item = _normalize_song(item)
            if normalized_item['id'] or normalized_item['mid']:
                normalized_songs.append(normalized_item)

    raw_dirinfo = detail_data.get('dirinfo', {}) if isinstance(detail_data, dict) else {}
    playlist_name = ''
    if isinstance(raw_dirinfo, dict):
        playlist_name = _pick_text(raw_dirinfo.get('dirname'), raw_dirinfo.get('diss_name'))

    response_total = total_song_num if total_song_num > 0 else len(normalized_songs)
    if len(normalized_songs) > response_total:
        response_total = len(normalized_songs)

    return _success(
        {
            'id': id,
            'dirid': dirid,
            'name': playlist_name,
            'total': response_total,
            'songs': normalized_songs,
        }
    )



@app.post('/playlist/like')
async def playlist_like(
    request: Request,
    id: str = Query(...),
    like: int = Query(default=1),
) -> Any:
    if add_songs is None:
        return _error(-1, 'qqmusic-api-python does not support like playlist endpoint.', status_code=501)

    raw_cookie = _extract_raw_cookie(request)
    if not raw_cookie:
        return _error(-1, 'Missing auth cookie.', status_code=401)

    credential = _credential_from_payload(raw_cookie)
    if credential is None:
        return _error(-1, 'Invalid auth cookie.', status_code=401)

    song_id = _extract_digits(id)
    if not song_id:
        return _error(-1, 'Invalid QQ song id.', status_code=400)

    song_id_num = _to_int(song_id)
    is_like = like != 0

    try:
        write_meta: dict[str, Any] = {}

        if is_like:
            for attempt in range(2):
                try:
                    result = await add_songs(dirid=201, song_ids=[song_id_num], credential=credential)
                    # add_songs returns False when song already exists, but this is still a successful "liked" state.
                    already_liked = not bool(result)
                    write_meta = {'already': already_liked}
                    break
                except Exception as exc:
                    if _is_known_songlist_result_error(exc):
                        if attempt == 0:
                            await asyncio.sleep(0.2)
                            continue

                        # Upstream occasionally mutates state but throws KeyError('result').
                        # Treat it as success to keep frontend state in sync with server state.
                        write_meta = {'already': False, 'assumed': True}
                        break

                    raise

            if not write_meta:
                return _error(-1, 'Failed to update QQ liked songs: unexpected retry exit.', status_code=500)

        if not is_like:
            if del_songs is None:
                return _error(-1, 'qqmusic-api-python does not support unlike endpoint.', status_code=501)

            for attempt in range(2):
                try:
                    await del_songs(dirid=201, song_ids=[song_id_num], credential=credential)
                    break
                except Exception as exc:
                    # QQ upstream may return code 2001 even when unlike has taken effect.
                    if _is_known_songlist_code_error(exc, 2001):
                        break

                    if _is_known_songlist_result_error(exc) and attempt == 0:
                        await asyncio.sleep(0.2)
                        continue
                    raise

        verified, actual_liked, verify_attempts = await _verify_qq_liked_state(song_id_num, is_like, credential)
        resolved_liked = is_like if actual_liked is None else actual_liked
        payload: dict[str, Any] = {
            'songId': song_id,
            'liked': resolved_liked,
            'expectedLiked': is_like,
            'verified': verified,
            'verifyAttempts': verify_attempts,
            **write_meta,
        }

        if not verified:
            payload['warning'] = 'QQ liked playlist is still syncing; please refresh shortly.'

        return _success(payload)
    except Exception as exc:  # pragma: no cover - upstream errors
        return _error(-1, f'Failed to update QQ liked songs: {exc}', status_code=500)


@app.get('/song/url')
async def song_url(
    request: Request,
    mid: str | None = Query(default=None),
    id: str | None = Query(default=None),
    quality: str = Query(default='128'),
) -> Any:
    if get_song_urls is None or SongFileType is None:
        return _error(-1, 'qqmusic-api-python does not support song url endpoint.', status_code=501)

    raw_cookie = _extract_raw_cookie(request)
    credential = _credential_from_payload(raw_cookie) if raw_cookie else None

    normalized_mid = _pick_text(mid)
    normalized_song_id = _to_int(_extract_digits(id), default=0) if id else 0

    if not normalized_mid and normalized_song_id > 0:
        normalized_mid = _read_song_mid_cache(normalized_song_id)

    if not normalized_mid and normalized_song_id > 0 and get_song_detail is not None:
        try:
            song_detail = await get_song_detail(normalized_song_id)
            track_info = song_detail.get('track_info', {}) if isinstance(song_detail, dict) else {}
            if isinstance(track_info, dict):
                normalized_mid = _pick_text(track_info.get('mid'))
            if normalized_mid:
                _write_song_mid_cache(normalized_song_id, normalized_mid)
        except Exception:
            normalized_mid = ''

    if not normalized_mid:
        return _error(-1, 'Missing QQ song mid (or unable to resolve from song id).', status_code=400)

    quality_map = {
        '128': SongFileType.MP3_128,
        '320': SongFileType.MP3_320,
        'flac': SongFileType.FLAC,
        'ogg': SongFileType.OGG_320,
    }
    file_type = quality_map.get(_pick_text(quality).lower(), SongFileType.MP3_128)

    try:
        urls = await get_song_urls([normalized_mid], file_type=file_type, credential=credential)
    except Exception as exc:  # pragma: no cover - upstream errors
        return _error(-1, f'Failed to fetch QQ song url: {exc}', status_code=500)

    raw_url = urls.get(normalized_mid) if isinstance(urls, dict) else ''
    if isinstance(raw_url, tuple):
        play_url = _pick_text(raw_url[0])
    else:
        play_url = _pick_text(raw_url)

    if not play_url:
        return _error(-1, 'No playable QQ song url returned.', status_code=404)

    return _success(
        {
            'mid': normalized_mid,
            'songId': normalized_song_id or None,
            'quality': _pick_text(quality).lower() or '128',
            'url': play_url,
        }
    )


@app.get('/song/lyric')
async def song_lyric(
    request: Request,
    mid: str | None = Query(default=None),
    id: str | None = Query(default=None),
) -> Any:
    if get_lyric is None:
        return _error(-1, 'qqmusic-api-python does not support song lyric endpoint.', status_code=501)

    raw_cookie = _extract_raw_cookie(request)
    credential = _credential_from_payload(raw_cookie) if raw_cookie else None

    normalized_mid = _pick_text(mid)
    normalized_song_id = _to_int(_extract_digits(id), default=0) if id else 0
    lookup_value: str | int = normalized_mid

    if not normalized_mid:
        if normalized_song_id <= 0:
            return _error(-1, 'Missing QQ song mid/id.', status_code=400)
        lookup_value = normalized_song_id

    try:
        lyric_payload = await get_lyric(
            lookup_value,
            qrc=False,
            trans=True,
            roma=False,
            credential=credential,
        )
    except Exception as exc:  # pragma: no cover - upstream errors
        return _error(-1, f'Failed to fetch QQ song lyric: {exc}', status_code=500)

    lyric = _pick_text(lyric_payload.get('lyric') if isinstance(lyric_payload, dict) else '')
    trans = _pick_text(lyric_payload.get('trans') if isinstance(lyric_payload, dict) else '')

    if not lyric and not trans:
        return _error(-1, 'No QQ song lyric returned.', status_code=404)

    return _success(
        {
            'mid': normalized_mid or None,
            'songId': normalized_song_id or None,
            'lyric': lyric,
            'trans': trans,
        }
    )


@app.get('/recommend/daily')
async def recommend_daily(
    request: Request,
    limit: int = Query(default=30, ge=1, le=100),
) -> Any:
    if get_detail is None:
        return _error(-1, 'qqmusic-api-python does not support songlist detail endpoint.', status_code=501)

    raw_cookie = _extract_raw_cookie(request)
    if not raw_cookie:
        return _error(-1, 'Missing auth cookie.', status_code=401)

    credential = _credential_from_payload(raw_cookie)
    if credential is None:
        return _error(-1, 'Invalid auth cookie.', status_code=401)

    cache_key = _cache_owner_key(raw_cookie, credential)
    cached_playlist = _read_daily_playlist_cache(cache_key)

    if cached_playlist is None:
        try:
            homepage_html = await _fetch_qq_mac_homepage(raw_cookie, credential)
        except Exception as exc:  # pragma: no cover - upstream errors
            return _error(-1, f'Failed to load QQ personalized recommendation source: {exc}', status_code=500)

        resolved = _extract_personal_daily_playlist(homepage_html)
        if not resolved:
            return _error(-1, 'QQ personalized daily playlist is not available.', status_code=404)

        playlist_id, playlist_title = resolved
        _write_daily_playlist_cache(cache_key, playlist_id, playlist_title)
    else:
        playlist_id, playlist_title = cached_playlist
    songlist_id = _to_int(playlist_id)
    if songlist_id <= 0:
        return _error(-1, 'QQ personalized daily playlist id is invalid.', status_code=500)

    try:
        detail = await get_detail(
            songlist_id=songlist_id,
            dirid=0,
            num=min(max(limit, 1), 100),
            page=1,
            onlysong=True,
            tag=False,
            userinfo=False,
            credential=credential,
        )
    except Exception as exc:  # pragma: no cover - upstream errors
        return _error(-1, f'Failed to load QQ personalized daily songs: {exc}', status_code=500)

    raw_songs = detail.get('songlist', []) if isinstance(detail, dict) else []
    if not isinstance(raw_songs, list):
        raw_songs = []

    normalized_songs: list[dict[str, Any]] = []
    seen_song_keys: set[str] = set()
    for raw_song in raw_songs:
        if not isinstance(raw_song, dict):
            continue
        normalized_item = _normalize_song(raw_song)
        identity = _pick_text(normalized_item.get('id'), normalized_item.get('mid'))
        if not identity or identity in seen_song_keys:
            continue
        seen_song_keys.add(identity)
        normalized_songs.append(normalized_item)
        if len(normalized_songs) >= limit:
            break

    if not normalized_songs:
        return _error(-1, 'QQ personalized daily songs is empty.', status_code=404)

    return _success(
        {
            'title': playlist_title or '今日私享',
            'playlistId': playlist_id,
            'total': len(normalized_songs),
            'songs': normalized_songs,
        }
    )


@app.get('/search/songs')
async def search_songs(
    keyword: str = Query(..., min_length=1),
    limit: int = Query(default=20, ge=1, le=50),
    page: int = Query(default=1, ge=1),
) -> Any:
    if search_by_type is None or SearchType is None:
        return _error(-1, 'qqmusic-api-python does not support search endpoint.', status_code=501)

    raw_songs = None
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            raw_songs = await search_by_type(
                keyword=keyword,
                search_type=SearchType.SONG,
                num=limit,
                page=page,
            )
            last_error = None
            break
        except Exception as exc:  # pragma: no cover - upstream errors
            last_error = exc
            if attempt == 0:
                await asyncio.sleep(0.3)

    if last_error is not None:
        return _error(-1, f'Failed to search QQ songs: {last_error}', status_code=500)

    normalized: list[dict[str, Any]] = []
    if isinstance(raw_songs, list):
        for item in raw_songs:
            if not isinstance(item, dict):
                continue
            normalized_item = _normalize_song(item)
            if normalized_item['id'] or normalized_item['mid']:
                normalized.append(normalized_item)

    return _success(
        {
            'keyword': keyword,
            'page': page,
            'total': len(normalized),
            'songs': normalized,
        }
    )
