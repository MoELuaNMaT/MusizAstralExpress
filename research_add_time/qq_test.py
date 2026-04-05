import asyncio, json
from qqmusic_api.songlist import get_detail
async def main():
    try:
        detail = await get_detail(songlist_id=8905204431, num=5)
        if 'songlist' in detail and len(detail['songlist']) > 0:
            print("First Song Data:")
            print(json.dumps(detail['songlist'][0], indent=2, ensure_ascii=False))
    except Exception as e: print(f"Error: {e}")
if __name__ == "__main__": asyncio.run(main())
