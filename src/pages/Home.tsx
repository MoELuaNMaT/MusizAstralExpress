import { useHomeData } from '@/hooks/useHomeData';
import { useHomeHandlers } from '@/hooks/useHomeHandlers';
import { HomeHeader } from '@/components/home/home-header';
import { PlaylistsPanel } from '@/components/home/playlists-panel';
import { HistoryPanel } from '@/components/home/history-panel';
import { DailyPanel } from '@/components/home/daily-panel';
import { MobileBottomNav } from '@/components/home/mobile-bottom-nav';
import { PlayerBar } from '@/components/player/player-bar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { text } from '@/constants/home.constants';

export function HomePage() {
  const data = useHomeData();
  const handlers = useHomeHandlers(data);

  if (!data.mounted || data.isLoading) {
    return (
      <div className="am-screen h-full flex items-center justify-center">
        <div className="text-slate-300 flex items-center gap-2">
          <Spinner size="sm" />
          <span>{text.loading}</span>
        </div>
      </div>
    );
  }

  if (!data.isAuthenticated) {
    return (
      <div className="am-screen h-full flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-slate-300 space-y-4">
            <p>{text.loginRequired}</p>
            <Button variant="primary" onClick={() => window.location.reload()}>
              {text.backToLogin}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="am-screen relative isolate h-full overflow-hidden flex flex-col text-white">
      <div className="am-ambient-bg" aria-hidden="true">
        <span className="am-ambient-orb am-ambient-orb-violet" />
        <span className="am-ambient-orb am-ambient-orb-cyan" />
        <span className="am-ambient-orb am-ambient-orb-pink" />
      </div>
      <div className="am-spark-layer" aria-hidden="true">
        <span className="am-spark am-spark-pink" style={{ left: '6%', top: '11%', animationDuration: '2.8s' }} />
        <span className="am-spark am-spark-cyan" style={{ left: '18%', top: '26%', animationDuration: '3.1s' }} />
        <span className="am-spark am-spark-violet" style={{ left: '34%', top: '13%', animationDuration: '2.2s' }} />
        <span className="am-spark am-spark-pink" style={{ left: '62%', top: '18%', animationDuration: '2.5s' }} />
        <span className="am-spark am-spark-cyan" style={{ left: '78%', top: '9%', animationDuration: '2.9s' }} />
        <span className="am-spark am-spark-violet" style={{ left: '12%', top: '68%', animationDuration: '2.4s' }} />
        <span className="am-spark am-spark-pink" style={{ left: '57%', top: '76%', animationDuration: '2.1s' }} />
        <span className="am-spark am-spark-cyan" style={{ left: '88%', top: '72%', animationDuration: '2.7s' }} />
      </div>

      <HomeHeader
        isMobileRuntime={data.isMobileRuntime}
        keyword={data.keyword}
        onKeywordChange={data.setKeyword}
        isSearchDropdownOpen={data.isSearchDropdownOpen}
        onOpenSearchDropdown={() => data.setIsSearchDropdownOpen(true)}
        isSearching={data.isSearching}
        searchPlatformFilter={data.searchPlatformFilter}
        onSetSearchPlatformFilter={data.setSearchPlatformFilter}
        searchSuggestions={data.searchSuggestions}
        searchHistory={data.searchHistory}
        searchResults={data.searchResults}
        filteredSearchResults={data.filteredSearchResults}
        searchWarnings={data.searchWarnings}
        searchError={data.searchError}
        onSearch={handlers.handleSearch}
        onApplySearchKeyword={handlers.handleApplySearchKeyword}
        onClearSearchHistory={handlers.handleClearSearchHistory}
        searchDropdownRef={data.searchDropdownRef}
        containerRef={data.searchResultContainerRef}
        measureRef={data.searchResultMeasureRef}
        virtualStart={data.searchVirtualStart}
        virtualEnd={data.searchVirtualEnd}
        totalHeight={data.searchVirtualTotalHeight}
        itemHeight={data.searchVirtualItemHeight}
        virtualItems={data.virtualSearchResults}
        playingSongId={data.playingSongId}
        isPlayerPlaying={data.isPlayerPlaying}
        selectedSongKey={data.selectedSongKey}
        doublePlayCueSongKey={data.doublePlayCueSongKey}
        likingSongIds={data.likingSongIds}
        onSelectSong={handlers.handleSelectSong}
        onSearchPlayAt={handlers.handleSearchPlayAt}
        onSearchDoublePlayAt={handlers.handleSearchDoublePlayAt}
        onLikeSongAction={handlers.handleLikeSongAction}
        users={data.users}
        neteaseDisplayNickname={data.neteaseDisplayNickname}
        qqDisplayNickname={data.qqDisplayNickname}
        onRemoveUser={data.removeUser}
      />

      <main className={`am-home-main relative z-20 container mx-auto flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-4 ${data.isMobileRuntime ? 'pb-52' : 'pb-36'}`}>
        <PlaylistsPanel
          isMobileRuntime={data.isMobileRuntime}
          panelTab={data.panelTab}
          setPanelTab={data.setPanelTab}
          isInitialPlaylistBootstrapPending={data.isInitialPlaylistBootstrapPending}
          initialPlaylistBootstrapMessage={data.initialPlaylistBootstrapMessage}
          isPlaylistLoading={data.isPlaylistLoading}
          playlistError={data.playlistError}
          playlists={data.playlists}
          playlistWarnings={data.playlistWarnings}
          selectedPlaylist={data.selectedPlaylist}
          onSelectPlaylist={data.loadPlaylistDetail}
          playlistDetailSongs={data.playlistDetailSongs}
          playlistDetailError={data.playlistDetailError}
          isDetailLoading={data.isDetailLoading}
          isDetailRefreshing={data.isDetailRefreshing}
          isNeteaseLikedPlaylistSelected={data.isNeteaseLikedPlaylistSelected}
          isDetailBusy={data.isDetailBusy}
          neteaseLikedOrder={data.neteaseLikedOrder}
          onNeteaseLikedOrderChange={handlers.handleNeteaseLikedOrderChange}
          onForceRefreshNeteaseWebOrder={handlers.handleForceRefreshNeteaseWebOrder}
          onRefresh={handlers.handleRefresh}
          isSearching={data.isSearching}
          isDailyLoading={data.isDailyLoading}
          containerRef={data.playlistDetailContainerRef}
          measureRef={data.playlistDetailMeasureRef}
          virtualStart={data.playlistDetailVirtualStart}
          virtualEnd={data.playlistDetailVirtualEnd}
          totalHeight={data.playlistDetailVirtualTotalHeight}
          itemHeight={data.playlistDetailVirtualItemHeight}
          virtualItems={data.virtualPlaylistDetailSongs}
          playingSongId={data.playingSongId}
          isPlayerPlaying={data.isPlayerPlaying}
          selectedSongKey={data.selectedSongKey}
          doublePlayCueSongKey={data.doublePlayCueSongKey}
          likingSongIds={data.likingSongIds}
          onSelectSong={handlers.handleSelectSong}
          onDetailPlayAt={handlers.handleDetailPlayAt}
          onDetailDoublePlayAt={handlers.handleDetailDoublePlayAt}
          onLikeSongAction={handlers.handleLikeSongAction}
          onScrollableWheel={handlers.handleScrollableWheel}
        />

        <HistoryPanel
          isMobileRuntime={data.isMobileRuntime}
          panelTab={data.panelTab}
          setPanelTab={data.setPanelTab}
          playerHistory={data.playerHistory}
          clearPlayerHistory={data.clearPlayerHistory}
          containerRef={data.historySongContainerRef}
          measureRef={data.historySongMeasureRef}
          virtualStart={data.historyVirtualStart}
          virtualEnd={data.historyVirtualEnd}
          totalHeight={data.historyVirtualTotalHeight}
          itemHeight={data.historyVirtualItemHeight}
          virtualItems={data.virtualHistorySongs}
          playingSongId={data.playingSongId}
          isPlayerPlaying={data.isPlayerPlaying}
          selectedSongKey={data.selectedSongKey}
          doublePlayCueSongKey={data.doublePlayCueSongKey}
          likingSongIds={data.likingSongIds}
          onSelectSong={handlers.handleSelectSong}
          onHistoryPlayAt={handlers.handleHistoryPlayAt}
          onHistoryDoublePlayAt={handlers.handleHistoryDoublePlayAt}
          onLikeSongAction={handlers.handleLikeSongAction}
          onScrollableWheel={handlers.handleScrollableWheel}
        />

        <DailyPanel
          panelTab={data.panelTab}
          setPanelTab={data.setPanelTab}
          dailySourceTab={data.dailySourceTab}
          setDailySourceTab={data.setDailySourceTab}
          dailySongs={data.dailySongs}
          dailyNeteaseSongs={data.dailyNeteaseSongs}
          dailyQQSongs={data.dailyQQSongs}
          activeDailySongs={data.activeDailySongs}
          dailyWarnings={data.dailyWarnings}
          dailyError={data.dailyError}
          isDailyLoading={data.isDailyLoading}
          onRefreshDaily={handlers.handleRefreshDaily}
          containerRef={data.dailySongContainerRef}
          measureRef={data.dailySongMeasureRef}
          virtualStart={data.dailyVirtualStart}
          virtualEnd={data.dailyVirtualEnd}
          totalHeight={data.dailyVirtualTotalHeight}
          itemHeight={data.dailyVirtualItemHeight}
          virtualItems={data.virtualDailySongs}
          playingSongId={data.playingSongId}
          isPlayerPlaying={data.isPlayerPlaying}
          selectedSongKey={data.selectedSongKey}
          doublePlayCueSongKey={data.doublePlayCueSongKey}
          likingSongIds={data.likingSongIds}
          onSelectSong={handlers.handleSelectSong}
          onDailyPlayAt={handlers.handleDailyPlayAt}
          onDailyDoublePlayAt={handlers.handleDailyDoublePlayAt}
          onLikeSongAction={handlers.handleLikeSongAction}
          onScrollableWheel={handlers.handleScrollableWheel}
        />
      </main>

      {data.isMobileRuntime && (
        <MobileBottomNav panelTab={data.panelTab} setPanelTab={data.setPanelTab} />
      )}

      <PlayerBar />
    </div>
  );
}
