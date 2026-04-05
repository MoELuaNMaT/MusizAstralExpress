from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any

import requests


TIME_CANDIDATES = [
    'addedAt',
    'at',
    'join_time',
    'joinTime',
    'add_time',
    'addTime',
    'addtime',
    'ctime',
    'create_time',
    'createTime',
    'ordertime',
]


@dataclass
class ProbeSummary:
    endpoint: str
    total_songs: int
    sampled_songs: int
    non_empty_time_hits: dict[str, int]
    time_like_keys: list[str]



def _load_qq_credential_json() -> dict[str, Any]:
    auth_path = os.path.join(os.environ.get('APPDATA', ''), 'com.allmusic.app', 'auth_store.json')
    with open(auth_path, 'r', encoding='utf-8') as fh:
        store = json.load(fh)

    raw_cookie = ((store.get('auth_qq') or {}).get('cookie') or '').strip()
    if not raw_cookie:
        raise RuntimeError('auth_store.json 中未找到 auth_qq.cookie')

    try:
        payload = json.loads(raw_cookie)
    except json.JSONDecodeError as exc:
        raise RuntimeError('auth_qq.cookie 不是 JSON 凭证，无法自动探测。') from exc

    if not isinstance(payload, dict):
        raise RuntimeError('auth_qq.cookie JSON 结构异常。')

    return payload



def _extract_uin(payload: dict[str, Any]) -> str:
    for key in ('musicid', 'str_musicid', 'uin', 'p_uin', 'qqmusic_uin'):
        value = str(payload.get(key, '')).strip()
        matched = re.search(r'(\d+)', value)
        if matched:
            return matched.group(1)
    return ''



def _build_cookie_jar(payload: dict[str, Any], uin: str) -> dict[str, str]:
    music_key = str(payload.get('musickey') or payload.get('qqmusic_key') or '').strip()
    jar = {
        'uin': f'o{uin}' if uin else '',
        'p_uin': f'o{uin}' if uin else '',
        'qqmusic_uin': uin,
        'qqmusic_key': music_key,
        'qm_keyst': music_key,
    }
    return {k: v for k, v in jar.items() if v}



def _scan_time_fields(songs: list[dict[str, Any]]) -> tuple[dict[str, int], list[str]]:
    hits: dict[str, int] = {field: 0 for field in TIME_CANDIDATES}
    discovered_keys: set[str] = set()

    for song in songs:
        if not isinstance(song, dict):
            continue

        nested_data = song.get('data') if isinstance(song.get('data'), dict) else {}

        for field in TIME_CANDIDATES:
            top_value = song.get(field)
            nested_value = nested_data.get(field)
            if top_value not in (None, '', 0, '0'):
                hits[field] += 1
            if nested_value not in (None, '', 0, '0'):
                hits[field] += 1

        for key in song.keys():
            lk = key.lower()
            if 'time' in lk or 'join' in lk or 'add' in lk or 'order' in lk:
                discovered_keys.add(f'top.{key}')

        for key in nested_data.keys():
            lk = key.lower()
            if 'time' in lk or 'join' in lk or 'add' in lk or 'order' in lk:
                discovered_keys.add(f'data.{key}')

    non_empty = {k: v for k, v in hits.items() if v > 0}
    return non_empty, sorted(discovered_keys)



def probe_profile_order_asset(cookie_jar: dict[str, str], uin: str, pages: int = 3) -> ProbeSummary:
    headers = {
        'Referer': 'https://y.qq.com/portal/profile.html',
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ),
    }

    all_songs: list[dict[str, Any]] = []
    totalsong = 0

    for page in range(pages):
        start = page * 100
        params = {
            'g_tk': 5381,
            'loginUin': uin,
            'hostUin': 0,
            'format': 'json',
            'inCharset': 'utf8',
            'outCharset': 'utf-8',
            'notice': 0,
            'platform': 'yqq.json',
            'needNewCode': 0,
            'ct': 20,
            'cid': 205360956,
            'userid': uin,
            'reqtype': 1,
            'sin': start,
            'ein': start + 99,
        }

        resp = requests.get(
            'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg',
            params=params,
            headers=headers,
            cookies=cookie_jar,
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get('code') != 0:
            raise RuntimeError(f'reqtype=1 返回异常 code={data.get("code")}')

        payload = data.get('data') if isinstance(data.get('data'), dict) else {}
        totalsong = int(payload.get('totalsong') or totalsong or 0)
        page_songs = payload.get('songlist') if isinstance(payload.get('songlist'), list) else []
        all_songs.extend(item for item in page_songs if isinstance(item, dict))

        has_more = int(payload.get('has_more') or 0)
        if has_more == 0:
            break

    non_empty_time_hits, time_like_keys = _scan_time_fields(all_songs)

    return ProbeSummary(
        endpoint='c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg?reqtype=1',
        total_songs=totalsong,
        sampled_songs=len(all_songs),
        non_empty_time_hits=non_empty_time_hits,
        time_like_keys=time_like_keys,
    )



def main() -> None:
    payload = _load_qq_credential_json()
    uin = _extract_uin(payload)
    if not uin:
        raise RuntimeError('无法从 auth_qq.cookie 提取 uin。')

    cookie_jar = _build_cookie_jar(payload, uin)
    if 'qqmusic_key' not in cookie_jar:
        raise RuntimeError('缺少 qqmusic_key/musickey，无法访问收藏接口。')

    summary = probe_profile_order_asset(cookie_jar, uin)

    print('[QQ Added-Time Probe]')
    print(f'endpoint      : {summary.endpoint}')
    print(f'sampled/total : {summary.sampled_songs}/{summary.total_songs}')
    print(f'time hits     : {summary.non_empty_time_hits or "<none>"}')
    print(f'time-like keys: {summary.time_like_keys or "<none>"}')

    if summary.non_empty_time_hits:
        print('result        : FOUND_TIME_FIELDS')
    else:
        print('result        : NO_PER_SONG_ADDED_TIME_FIELD')


if __name__ == '__main__':
    main()
