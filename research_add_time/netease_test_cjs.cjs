const { playlist_detail } = require('NeteaseCloudMusicApi');
async function main() {
    try {
        const result = await playlist_detail({ id: '24381616' });
        const trackIds = result.body.playlist.trackIds;
        console.log("Netease Add Time (at) Example:");
        console.log(trackIds.slice(0, 3).map(t => ({ id: t.id, at: t.at, date: new Date(t.at).toLocaleString() })));
    } catch (e) { console.error(e); }
}
main();
