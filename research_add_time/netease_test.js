import { playlist_detail } from 'NeteaseCloudMusicApi';
async function main() {
    try {
        const result = await playlist_detail({ id: '24381616' });
        const playlist = result.body.playlist;
        console.log("trackIds Sample:");
        console.log(JSON.stringify(playlist.trackIds.slice(0, 3), null, 2));
    } catch (e) { console.error(e); }
}
main();
