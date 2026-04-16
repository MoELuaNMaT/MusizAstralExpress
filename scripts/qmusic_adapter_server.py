"""Local QQ music adapter with QR login and library endpoints (qqmusic-api-python v0.5.1).

This service wraps qqmusic-api-python so the frontend keeps a stable HTTP contract.

Endpoints:
- GET  /health
- GET  /connect/qr/key
- GET  /connect/qr/create?key=...&qrimg=true
- GET  /connect/qr/check?key=...
- GET  /connect/status
- GET  /playlist/user
- GET  /playlist/detail?id=...&dirid=...
- POST /playlist/like?id=...&like=...
- GET  /song/url?mid=... (or /song/url?id=...)
- GET  /song/stream?target=...
- GET  /song/lyric?mid=... (or /song/lyric?id=...)
- GET  /recommend/daily
- GET  /recommend/daily/probe
- POST /recommend/daily/write-probe
- GET  /search/songs
"""

from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from html import unescape
from threading import Lock
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

try:
    import httpx
except Exception:
    httpx = None

# ── qqmusic-api-python v0.5.1 ──────────────────────────────────────────────────

from qqmusic_api import Client, Credential
from qqmusic_api.core.exceptions import ApiError, LoginExpiredError, NotLoginError, CredentialError
from qqmusic_api.models.login import QR, QRCodeLoginEvents, QRLoginType, QRLoginResult
from qqmusic_api.modules.song import SongFileType, SongFileInfo
from qqmusic_api.models.song import UrlinfoItem

logger = logging.getLogger('qmusic-adapter')


def _extract_songs_from_result(result: Any) -> list[Any]:
    """从API返回对象中提取歌曲列表，兼容不同版本库的字段命名."""
    for attr in ('songs', 'tracks', 'items'):
        val = getattr(result, attr, None)
        if isinstance(val, list) and len(val) > 0:
            return val
    if isinstance(result, list):
        return result
    logger.warning('recommend result has no songs/tracks/items, type=%s attrs=%s', type(result).__name__, [a for a in dir(result) if not a.startswith('_')])
    return []


# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="QQMusic Local Adapter", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=False,
    allow_methods=['GET', 'POST'],
    allow_headers=['Content-Type', 'Authorization', 'token', 'cookie'],
)

STREAM_FORWARD_HEADERS = {
    'range', 'accept', 'accept-encoding', 'if-range', 'user-agent',
}
STREAM_RESPONSE_HEADERS = {
    'accept-ranges', 'content-length', 'content-range',
    'content-type', 'cache-control', 'etag', 'last-modified',
}

_ALLOWED_STREAM_HOSTS = re.compile(
    r'(?:.*\.)?(?:qqmusic\.qq\.com|qqmusic\.cn|qq\.com|qpic\.cn|gtimg\.cn'
    r'|myqcloud\.com|tc\.qq\.com|stream\.qqmusic\.qq\.com'
    r'|isure\.stream\.qqmusic\.qq\.com|dl\.stream\.qqmusic\.qq\.com'
    r'|ws\.stream\.qqmusic\.qq\.com|ocmusicsrv\.filedr\.myqcloud\.com|c\.y\.qq\.com)$',
    re.IGNORECASE,
)

# ── QR login cache ────────────────────────────────────────────────────────────

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

# ── Performance caches ────────────────────────────────────────────────────────

DAILY_PLAYLIST_CACHE_TTL_SECONDS = 600
SONG_MID_CACHE_TTL_SECONDS = 6 * 60 * 60
_DAILY_PLAYLIST_CACHE: dict[str, tuple[str, str, float]] = {}
_SONG_MID_CACHE: dict[int, tuple[str, float]] = {}
_HTTPX_CLIENT: httpx.AsyncClient | None = None
_CACHE_LOCK = Lock()

QQ_LIKED_VERIFY_DELAYS = (0.0, 0.35, 0.8, 1.4, 2.2)
QQ_LIKED_VERIFY_PAGE_SIZE = 200
QQ_LIKED_VERIFY_MAX_PAGES = 8

# ── Client management ─────────────────────────────────────────────────────────

_shared_client: Client | None = None


def _get_shared_client() -> Client:
    """Shared Client for non-authenticated requests."""
    global _shared_client
    if _shared_client is None:
        _shared_client = Client()
    return _shared_client


@asynccontextmanager
async def _auth_client(credential: Credential):
    """Scoped Client for a single authenticated request cycle."""
    client = Client(credential=credential)
    try:
        yield client
    finally:
        await client.close()


@asynccontextmanager
async def _shared_client_cm():
    """Async context manager for the shared non-auth Client (does NOT close it)."""
    yield _get_shared_client()


# ── Utility helpers ───────────────────────────────────────────────────────────

def _now_ms() -> int:
    return int(time.time() * 1000)


def _success(data: Any) -> dict[str, Any]:
    return {"code": 0, "message": "Success", "data": data, "timestamp": _now_ms()}


def _error(code: int, message: str, status_code: int = 400, data: Any = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "data": data, "timestamp": _now_ms()},
    )


def _cleanup_expired_local_cache() -> None:
    now = time.time()
    with _CACHE_LOCK:
        expired_daily = [key for key, (_, _, expires_at) in _DAILY_PLAYLIST_CACHE.items() if expires_at <= now]
        for key in expired_daily:
            _DAILY_PLAYLIST_CACHE.pop(key, None)

        expired_mid = [song_id for song_id, (_, expires_at) in _SONG_MID_CACHE.items() if expires_at <= now]
        for song_id in expired_mid:
            _SONG_MID_CACHE.pop(song_id, None)


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


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _extract_digits(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    matched = re.search(r"(\d+)", text)
    return matched.group(1) if matched else None


def _parse_json_payload(raw_payload: str) -> dict[str, Any] | None:
    payload = raw_payload.strip()
    if not payload or not payload.startswith('{'):
        return None
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _parse_cookie_header(raw_cookie: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for part in raw_cookie.split(';'):
        segment = part.strip()
        if not segment or '=' not in segment:
            continue
        key, value = segment.split('=', 1)
        parsed[key.strip()] = value.strip()
    return parsed


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


def _credential_from_cookie_str(raw_cookie: str) -> Credential | None:
    """Build Credential from cookie header (replaces removed from_cookies_str / from_cookies_dict)."""
    parsed = _parse_cookie_header(raw_cookie)
    if not parsed:
        return None

    musicid = 0
    uin = parsed.get('uin', '') or parsed.get('p_uin', '') or parsed.get('wxuin', '')
    if uin.startswith('o'):
        uin = uin[1:]
    if uin.isdigit():
        musicid = int(uin)

    try:
        return Credential(
            openid=parsed.get('openid', '') or parsed.get('wxopenid', ''),
            refresh_token=parsed.get('refresh_token', ''),
            access_token=parsed.get('access_token', ''),
            musicid=musicid,
            musickey=parsed.get('qqmusic_key', ''),
            str_musicid=str(musicid) if musicid > 0 else '',
            refresh_key=parsed.get('refresh_key', ''),
            encrypt_uin=parsed.get('encrypt_uin', ''),
        )
    except Exception:
        return None


def _credential_from_payload(raw_cookie: str) -> Credential | None:
    """Parse frontend auth payload into Credential."""
    # 1. JSON payload (Credential.model_dump_json() output)
    payload = _parse_json_payload(raw_cookie)
    if isinstance(payload, dict):
        try:
            return Credential.model_validate(payload)
        except Exception:
            pass
    # 2. Cookie header string
    return _credential_from_cookie_str(raw_cookie)


def _cache_owner_key(raw_cookie: str, credential: Credential | None) -> str:
    owner = ''
    if credential is not None:
        owner = _pick_text(getattr(credential, 'str_musicid', ''), getattr(credential, 'musicid', ''))
    if not owner:
        owner = _extract_uin(raw_cookie) or 'anonymous'
    return owner


def _read_daily_playlist_cache(owner_key: str) -> tuple[str, str] | None:
    _cleanup_expired_local_cache()
    with _CACHE_LOCK:
        cached = _DAILY_PLAYLIST_CACHE.get(owner_key)
    if cached is None:
        return None
    playlist_id, title, _ = cached
    return playlist_id, title


def _write_daily_playlist_cache(owner_key: str, playlist_id: str, title: str) -> None:
    expires_at = time.time() + DAILY_PLAYLIST_CACHE_TTL_SECONDS
    with _CACHE_LOCK:
        _DAILY_PLAYLIST_CACHE[owner_key] = (playlist_id, title, expires_at)


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

    client = _get_httpx_client()
    response = await client.get('https://c.y.qq.com/node/musicmac/v6/index.html', headers=headers)
    response.raise_for_status()
    return response.text


def _extract_personal_daily_playlist(html: str) -> tuple[str, str] | None:
    if not html:
        return None

    decoded_html = unescape(html)
    strict_patterns = (
        re.compile(
            r'data-rid=\\?"(?P<rid>\d+)\\?"[\s\S]{0,600}?alt=\\?"(?P<title>[^"\\]*今日私享[^"\\]*)',
            re.IGNORECASE,
        ),
        re.compile(
            r'data-rid=\\?"(?P<rid>\d+)\\?"[\s\S]{0,800}?>(?P<title>[^<]*今日私享[^<]*)</a>',
            re.IGNORECASE,
        ),
    )
    for pattern in strict_patterns:
        for matched in pattern.finditer(decoded_html):
            playlist_id = _pick_text(matched.group('rid'))
            title = _pick_text(matched.group('title'))
            if playlist_id and '今日私享' in title:
                return playlist_id, title

    # QQ 页面模板经常插入额外包裹层，这里用“标题命中后向前回溯最近 rid”的方式兜底。
    for matched in re.finditer('今日私享', decoded_html):
        window_start = max(0, matched.start() - 1200)
        window_end = min(len(decoded_html), matched.end() + 400)
        window = decoded_html[window_start:window_end]
        rid_matches = list(re.finditer(r'data-rid=\\?"(?P<rid>\d+)\\?"', window, re.IGNORECASE))
        if not rid_matches:
            continue
        playlist_id = _pick_text(rid_matches[-1].group('rid'))
        if playlist_id:
            return playlist_id, '今日私享'

    return None


# ── Stream proxy helpers ─────────────────────────────────────────────────────

def _sanitize_stream_target(target: str) -> str:
    value = _pick_text(target)
    if not value or not re.match(r'^https?://', value, re.IGNORECASE):
        return ''
    try:
        parsed = urlparse(value)
        hostname = parsed.hostname
        if not hostname:
            return ''
        try:
            addr = ipaddress.ip_address(hostname)
            if addr.is_private or addr.is_loopback or addr.is_link_local:
                return ''
        except ValueError:
            pass
        if not _ALLOWED_STREAM_HOSTS.match(hostname):
            return ''
    except Exception:
        return ''
    return value


def _build_stream_forward_headers(request: Request) -> dict[str, str]:
    return {
        key: value.strip()
        for key, value in request.headers.items()
        if key.lower() in STREAM_FORWARD_HEADERS and value.strip()
    }


def _build_stream_response_headers(headers: Any) -> dict[str, str]:
    return {
        key: value.strip()
        for key, value in headers.items()
        if key.lower() in STREAM_RESPONSE_HEADERS and value.strip()
    }


def _get_httpx_client() -> httpx.AsyncClient:
    global _HTTPX_CLIENT
    if httpx is None:
        raise RuntimeError('httpx is unavailable')
    with _CACHE_LOCK:
        if _HTTPX_CLIENT is None:
            _HTTPX_CLIENT = httpx.AsyncClient(follow_redirects=True, timeout=12)
        return _HTTPX_CLIENT


# ── Song/playlist normalization ────────────────────────────────────────────────

def _build_cover_url(album_mid: str) -> str:
    if not album_mid:
        return ''
    return f'https://y.gtimg.cn/music/photo_new/T002R300x300M000{album_mid}.jpg'


def _normalize_song(raw: Any) -> dict[str, Any]:
    """Normalize from Pydantic model (base.Song / SongSearch) or raw dict."""
    # Pydantic model path
    if hasattr(raw, 'model_fields') or hasattr(raw, '__pydantic_core_schema__'):
        song_id = str(getattr(raw, 'id', '') or '')
        song_mid = getattr(raw, 'mid', '') or ''
        name = getattr(raw, 'name', '') or getattr(raw, 'title', '') or ''
        interval = getattr(raw, 'interval', 0) or 0

        singer_names: list[str] = []
        for singer in (getattr(raw, 'singer', None) or []):
            sname = getattr(singer, 'name', '')
            if sname:
                singer_names.append(sname)
        if not singer_names:
            fallback = getattr(raw, 'artist', '') or getattr(raw, 'singername', '')
            if fallback:
                singer_names = [p.strip() for p in fallback.split('/') if p.strip()]

        album = getattr(raw, 'album', None)
        album_mid = getattr(album, 'mid', '') if album else ''
        album_name = getattr(album, 'name', '') if album else ''

        numeric_id = _to_int(_extract_digits(song_id), default=0)
        if numeric_id > 0 and song_mid:
            _write_song_mid_cache(numeric_id, song_mid)

        return {
            'id': song_id or song_mid,
            'mid': song_mid,
            'name': name,
            'artist': '/'.join(singer_names),
            'album': album_name,
            'duration': interval * 1000 if interval > 0 else 0,
            'coverUrl': _build_cover_url(album_mid),
            'addedAt': 0,
        }

    # Dict path (backward compatibility for edge cases)
    if not isinstance(raw, dict):
        return {}

    song_id = _pick_text(raw.get('id'), raw.get('songid'), raw.get('songId'))
    song_mid = _pick_text(raw.get('mid'), raw.get('songmid'))
    numeric_id = _to_int(_extract_digits(song_id), default=0)
    if numeric_id > 0 and song_mid:
        _write_song_mid_cache(numeric_id, song_mid)

    album = raw.get('album') if isinstance(raw.get('album'), dict) else {}
    album_mid = _pick_text(album.get('mid'), raw.get('albummid'), raw.get('albumMid'))
    album_name = _pick_text(album.get('name'), raw.get('albumname'), raw.get('album'))
    cover_url = _pick_text(raw.get('coverUrl'), raw.get('picurl'), raw.get('albumpic'))
    if not cover_url and album_mid:
        cover_url = _build_cover_url(album_mid)

    singers = raw.get('singer')
    singer_names: list[str] = []
    if isinstance(singers, list):
        for singer in singers:
            if isinstance(singer, dict):
                name = _pick_text(singer.get('name'))
                if name:
                    singer_names.append(name)
    if not singer_names:
        fallback = _pick_text(raw.get('artist'), raw.get('singername'), raw.get('singerName'))
        if fallback:
            singer_names = [p.strip() for p in fallback.split('/') if p.strip()]

    duration_seconds = _to_int(raw.get('interval'))
    duration_ms = duration_seconds * 1000 if duration_seconds > 0 else _to_int(raw.get('duration'))

    return {
        'id': song_id or song_mid,
        'mid': song_mid,
        'name': _pick_text(raw.get('name'), raw.get('title'), raw.get('songname')),
        'artist': '/'.join(singer_names),
        'album': album_name,
        'duration': duration_ms,
        'coverUrl': cover_url,
        'addedAt': 0,
    }


def _normalize_song_list(raw_songs: Any, limit: int) -> list[dict[str, Any]]:
    if not isinstance(raw_songs, list):
        return []
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for song in raw_songs:
        item = _normalize_song(song)
        identity = _pick_text(item.get('id'), item.get('mid'))
        if not identity or identity in seen:
            continue
        seen.add(identity)
        result.append(item)
        if len(result) >= limit:
            break
    return result


def _normalize_playlist(raw: Any) -> dict[str, Any]:
    """Normalize from Pydantic model (UserPlaylistSummary) or raw dict."""
    if hasattr(raw, 'model_fields') or hasattr(raw, '__pydantic_core_schema__'):
        playlist_id = str(getattr(raw, 'id', '') or '')
        dirid = str(getattr(raw, 'dirid', '') or '')
        name = getattr(raw, 'title', '') or ''
        cover_url = getattr(raw, 'picurl', '') or getattr(raw, 'bigpic_url', '') or ''
        song_count = _to_int(getattr(raw, 'songnum', 0))
        creator = getattr(raw, 'nick', '') or ''
        description = getattr(raw, 'desc', '') or ''
        op_type = getattr(raw, 'op_type', 0) or 0
        ptype = 'liked' if str(dirid) == '201' else ('collected' if op_type == 1 else 'created')
        return {
            'id': playlist_id,
            'songlistId': playlist_id,
            'dirid': dirid,
            'name': name,
            'coverUrl': cover_url,
            'songCount': song_count,
            'creator': creator,
            'description': description,
            'type': ptype,
        }

    if not isinstance(raw, dict):
        return {}

    creator_info = raw.get('creator') if isinstance(raw.get('creator'), dict) else {}
    dir_info = raw.get('dirinfo') if isinstance(raw.get('dirinfo'), dict) else {}

    playlist_id = _pick_text(
        raw.get('songlistId'), raw.get('songlist_id'), raw.get('tid'),
        raw.get('id'), raw.get('dirid'), raw.get('dirId'),
        raw.get('dissid'), raw.get('disstid'), dir_info.get('dirid'),
    )
    songlist_id = _pick_text(
        raw.get('songlistId'), raw.get('songlist_id'), raw.get('id'),
        raw.get('tid'), raw.get('dirId'), raw.get('dissid'), raw.get('disstid'),
    )
    dirid = _pick_text(raw.get('dirid'), raw.get('dirId'), dir_info.get('dirid'))
    name = _pick_text(
        raw.get('diss_name'), raw.get('dissname'), raw.get('dirname'),
        raw.get('dirName'), raw.get('name'), raw.get('title'),
        dir_info.get('dirname'), dir_info.get('diss_name'), dir_info.get('name'),
    )
    cover_url = _pick_text(
        raw.get('coverUrl'), raw.get('cover_url_big'),
        raw.get('cover_url_medium'), raw.get('cover'),
        raw.get('coverurl'), raw.get('cover_url'),
        raw.get('bigpicUrl'), raw.get('picUrl'),
        raw.get('diss_cover'), raw.get('imgurl'),
        raw.get('picurl'), raw.get('logo'),
        dir_info.get('coverurl'), dir_info.get('cover_url'),
    )
    song_count = _to_int(
        raw.get('songCount') or raw.get('song_num') or raw.get('songnum')
        or raw.get('songNum') or raw.get('song_count') or raw.get('total_song_num')
        or raw.get('total_song_count') or raw.get('trackCount') or raw.get('track_count')
        or raw.get('total') or dir_info.get('song_num') or dir_info.get('song_count')
        or dir_info.get('total_song_num'),
    )
    creator = _pick_text(
        raw.get('creator_name'), raw.get('hostname'),
        raw.get('nickname'), raw.get('nick'),
        raw.get('creator') if isinstance(raw.get('creator'), str) else None,
        creator_info.get('name'), creator_info.get('nickname'),
        creator_info.get('creator_name'), dir_info.get('creator_name'),
    )
    description = _pick_text(
        raw.get('description'), raw.get('desc'),
        raw.get('diss_desc'), raw.get('descInfo'),
        dir_info.get('desc'), dir_info.get('description'),
    )
    raw_type = _pick_text(raw.get('type')).lower()
    ptype = 'liked' if str(dirid) == '201' else ('collected' if raw_type == 'collected' else 'created')
    return {
        'id': playlist_id,
        'songlistId': songlist_id,
        'dirid': dirid,
        'name': name,
        'coverUrl': cover_url,
        'songCount': song_count,
        'creator': creator,
        'description': description,
        'type': ptype,
    }


def _build_play_url(item: UrlinfoItem, credential: Credential | None = None) -> str:
    """Construct full CDN playback URL from relative purl."""
    if not item.purl:
        return ''
    if item.purl.startswith('http'):
        return item.purl
    # purl may already contain query params (vkey, guid, etc.) — use as-is
    if '?' in item.purl:
        return f'https://isure.stream.qqmusic.qq.com/{item.purl}'
    # Fallback: construct from vkey
    uin = str(credential.musicid) if credential and credential.musicid else ''
    parts = [f'vkey={item.vkey}'] if item.vkey else []
    if uin:
        parts.append(f'uin={uin}')
    parts.append('fromtag=38')
    return f'https://isure.stream.qqmusic.qq.com/{item.purl}?{"&".join(parts)}'


def _extract_first_playable_url(items: list[Any], credential: Credential | None = None) -> str:
    for item in items:
        play_url = _build_play_url(item, credential)
        if play_url:
            return play_url
    return ''


# ── Mid lookup cache ──────────────────────────────────────────────────────────

def _read_song_mid_cache(song_id: int) -> str:
    now = time.time()
    with _CACHE_LOCK:
        cached = _SONG_MID_CACHE.get(song_id)
    if cached is None or cached[1] <= now:
        return ''
    return cached[0]


def _write_song_mid_cache(song_id: int, song_mid: str) -> None:
    if song_id <= 0 or not song_mid:
        return
    with _CACHE_LOCK:
        _SONG_MID_CACHE[song_id] = (song_mid, time.time() + SONG_MID_CACHE_TTL_SECONDS)


async def _resolve_song_mid_from_detail(client: Client, song_id: int) -> str:
    if song_id <= 0:
        return ''
    detail = await client.execute(client.song.get_detail(song_id))
    track = detail.track if hasattr(detail, 'track') else None
    if track is None:
        return ''
    resolved_mid = _pick_text(getattr(track, 'mid', ''))
    if resolved_mid:
        _write_song_mid_cache(song_id, resolved_mid)
    return resolved_mid


def _build_song_url_quality_attempts(preferred_quality: str) -> list[tuple[str, SongFileType]]:
    normalized_quality = _pick_text(preferred_quality).lower() or '128'
    quality_map: dict[str, SongFileType] = {
        '128': SongFileType.MP3_128,
        '320': SongFileType.MP3_320,
        'flac': SongFileType.FLAC,
        'ogg': SongFileType.OGG_320,
    }
    if normalized_quality == 'flac':
        ordered_names = ['flac', 'ogg', '320', '128']
    elif normalized_quality == '320':
        ordered_names = ['320', 'ogg', '128', 'flac']
    else:
        ordered_names = ['128', 'ogg', '320', 'flac']

    attempts: list[tuple[str, SongFileType]] = []
    seen_names: set[str] = set()
    for quality_name in ordered_names:
        file_type = quality_map.get(quality_name)
        if file_type is None or quality_name in seen_names:
            continue
        seen_names.add(quality_name)
        attempts.append((quality_name, file_type))
    return attempts


# ── QQ liked playlist verification ────────────────────────────────────────────

def _extract_song_numeric_id(raw_song: Any) -> int:
    if hasattr(raw_song, 'id'):
        return _to_int(getattr(raw_song, 'id', 0))
    if isinstance(raw_song, dict):
        return _to_int(_extract_digits(raw_song.get('id') or raw_song.get('songid')))
    return 0


def _contains_song_id(raw_songs: list[Any], song_id: int) -> bool:
    return any(_extract_song_numeric_id(s) == song_id for s in raw_songs)


async def _is_song_in_qq_liked(client: Client, song_id: int, credential: Credential) -> bool | None:
    try:
        page = await client.execute(
            client.songlist.get_detail(201, dirid=201, num=QQ_LIKED_VERIFY_PAGE_SIZE, page=1, onlysong=True, tag=False, userinfo=False)
        )
    except Exception:
        return None
    songs = page.songs if hasattr(page, 'songs') else []
    if _contains_song_id(songs, song_id):
        return True
    total = getattr(page, 'total', 0) or 0
    max_pages = min(max(1, (total + QQ_LIKED_VERIFY_PAGE_SIZE - 1) // QQ_LIKED_VERIFY_PAGE_SIZE), QQ_LIKED_VERIFY_MAX_PAGES)
    for p in range(2, max_pages + 1):
        try:
            result = await client.execute(
                client.songlist.get_detail(201, dirid=201, num=QQ_LIKED_VERIFY_PAGE_SIZE, page=p, onlysong=True, tag=False, userinfo=False)
            )
        except Exception:
            return None
        next_songs = _extract_songs_from_result(result)
        if not next_songs:
            break
        if _contains_song_id(next_songs, song_id):
            return True
    return False


async def _verify_qq_liked_state(
    client: Client, song_id: int, expected: bool, credential: Credential,
) -> tuple[bool, bool | None, int]:
    latest: bool | None = None
    attempts = 0
    for delay in QQ_LIKED_VERIFY_DELAYS:
        if delay > 0:
            await asyncio.sleep(delay)
        attempts += 1
        observed = await _is_song_in_qq_liked(client, song_id, credential)
        if observed is None:
            continue
        latest = observed
        if observed == expected:
            return True, observed, attempts
    return False, latest, attempts


def _is_known_songlist_result_error(exc: Exception) -> bool:
    msg = str(exc).strip().lower()
    if not msg:
        return False
    if msg in {'result', "'result'", '"result"'}:
        return True
    return 'result' in msg and ('keyerror' in msg or 'missing key' in msg)


def _is_known_songlist_code_error(exc: Exception, code: int) -> bool:
    if isinstance(exc, ApiError) and getattr(exc, 'code', None) == code:
        return True
    return f'[{code}]' in str(exc).strip().lower()


# ── QR cache helpers ──────────────────────────────────────────────────────────

def _cleanup_expired_qr() -> None:
    deadline = time.time() - QR_TTL_SECONDS
    with _QR_LOCK:
        expired = [k for k, item in _QR_CACHE.items() if item.created_at < deadline]
        for key in expired:
            _QR_CACHE.pop(key, None)


# ── Lifecycle ─────────────────────────────────────────────────────────────────

@app.on_event('shutdown')
async def _shutdown() -> None:
    global _HTTPX_CLIENT, _shared_client
    http_client: httpx.AsyncClient | None = None
    with _CACHE_LOCK:
        http_client = _HTTPX_CLIENT
        _HTTPX_CLIENT = None
    if http_client is not None:
        await http_client.aclose()
    if _shared_client is not None:
        await _shared_client.close()
        _shared_client = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get('/health')
async def health() -> dict[str, Any]:
    return {"ok": True, "service": "qmusic-local-adapter", "version": "2.0.0", "qqapi": "0.5.1", "timestamp": _now_ms()}


# ── QR login ──────────────────────────────────────────────────────────────────

@app.get('/connect/qr/key')
async def connect_qr_key() -> Any:
    _cleanup_expired_qr()
    try:
        qr: QR = await _get_shared_client().login.get_qrcode(QRLoginType.QQ)
    except Exception as exc:
        return _error(-1, f"Failed to request QQ QR code: {exc}", status_code=500)
    payload_b64 = base64.b64encode(qr.data).decode('ascii')
    item = QRCacheItem(identifier=qr.identifier, qr_type=qr.qr_type, mimetype=qr.mimetype or 'image/png', payload_b64=payload_b64, created_at=time.time())
    with _QR_LOCK:
        _QR_CACHE[item.identifier] = item
    return _success({"unikey": item.identifier, "qr_data": item.payload_b64, "mimetype": item.mimetype})


@app.get('/connect/qr/create')
async def connect_qr_create(key: str = Query(...), qrimg: bool = Query(True)) -> Any:
    _cleanup_expired_qr()
    with _QR_LOCK:
        item = _QR_CACHE.get(key)
    if not item:
        return _error(-801, 'QR code expired, please refresh.', status_code=404)
    qrimg_value = f"data:{item.mimetype};base64,{item.payload_b64}" if qrimg else None
    return _success({"qrurl": item.payload_b64, "qrimg": qrimg_value, "mimetype": item.mimetype})


@app.get('/connect/qr/check')
async def connect_qr_check(key: str = Query(...)) -> Any:
    _cleanup_expired_qr()
    with _QR_LOCK:
        item = _QR_CACHE.get(key)
    if not item:
        return _success({"status": -1, "cookie": None})
    qr = QR(data=base64.b64decode(item.payload_b64), qr_type=item.qr_type, mimetype=item.mimetype, identifier=item.identifier)
    try:
        result: QRLoginResult = await _get_shared_client().login.check_qrcode(qr)
    except Exception as exc:
        return _error(-1, f"Failed to check QQ QR status: {exc}", status_code=500)
    status_map = {
        QRCodeLoginEvents.SCAN: 0, QRCodeLoginEvents.CONF: 1, QRCodeLoginEvents.DONE: 2,
        QRCodeLoginEvents.TIMEOUT: -1, QRCodeLoginEvents.REFUSE: -1, QRCodeLoginEvents.OTHER: -1,
    }
    status = status_map.get(result.event, -1)
    cookie_payload = None
    if status == 2 and result.credential is not None:
        cookie_payload = result.credential.model_dump_json()
    if status in (2, -1):
        with _QR_LOCK:
            _QR_CACHE.pop(key, None)
    return _success({"status": status, "cookie": cookie_payload})


# ── Connection status ────────────────────────────────────────────────────────

@app.get('/connect/status')
async def connect_status(request: Request) -> Any:
    raw_cookie = _extract_raw_cookie(request)
    if not raw_cookie:
        return _error(-1, 'Missing auth cookie.', status_code=401)
    credential = _credential_from_payload(raw_cookie)
    if credential is not None:
        try:
            async with _auth_client(credential) as client:
                result = await client.execute(client.user.get_homepage(credential.encrypt_uin))
            info = result.base_info
            return _success({"id": credential.musicid, "name": info.name or 'QQ Music User', "avatar": info.avatar or ''})
        except Exception:
            pass
    guessed_uin = _extract_uin(raw_cookie)
    if not guessed_uin and credential is not None:
        guessed_uin = _extract_digits(credential.musicid)
    return _success({"id": guessed_uin or 'unknown', "name": 'QQ Music User', "avatar": ''})


# ── Playlists ─────────────────────────────────────────────────────────────────

@app.get('/playlist/user')
async def playlist_user(
    request: Request,
    uin: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
) -> Any:
    raw_cookie = _extract_raw_cookie(request)
    credential = _credential_from_payload(raw_cookie) if raw_cookie else None

    target_uin = ''
    if credential is not None:
        target_uin = _extract_digits(credential.musicid) or ''
    if not target_uin and raw_cookie:
        target_uin = _extract_uin(raw_cookie) or ''
    if not target_uin:
        target_uin = _extract_digits(uin) or ''
    if not target_uin:
        return _error(-1, 'Missing uin and cannot derive it from cookie.', status_code=400)

    try:
        async with _auth_client(credential) if credential else _shared_client_cm() as client:
            result = await client.execute(client.user.get_created_songlist(int(target_uin)))
    except (NotLoginError, LoginExpiredError, CredentialError) as exc:
        return _error(-1, f'QQ 登录已过期，请重新扫码登录: {exc}', status_code=401)
    except Exception as exc:
        return _error(-1, f'Failed to load QQ playlists: {exc}', status_code=500)

    playlists = result.playlists if hasattr(result, 'playlists') else []
    normalized = []
    for item in playlists[:limit]:
        ni = _normalize_playlist(item)
        if ni['id']:
            normalized.append(ni)
    return _success({'uin': target_uin, 'total': len(normalized), 'playlists': normalized})


@app.get('/playlist/detail')
async def playlist_detail(
    request: Request,
    id: str = Query(...),
    dirid: str | None = Query(default=None),
    limit: int = Query(default=300, ge=1, le=500),
) -> Any:
    raw_cookie = _extract_raw_cookie(request)
    credential = _credential_from_payload(raw_cookie) if raw_cookie else None
    songlist_id = _to_int(id)
    explicit_dirid = _to_int(dirid) if dirid else 0

    # Build ordered, deduplicated (songlist_id, dirid) pairs to try
    pairs: list[tuple[int, int]] = []
    if songlist_id > 0:
        pairs.append((songlist_id, explicit_dirid))
        if explicit_dirid == 0:
            pairs.append((songlist_id, songlist_id))
    if explicit_dirid > 0:
        pairs.append((0, explicit_dirid))
        if songlist_id == 0:
            pairs.append((explicit_dirid, explicit_dirid))
    seen: set[tuple[int, int]] = set()
    deduped = [p for p in pairs if not (p in seen or seen.add(p))]

    detail_data: Any = None
    selected_pair: tuple[int, int] | None = None
    last_error: Exception | None = None

    async with _auth_client(credential) if credential else _shared_client_cm() as client:
        for sl_id, dr_id in deduped:
            try:
                candidate = await client.execute(
                    client.songlist.get_detail(sl_id, dirid=dr_id, num=limit, page=1, onlysong=True, tag=False, userinfo=True)
                )
                info = candidate.info if hasattr(candidate, 'info') else None
                candidate_dir_id = getattr(info, 'dirid', 0) or 0
                if explicit_dirid > 0 and candidate_dir_id > 0 and candidate_dir_id != explicit_dirid:
                    continue
                candidate_songs = candidate.songs if hasattr(candidate, 'songs') else []
                if detail_data is None:
                    detail_data = candidate
                    selected_pair = (sl_id, dr_id)
                if candidate_songs:
                    detail_data = candidate
                    selected_pair = (sl_id, dr_id)
                    break
            except Exception as exc:
                last_error = exc

    if detail_data is None:
        msg = f'Failed to load QQ playlist detail: {last_error}' if last_error else 'Failed to load QQ playlist detail.'
        return _error(-1, msg, status_code=500)

    raw_songs: list[Any] = list(detail_data.songs if hasattr(detail_data, 'songs') else [])
    page_size = max(1, min(limit, 500))
    total_songs = getattr(detail_data, 'total', 0) or len(raw_songs)

    # Paginate remaining pages
    if selected_pair and total_songs > len(raw_songs):
        expected_pages = max(1, (total_songs + page_size - 1) // page_size)
        seen_keys: set[str] = set()
        for song in raw_songs:
            sid = str(getattr(song, 'id', '') or getattr(song, 'mid', '') or '')
            if sid:
                seen_keys.add(sid)
        for page in range(2, expected_pages + 1):
            try:
                next_detail = await client.execute(
                    client.songlist.get_detail(selected_pair[0], dirid=selected_pair[1], num=page_size, page=page, onlysong=True, tag=False, userinfo=False)
                )
            except Exception:
                break
            next_songs = list(next_detail.songs if hasattr(next_detail, 'songs') else [])
            if not next_songs:
                break
            appended = 0
            for song in next_songs:
                sid = str(getattr(song, 'id', '') or getattr(song, 'mid', '') or '')
                if sid and sid in seen_keys:
                    continue
                if sid:
                    seen_keys.add(sid)
                raw_songs.append(song)
                appended += 1
            if appended == 0 or len(raw_songs) >= total_songs:
                break

    normalized_songs = []
    for item in raw_songs:
        ni = _normalize_song(item)
        if ni.get('id') or ni.get('mid'):
            normalized_songs.append(ni)

    info = detail_data.info if hasattr(detail_data, 'info') else None
    playlist_name = getattr(info, 'title', '') if info else ''
    response_total = max(total_songs, len(normalized_songs))

    return _success({'id': id, 'dirid': dirid, 'name': playlist_name, 'total': response_total, 'songs': normalized_songs})


# ── Like / Unlike ───────────────────────────────────────────────────────────

@app.post('/playlist/like')
async def playlist_like(
    request: Request,
    id: str = Query(...),
    like: int = Query(default=1),
) -> Any:
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

    # v0.5.1: add_songs/del_songs take list[tuple[int, int]] (song_id, song_type)
    song_info = [(song_id_num, 0)]

    async with _auth_client(credential) as client:
        try:
            write_meta: dict[str, Any] = {}
            if is_like:
                for attempt in range(2):
                    try:
                        result = await client.songlist.add_songs(dirid=201, song_info=song_info, credential=credential)
                        write_meta = {'already': not bool(result)}
                        break
                    except Exception as exc:
                        if _is_known_songlist_result_error(exc):
                            if attempt == 0:
                                await asyncio.sleep(0.2)
                                continue
                            write_meta = {'already': False, 'assumed': True}
                            break
                        raise
                if not write_meta:
                    return _error(-1, 'Failed to update QQ liked songs.', status_code=500)
            else:
                for attempt in range(2):
                    try:
                        await client.songlist.del_songs(dirid=201, song_info=song_info, credential=credential)
                        break
                    except Exception as exc:
                        if _is_known_songlist_code_error(exc, 2001):
                            break
                        if _is_known_songlist_result_error(exc) and attempt == 0:
                            await asyncio.sleep(0.2)
                            continue
                        raise

            verified, actual_liked, verify_attempts = await _verify_qq_liked_state(client, song_id_num, is_like, credential)
            resolved = is_like if actual_liked is None else actual_liked
            payload: dict[str, Any] = {
                'songId': song_id, 'liked': resolved, 'expectedLiked': is_like,
                'verified': verified, 'verifyAttempts': verify_attempts, **write_meta,
            }
            if not verified:
                payload['warning'] = 'QQ liked playlist is still syncing; please refresh shortly.'
            return _success(payload)
        except Exception as exc:
            return _error(-1, f'Failed to update QQ liked songs: {exc}', status_code=500)


# ── Song URL ─────────────────────────────────────────────────────────────────

@app.get('/song/url')
async def song_url(
    request: Request,
    mid: str | None = Query(default=None),
    id: str | None = Query(default=None),
    quality: str = Query(default='128'),
) -> Any:
    raw_cookie = _extract_raw_cookie(request)
    credential = _credential_from_payload(raw_cookie) if raw_cookie else None
    normalized_mid = _pick_text(mid)
    normalized_song_id = _to_int(_extract_digits(id), default=0) if id else 0
    t0 = time.monotonic()

    if not normalized_mid and normalized_song_id > 0:
        normalized_mid = _read_song_mid_cache(normalized_song_id)
    if not normalized_mid and normalized_song_id > 0:
        try:
            async with _auth_client(credential) if credential else _shared_client_cm() as client:
                normalized_mid = await _resolve_song_mid_from_detail(client, normalized_song_id)
        except Exception:
            normalized_mid = ''

    if not normalized_mid:
        return _error(-1, 'Missing QQ song mid (or unable to resolve from song id).', status_code=400)

    requested_quality = _pick_text(quality).lower() or '128'
    quality_attempts = _build_song_url_quality_attempts(requested_quality)
    play_url = ''
    resolved_quality = requested_quality

    try:
        async with _auth_client(credential) if credential else _shared_client_cm() as client:
            mid_candidates = [normalized_mid]
            attempted_mids: set[str] = set()

            while mid_candidates and not play_url:
                current_mid = _pick_text(mid_candidates.pop(0))
                if not current_mid or current_mid in attempted_mids:
                    continue
                attempted_mids.add(current_mid)

                for quality_name, file_type in quality_attempts:
                    result = await client.execute(
                        client.song.get_song_urls(file_info=[SongFileInfo(mid=current_mid)], file_type=file_type)
                    )
                    items = result.data if hasattr(result, 'data') else []
                    play_url = _extract_first_playable_url(items, credential)
                    if play_url:
                        normalized_mid = current_mid
                        resolved_quality = quality_name
                        break

                if play_url or normalized_song_id <= 0:
                    continue

                try:
                    refreshed_mid = await _resolve_song_mid_from_detail(client, normalized_song_id)
                except Exception:
                    refreshed_mid = ''
                if refreshed_mid and refreshed_mid not in attempted_mids and refreshed_mid != current_mid:
                    mid_candidates.append(refreshed_mid)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return _error(-1, f'Failed to fetch QQ song url: {exc}', status_code=500)

    if not play_url:
        logger.warning(
            'qq song url unresolved: song_id=%s mid=%s requested_quality=%s',
            normalized_song_id,
            normalized_mid,
            requested_quality,
        )
        return _error(-1, 'No playable QQ song url returned.', status_code=404)

    print(f'[SONG_URL] mid={normalized_mid} quality={resolved_quality} elapsed={((time.monotonic() - t0) * 1000):.0f}ms')
    return _success({
        'mid': normalized_mid, 'songId': normalized_song_id or None,
        'quality': resolved_quality, 'url': play_url,
    })


# ── Song stream proxy ─────────────────────────────────────────────────────────

@app.get('/song/stream')
async def song_stream(request: Request, target: str = Query(...)) -> Any:
    stream_target = _sanitize_stream_target(target)
    if not stream_target:
        return _error(-1, 'Missing or invalid stream target.', status_code=400)
    try:
        client = _get_httpx_client()
        upstream_req = client.build_request('GET', stream_target, headers=_build_stream_forward_headers(request))
        upstream_resp = await client.send(upstream_req, stream=True)
    except Exception as exc:
        return _error(-1, f'Failed to open QQ audio stream: {exc}', status_code=502)
    if upstream_resp.status_code >= 400:
        await upstream_resp.aclose()
        return _error(-1, f'QQ audio stream upstream returned HTTP {upstream_resp.status_code}.', status_code=502)
    resp_headers = _build_stream_response_headers(upstream_resp.headers)
    media_type = upstream_resp.headers.get('content-type', 'audio/mpeg')

    async def iter_stream() -> Any:
        try:
            async for chunk in upstream_resp.aiter_bytes():
                if chunk:
                    yield chunk
        finally:
            await upstream_resp.aclose()

    return StreamingResponse(iter_stream(), status_code=upstream_resp.status_code, headers=resp_headers, media_type=media_type)


# ── Lyric ─────────────────────────────────────────────────────────────────────

@app.get('/song/lyric')
async def song_lyric(
    request: Request,
    mid: str | None = Query(default=None),
    id: str | None = Query(default=None),
) -> Any:
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
        async with _auth_client(credential) if credential else _shared_client_cm() as client:
            lyric_result = await client.execute(client.lyric.get_lyric(lookup_value, qrc=False, trans=True, roma=False))
            if getattr(lyric_result, 'crypt', 0) == 1:
                lyric_result = lyric_result.decrypt()
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return _error(-1, f'Failed to fetch QQ song lyric: {exc}', status_code=500)
    lyric = getattr(lyric_result, 'lyric', '') or ''
    trans = getattr(lyric_result, 'trans', '') or ''
    if not lyric and not trans:
        return _error(-1, 'No QQ song lyric returned.', status_code=404)
    return _success({'mid': normalized_mid or None, 'songId': normalized_song_id or None, 'lyric': lyric, 'trans': trans})


# ── Daily recommendations ─────────────────────────────────────────────────────

@app.get('/recommend/daily')
async def recommend_daily(
    request: Request,
    limit: int = Query(default=30, ge=1, le=100),
) -> Any:
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
        except Exception as exc:
            return _error(-1, f'Failed to load QQ personalized recommendation source: {exc}', status_code=500)

        resolved = _extract_personal_daily_playlist(homepage_html)
        if not resolved:
            logger.warning('qq daily playlist marker not found in homepage html')
            return _error(-1, 'QQ personalized daily playlist is not available.', status_code=404)

        playlist_id, playlist_title = resolved
        _write_daily_playlist_cache(cache_key, playlist_id, playlist_title)
    else:
        playlist_id, playlist_title = cached_playlist

    songlist_id = _to_int(playlist_id)
    if songlist_id <= 0:
        return _error(-1, 'QQ personalized daily playlist id is invalid.', status_code=500)

    try:
        async with _auth_client(credential) as client:
            detail = await client.execute(
                client.songlist.get_detail(
                    songlist_id,
                    dirid=0,
                    num=min(max(limit, 1), 100),
                    page=1,
                    onlysong=True,
                    tag=False,
                    userinfo=False,
                )
            )
    except Exception as exc:
        return _error(-1, f'Failed to load QQ personalized daily songs: {exc}', status_code=500)

    raw_songs = list(detail.songs if hasattr(detail, 'songs') else [])
    normalized_songs = _normalize_song_list(raw_songs, limit)
    if not normalized_songs:
        logger.warning('qq daily playlist resolved but returned empty songs: playlist_id=%s', playlist_id)
        return _error(-1, 'QQ personalized daily songs is empty.', status_code=404)
    return _success({
        'title': playlist_title or '今日私享',
        'playlistId': playlist_id,
        'total': len(normalized_songs),
        'songs': normalized_songs,
    })


@app.get('/recommend/daily/probe')
async def recommend_daily_probe(
    request: Request,
    refresh: int = Query(default=1),
    sample: int = Query(default=5, ge=1, le=10),
) -> Any:
    raw_cookie = _extract_raw_cookie(request)
    if not raw_cookie:
        return _error(-1, 'Missing auth cookie.', status_code=401)
    credential = _credential_from_payload(raw_cookie)
    if credential is None:
        return _error(-1, 'Invalid auth cookie.', status_code=401)
    try:
        async with _auth_client(credential) as client:
            result = await client.execute(client.recommend.get_radar_recommend(page=1))
    except Exception as exc:
        return _error(-1, f'Failed to load QQ daily recommendation probe: {exc}', status_code=500)
    raw_songs = _extract_songs_from_result(result)
    sample_songs = _normalize_song_list(raw_songs, sample)
    current_music_id = credential.str_musicid or str(credential.musicid) or ''
    return _success({
        'source': 'api.radar_recommend',
        'sourceKind': 'paginated-song-stream',
        'title': '每日推荐',
        'trackCount': len(raw_songs),
        'hasMore': getattr(result, 'has_more', False),
        'streamMeta': {'currentMusicId': current_music_id or None, 'hasPlaylistId': False, 'hasDirid': False},
        'writeHeuristic': {'canAttemptDirWriteProbe': False, 'reason': 'get_radar_recommend() does not return a writable playlist context.'},
        'sampleSongs': sample_songs,
    })


@app.post('/recommend/daily/write-probe')
async def recommend_daily_write_probe(
    request: Request,
    refresh: int = Query(default=1),
    restore: int = Query(default=1),
    song_id: str | None = Query(default=None, alias='songId'),
) -> Any:
    raw_cookie = _extract_raw_cookie(request)
    if not raw_cookie:
        return _error(-1, 'Missing auth cookie.', status_code=401)
    credential = _credential_from_payload(raw_cookie)
    if credential is None:
        return _error(-1, 'Invalid auth cookie.', status_code=401)
    try:
        async with _auth_client(credential) as client:
            result = await client.execute(client.recommend.get_radar_recommend(page=1))
    except Exception as exc:
        return _error(-1, f'Failed to resolve QQ daily recommendation source: {exc}', status_code=500)
    raw_songs = _extract_songs_from_result(result)
    sample_songs = _normalize_song_list(raw_songs, 5)
    return _error(
        -1,
        'get_radar_recommend() does not expose a writable playlist context (dirid/songlistId).',
        status_code=409,
        data={
            'probe': {
                'source': 'api.radar_recommend', 'sourceKind': 'paginated-song-stream',
                'title': '每日推荐', 'trackCount': len(raw_songs), 'sampleSongs': sample_songs,
            },
            'requestedSongId': _to_int(_extract_digits(song_id)) or None,
            'writeAttempted': False,
            'reason': 'No writable dirid/songlistId from get_radar_recommend().',
        },
    )


# ── Search ────────────────────────────────────────────────────────────────────

@app.get('/search/songs')
async def search_songs(
    keyword: str = Query(..., min_length=1),
    limit: int = Query(default=20, ge=1, le=50),
    page: int = Query(default=1, ge=1),
) -> Any:
    client = _get_shared_client()
    last_error: Exception | None = None
    raw_result = None
    for attempt in range(2):
        try:
            raw_result = await client.execute(client.search.search_by_type(keyword=keyword, search_type=0, num=limit, page=page))
            last_error = None
            break
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                await asyncio.sleep(0.3)
    if last_error is not None:
        return _error(-1, f'Failed to search QQ songs: {last_error}', status_code=500)
    song_list = raw_result.song if hasattr(raw_result, 'song') else []
    normalized = []
    for item in song_list:
        ni = _normalize_song(item)
        if ni.get('id') or ni.get('mid'):
            normalized.append(ni)
    return _success({'keyword': keyword, 'page': page, 'total': len(normalized), 'songs': normalized})
