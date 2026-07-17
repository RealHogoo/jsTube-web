import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Clock, Download, Heart, Image as ImageIcon, Info, ListMusic, Music, Pause, Play, Plus, RefreshCw, Search, SkipBack, SkipForward, Star, Tags, Trash2, Video, X } from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_MEDIA_API_BASE || "";
const ADMIN_BASE_URL = serviceBaseUrl(import.meta.env.VITE_ADMIN_BASE_URL, 8081, "adm");
const WEBHARD_BASE_URL = serviceBaseUrl(import.meta.env.VITE_WEBHARD_BASE_URL, 8083, "box");
const PAGE_SIZE = 30;
const TV_KARAOKE_PAGE_SIZE = 4;
const KARAOKE_QUEUE_STORAGE_KEY = "media.karaoke.queue";

const TABS = [
  { value: "IMAGE", label: "이미지", icon: ImageIcon },
  { value: "VIDEO", label: "영상", icon: Video },
  { value: "KARAOKE", label: "노래방", icon: Music }
];

const SORT_OPTIONS = [
  { value: "recent", label: "최신순" },
  { value: "popular", label: "조회순" },
  { value: "liked", label: "좋아요순" }
];

function App() {
  const [page, setPage] = useState("media");
  const [items, setItems] = useState([]);
  const [activeKind, setActiveKind] = useState("IMAGE");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [counts, setCounts] = useState({ image: 0, video: 0, karaoke: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewerItem, setViewerItem] = useState(null);
  const [currentUser, setCurrentUser] = useState(undefined);
  const [version, setVersion] = useState({ git_commit: "unknown" });
  const [timeTagJob, setTimeTagJob] = useState(null);
  const [serviceDisabledMessage, setServiceDisabledMessage] = useState("");
  const sentinelRef = useRef(null);
  const karaokeRemoteSessionId = remoteSessionIdFromUrl();
  const karaokeRemoteRole = remoteRoleFromUrl();
  const karaokeRemoteJoinToken = remoteJoinTokenFromUrl() || storedRemoteJoinToken(karaokeRemoteSessionId);
  const karaokeTvMode = karaokeTvModeFromUrl();
  const karaokePairToken = karaokePairTokenFromUrl();
  const karaokeJoinToken = karaokeJoinTokenFromUrl();

  useEffect(() => {
    if (!karaokeTvMode && !karaokePairToken && !karaokeJoinToken && page === "media") {
      load({ reset: true });
    }
  }, [page, activeKind, sort, favoriteOnly, karaokeTvMode, karaokePairToken, karaokeJoinToken]);

  useEffect(() => {
    if (karaokeTvMode || karaokePairToken) {
      setCurrentUser(null);
    } else {
      loadCurrentUser();
    }
    loadVersion();
  }, [karaokeTvMode, karaokePairToken, karaokeJoinToken]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMore && !loading) {
        load({ reset: false });
      }
    }, { rootMargin: "480px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, items.length, activeKind, sort, query, favoriteOnly]);

  useEffect(() => {
    const jobId = timeTagJob?.job_id;
    if (!jobId || isTimeTagJobIdle(timeTagJob)) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const data = await request("/api/youtube/time-tags/status/", {
          method: "POST",
          body: JSON.stringify({ job_id: jobId })
        });
        if (stopped) return;
        const nextJob = data.job || null;
        setTimeTagJob(nextJob);
        setMessage(timeTagJobMessage(nextJob || data));
        if (isTimeTagJobIdle(nextJob)) {
          await load({ reset: true });
        }
      } catch (error) {
        if (!stopped) setMessage(error.message);
      }
    };
    poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [timeTagJob?.job_id, timeTagJob?.status]);

  const visibleItems = items;
  const displayCounts = counts;

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : { message: `HTTP ${response.status}` };
    if (body.code === "SERVICE_DISABLED") {
      setServiceDisabledMessage(body.message || "미디어 서비스가 관리자에 의해 비활성화되었습니다.");
      throw new Error(body.message || "미디어 서비스가 관리자에 의해 비활성화되었습니다.");
    }
    if (isAuthInvalid(response, body)) {
      redirectToLoginWithAlert();
      throw new Error(body.message || "로그인 정보가 유효하지 않습니다.");
    }
    if (!response.ok || body.ok !== true) {
      throw new Error(body.message || "요청에 실패했습니다.");
    }
    return body.data;
  }

  async function load({ reset = false, nextQuery = query } = {}) {
    const offset = reset ? 0 : items.length;
    setLoading(true);
    setMessage(reset ? "미디어를 불러오는 중입니다." : "추가 미디어를 불러오는 중입니다.");
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort,
        content_kind: activeKind
      });
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      if (favoriteOnly) params.set("favorite", "true");
      const data = await request(`/api/media/?${params.toString()}`);
      const nextItems = data.items || [];
      setItems((prev) => reset ? nextItems : mergeItems(prev, nextItems));
      if (data.counts) setCounts(data.counts);
      setHasMore(data.has_more === true);
      setMessage(nextItems.length ? "" : (reset ? "표시할 미디어가 없습니다." : "더 불러올 미디어가 없습니다."));
    } catch (error) {
      if (reset) {
        setItems([]);
        setCounts({ image: 0, video: 0, karaoke: 0 });
        setHasMore(false);
      }
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadVersion() {
    try {
      setVersion(await request("/api/version/"));
    } catch {
      setVersion({ git_commit: "unknown" });
    }
  }

  async function loadCurrentUser() {
    try {
      setCurrentUser(await request("/api/me/"));
    } catch {
      setCurrentUser(null);
    }
  }

  async function sync() {
    setLoading(true);
    setMessage("웹하드 미디어를 동기화하는 중입니다.");
    try {
      const data = await request("/api/sync/", { method: "POST", body: "{}" });
      setMessage(`동기화 완료: ${data.scanned_count}개 확인, ${data.upserted_count}개 반영`);
      await load({ reset: true });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function generateYoutubeTimeTags() {
    setLoading(true);
    setMessage("타임라인 태그를 생성하는 중입니다.");
    try {
      const data = await request("/api/youtube/time-tags/generate/", {
        method: "POST",
        body: "{}"
      });
      const nextJob = data.job || null;
      setTimeTagJob(nextJob);
      setMessage(timeTagJobMessage(nextJob || data));
      if (isTimeTagJobIdle(nextJob)) {
        await load({ reset: true });
      }
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function bulkChangeVideoPublic(publicValue) {
    const karaokeOnly = activeKind === "KARAOKE";
    const targetLabel = karaokeOnly ? "노래방 영상" : "모든 영상";
    const actionLabel = publicValue ? "공개" : "비공개";
    if (!window.confirm(`${targetLabel}을 ${actionLabel} 처리할까요?`)) return;
    setLoading(true);
    setMessage(`${targetLabel} ${actionLabel} 처리 중입니다.`);
    try {
      const data = await request("/api/media/bulk-public/", {
        method: "POST",
        body: JSON.stringify({ public: publicValue, karaoke_only: karaokeOnly })
      });
      setMessage(`${data.updated_count || 0}개 영상을 ${actionLabel} 처리했습니다.`);
      await load({ reset: true });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    postAdminLogout();
    setCurrentUser(null);
    setItems([]);
    setHasMore(false);
    setCounts({ image: 0, video: 0, karaoke: 0 });
    setViewerItem(null);
    setMessage("로그아웃했습니다.");
  }

  async function patchItem(item, patch) {
    try {
      const data = await request(`/api/media/${item.webhard_file_id}/`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      const updated = data.item;
      setItems((prev) => prev.map((entry) => entry.webhard_file_id === updated.webhard_file_id ? updated : entry));
      setViewerItem(updated);
      setMessage("변경 내용을 저장했습니다.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function createThumbnail(item, seekSeconds) {
    setLoading(true);
    setMessage("썸네일을 생성하는 중입니다.");
    try {
      const body = Number.isFinite(seekSeconds) ? { seek_seconds: seekSeconds } : {};
      const data = await request(`/api/media/${item.webhard_file_id}/thumbnail/`, { method: "POST", body: JSON.stringify(body) });
      const updated = data.item;
      if (updated?.webhard_file_id) {
        setItems((prev) => prev.map((entry) => entry.webhard_file_id === updated.webhard_file_id ? updated : entry));
        setViewerItem(updated);
      }
      const updatedCount = Number(data.thumbnail?.updated_count || 0);
      setMessage(updatedCount > 0 || hasVideoThumbnail(updated) ? "썸네일을 반영했습니다." : "생성할 썸네일이 없습니다.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteItem(item) {
    if (!window.confirm("이 미디어를 웹하드 휴지통으로 이동할까요?")) {
      return;
    }
    setLoading(true);
    setMessage("미디어를 휴지통으로 이동하는 중입니다.");
    try {
      await request(`/api/media/${item.webhard_file_id}/delete/`, { method: "POST", body: "{}" });
      setItems((prev) => prev.filter((entry) => entry.webhard_file_id !== item.webhard_file_id));
      setViewerItem(null);
      setCounts((prev) => decrementCounts(prev, item));
      setMessage("웹하드 휴지통으로 이동했습니다.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    load({ reset: true });
  }

  function openViewer(item) {
    setViewerItem(item);
    patchItem(item, { increment_view: true });
  }

  if (serviceDisabledMessage) {
    return <ServiceDisabledPage message={serviceDisabledMessage} version={version} />;
  }

  return (
    <>
      {!karaokeTvMode && !karaokeRemoteSessionId && !karaokeJoinToken && <header className="topbar">
        <strong>웹하드 미디어</strong>
        <nav>
          {currentUser?.is_admin && <button className={page === "media" ? "topbar-button active" : "topbar-button"} type="button" onClick={() => setPage("media")}>미디어</button>}
          {currentUser?.is_admin && <button className={page === "youtube" ? "topbar-button active" : "topbar-button"} type="button" onClick={() => setPage("youtube")}>유튜브 저장</button>}
          {currentUser && <a href={`${WEBHARD_BASE_URL}/preview.html`} target="_blank" rel="noreferrer">웹하드</a>}
          {currentUser && <a href={`${ADMIN_BASE_URL}/`} target="_blank" rel="noreferrer">어드민</a>}
          {currentUser && <a href={`${ADMIN_BASE_URL}/mypage.do`} target="_blank" rel="noreferrer">마이페이지</a>}
          {currentUser && <button className="topbar-button" type="button" onClick={logout}>로그아웃</button>}
          {currentUser === null && <a className="active" href={loginUrl()}>로그인</a>}
        </nav>
      </header>}

      {karaokeTvMode ? (
        <KaraokeTvPairingPage request={request} />
      ) : karaokePairToken ? (
        <KaraokePairPage pairingToken={karaokePairToken} />
      ) : karaokeJoinToken ? (
        <KaraokeJoinPage joinToken={karaokeJoinToken} />
      ) : karaokeRemoteSessionId ? (
        <KaraokeRemotePage request={request} sessionId={karaokeRemoteSessionId} role={karaokeRemoteRole} joinToken={karaokeRemoteJoinToken} />
      ) : page === "youtube" ? (
        <YoutubeImportPage
          currentUser={currentUser}
          request={request}
          onImported={(importTags) => {
            setActiveKind(importTags.includes("노래방") ? "KARAOKE" : "VIDEO");
            setPage("media");
          }}
        />
      ) : <main className="shell media-shell">
        <section className="panel page-head">
          <div>
            <h1>{activeKind === "IMAGE" ? "이미지 보기" : activeKind === "KARAOKE" ? "노래방 보기" : "영상 보기"}</h1>
            <p>웹하드에서 동기화된 이미지, 영상, 노래방 영상을 탭으로 분리해 조회합니다.</p>
          </div>
          <div className="actions">
            <button className="btn" type="button" onClick={() => load({ reset: true })} disabled={loading}>
              <RefreshCw size={16} /> 새로고침
            </button>
            {currentUser?.is_admin && activeKind === "KARAOKE" && (
              <button className="btn" type="button" onClick={generateYoutubeTimeTags} disabled={loading}>타임라인 생성</button>
            )}
            {currentUser?.is_admin && activeKind !== "IMAGE" && (
              <>
                <button className="btn" type="button" onClick={() => bulkChangeVideoPublic(true)} disabled={loading}>영상 공개</button>
                <button className="btn" type="button" onClick={() => bulkChangeVideoPublic(false)} disabled={loading}>영상 비공개</button>
              </>
            )}
            {currentUser?.is_admin && <button className="btn primary" type="button" onClick={sync} disabled={loading}>웹하드 동기화</button>}
          </div>
        </section>

        <section className="panel control-panel">
          <div className="tab-row" role="tablist" aria-label="미디어 유형">
            {TABS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                className={activeKind === value ? "tab-button active" : "tab-button"}
                type="button"
                role="tab"
                aria-selected={activeKind === value}
                onClick={() => setActiveKind(value)}
              >
                <Icon size={17} /> {label} <strong>{tabCount(displayCounts, value)}</strong>
              </button>
            ))}
          </div>

          <form className="filter-row" onSubmit={submitSearch}>
            <label className="search-field">
              검색
              <span className="search-input-wrap">
                <Search size={16} />
                <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="파일명, 앨범, 태그, 소유자" />
              </span>
            </label>
            <label>
              정렬
              <select className="input" value={sort} onChange={(event) => setSort(event.target.value)}>
                {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="check-control">
              <input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} />
              즐겨찾기만
            </label>
            <button className="btn" type="submit">검색</button>
          </form>
        </section>

        <section className="masonry-grid" aria-label={activeKind === "IMAGE" ? "이미지 목록" : activeKind === "KARAOKE" ? "노래방 목록" : "영상 목록"}>
          {visibleItems.map((item, index) => (
            <MediaCard key={item.webhard_file_id} item={item} index={index} onOpen={openViewer} />
          ))}
        </section>

        {!visibleItems.length && !loading && <div className="empty">조건에 맞는 미디어가 없습니다.</div>}
        <div ref={sentinelRef} className="feed-sentinel">
          {loading ? "불러오는 중입니다." : hasMore ? "아래로 스크롤하면 더 불러옵니다." : "마지막 미디어입니다."}
        </div>
        {message && <p className="message">{message}</p>}
      </main>}

      {viewerItem && (
        <ViewerModal
          item={viewerItem}
          currentUser={currentUser}
          onClose={() => setViewerItem(null)}
          onPatch={patchItem}
          onCreateThumbnail={createThumbnail}
          onDelete={deleteItem}
        />
      )}
      {loading && <LoadingOverlay message={message} />}
      {!karaokeTvMode && <div className="build-version">media-service · git {version?.git_commit || "unknown"}</div>}
    </>
  );
}

function ServiceDisabledPage({ message, version }) {
  return (
    <main className="service-disabled-page">
      <section className="service-disabled-panel">
        <Info size={36} />
        <p className="error-code">S4003</p>
        <h1>미디어 서비스가 비활성화되었습니다.</h1>
        <p>{message || "관리자가 서비스를 다시 사용 처리할 때까지 화면을 열 수 없습니다."}</p>
        <a className="btn primary" href={ADMIN_BASE_URL}>어드민으로 이동</a>
      </section>
      <div className="build-version">media-service · git {version?.git_commit || "unknown"}</div>
    </main>
  );
}

function LoadingOverlay({ message }) {
  return (
    <div className="loading-overlay" role="alert" aria-live="assertive" aria-busy="true">
      <div className="loading-box">
        <span className="loading-spinner" />
        <strong>처리 중입니다</strong>
        <p>{message || "잠시만 기다려 주세요."}</p>
      </div>
    </div>
  );
}

function hasVideoThumbnail(item) {
  const thumbnailUrl = String(item?.thumbnail_url || "");
  const contentUrl = String(item?.content_url || "");
  if (!thumbnailUrl) return false;
  if (contentUrl && thumbnailUrl === contentUrl) return false;
  return !thumbnailUrl.includes("/file/content/");
}

function mediaPreviewUrl(item) {
  if (item.content_kind === "VIDEO") {
    return hasVideoThumbnail(item) ? item.thumbnail_url : "";
  }
  return item.thumbnail_url || item.content_url || "";
}

function MediaCard({ item, index, onOpen }) {
  const previewUrl = mediaPreviewUrl(item);
  return (
    <article className={`media-card span-${(index % 5) + 1}`}>
      <button className="card-media" type="button" onClick={() => onOpen(item)}>
        {previewUrl ? <img src={previewUrl} alt="" loading="lazy" /> : <span>미리보기 없음</span>}
        <i>{item.content_kind === "VIDEO" ? <Video size={18} /> : <ImageIcon size={18} />}</i>
      </button>
      <div className="card-meta">
        <strong>{item.title || item.display_name || item.file_name}</strong>
        <small>{item.file_name || item.display_name}</small>
        <div className="tag-row compact">
          {(item.tags || []).slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </div>
    </article>
  );
}

function tabCount(counts, tabValue) {
  if (tabValue === "IMAGE") return counts.image || 0;
  if (tabValue === "KARAOKE") return counts.karaoke || 0;
  return counts.video || 0;
}

function KaraokeTvPairingPage({ request }) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(null);
  const [queue, setQueue] = useState([]);
  const [currentItem, setCurrentItem] = useState(null);
  const [latestSequence, setLatestSequence] = useState(0);
  const [notice, setNotice] = useState("TV 세션을 준비하는 중입니다.");
  const [noticeScrolling, setNoticeScrolling] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const videoRef = useRef(null);
  const noticeBoxRef = useRef(null);
  const noticeTextRef = useRef(null);
  const latestSequenceRef = useRef(0);
  const currentMediaKeyRef = useRef("");
  const timeTagsRef = useRef([]);
  const tvToken = session?.tv_token || "";
  const paired = status?.paired === true;
  const timeTags = useMemo(() => parseTimeTags(currentItem?.tags || []), [currentItem?.tags]);
  const activeTimeIndex = activeTimeTagIndex(timeTags, currentVideoTime);

  useEffect(() => {
    latestSequenceRef.current = latestSequence;
  }, [latestSequence]);

  useEffect(() => {
    timeTagsRef.current = timeTags;
  }, [timeTags]);

  useEffect(() => () => releaseMediaElement(videoRef.current), []);

  useEffect(() => {
    let stopped = false;
    async function createSession() {
      try {
        const data = await request("/api/karaoke/tv/session/", { method: "POST", body: "{}" });
        if (!stopped) {
          setSession(data);
          setStatus({ paired: false, pairing_code: data.pairing_code });
          setNotice("모바일로 QR을 스캔해 연결하세요.");
        }
      } catch (error) {
        if (!stopped) setNotice(error.message);
      }
    }
    createSession();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    if (!tvToken || paired) return undefined;
    let stopped = false;
    async function pollStatus() {
      try {
        const data = await request(`/api/karaoke/tv/session/${encodeURIComponent(tvToken)}/status/`);
        if (stopped) return;
        setStatus(data);
        setQueue((data.queue || []).map((item) => tvPlayableItem(item, tvToken)));
        updateCurrentItem(data.current_item ? tvPlayableItem(data.current_item, tvToken) : null);
        if (data.paired) setNotice("모바일 기기가 연결되었습니다.");
      } catch (error) {
        if (!stopped) setNotice(error.message);
      }
    }
    pollStatus();
    const timer = window.setInterval(pollStatus, 1500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [tvToken, paired]);

  useEffect(() => {
    if (!tvToken || !paired) return undefined;
    let stopped = false;
    let timer = null;
    let eventSource = null;

    function applyCommandData(data) {
      if (stopped) return;
      if (Array.isArray(data.queue)) setQueue(data.queue.map((item) => tvPlayableItem(item, tvToken)));
      if (Object.prototype.hasOwnProperty.call(data, "current_item")) {
        updateCurrentItem(data.current_item ? tvPlayableItem(data.current_item, tvToken) : null);
      }
      for (const command of data.commands || []) {
        handleTvCommand(command, data);
      }
      const nextSequence = Number(data.latest_sequence || 0);
      if (nextSequence > latestSequenceRef.current) {
        latestSequenceRef.current = nextSequence;
        setLatestSequence(nextSequence);
      }
    }

    async function pollCommands() {
      try {
        const afterSequence = latestSequenceRef.current;
        const data = await request(`/api/karaoke/tv/session/${encodeURIComponent(tvToken)}/commands/?after=${afterSequence}`);
        applyCommandData(data);
      } catch (error) {
        if (!stopped) setNotice(error.message);
      }
    }

    function startPolling() {
      if (timer) return;
      pollCommands();
      timer = window.setInterval(pollCommands, 1000);
    }

    if ("EventSource" in window) {
      eventSource = new EventSource(`${API_BASE}/api/karaoke/tv/session/${encodeURIComponent(tvToken)}/events/?after=${latestSequenceRef.current}`);
      eventSource.onmessage = (event) => {
        try {
          applyCommandData(JSON.parse(event.data || "{}"));
        } catch {
          // Ignore malformed event payloads and keep the stream alive.
        }
      };
      eventSource.addEventListener("error", (event) => {
        try {
          const data = JSON.parse(event.data || "{}");
          if (data.message) setNotice(data.message);
        } catch {
          // EventSource also emits network errors without payloads.
        }
      });
      eventSource.onerror = () => {
        if (stopped) return;
        eventSource?.close();
        eventSource = null;
        startPolling();
      };
    } else {
      startPolling();
    }

    return () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
      if (eventSource) eventSource.close();
    };
  }, [tvToken, paired]);

  useEffect(() => {
    if (!tvToken) return undefined;
    const heartbeat = async () => {
      try {
        await request(`/api/karaoke/tv/session/${encodeURIComponent(tvToken)}/heartbeat/`, { method: "POST", body: "{}" });
      } catch {
        // Status polling will surface expired sessions.
      }
    };
    const timer = window.setInterval(heartbeat, 60000);
    heartbeat();
    return () => window.clearInterval(timer);
  }, [tvToken]);

  useEffect(() => {
    const box = noticeBoxRef.current;
    const text = noticeTextRef.current;
    if (!box || !text) return undefined;

    const updateNoticeOverflow = () => {
      const overflowX = Math.max(text.scrollWidth - box.clientWidth, 0);
      const overflowY = text.scrollHeight > box.clientHeight;
      box.style.setProperty("--notice-scroll-distance", `${overflowX + 60}px`);
      setNoticeScrolling(overflowX > 0 || overflowY);
    };

    updateNoticeOverflow();
    window.setTimeout(updateNoticeOverflow, 120);
    window.addEventListener("resize", updateNoticeOverflow);
    return () => window.removeEventListener("resize", updateNoticeOverflow);
  }, [notice]);

  function handleTvCommand(command, sessionData = {}) {
    const type = String(command?.type || "");
    const item = command?.payload?.item ? tvPlayableItem(command.payload.item, tvToken) : null;
    if (type === "PAIRED") {
      setNotice("모바일 기기가 연결되었습니다.");
      return;
    }
    if (type === "PLAY_ITEM" && item) {
      updateCurrentItem(item);
      setNotice(`${reservationTitle(item)} 재생을 시작합니다.`);
      playVideoSoon();
      return;
    }
    if (type === "RESERVE_ITEM" && item) {
      const reserver = reservationByLabel(item);
      setNotice(`${reservationTitle(item)} 예약되었습니다.${reserver ? ` (${reserver})` : ""}`);
      return;
    }
    if (type === "NEXT") {
      const nextCurrent = sessionData.current_item ? tvPlayableItem(sessionData.current_item, tvToken) : null;
      setNotice(nextCurrent ? `${reservationTitle(nextCurrent)} 재생을 시작합니다.` : "예약된 다음 곡이 없습니다.");
      if (nextCurrent) playVideoSoon();
      return;
    }
    if (type === "PREV_TAG") {
      seekPreviousTimeTag();
      return;
    }
    if (type === "NEXT_TAG") {
      seekNextTimeTag();
      return;
    }
    if (type === "TOGGLE_PLAY") {
      togglePlay();
      return;
    }
    if (type === "CLEAR_QUEUE") {
      setNotice("예약 목록을 비웠습니다.");
    }
  }

  function playVideoSoon() {
    window.setTimeout(() => playMediaElement(videoRef.current, handlePlaybackBlocked), 80);
    setPlaying(true);
  }

  function handlePlaybackBlocked(message) {
    setPlaybackBlocked(true);
    setPlaying(false);
    setNotice(message);
  }

  function unlockPlayback() {
    setPlaybackBlocked(false);
    playMediaElement(videoRef.current, handlePlaybackBlocked);
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      playMediaElement(video, handlePlaybackBlocked);
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  async function playNextSong() {
    if (!tvToken) return;
    try {
      const data = await request(`/api/karaoke/tv/session/${encodeURIComponent(tvToken)}/next/`, { method: "POST", body: "{}" });
      const nextSession = data.session || {};
      const nextCurrent = nextSession.current_item ? tvPlayableItem(nextSession.current_item, tvToken) : null;
      setQueue((nextSession.queue || []).map((item) => tvPlayableItem(item, tvToken)));
      updateCurrentItem(nextCurrent);
      const nextSequence = Number(data.latest_sequence || 0);
      if (nextSequence > latestSequenceRef.current) {
        latestSequenceRef.current = nextSequence;
        setLatestSequence(nextSequence);
      }
      if (!nextCurrent) {
        setNotice("예약된 다음 곡이 없습니다.");
        setPlaying(false);
        return;
      }
      setNotice(`${reservationTitle(nextCurrent)} 재생을 시작합니다.`);
      playVideoSoon();
    } catch (error) {
      setNotice(error.message);
    }
  }

  function updateCurrentItem(nextItem) {
    const nextKey = mediaItemKey(nextItem);
    const mediaChanged = currentMediaKeyRef.current !== nextKey;
    if (currentMediaKeyRef.current && mediaChanged) {
      releaseMediaElement(videoRef.current);
    }
    currentMediaKeyRef.current = nextKey;
    if (mediaChanged) setCurrentVideoTime(0);
    setCurrentItem(nextItem);
    if (!nextItem) setPlaying(false);
  }

  function seekToTimeTag(seconds) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    playMediaElement(video, handlePlaybackBlocked);
    setPlaying(true);
  }

  function seekNextTimeTag() {
    const currentTags = timeTagsRef.current || [];
    if (!currentTags.length) return;
    const currentTime = videoRef.current?.currentTime || 0;
    const next = currentTags.find((entry) => entry.seconds > currentTime + 0.35) || currentTags[0];
    seekToTimeTag(next.seconds);
  }

  function seekPreviousTimeTag() {
    const currentTags = timeTagsRef.current || [];
    if (!currentTags.length) return;
    const currentTime = videoRef.current?.currentTime || 0;
    const previous = [...currentTags].reverse().find((entry) => entry.seconds < currentTime - 0.7) || currentTags[0];
    seekToTimeTag(previous.seconds);
  }

  if (!paired) {
    return (
      <main className="tv-pairing-page">
        <section className="tv-pairing-panel">
          <div>
            <span className="kind-badge">TV 노래방</span>
            <h1>모바일과 연결</h1>
            <p>모바일 카메라로 QR을 스캔하거나 아래 숫자 코드를 입력하세요.</p>
          </div>
          {session?.qr_image_url ? (
            <img className="tv-qr-canvas" src={session.qr_image_url} alt="모바일 페어링 QR" />
          ) : (
            <div className="tv-qr-canvas" aria-hidden="true" />
          )}
          <strong className="tv-pairing-code">{session?.pairing_code || "------"}</strong>
          <p className="tv-pairing-url">{session?.pair_url || ""}</p>
          <p className="tv-message">{notice}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="tv-display-page">
      <section className="tv-display-player">
        <div className="tv-player-screen">
          {currentItem?.content_url ? (
            <div className="video-interaction-lock">
              <AdaptiveVideo
                item={currentItem}
                key={mediaItemKey(currentItem)}
                ref={videoRef}
                controlsList="nodownload noplaybackrate noremoteplayback"
                disablePictureInPicture
                playsInline
                preload="metadata"
                onContextMenu={(event) => event.preventDefault()}
                onPlay={() => { setPlaying(true); setPlaybackBlocked(false); }}
                onPause={() => setPlaying(false)}
                onEnded={playNextSong}
                onTimeUpdate={(event) => setCurrentVideoTime(event.currentTarget.currentTime)}
              />
              <div className="media-click-shield" aria-hidden="true" />
              {playbackBlocked && (
                <button className="tv-play-unlock" type="button" onClick={unlockPlayback}>
                  <Play size={22} /> 재생 활성화
                </button>
              )}
            </div>
          ) : (
            <div className="tv-standby">
              <Music size={58} />
              <strong>재생 대기</strong>
              <span>모바일에서 곡을 검색해 예약하거나 재생하세요.</span>
            </div>
          )}
        </div>
        <div className="tv-now">
          <strong>{currentItem ? reservationTitle(currentItem) : "재생 대기"}</strong>
          {currentItem ? (
            karaokeArtist(currentItem) && <span>{karaokeArtist(currentItem)}</span>
          ) : (
            <span>모바일 노래방 화면과 연결되었습니다.</span>
          )}
        </div>
        <div className="tv-controls">
          <button type="button" onClick={seekPreviousTimeTag} disabled={!timeTags.length}><SkipBack size={20} /> 이전태그</button>
          <button className="primary" type="button" onClick={togglePlay} disabled={!currentItem}>{playing ? <Pause size={20} /> : <Play size={20} />} {playing ? "일시정지" : "재생"}</button>
          <button type="button" onClick={seekNextTimeTag} disabled={!timeTags.length}><SkipForward size={20} /> 간주점프</button>
          <button type="button" onClick={playNextSong} disabled={!queue.length}><ListMusic size={20} /> 다음곡</button>
        </div>
      </section>
      <aside className="tv-display-queue">
        <p className={`tv-notice${noticeScrolling ? " scrolling" : ""}`} ref={noticeBoxRef}>
          <span className="tv-notice-text" ref={noticeTextRef}>{notice}</span>
        </p>
        <div className="tv-panel-head">
          <strong>예약 목록</strong>
          <span>{reservationSummary(queue)}</span>
        </div>
        <div className="tv-reservation-list">
          {queue.slice(0, 6).map((item, index) => (
            <article className={tvQueueCardClass(index)} key={`${item.webhard_file_id}-${index}`}>
              <span className="tv-reservation-label">{reservationOrderLabel(index)}</span>
              <strong className="tv-reservation-title">{reservationTitle(item)}</strong>
              {reservationByLabel(item) && <small className="tv-reservation-user">{reservationByLabel(item)}</small>}
            </article>
          ))}
          {!queue.length && <p className="tv-empty">예약된 곡이 없습니다.</p>}
        </div>
      </aside>
    </main>
  );
}

function KaraokePairPage({ pairingToken }) {
  const [message, setMessage] = useState("TV와 연결하는 중입니다.");

  useEffect(() => {
    let stopped = false;
    async function pair() {
      try {
        const response = await fetch(`${API_BASE}/api/karaoke/tv/pair/`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairing_token: pairingToken })
        });
        const contentType = response.headers.get("content-type") || "";
        const body = contentType.includes("application/json") ? await response.json() : { message: `HTTP ${response.status}` };
        if (isAuthInvalid(response, body)) {
          window.location.replace(loginUrl());
          return;
        }
        if (!response.ok || body.ok !== true) {
          throw new Error(body.message || "TV 연결에 실패했습니다.");
        }
        const data = body.data || {};
        if (stopped) return;
        if (data.session_id) {
          window.location.replace(karaokeRemoteUrl(data.session_id, "HOST"));
          return;
        }
        setMessage("TV 연결 정보가 올바르지 않습니다.");
      } catch (error) {
        if (!stopped) setMessage(error.message);
      }
    }
    pair();
    return () => {
      stopped = true;
    };
  }, [pairingToken]);

  return (
    <main className="karaoke-remote-shell">
      <section className="karaoke-search-panel single-column">
        <div>
          <span className="kind-badge">모바일 페어링</span>
          <h1>TV 연결</h1>
          <p>{message}</p>
        </div>
      </section>
    </main>
  );
}

function KaraokeJoinPage({ joinToken }) {
  const [message, setMessage] = useState("Jam에 참여하는 중입니다.");

  useEffect(() => {
    let stopped = false;
    async function join() {
      try {
        const parsed = parseKaraokeJoinToken(joinToken);
        if (!parsed.sessionId || !parsed.token) {
          throw new Error("Jam 참여 링크가 올바르지 않습니다.");
        }
        const response = await fetch(`${API_BASE}/api/karaoke/tv/join/`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: parsed.sessionId, join_token: parsed.token })
        });
        const contentType = response.headers.get("content-type") || "";
        const body = contentType.includes("application/json") ? await response.json() : { message: `HTTP ${response.status}` };
        if (isAuthInvalid(response, body)) {
          window.location.replace(loginUrl());
          return;
        }
        if (!response.ok || body.ok !== true) {
          throw new Error(body.message || "Jam 참여에 실패했습니다.");
        }
        const data = body.data || {};
        if (stopped) return;
        window.location.replace(karaokeRemoteUrl(data.session_id || parsed.sessionId, data.role || "GUEST"));
      } catch (error) {
        if (!stopped) setMessage(error.message);
      }
    }
    join();
    return () => {
      stopped = true;
    };
  }, [joinToken]);

  return (
    <main className="karaoke-remote-shell">
      <section className="karaoke-search-panel single-column">
        <div>
          <span className="kind-badge">Jam 참여</span>
          <h1>TV 노래방 참여</h1>
          <p>{message}</p>
        </div>
      </section>
    </main>
  );
}

function KaraokePage({ currentUser, request, tvMode = false }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [quickNumber, setQuickNumber] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedQueueIndex, setSelectedQueueIndex] = useState(0);
  const [focusArea, setFocusArea] = useState("list");
  const [queue, setQueue] = useState([]);
  const [currentItem, setCurrentItem] = useState(null);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [timeTagDraft, setTimeTagDraft] = useState("");
  const [remoteSession, setRemoteSession] = useState(null);
  const [remoteSequence, setRemoteSequence] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [playing, setPlaying] = useState(false);
  const shellRef = useRef(null);
  const videoRef = useRef(null);
  const listRef = useRef(null);
  const remoteSequenceRef = useRef(0);
  const currentMediaKeyRef = useRef("");
  const timeTags = useMemo(() => parseTimeTags(currentItem?.tags || []), [currentItem?.tags]);
  const activeTimeIndex = activeTimeTagIndex(timeTags, currentVideoTime);
  const canEditCurrentItem = canManageMedia(currentUser, currentItem);
  const tvPageIndex = tvMode ? Math.floor(selectedIndex / TV_KARAOKE_PAGE_SIZE) : 0;
  const tvPageCount = tvMode ? Math.max(Math.ceil(items.length / TV_KARAOKE_PAGE_SIZE), 1) : 1;
  const tvPageStart = tvPageIndex * TV_KARAOKE_PAGE_SIZE;
  const tvPageEnd = Math.min(tvPageStart + TV_KARAOKE_PAGE_SIZE, items.length);
  const tvPageRangeLabel = items.length ? `${tvPageStart + 1}-${tvPageEnd}` : "0";
  const tvVisibleItems = tvMode ? items.slice(tvPageStart, tvPageStart + TV_KARAOKE_PAGE_SIZE) : items;

  useEffect(() => {
    remoteSequenceRef.current = remoteSequence;
  }, [remoteSequence]);

  useEffect(() => {
    shellRef.current?.focus();
    setQueue(readStoredKaraokeQueue());
    loadKaraoke("");
    createRemoteSession();
  }, []);

  useEffect(() => {
    writeStoredKaraokeQueue(queue);
    if (selectedQueueIndex >= queue.length) {
      setSelectedQueueIndex(Math.max(queue.length - 1, 0));
    }
  }, [queue, selectedQueueIndex]);

  useEffect(() => {
    setTimeTagDraft(formatTimeTagDraft(currentItem?.tags || []));
  }, [currentItem]);

  useEffect(() => () => releaseMediaElement(videoRef.current), []);

  useEffect(() => {
    if (!remoteSession?.session_id) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const afterSequence = remoteSequenceRef.current;
        const data = await request(`/api/karaoke/remote/${remoteSession.session_id}/commands/?after=${afterSequence}`);
        if (stopped) return;
        const commands = data.commands || [];
        for (const command of commands) {
          handleRemoteCommand(command);
        }
        if (commands.length) {
          const nextSequence = Math.max(...commands.map((command) => Number(command.sequence || 0)));
          if (nextSequence > remoteSequenceRef.current) {
            remoteSequenceRef.current = nextSequence;
            setRemoteSequence(nextSequence);
          }
        }
      } catch (error) {
        if (!stopped) setMessage(error.message);
      }
    };
    const timer = window.setInterval(poll, 1200);
    poll();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [remoteSession?.session_id]);

  useEffect(() => {
    if (!remoteSession?.session_id) return undefined;
    const heartbeat = async () => {
      try {
        await request(`/api/karaoke/remote/${remoteSession.session_id}/heartbeat/`, { method: "POST", body: "{}" });
      } catch {
        // Polling will surface session errors; heartbeat is best-effort.
      }
    };
    const timer = window.setInterval(heartbeat, 60000);
    heartbeat();
    return () => window.clearInterval(timer);
  }, [remoteSession?.session_id]);

  useEffect(() => {
    const handler = (event) => {
      const target = event.target;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      const isNativeAction = target?.tagName === "BUTTON" || target?.tagName === "A" || target?.tagName === "SELECT";
      if (isTyping && event.key !== "Escape") {
        return;
      }
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        setQuickNumber((value) => `${value}${event.key}`.slice(0, 7));
        return;
      }
      if (event.key === "Backspace" && quickNumber) {
        event.preventDefault();
        setQuickNumber((value) => value.slice(0, -1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(-1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveFocusArea(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveFocusArea(1);
        return;
      }
      if (tvMode && focusArea === "list" && ["PageUp", "ChannelUp"].includes(event.key)) {
        event.preventDefault();
        moveTvPage(-1);
        return;
      }
      if (tvMode && focusArea === "list" && ["PageDown", "ChannelDown"].includes(event.key)) {
        event.preventDefault();
        moveTvPage(1);
        return;
      }
      if (event.key === "Enter") {
        if (isNativeAction) {
          return;
        }
        event.preventDefault();
        if (quickNumber) {
          searchQuickNumber();
        } else {
          activateFocusedArea();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (quickNumber) {
          setQuickNumber("");
        } else {
          setQuery("");
          loadKaraoke("");
        }
        return;
      }
      if (event.key === "MediaPlayPause") {
        event.preventDefault();
        togglePlay();
        return;
      }
      if (event.key === "MediaTrackNext") {
        event.preventDefault();
        playNextSong();
        return;
      }
      if (event.key === "MediaTrackPrevious") {
        event.preventDefault();
        seekPreviousTimeTag();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [items, selectedIndex, selectedQueueIndex, focusArea, quickNumber, queue, currentItem, currentVideoTime]);

  useEffect(() => {
    if (tvMode) return;
    const selected = listRef.current?.querySelector(`[data-karaoke-index="${selectedIndex}"]`);
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedIndex, tvMode]);

  async function loadKaraoke(nextQuery = query) {
    setLoading(true);
    setMessage("노래방 목록을 불러오는 중입니다.");
    try {
      const params = new URLSearchParams({
        content_kind: "KARAOKE",
        limit: "80",
        offset: "0",
        sort: "recent"
      });
      if (nextQuery.trim()) params.set("q", normalizeKaraokeQuery(nextQuery));
      const data = await request(`/api/media/?${params.toString()}`);
      const nextItems = data.items || [];
      setItems(nextItems);
      setSelectedIndex(0);
      setMessage(nextItems.length ? "" : "조건에 맞는 노래방 영상이 없습니다.");
    } catch (error) {
      setItems([]);
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function createRemoteSession() {
    try {
      setRemoteSession(await request("/api/karaoke/remote/session/", { method: "POST", body: "{}" }));
    } catch (error) {
      setMessage(error.message);
    }
  }

  function handleRemoteCommand(command) {
    const type = String(command?.type || "");
    const item = command?.payload?.item;
    if (type === "PLAY_ITEM" && item) {
      playNow(item);
      return;
    }
    if (type === "RESERVE_ITEM" && item) {
      reserve(item);
      return;
    }
    if (type === "NEXT") {
      playNextSong();
      return;
    }
    if (type === "PREV_TAG") {
      seekPreviousTimeTag();
      return;
    }
    if (type === "NEXT_TAG") {
      seekNextTimeTag();
      return;
    }
    if (type === "TOGGLE_PLAY") {
      togglePlay();
      return;
    }
    if (type === "CLEAR_QUEUE") {
      setQueue([]);
      setMessage("리모컨에서 예약목록을 비웠습니다.");
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    setQuickNumber("");
    loadKaraoke(query);
  }

  function searchQuickNumber() {
    if (!quickNumber) return;
    const nextQuery = quickNumber;
    setQuery(nextQuery);
    loadKaraoke(nextQuery);
  }

  function pressKeypad(value) {
    if (value === "clear") {
      setQuickNumber("");
      return;
    }
    if (value === "back") {
      setQuickNumber((current) => current.slice(0, -1));
      return;
    }
    setQuickNumber((current) => `${current}${value}`.slice(0, 7));
  }

  function moveFocusArea(delta) {
    const areas = tvMode ? ["queue", "keypad", "player", "list"] : ["list", "player", "keypad", "queue"];
    setFocusArea((current) => {
      const currentIndex = Math.max(areas.indexOf(current), 0);
      return areas[(currentIndex + delta + areas.length) % areas.length];
    });
  }

  function moveFocus(delta) {
    if (focusArea === "list") {
      moveSelection(delta);
      return;
    }
    if (focusArea === "queue") {
      setSelectedQueueIndex((current) => {
        if (!queue.length) return 0;
        const maxIndex = tvMode ? Math.min(queue.length - 1, 1) : queue.length - 1;
        return Math.min(Math.max(current + delta, 0), maxIndex);
      });
      return;
    }
    if (focusArea === "player") {
      if (delta > 0) seekNextTimeTag();
      else seekPreviousTimeTag();
    }
  }

  function activateFocusedArea() {
    if (focusArea === "list" && items[selectedIndex]) {
      playNow(items[selectedIndex]);
      return;
    }
    if (focusArea === "queue" && queue[selectedQueueIndex]) {
      playReserved(selectedQueueIndex);
      return;
    }
    if (focusArea === "player") {
      togglePlay();
      return;
    }
    if (focusArea === "keypad") {
      searchQuickNumber();
    }
  }

  function moveSelection(delta) {
    setSelectedIndex((current) => {
      if (!items.length) return 0;
      return Math.min(Math.max(current + delta, 0), items.length - 1);
    });
  }

  function moveTvPage(delta) {
    if (!items.length) return;
    setSelectedIndex((current) => {
      const currentPage = Math.floor(current / TV_KARAOKE_PAGE_SIZE);
      const nextPage = Math.min(Math.max(currentPage + delta, 0), tvPageCount - 1);
      return Math.min(nextPage * TV_KARAOKE_PAGE_SIZE, items.length - 1);
    });
  }

  function playNow(item) {
    flushSync(() => {
      updateCurrentItem(item);
      setCurrentVideoTime(0);
      setFocusArea("player");
      setPlaying(true);
    });
    playMediaElement(videoRef.current, setMessage);
  }

  function reserve(item) {
    setQueue((current) => current.some((entry) => entry.webhard_file_id === item.webhard_file_id) ? current : current.concat(item));
    setFocusArea("queue");
    setMessage(`${item.title || item.display_name || item.file_name} 예약했습니다.`);
  }

  function removeReserved(item) {
    setQueue((current) => current.filter((entry) => entry.webhard_file_id !== item.webhard_file_id));
  }

  function playReserved(index) {
    const item = queue[index];
    if (!item) return;
    setQueue((current) => current.filter((_, entryIndex) => entryIndex !== index));
    setSelectedQueueIndex(0);
    playNow(item);
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      playMediaElement(video, setMessage);
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function playNextSong() {
    const [next, ...rest] = queue;
    if (!next) {
      updateCurrentItem(null);
      setPlaying(false);
      setFocusArea("list");
      setMessage("예약된 다음 곡이 없습니다.");
      return;
    }
    setQueue(rest);
    playNow(next);
  }

  function seekToTimeTag(seconds) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    playMediaElement(video, setMessage);
    setPlaying(true);
  }

  function seekNextTimeTag() {
    if (!timeTags.length) return;
    const currentTime = videoRef.current?.currentTime || 0;
    const next = timeTags.find((entry) => entry.seconds > currentTime + 0.35) || timeTags[0];
    seekToTimeTag(next.seconds);
  }

  function seekPreviousTimeTag() {
    if (!timeTags.length) return;
    const currentTime = videoRef.current?.currentTime || 0;
    const previous = [...timeTags].reverse().find((entry) => entry.seconds < currentTime - 0.7) || timeTags[0];
    seekToTimeTag(previous.seconds);
  }

  async function saveTimeTags() {
    if (!currentItem) return;
    const preservedTags = (currentItem.tags || []).filter((tag) => !isTimeTag(tag));
    const nextTimeTags = timeTagDraft
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(normalizeTimeTagLine)
      .filter(Boolean);
    const nextTags = uniqueTags(preservedTags.concat(nextTimeTags));
    setLoading(true);
    setMessage("타임태그를 저장하는 중입니다.");
    try {
      const data = await request(`/api/media/${currentItem.webhard_file_id}/`, {
        method: "PATCH",
        body: JSON.stringify({ tags: nextTags })
      });
      const updated = data.item;
      updateCurrentItem(updated);
      setItems((current) => current.map((entry) => entry.webhard_file_id === updated.webhard_file_id ? updated : entry));
      setQueue((current) => current.map((entry) => entry.webhard_file_id === updated.webhard_file_id ? updated : entry));
      setMessage("타임태그를 저장했습니다.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function renderReservationPanel(extraClass = "") {
    const className = [
      "reservation-panel",
      "header-reservation-panel",
      extraClass,
      focusArea === "queue" ? "focus-area" : "",
    ].filter(Boolean).join(" ");
    return (
      <div className={className}>
        <div className="karaoke-list-head">
          <strong>예약 목록</strong>
          <span>{reservationSummary(queue)}</span>
        </div>
        <div className="reservation-list">
          {queue.map((item, index) => (
            <article className={reservationItemClass(index, selectedQueueIndex)} key={item.webhard_file_id}>
              <span>{reservationOrderLabel(index)}</span>
              <div>
                <strong>{item.title || item.display_name || item.file_name}</strong>
                <small>{karaokeArtist(item)}</small>
              </div>
              <button className="btn icon-only" type="button" onClick={() => playReserved(index)} aria-label="예약 재생"><Play size={16} /></button>
              <button className="btn icon-only" type="button" onClick={() => removeReserved(item)} aria-label="예약 삭제"><Trash2 size={16} /></button>
            </article>
          ))}
          {!queue.length && <p>예약한 곡이 없습니다.</p>}
        </div>
      </div>
    );
  }

  function updateCurrentItem(nextItem) {
    const nextKey = mediaItemKey(nextItem);
    const mediaChanged = currentMediaKeyRef.current !== nextKey;
    if (currentMediaKeyRef.current && mediaChanged) {
      releaseMediaElement(videoRef.current);
    }
    currentMediaKeyRef.current = nextKey;
    if (mediaChanged) setCurrentVideoTime(0);
    setCurrentItem(nextItem);
    if (!nextItem) setPlaying(false);
  }

  function renderTvReservationCard(item, index, label, extraClass = "") {
    if (!item && index < 2) return null;
    const classes = [
      "tv-reservation-card",
      extraClass,
      focusArea === "queue" && selectedQueueIndex === index ? "active" : ""
    ].filter(Boolean).join(" ");
    return (
      <article className={classes}>
        <span className="tv-reservation-label">{label}</span>
        <strong className="tv-reservation-title">{item ? reservationTitle(item) : "예약 대기 중"}</strong>
      </article>
    );
  }

  function renderTvReservationPanel() {
    const next = queue[0];
    const second = queue[1];
    const extraCount = Math.max(queue.length - 2, 0);
    return (
      <section className={focusArea === "queue" ? "tv-reservation-panel tv-focus" : "tv-reservation-panel"}>
        <div className="tv-panel-head">
          <strong>예약 목록</strong>
          <span>{reservationSummary(queue)}</span>
        </div>
        <div className="tv-reservation-list">
          {renderTvReservationCard(next, 0, "다음곡", "next-song")}
          {renderTvReservationCard(second, 1, "다다음곡", "second-song")}
          {extraCount > 0 && renderTvReservationCard(null, 2, `+${extraCount}곡`, "later-song")}
          {!queue.length && <p className="tv-empty">예약한 곡이 없습니다.</p>}
        </div>
      </section>
    );
  }

  if (tvMode) {
    return (
      <main className="karaoke-tv-page" ref={shellRef} tabIndex={-1}>
        <section className="tv-search-panel">
          <form className="tv-search-form" onSubmit={submitSearch}>
            <label>
              <span>노래 검색</span>
              <span className="tv-search-input-wrap">
                <Search size={18} />
                <input className="tv-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목, 가수, KY.12345, 태그" />
              </span>
            </label>
            <button className="tv-button primary" type="submit" disabled={loading}>검색</button>
            <button className="tv-button" type="button" onClick={() => { setQuery(""); setQuickNumber(""); loadKaraoke(""); }} disabled={loading}>초기화</button>
          </form>
        </section>

        <section className="tv-layout">
          <aside className="tv-left-rail">
            {renderTvReservationPanel()}
            <section className={focusArea === "keypad" ? "tv-keypad-panel tv-focus" : "tv-keypad-panel"}>
              <strong>KY번호 빠른 입력</strong>
              <div className="tv-number-display">{quickNumber || "숫자키 입력"}</div>
              <div className="tv-keypad">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((value) => <button type="button" key={value} onClick={() => pressKeypad(value)}>{value}</button>)}
                <button type="button" onClick={() => pressKeypad("back")}>←</button>
                <button type="button" onClick={() => pressKeypad("0")}>0</button>
                <button type="button" onClick={() => pressKeypad("clear")}>C</button>
              </div>
              <button className="tv-button primary full" type="button" onClick={searchQuickNumber} disabled={!quickNumber}>번호 검색</button>
            </section>
          </aside>

          <section className={focusArea === "player" ? "tv-player-panel tv-focus" : "tv-player-panel"}>
            <div className="tv-player-screen">
              {currentItem?.content_url ? (
                <div className="video-interaction-lock">
                  <AdaptiveVideo
                    item={currentItem}
                    key={mediaItemKey(currentItem)}
                    ref={videoRef}
                    poster={hasVideoThumbnail(currentItem) ? currentItem.thumbnail_url : undefined}
                    controlsList="nodownload noplaybackrate noremoteplayback"
                    disablePictureInPicture
                    playsInline
                    preload="metadata"
                    onContextMenu={(event) => event.preventDefault()}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={playNextSong}
                    onTimeUpdate={(event) => setCurrentVideoTime(event.currentTarget.currentTime)}
                  />
                  <div className="media-click-shield" aria-hidden="true" />
                </div>
              ) : (
                <div className="tv-standby">
                  <Music size={58} />
                  <strong>곡을 선택하세요</strong>
                  <span>리모컨 방향키로 곡을 고르고 Enter를 누르면 재생됩니다.</span>
                </div>
              )}
            </div>
            <div className="tv-now">
              <strong>{currentItem ? reservationTitle(currentItem) : "재생 대기"}</strong>
              <span>{currentItem ? karaokeArtist(currentItem) : "예약 목록에서 다음 곡을 이어서 재생합니다."}</span>
            </div>
            <div className="tv-controls">
              <button type="button" onClick={seekPreviousTimeTag} disabled={!timeTags.length}><SkipBack size={20} /> 이전태그</button>
              <button className="primary" type="button" onClick={togglePlay} disabled={!currentItem}>{playing ? <Pause size={20} /> : <Play size={20} />} {playing ? "일시정지" : "재생"}</button>
              <button type="button" onClick={seekNextTimeTag} disabled={!timeTags.length}><SkipForward size={20} /> 간주점프</button>
              <button type="button" onClick={playNextSong} disabled={!queue.length}><ListMusic size={20} /> 다음곡</button>
            </div>
            {timeTags.length > 0 && (
              <div className="tv-time-tags">
                {timeTags.map((entry, index) => (
                  <button className={index === activeTimeIndex ? "active" : ""} type="button" key={`${entry.seconds}-${entry.raw}`} onClick={() => seekToTimeTag(entry.seconds)}>
                    <strong>{formatMediaTime(entry.seconds)}</strong>
                    <span>{entry.label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className={focusArea === "list" ? "tv-song-panel tv-focus" : "tv-song-panel"}>
            <div className="tv-panel-head">
              <strong>곡 목록</strong>
              <span>{items.length}곡 · {tvPageIndex + 1}/{tvPageCount}쪽 · {focusArea === "list" ? "선택 중" : "좌우키로 이동"}</span>
            </div>
            <div className="tv-page-guide">
              <span>▲▼ 곡 이동</span>
              <span>페이지 {tvPageRangeLabel}</span>
            </div>
            <div className="tv-song-list" ref={listRef}>
              {tvVisibleItems.map((item, pageOffset) => {
                const index = tvPageStart + pageOffset;
                return (
                <article className={index === selectedIndex ? "tv-song-card active" : "tv-song-card"} data-karaoke-index={index} key={item.webhard_file_id}>
                  <button className="tv-song-main" type="button" onClick={() => setSelectedIndex(index)} onDoubleClick={() => playNow(item)}>
                    <span className="tv-karaoke-number">{karaokeNumber(item) || String(index + 1).padStart(2, "0")}</span>
                    <strong>{reservationTitle(item)}</strong>
                  </button>
                  <div className="tv-song-actions">
                    <button type="button" onClick={() => playNow(item)}><Play size={16} /> 재생</button>
                    <button type="button" onClick={() => reserve(item)}><Plus size={16} /> 예약</button>
                  </div>
                </article>
                );
              })}
              {!items.length && !loading && <div className="tv-empty">검색 결과가 없습니다.</div>}
            </div>
          </aside>
        </section>

        {message && <p className="tv-message">{message}</p>}
      </main>
    );
  }

  return (
    <main className="karaoke-shell" ref={shellRef} tabIndex={-1}>
      <section className="karaoke-search-panel">
        <div>
          <span className="kind-badge">노래방 모드</span>
          <h1>리모컨으로 고르고 예약하기</h1>
          <p>방향키 좌우로 영역 이동, 상하로 선택 이동, Enter로 실행합니다. 숫자키는 KY번호 검색입니다.</p>
        </div>
        {!tvMode && renderReservationPanel()}
        <form className="karaoke-search" onSubmit={submitSearch}>
          <label>
            노래 검색
            <span className="search-input-wrap">
              <Search size={18} />
              <input className="input karaoke-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목, 가수, KY.12345, 태그" />
            </span>
          </label>
          <label className="tv-quick-search">
            KY 번호
            <span className="search-input-wrap">
              <input
                className="input karaoke-input"
                inputMode="numeric"
                value={quickNumber}
                onChange={(event) => setQuickNumber(event.target.value.replace(/\D/g, "").slice(0, 7))}
                onFocus={() => setFocusArea("keypad")}
                placeholder="00000"
              />
            </span>
          </label>
          <button className="btn primary karaoke-action tv-quick-action" type="button" onClick={searchQuickNumber} disabled={!quickNumber || loading}>번호검색</button>
          <button className="btn primary karaoke-action" type="submit" disabled={loading}>검색</button>
          <button className="btn karaoke-action" type="button" onClick={() => { setQuery(""); setQuickNumber(""); loadKaraoke(""); }} disabled={loading}>초기화</button>
        </form>
      </section>

      <section className="mobile-remote-panel">
        <strong>모바일 조작 패널</strong>
        {remoteSession?.session_id && (
          <p className="remote-session-url">휴대폰 리모컨: {karaokeRemoteUrl(remoteSession.session_id)}</p>
        )}
        <div className="mobile-remote-actions">
          <button type="button" onClick={() => items[selectedIndex] && reserve(items[selectedIndex])}>선택곡 예약</button>
          <button type="button" onClick={() => items[selectedIndex] && playNow(items[selectedIndex])}>선택곡 재생</button>
          <button type="button" onClick={seekPreviousTimeTag} disabled={!timeTags.length}>이전태그</button>
          <button type="button" onClick={seekNextTimeTag} disabled={!timeTags.length}>간주점프</button>
          <button type="button" onClick={playNextSong} disabled={!queue.length}>다음곡</button>
        </div>
      </section>

      <section className="karaoke-grid">
        <div className="karaoke-left-rail">
          <div className={focusArea === "list" ? "karaoke-list-panel focus-area" : "karaoke-list-panel"}>
            <div className="karaoke-list-head">
              <strong>곡 목록</strong>
              <span>{items.length}곡 · {focusArea === "list" ? "선택 중" : "좌우키로 이동"}</span>
            </div>
            <div className="karaoke-list" ref={listRef}>
              {items.map((item, index) => (
                <article className={index === selectedIndex ? "karaoke-card active" : "karaoke-card"} data-karaoke-index={index} key={item.webhard_file_id}>
                  <button className="karaoke-card-main" type="button" onClick={() => setSelectedIndex(index)} onDoubleClick={() => playNow(item)}>
                    <span className="karaoke-number">{karaokeNumber(item) || String(index + 1).padStart(2, "0")}</span>
                    <span>
                      <strong>{item.title || item.display_name || item.file_name}</strong>
                      <small>{karaokeArtist(item)}</small>
                    </span>
                  </button>
                  <div className="karaoke-card-actions">
                    <button className="btn primary" type="button" onClick={() => playNow(item)}><Play size={16} /> 재생</button>
                    <button className="btn" type="button" onClick={() => reserve(item)}><Plus size={16} /> 예약</button>
                  </div>
                </article>
              ))}
              {!items.length && !loading && <div className="karaoke-empty">검색 결과가 없습니다.</div>}
            </div>
          </div>
          <div className={focusArea === "keypad" ? "quick-number focus-area" : "quick-number"}>
            <strong>KY번호 빠른 입력</strong>
            <div className="quick-number-display">{quickNumber || "숫자키 입력"}</div>
            <div className="quick-keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((value) => <button type="button" key={value} onClick={() => pressKeypad(value)}>{value}</button>)}
              <button type="button" onClick={() => pressKeypad("back")}>←</button>
              <button type="button" onClick={() => pressKeypad("0")}>0</button>
              <button type="button" onClick={() => pressKeypad("clear")}>C</button>
            </div>
            <button className="btn primary karaoke-action full" type="button" onClick={searchQuickNumber} disabled={!quickNumber}>번호 검색</button>
          </div>
        </div>

        <section className={focusArea === "player" ? "karaoke-player-panel focus-area" : "karaoke-player-panel"}>
          <div className="karaoke-player">
            {currentItem?.content_url ? (
              <div className="video-interaction-lock">
                <AdaptiveVideo
                  item={currentItem}
                  key={mediaItemKey(currentItem)}
                  ref={videoRef}
                  poster={hasVideoThumbnail(currentItem) ? currentItem.thumbnail_url : undefined}
                  controlsList="nodownload noplaybackrate noremoteplayback"
                  disablePictureInPicture
                  playsInline
                  preload="metadata"
                  onContextMenu={(event) => event.preventDefault()}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={playNextSong}
                  onTimeUpdate={(event) => setCurrentVideoTime(event.currentTarget.currentTime)}
                />
                <div className="media-click-shield" aria-hidden="true" />
              </div>
            ) : (
              <div className="karaoke-standby">
                <Music size={54} />
                <strong>곡을 선택하세요</strong>
                <span>리모컨 방향키로 곡을 고르고 Enter를 누르면 재생됩니다.</span>
              </div>
            )}
          </div>
          <div className="karaoke-now">
            <strong>{currentItem ? (currentItem.title || currentItem.display_name || currentItem.file_name) : "재생 대기"}</strong>
            <span>{currentItem ? karaokeArtist(currentItem) : "예약 목록에서 다음 곡을 이어서 재생합니다."}</span>
          </div>
          <div className="karaoke-controls">
            <button className="karaoke-control" type="button" onClick={seekPreviousTimeTag} disabled={!timeTags.length}><SkipBack size={20} /> 이전태그</button>
            <button className="karaoke-control primary" type="button" onClick={togglePlay} disabled={!currentItem}>{playing ? <Pause size={20} /> : <Play size={20} />} {playing ? "일시정지" : "재생"}</button>
            <button className="karaoke-control" type="button" onClick={seekNextTimeTag} disabled={!timeTags.length}><SkipForward size={20} /> 간주점프</button>
            <button className="karaoke-control" type="button" onClick={playNextSong} disabled={!queue.length}><ListMusic size={20} /> 다음곡</button>
          </div>
          {timeTags.length > 0 && (
            <div className="karaoke-time-tags">
              {timeTags.map((entry, index) => (
                <button className={index === activeTimeIndex ? "active" : ""} type="button" key={`${entry.seconds}-${entry.raw}`} onClick={() => seekToTimeTag(entry.seconds)}>
                  <strong>{formatMediaTime(entry.seconds)}</strong>
                  <span>{entry.label}</span>
                </button>
              ))}
            </div>
          )}
          {currentItem && canEditCurrentItem && (
            <div className="time-tag-editor">
              <label>
                타임태그 편집
                <textarea className="input textarea" value={timeTagDraft} onChange={(event) => setTimeTagDraft(event.target.value)} placeholder="00:35 전주끝&#10;01:12 1절&#10;02:28 간주" />
              </label>
              <button className="btn primary" type="button" onClick={saveTimeTags} disabled={loading}>타임태그 저장</button>
            </div>
          )}
        </section>
      </section>

      {message && <p className="message karaoke-message">{message}</p>}
    </main>
  );
}

function reservationTitle(item) {
  return item?.title || item?.display_name || item?.file_name || "제목 없음";
}

function reservationByLabel(item) {
  const reserver = String(item?.reserved_by_user_id || item?.reserved_by || "").trim();
  return reserver ? `예약자 ${reserver}` : "";
}

function reservationSummary(queue) {
  if (!queue.length) return "0곡";
  if (queue.length === 1) return "다음곡 1곡";
  const extraCount = queue.length - 2;
  return extraCount > 0 ? `다음곡 · 다다음곡 +${extraCount}곡` : "다음곡 · 다다음곡";
}

function reservationItemClass(index, selectedQueueIndex) {
  const classes = [];
  if (index === selectedQueueIndex) classes.push("active");
  if (index === 0) classes.push("next-song");
  if (index === 1) classes.push("second-song");
  if (index > 1) classes.push("later-song");
  return classes.join(" ");
}

function tvQueueCardClass(index) {
  const classes = ["tv-reservation-card"];
  if (index === 0) classes.push("next-song");
  if (index === 1) classes.push("second-song");
  if (index > 1) classes.push("later-song");
  return classes.join(" ");
}

function reservationOrderLabel(index) {
  if (index === 0) return "다음곡";
  if (index === 1) return "다다음곡";
  return `+${index - 1}`;
}

function KaraokeRemotePage({ request, sessionId, role = "", joinToken = "" }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [activeListTab, setActiveListTab] = useState("all");
  const [currentJoinToken, setCurrentJoinToken] = useState(joinToken);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const guestMode = String(role || "").toUpperCase() === "GUEST";
  const favoriteOnly = activeListTab === "favorite";
  const jamShareUrl = !guestMode && currentJoinToken ? karaokeJoinShareUrl(sessionId, currentJoinToken) : "";

  useEffect(() => {
    setCurrentJoinToken(joinToken);
  }, [joinToken, sessionId]);

  useEffect(() => {
    search(query);
  }, [sessionId, activeListTab]);

  async function search(nextQuery = query) {
    setLoading(true);
    setMessage("곡을 검색하는 중입니다.");
    try {
      const params = new URLSearchParams({ content_kind: "KARAOKE", limit: "40", offset: "0", sort: "recent" });
      if (nextQuery.trim()) params.set("q", normalizeKaraokeQuery(nextQuery));
      if (favoriteOnly) params.set("favorite", "true");
      if (guestMode) params.set("public", "true");
      const data = await request(`/api/media/?${params.toString()}`);
      setItems(data.items || []);
      setMessage((data.items || []).length ? "" : "검색 결과가 없습니다.");
    } catch (error) {
      setItems([]);
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    const nextQuery = query.trim();
    setQuery(nextQuery);
    search(nextQuery);
  }

  async function sendCommand(type, item = null) {
    setMessage("TV로 명령을 보내는 중입니다.");
    try {
      await request(`/api/karaoke/remote/${sessionId}/command/`, {
        method: "POST",
        body: JSON.stringify({ type, payload: item ? { item } : {} })
      });
      setMessage(type === "RESERVE_ITEM" ? "예약했습니다." : "TV에 명령을 보냈습니다.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function toggleFavorite(item) {
    try {
      const data = await request(`/api/media/${item.webhard_file_id}/`, {
        method: "PATCH",
        body: JSON.stringify({ favorite: !item.favorite })
      });
      const updated = data.item || item;
      setItems((current) => current.map((entry) => entry.webhard_file_id === updated.webhard_file_id ? updated : entry));
      setMessage(updated.favorite ? "선호곡에 저장했습니다." : "선호곡에서 제거했습니다.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function copyJamShareUrl() {
    if (!jamShareUrl) return;
    try {
      await navigator.clipboard.writeText(jamShareUrl);
      setMessage("Jam 참여 링크를 복사했습니다.");
    } catch {
      window.prompt("Jam 참여 링크", jamShareUrl);
    }
  }

  async function refreshJamShareUrl() {
    setMessage("초대 링크를 새로 만드는 중입니다.");
    try {
      const data = await request(`/api/karaoke/remote/${sessionId}/join-token/`, {
        method: "POST",
        body: "{}"
      });
      const nextToken = data.join_token || "";
      storeRemoteJoinToken(sessionId, nextToken);
      setCurrentJoinToken(nextToken);
      setMessage("새 초대 링크를 만들었습니다. 기존 링크는 사용할 수 없습니다.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  function clearSearch() {
    setQuery("");
    search("");
  }

  return (
    <main className="karaoke-remote-shell">
      <section className="karaoke-search-panel remote-info-panel single-column">
        <div>
          <span className="kind-badge">모바일 리모컨</span>
          <h1>TV 노래방 제어</h1>
          <p>TV와 연결되었습니다. 초대 링크를 공유하면 다른 사용자도 예약할 수 있습니다.</p>
        </div>
        {!guestMode && (
          <div className="remote-share-panel">
            <div>
              <strong>Jam 초대 링크</strong>
              <small>{jamShareUrl ? "공유받은 사용자는 예약만 할 수 있습니다." : "초대 링크를 새로 만들어 공유할 수 있습니다."}</small>
            </div>
            <div className="remote-share-actions">
              <button className="btn" type="button" onClick={refreshJamShareUrl}><RefreshCw size={16} /> 재발급</button>
              <button className="btn primary" type="button" onClick={copyJamShareUrl} disabled={!jamShareUrl}>링크 복사</button>
            </div>
          </div>
        )}
      </section>

      <section className={guestMode ? "remote-control-pad remote-host-only hidden" : "remote-control-pad remote-host-only"}>
        <button type="button" onClick={() => sendCommand("PREV_TAG")}>이전태그</button>
        <button type="button" onClick={() => sendCommand("TOGGLE_PLAY")}>재생/정지</button>
        <button type="button" onClick={() => sendCommand("NEXT_TAG")}>간주점프</button>
        <button type="button" onClick={() => sendCommand("NEXT")}>다음곡</button>
        <button type="button" onClick={() => sendCommand("CLEAR_QUEUE")}>예약비움</button>
      </section>

      <section className="karaoke-search-panel remote-search-panel single-column">
        <form className="karaoke-search remote-search-form" onSubmit={submitSearch}>
          <label>
            곡 검색
            <span className="search-input-wrap">
              <Search size={18} />
              <input className="input karaoke-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목, 가수, KY번호" />
            </span>
          </label>
          <button className="btn primary karaoke-action" type="submit" disabled={loading}>검색</button>
          <button className="btn karaoke-action" type="button" onClick={clearSearch} disabled={loading && !query}>초기화</button>
        </form>
        <div className="remote-list-tabs" role="tablist" aria-label="노래 목록">
          <button className={activeListTab === "all" ? "active" : ""} type="button" onClick={() => setActiveListTab("all")}>전체곡</button>
          <button className={activeListTab === "favorite" ? "active" : ""} type="button" onClick={() => setActiveListTab("favorite")}>선호곡</button>
        </div>
        <p className="remote-search-status">{loading ? "검색 중..." : `${items.length}곡 표시 중`}</p>
      </section>

      <section className="remote-song-list">
        <div className="remote-section-head">
          <strong>검색 목록</strong>
          <span>{items.length}곡</span>
        </div>
        {items.map((item) => (
          <article key={item.webhard_file_id}>
            <div>
              <span className="karaoke-number">{karaokeNumber(item) || "-"}</span>
              <strong>{item.title || item.display_name || item.file_name}</strong>
              <small>{karaokeArtist(item)}</small>
            </div>
            <button className={guestMode ? "btn primary hidden" : "btn primary"} type="button" onClick={() => sendCommand("PLAY_ITEM", item)}><Play size={16} /> 바로재생</button>
            <button className="btn" type="button" onClick={() => sendCommand("RESERVE_ITEM", item)}><Plus size={16} /> 예약</button>
            <button className={item.favorite ? "btn primary" : "btn"} type="button" onClick={() => toggleFavorite(item)}><Star size={16} /> 선호</button>
          </article>
        ))}
      </section>
      {message && <p className="message karaoke-message">{message}</p>}
    </main>
  );
}

function YoutubeImportPage({ currentUser, request, onImported }) {
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [preview, setPreview] = useState(null);
  const [toolStatus, setToolStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [queueItems, setQueueItems] = useState([]);
  const [jobId, setJobId] = useState("");
  const [jobSummary, setJobSummary] = useState(null);

  useEffect(() => {
    if (currentUser?.is_admin) {
      checkTools();
    }
  }, [currentUser?.is_admin]);

  useEffect(() => {
    if (!importing || !jobId || !queueItems.length) return undefined;
    let stopped = false;
    const updateQueue = async () => {
      const ids = queueItems.map((item) => item.youtube_video_id).filter(Boolean);
      if (!ids.length) return;
      try {
        const data = await request("/api/youtube/import/status/", {
          method: "POST",
          body: JSON.stringify({ youtube_video_ids: ids, job_id: jobId })
        });
        if (!stopped) {
          if (data.job?.items?.length) {
            updateQueueFromJob(data.job);
          } else {
            markSavedQueueItems(data.items || []);
          }
          if (isYoutubeJobIdle(data.job)) {
            finishImportJob(data.job);
          }
        }
      } catch {
        // Keep the browser session active while the server-side download continues.
      }
    };
    updateQueue();
    const timer = window.setInterval(updateQueue, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [importing, queueItems.length, jobId]);

  async function checkTools() {
    setLoading(true);
    setMessage("다운로드 도구와 웹하드 상태를 확인하는 중입니다.");
    try {
      const data = await request("/api/youtube/tools/check/", { method: "POST", body: "{}" });
      setToolStatus(data);
      setMessage(data.ok_to_download ? "다운로드와 웹하드 저장 준비가 끝났습니다." : "다운로드 환경 또는 웹하드 상태 확인이 필요합니다.");
      return data;
    } catch (error) {
      setMessage(error.message);
      setToolStatus(null);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function analyze(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("유튜브 링크를 분석하는 중입니다.");
    setPreview(null);
    setQueueItems([]);
    setJobId("");
    setJobSummary(null);
    try {
      const data = await request("/api/youtube/preview/", {
        method: "POST",
        body: JSON.stringify({ url })
      });
      setPreview(data);
      setQueueItems(buildImportQueue(data.items || []));
      setMessage(`${data.item_count || 0}개 영상을 찾았습니다.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function ensureJob() {
    if (jobId) return jobId;
    const checked = await checkTools();
    if (!checked?.ok_to_download) return "";
    const importTags = splitTags(tags);
    const initialQueue = buildImportQueue(preview?.items || []);
    setLoading(true);
    setMessage("유튜브 저장 작업을 생성하는 중입니다.");
    try {
      const data = await request("/api/youtube/import/", {
        method: "POST",
        body: JSON.stringify({ url, tags: importTags })
      });
      const nextJobId = data.job_id || "";
      if (!nextJobId) {
        setMessage("유튜브 저장 작업을 시작하지 못했습니다.");
        return "";
      }
      setJobId(nextJobId);
      setJobSummary(data);
      setQueueItems(data.items?.length ? data.items.map(normalizeQueueItem) : initialQueue);
      setMessage(`${data.item_count || initialQueue.length}개 다운로드 작업이 준비되었습니다.`);
      return nextJobId;
    } catch (error) {
      setMessage(error.message);
      return "";
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const nextJobId = await ensureJob();
    if (!nextJobId) return;
    setImporting(true);
    setLoading(true);
    setQueueItems((current) => current.map((item) => (
      item.status === "saved" ? item : { ...item, status: "downloading", message: "" }
    )));
    setMessage("목록 다운로드를 시작했습니다. 완료 전까지 상태를 계속 확인합니다.");
    try {
      const data = await request("/api/youtube/import/start-all/", {
        method: "POST",
        body: JSON.stringify({ job_id: nextJobId })
      });
      if (data.job?.items?.length) {
        updateQueueFromJob(data.job);
      }
    } catch (error) {
      setMessage(error.message);
      setImporting(false);
    } finally {
      setLoading(false);
    }
  }

  async function startOne(item) {
    const nextJobId = await ensureJob();
    if (!nextJobId) return;
    setImporting(true);
    setQueueItems((current) => current.map((entry) => (
      entry.youtube_video_id === item.youtube_video_id
        ? { ...entry, status: "downloading", message: "" }
        : entry
    )));
    setMessage(`${item.title || item.youtube_video_id} 다운로드를 시작했습니다.`);
    try {
      const data = await request("/api/youtube/import/item/start/", {
        method: "POST",
        body: JSON.stringify({ job_id: nextJobId, youtube_video_id: item.youtube_video_id })
      });
      if (data.job?.items?.length) {
        updateQueueFromJob(data.job);
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  function finishImportJob(job) {
    const result = job?.result || job || {};
    const savedCount = result.downloaded_count || result.upserted_count || 0;
    const duplicateCount = result.skipped_duplicate_count || 0;
    const failedCount = result.failed_count || 0;
    const firstFailure = (result.results || []).find((item) => item.status === "FAILED");
    setJobSummary(job || null);
    applyFinalImportResults(result.results || []);
    setMessage(`웹하드 저장 완료: ${result.scanned_count || 0}개 확인, ${savedCount}개 저장, 중복 제외 ${duplicateCount}개, ${failedCount}개 실패${firstFailure?.message ? ` - ${firstFailure.message}` : ""}`);
    setImporting(false);
    setLoading(false);
    if (savedCount > 0) {
      onImported(splitTags(tags));
    }
  }

  function updateQueueFromJob(job) {
    const items = (job.items || []).map(normalizeQueueItem);
    setQueueItems(items);
    setJobSummary(job);
    const savedCount = Number(job.downloaded_count ?? items.filter((item) => item.status === "saved").length);
    const duplicateCount = Number(job.skipped_duplicate_count ?? items.filter((item) => item.status === "skipped").length);
    const failedCount = Number(job.failed_count ?? items.filter((item) => item.status === "failed").length);
    const runningCount = Number(job.running_count ?? items.filter((item) => item.status === "downloading").length);
    const queuedCount = Number(job.queued_count ?? items.filter((item) => item.status === "queued").length);
    const activeTitle = job.active_item?.title ? `, 현재: ${job.active_item.title}` : "";
    setMessage(`유튜브 저장 진행 중입니다. 저장 ${savedCount}/${items.length}${duplicateCount ? `, 중복 제외 ${duplicateCount}` : ""}${runningCount ? `, 진행 ${runningCount}` : ""}${queuedCount ? `, 대기 ${queuedCount}` : ""}${failedCount ? `, 실패 ${failedCount}` : ""}${activeTitle}`);
  }

  function markSavedQueueItems(savedItems) {
    setQueueItems((current) => {
      const savedById = new Map(savedItems.map((item) => [String(item.youtube_video_id || ""), item]));
      let firstPendingMarked = false;
      const next = current.map((item) => {
        const saved = savedById.get(String(item.youtube_video_id || ""));
        if (saved) {
          return { ...item, status: "saved", webhard_file_id: saved.webhard_file_id };
        }
        if (item.status === "failed") return item;
        if (!firstPendingMarked) {
          firstPendingMarked = true;
          return { ...item, status: "downloading" };
        }
        return { ...item, status: "queued" };
      });
      const savedCount = next.filter((item) => item.status === "saved").length;
      const failedCount = next.filter((item) => item.status === "failed").length;
      setMessage(`유튜브 영상을 다운로드해서 웹하드에 저장하는 중입니다. ${savedCount}/${next.length} 저장${failedCount ? `, ${failedCount} 실패` : ""}`);
      return next;
    });
  }

  function applyFinalImportResults(results) {
    if (!results.length) return;
    const resultById = new Map(results.map((item) => [String(item.youtube_video_id || ""), item]));
    setQueueItems((current) => current.map((item) => {
      const result = resultById.get(String(item.youtube_video_id || ""));
      if (!result) return item;
      if (result.status === "DOWNLOADED") {
        return { ...item, status: "saved", webhard_file_id: result.file_id };
      }
      if (result.status === "SKIPPED_DUPLICATE") {
        return { ...item, status: "skipped", webhard_file_id: result.file_id, message: "이미 저장된 영상" };
      }
      if (result.status === "FAILED") {
        return { ...item, status: "failed", message: result.message || "저장 실패" };
      }
      return item;
    }));
  }

  if (!currentUser?.is_admin) {
    return (
      <main className="shell media-shell">
        <section className="panel page-head">
          <div>
            <h1>유튜브 저장</h1>
            <p>관리자만 사용할 수 있습니다.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      <main className="shell media-shell">
        <section className="panel page-head">
          <div>
            <h1>유튜브 저장</h1>
            <p>단일 영상 또는 재생목록 링크를 다운로드해서 웹하드에 저장하고 미디어 영상 목록에 반영합니다.</p>
          </div>
        </section>

        <section className="panel youtube-panel">
          <div className="tool-check">
            <div>
              <h2>다운로드 환경 체크</h2>
              <p>저장 실행 전 `yt-dlp`, `ffmpeg`, 웹하드 실행 상태를 확인합니다. `ffmpeg`가 없으면 자동 설치합니다.</p>
            </div>
            <button className="btn" type="button" onClick={checkTools} disabled={loading}>다시 체크</button>
          </div>
          {toolStatus && <ToolStatus status={toolStatus} />}
          <form className="youtube-form" onSubmit={analyze}>
            <label>
              유튜브 링크
              <input className="input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=... 또는 playlist URL" />
            </label>
            <label>
              태그
              <input className="input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="쉼표로 구분, 예: 노래방, 최신곡" />
            </label>
            <div className="actions">
              <button className="btn" type="submit" disabled={loading || !url.trim()}>분석</button>
              <button className="btn primary" type="button" onClick={save} disabled={loading || !preview?.item_count}>목록 전체 다운로드 시작</button>
            </div>
          </form>
          {message && <p className="message inline-message">{message}</p>}
        </section>

        {preview && (
          <section className="panel youtube-preview">
            <div className="preview-head">
              <div>
                <h2>{preview.playlist_title || preview.title || "유튜브 영상"}</h2>
                <p>{preview.item_count}개 영상 · 분석된 목록에서 원하는 영상만 저장하거나 전체 저장을 시작할 수 있습니다.</p>
              </div>
              <button className="btn primary" type="button" onClick={save} disabled={loading}>전체 저장 시작</button>
            </div>
            <QueueSummary items={queueItems} importing={importing} jobSummary={jobSummary} />
            <div className="youtube-list-head">
              <strong>저장할 영상 목록</strong>
              <span>다운로드 후 웹하드에 저장되고 미디어 목록에 반영됩니다.</span>
            </div>
            <div className="youtube-list">
              {(queueItems.length ? queueItems : buildImportQueue(preview.items || [])).map((item) => (
                <article className={`youtube-item ${item.status || "queued"}`} key={item.youtube_video_id}>
                  {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" /> : <div className="youtube-thumb-empty">썸네일 없음</div>}
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.channel_name || item.youtube_video_id}</small>
                    <span className={`queue-status ${item.status || "queued"}`}>{queueStatusLabel(item)}</span>
                    {item.message && <em>{item.message}</em>}
                    <div className="youtube-item-actions">
                      <button
                        className="btn compact"
                        type="button"
                        onClick={() => startOne(item)}
                        disabled={loading || item.status === "downloading" || item.status === "saved"}
                      >
                        이 영상만 저장
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
      {loading && !importing && <LoadingOverlay message={message} />}
    </>
  );
}

function QueueSummary({ items, importing, jobSummary }) {
  if (!items.length) return null;
  const saved = Number(jobSummary?.downloaded_count ?? items.filter((item) => item.status === "saved").length);
  const duplicate = Number(jobSummary?.skipped_duplicate_count ?? items.filter((item) => item.status === "skipped").length);
  const failed = Number(jobSummary?.failed_count ?? items.filter((item) => item.status === "failed").length);
  const running = Number(jobSummary?.running_count ?? items.filter((item) => item.status === "downloading").length);
  const queued = Number(jobSummary?.queued_count ?? items.filter((item) => item.status === "queued").length);
  const active = running > 0;
  const finished = Number(jobSummary?.finished_count ?? saved + duplicate + failed);
  const progress = Number(jobSummary?.progress_percent ?? ((finished / items.length) * 100));
  const activeTitle = jobSummary?.active_item?.title || items.find((item) => item.status === "downloading")?.title || "";
  const summaryText = failed
    ? `${failed}개 실패`
    : importing || active
      ? "다운로드 및 웹하드 저장 진행 중"
      : "저장 시작 전";
  return (
    <div className="queue-summary" aria-live="polite">
      <strong>{saved}/{items.length}</strong>
      <span>{summaryText}</span>
      <progress max={100} value={Number.isFinite(progress) ? progress : 0} />
      <small>웹하드 저장 완료 {saved}개 · 중복 제외 {duplicate}개 · 다운로드 중 {running}개 · 다운로드 예정 {queued}개{activeTitle ? ` · 현재 처리 중: ${activeTitle}` : ""}</small>
    </div>
  );
}

function ToolStatus({ status }) {
  const tools = status.tools || {};
  return (
    <div className="tool-status-grid">
      {[tools.yt_dlp, tools.ffmpeg, tools.webhard].filter(Boolean).map((tool) => (
        <article className={tool.installed && tool.is_latest !== false ? "tool-card ok" : "tool-card warn"} key={tool.name}>
          <strong>{tool.name}</strong>
          <span>{tool.installed ? "설치됨" : "미설치"}</span>
          <small>현재: {tool.version || "-"}</small>
          <small>최신: {tool.latest_version || "확인 불가"}</small>
          <p>{tool.message}</p>
        </article>
      ))}
    </div>
  );
}

function ViewerModal({ item, currentUser, onClose, onPatch, onCreateThumbnail, onDelete }) {
  const videoRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [form, setForm] = useState({ title: item.title || "", album: item.album || "", tags: (item.tags || []).join(", "), description: item.description || "" });
  const [thumbnailTime, setThumbnailTime] = useState("00:00:01");
  const [timeTagDraft, setTimeTagDraft] = useState(formatTimeTagDraft(item.tags || []));
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const canManage = canManageMedia(currentUser, item);
  const canDelete = canDeleteMedia(currentUser, item);
  const isYoutubeEmbed = item.source_type === "YOUTUBE" && item.youtube_embed_url;
  const isLocalVideo = !isYoutubeEmbed && item.content_kind === "VIDEO" && item.content_url;
  const timeTags = useMemo(() => parseTimeTags(item.tags || []), [item.tags]);
  const activeTimeIndex = activeTimeTagIndex(timeTags, currentVideoTime);

  useEffect(() => {
    setForm({ title: item.title || "", album: item.album || "", tags: (item.tags || []).join(", "), description: item.description || "" });
    setThumbnailTime("00:00:01");
    setTimeTagDraft(formatTimeTagDraft(item.tags || []));
    setCurrentVideoTime(0);
  }, [item]);

  function save() {
    onPatch(item, {
      title: form.title,
      album: form.album,
      tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      description: form.description
    });
    setEditing(false);
  }

  function useCurrentThumbnailTime() {
    const currentTime = videoRef.current?.currentTime || 0;
    setThumbnailTime(formatMediaTime(currentTime));
  }

  function submitThumbnail() {
    const seekSeconds = parseTimeInput(thumbnailTime);
    if (seekSeconds == null) {
      window.alert("썸네일 시간은 12, 01:12, 01:02:03 형식으로 입력해 주세요.");
      return;
    }
    onCreateThumbnail(item, seekSeconds);
  }

  function seekToTimeTag(seconds) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    playMediaElement(video);
  }

  function seekNextTimeTag() {
    if (!timeTags.length) return;
    const currentTime = videoRef.current?.currentTime || 0;
    const next = timeTags.find((entry) => entry.seconds > currentTime + 0.35) || timeTags[0];
    seekToTimeTag(next.seconds);
  }

  function seekPreviousTimeTag() {
    if (!timeTags.length) return;
    const currentTime = videoRef.current?.currentTime || 0;
    const previous = [...timeTags].reverse().find((entry) => entry.seconds < currentTime - 0.35) || timeTags[timeTags.length - 1];
    seekToTimeTag(previous.seconds);
  }

  function addCurrentTimeTag() {
    const currentTime = videoRef.current?.currentTime || 0;
    const nextLine = formatMediaTime(currentTime);
    setTimeTagDraft((current) => current ? `${current}\n${nextLine}` : nextLine);
  }

  function saveTimeTags() {
    const preservedTags = (item.tags || []).filter((tag) => !isTimeTag(tag));
    const nextTimeTags = timeTagDraft
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(normalizeTimeTagLine)
      .filter(Boolean);
    const nextTags = uniqueTags(preservedTags.concat(nextTimeTags));
    setForm((current) => ({ ...current, tags: nextTags.join(", ") }));
    onPatch(item, { tags: nextTags });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-panel viewer-panel" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="kind-badge">{kindLabel(item.content_kind)}</span>
            <h2>{item.title || item.display_name || item.file_name}</h2>
          </div>
          <button className="btn icon-only" type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>

        <div className="viewer-grid">
          <div className="file-viewer media-viewer">
            {isYoutubeEmbed ? (
              <iframe className="detail-media youtube-frame" src={item.youtube_embed_url} title={item.title || item.display_name || "YouTube"} allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" />
            ) : isLocalVideo ? (
              <AdaptiveVideo
                item={item}
                ref={videoRef}
                className="detail-media"
                poster={hasVideoThumbnail(item) ? item.thumbnail_url : undefined}
                controls
                controlsList="nodownload noplaybackrate noremoteplayback"
                disablePictureInPicture
                playsInline
                preload="metadata"
                onContextMenu={(event) => event.preventDefault()}
                onTimeUpdate={(event) => setCurrentVideoTime(event.currentTarget.currentTime)}
              />
            ) : item.thumbnail_url || item.content_url ? (
              <img className="detail-media" src={item.content_url || item.thumbnail_url} alt="" />
            ) : (
              <div className="document-detail"><strong>미리보기 없음</strong><span>{item.file_name}</span></div>
            )}
          </div>

          <aside className="viewer-side">
            <div className="actions side-actions">
              <button className="btn" type="button" onClick={() => setInfoOpen(true)}><Info size={16} /> 파일 정보</button>
              <button className={item.favorite ? "btn primary" : "btn"} type="button" onClick={() => onPatch(item, { favorite: !item.favorite })}>
                <Star size={16} /> 즐겨찾기
              </button>
              <button className={item.liked ? "btn primary" : "btn"} type="button" onClick={() => onPatch(item, { liked: !item.liked })}>
                <Heart size={16} /> {formatCount(item.like_count)}
              </button>
              {item.download_url && !isLocalVideo && !isYoutubeEmbed && <a className="btn" href={item.download_url}><Download size={16} /> 다운로드</a>}
              {canDelete && (
                <button className="btn danger" type="button" onClick={() => onDelete(item)}>
                  <Trash2 size={16} /> 삭제
                </button>
              )}
            </div>

            {canManage && isLocalVideo && (
              <div className="thumbnail-control">
                <label>
                  썸네일 시간
                  <input className="input" value={thumbnailTime} onChange={(event) => setThumbnailTime(event.target.value)} placeholder="00:00:01" />
                </label>
                <div className="actions">
                  <button className="btn" type="button" onClick={useCurrentThumbnailTime}><Clock size={16} /> 현재 시간</button>
                  <button className="btn primary" type="button" onClick={submitThumbnail}>썸네일 변경</button>
                </div>
              </div>
            )}

            {isLocalVideo && (
              <div className="time-tags-panel">
                <div className="time-tags-head">
                  <strong>타임태그</strong>
                  <div className="actions">
                    <button className="btn" type="button" onClick={seekPreviousTimeTag} disabled={!timeTags.length}><SkipBack size={16} /> 이전</button>
                    <button className="btn" type="button" onClick={seekNextTimeTag} disabled={!timeTags.length}><SkipForward size={16} /> 다음</button>
                  </div>
                </div>
                {timeTags.length > 0 ? (
                  <div className="time-tag-list">
                    {timeTags.map((entry, index) => (
                      <button
                        className={index === activeTimeIndex ? "time-tag-button active" : "time-tag-button"}
                        key={`${entry.seconds}-${entry.raw}`}
                        type="button"
                        onClick={() => seekToTimeTag(entry.seconds)}
                      >
                        <strong>{formatMediaTime(entry.seconds)}</strong>
                        <span>{entry.label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="time-tag-empty">등록된 타임태그가 없습니다.</p>
                )}
                {canManage && (
                  <div className="time-tag-editor media-time-tag-editor">
                    <label>
                      타임태그 편집
                      <textarea
                        className="input textarea"
                        value={timeTagDraft}
                        onChange={(event) => setTimeTagDraft(event.target.value)}
                      />
                    </label>
                    <div className="time-tag-editor-actions">
                      <button className="btn" type="button" onClick={addCurrentTimeTag}><Clock size={16} /> 현재 시간 추가</button>
                      <button className="btn primary" type="button" onClick={saveTimeTags}>타임태그 저장</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {editing ? (
              <div className="form-grid single-column">
                <label>제목<input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
                <label>앨범<input className="input" value={form.album} onChange={(event) => setForm({ ...form, album: event.target.value })} /></label>
                <label>태그<input className="input" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="쉼표로 구분" /></label>
                <label>설명<textarea className="input textarea" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
                <div className="actions">
                  <button className="btn" type="button" onClick={() => setEditing(false)}>취소</button>
                  <button className="btn primary" type="button" onClick={save}>저장</button>
                </div>
              </div>
            ) : (
              <div className="meta-block">
                <div className="tag-row">
                  {(item.tags || []).length ? item.tags.map((tag) => <span key={tag}><Tags size={13} />{tag}</span>) : <span>태그 없음</span>}
                </div>
                <p>{item.description || "설명이 없습니다."}</p>
                {canManage && <button className="btn" type="button" onClick={() => setEditing(true)}>메타데이터 수정</button>}
              </div>
            )}
          </aside>
        </div>
        {infoOpen && <FileInfoDialog item={item} onClose={() => setInfoOpen(false)} />}
      </section>
    </div>
  );
}

function FileInfoDialog({ item, onClose }) {
  return (
    <div className="info-dialog-backdrop" onClick={onClose}>
      <section className="info-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head compact-head">
          <div>
            <span className="kind-badge">정보</span>
            <h2>파일 정보</h2>
          </div>
          <button className="btn icon-only" type="button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        <dl className="status-list compact-grid">
          <div><dt>파일명</dt><dd>{item.file_name || item.display_name || "-"}</dd></div>
          <div><dt>크기</dt><dd>{formatSize(item.file_size)}</dd></div>
          <div><dt>소유자</dt><dd>{item.owner_user_id || "-"}</dd></div>
          <div><dt>생성일</dt><dd>{formatDateTime(item.original_created_at || item.uploaded_at)}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function mergeItems(current, next) {
  const seen = new Set(current.map((item) => String(item.webhard_file_id)));
  return current.concat(next.filter((item) => !seen.has(String(item.webhard_file_id))));
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildImportQueue(items) {
  return (items || []).map((item, index) => ({
    youtube_video_id: String(item.youtube_video_id || item.id || index),
    title: item.title || item.youtube_video_id || `영상 ${index + 1}`,
    channel_name: item.channel_name || "",
    thumbnail_url: item.thumbnail_url || "",
    status: "queued",
    message: ""
  }));
}

function normalizeQueueItem(item) {
  const status = String(item.status || "QUEUED").toUpperCase();
  let mappedStatus = "queued";
  if (status === "RUNNING" || status === "DOWNLOADING") mappedStatus = "downloading";
  if (status === "SAVED" || status === "DOWNLOADED") mappedStatus = "saved";
  if (status === "SKIPPED_DUPLICATE") mappedStatus = "skipped";
  if (status === "FAILED") mappedStatus = "failed";
  return {
    order_no: Number(item.order_no || 0),
    youtube_video_id: String(item.youtube_video_id || item.id || ""),
    title: item.title || item.youtube_video_id || "영상",
    channel_name: item.channel_name || "",
    thumbnail_url: item.thumbnail_url || "",
    status: mappedStatus,
    webhard_file_id: item.webhard_file_id || item.file_id || "",
    message: item.message || "",
    started_at: item.started_at || "",
    finished_at: item.finished_at || ""
  };
}

function isTimeTagJobIdle(job) {
  if (!job) return false;
  if (job.worker_running) return false;
  const status = String(job.status || "").toUpperCase();
  return ["DONE", "FAILED", "PARTIAL"].includes(status);
}

function timeTagJobMessage(job) {
  const itemCount = Number(job?.item_count || 0);
  const finishedCount = Number(job?.finished_count || 0);
  const updatedCount = Number(job?.updated_count || 0);
  const failedCount = Number(job?.failed_count || 0);
  const missingUrlCount = Number(job?.skipped_missing_url_count || 0);
  const missingFileCount = Number(job?.skipped_missing_file_count || 0);
  const emptyCount = Number(job?.skipped_empty_count || 0);
  const status = String(job?.status || "").toUpperCase();
  if (!itemCount) return "생성할 타임라인 태그 대상이 없습니다.";
  if (isTimeTagJobIdle(job)) {
    return `타임라인 생성 완료: ${itemCount}개 대상, ${updatedCount}개 반영, URL 없음 ${missingUrlCount}개, 파일 없음 ${missingFileCount}개, 미검출 ${emptyCount}개, 실패 ${failedCount}개`;
  }
  const activeTitle = job?.active_item?.title ? `, 현재: ${job.active_item.title}` : "";
  return `타임라인 생성 ${status === "QUEUED" ? "대기" : "진행"} 중: ${finishedCount}/${itemCount}개 처리, ${updatedCount}개 반영${failedCount ? `, 실패 ${failedCount}개` : ""}${activeTitle}`;
}

function isYoutubeJobIdle(job) {
  if (!job) return false;
  const status = String(job.status || "").toUpperCase();
  if (status === "DONE" || status === "FAILED") return true;
  return !(job.items || []).some((item) => String(item.status || "").toUpperCase() === "RUNNING");
}

function queueStatusLabel(item) {
  if (item.status === "saved") return "웹하드 저장 완료";
  if (item.status === "skipped") return "중복 제외";
  if (item.status === "downloading") return "다운로드 중";
  if (item.status === "failed") return "실패";
  return "다운로드 예정";
}

function isAuthInvalid(response, body) {
  const code = String(body?.code || "").toUpperCase();
  return response.status === 401 || code === "UNAUTHORIZED" || code === "AUTH_REQUIRED";
}

function redirectToLoginWithAlert() {
  if (typeof window === "undefined") return;
  if (window.__MEDIA_AUTH_REDIRECTING) return;
  window.__MEDIA_AUTH_REDIRECTING = true;
  window.alert("로그인 정보가 유효하지 않습니다. 다시 로그인해 주세요.");
  window.location.href = loginUrl();
}

function loginUrl() {
  const returnUrl = typeof window === "undefined" ? "" : window.location.href;
  return `${ADMIN_BASE_URL}/service-login-page.do?service_nm=${encodeURIComponent("Media Service")}&return_url=${encodeURIComponent(returnUrl)}`;
}

function postAdminLogout() {
  if (typeof document === "undefined") return;
  const iframeName = "adminLogoutFrame";
  let iframe = document.querySelector(`iframe[name="${iframeName}"]`);
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.name = iframeName;
    iframe.hidden = true;
    document.body.appendChild(iframe);
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${ADMIN_BASE_URL}/logout.json`;
  form.target = iframeName;
  form.style.display = "none";
  document.body.appendChild(form);
  form.submit();
  window.setTimeout(() => form.remove(), 1000);
}

function serviceBaseUrl(configured, localPort, serviceSubdomain = "") {
  const value = String(configured || "").replace(/\/+$/, "");
  if (value) {
    return value;
  }
  if (typeof window === "undefined") {
    return `http://localhost:${localPort}`;
  }
  const { protocol, hostname, origin } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:${localPort}`;
  }
  const sibling = siblingServiceOrigin(protocol, hostname, serviceSubdomain);
  if (sibling) {
    return sibling;
  }
  return origin;
}

function siblingServiceOrigin(protocol, hostname, serviceSubdomain) {
  if (!serviceSubdomain) return "";
  const parts = String(hostname || "").split(".");
  if (parts.length < 3) return "";
  parts[0] = serviceSubdomain;
  return `${protocol}//${parts.join(".")}`;
}

function canManageMedia(currentUser, item) {
  if (!currentUser) return false;
  return currentUser.is_admin === true || String(item?.owner_user_id || "") === String(currentUser.user_id || "");
}

function canDeleteMedia(currentUser, item) {
  if (!canManageMedia(currentUser, item)) return false;
  return currentUser.is_admin === true || currentUser.permissions?.delete === true;
}

function decrementCounts(counts, item) {
  const key = item?.content_kind === "IMAGE" ? "image" : ((item?.tags || []).includes("노래방") ? "karaoke" : "video");
  return { ...counts, [key]: Math.max(Number(counts[key] || 0) - 1, 0) };
}

function kindLabel(kind) {
  if (kind === "IMAGE") return "이미지";
  if (kind === "VIDEO") return "영상";
  return String(kind || "-");
}

function formatSize(value) {
  const size = Number(value || 0);
  if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR", { hour12: false });
}

function normalizeKaraokeQuery(value) {
  const text = String(value || "").trim();
  const numberMatch = text.match(/^(?:KY\.?|ky\.?)?(\d{3,7})$/);
  if (numberMatch) {
    return numberMatch[1];
  }
  return text;
}

function karaokeNumber(item) {
  if (item?.karaoke_number) return item.karaoke_number;
  const tags = [...(item?.tags || []), ...(item?.webhard_tags || [])];
  for (const tag of tags) {
    const match = String(tag || "").match(/KY\.?(\d{3,7})/i);
    if (match) return `KY.${match[1]}`;
    const numericMatch = String(tag || "").trim().match(/^\d{3,7}$/);
    if (numericMatch) return `KY.${numericMatch[0]}`;
  }
  const text = `${item?.title || ""} ${item?.display_name || ""} ${item?.file_name || ""}`;
  const match = text.match(/KY\.?(\d{3,7})/i);
  return match ? `KY.${match[1]}` : "";
}

function karaokeArtist(item) {
  const karaokeArtistName = String(item?.karaoke_artist || "").trim();
  if (karaokeArtistName && !isHiddenKaraokeArtistLabel(karaokeArtistName)) return karaokeArtistName;
  const channelName = String(item?.channel_name || "").trim();
  if (channelName && !isHiddenKaraokeArtistLabel(channelName)) return channelName;
  const albumName = String(item?.album || "").trim();
  if (albumName && !isHiddenKaraokeArtistLabel(albumName)) return albumName;
  return (item?.tags || [])
    .filter((tag) => !/^KY\.?\d+/i.test(String(tag)) && !String(tag).includes(":") && !isHiddenKaraokeArtistLabel(tag))
    .slice(0, 2)
    .join(", ") || "";
}

function isHiddenKaraokeArtistLabel(value) {
  const text = String(value || "").replace(/\s+/g, "").toLowerCase();
  return isOfficialKaraokeChannel(value) || text === "admin채널" || text === "adminchannel";
}

function isOfficialKaraokeChannel(value) {
  const text = String(value || "").replace(/\s+/g, "").toLowerCase();
  return text.includes("tj노래방공식유튜브") || text.includes("tjkaraoke") || text.includes("공식유튜브채널");
}

function remoteSessionIdFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("karaoke_remote") || "";
}

function remoteRoleFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("karaoke_role") || "";
}

function remoteJoinTokenFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("karaoke_join_token") || "";
}

function storedRemoteJoinToken(sessionId) {
  if (typeof window === "undefined" || !sessionId) return "";
  try {
    return window.sessionStorage.getItem(`karaoke_join_token:${sessionId}`) || "";
  } catch {
    return "";
  }
}

function storeRemoteJoinToken(sessionId, joinToken) {
  if (typeof window === "undefined" || !sessionId || !joinToken) return false;
  try {
    window.sessionStorage.setItem(`karaoke_join_token:${sessionId}`, joinToken);
    return true;
  } catch {
    return false;
  }
}

function karaokeTvModeFromUrl() {
  if (typeof window === "undefined") return false;
  return window.location.pathname === "/tv";
}

function karaokePairTokenFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("karaoke_pair") || "";
}

function karaokeJoinTokenFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("karaoke_join") || "";
}

function parseKaraokeJoinToken(value) {
  const [sessionId, ...tokenParts] = String(value || "").split(".");
  return { sessionId: sessionId || "", token: tokenParts.join(".") };
}

function karaokeRemoteUrl(sessionId, role = "", joinToken = "") {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("karaoke_remote", sessionId);
  if (role) url.searchParams.set("karaoke_role", role);
  if (joinToken) url.searchParams.set("karaoke_join_token", joinToken);
  return url.toString();
}

function karaokeJoinShareUrl(sessionId, joinToken) {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("karaoke_join", `${sessionId}.${joinToken}`);
  return url.toString();
}

function mediaItemKey(item) {
  if (!item) return "";
  return String(item.webhard_file_id || item.content_url || item.file_name || "");
}

function preferredVideoQuality() {
  if (typeof window === "undefined") return "1080";
  const width = Math.max(window.innerWidth || 0, window.screen?.width || 0);
  const pixelWidth = width * (window.devicePixelRatio || 1);
  return pixelWidth >= 1200 ? "1080" : "720";
}

function playbackContentUrl(item, quality = preferredVideoQuality()) {
  const url = String(item?.content_url || "");
  if (!url || item?.content_kind !== "VIDEO") return url;
  if (/[?&]quality=(720|1080)(?:&|$)/.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}quality=${encodeURIComponent(quality)}`;
}

const AdaptiveVideo = React.forwardRef(function AdaptiveVideo({ item, ...props }, forwardedRef) {
  const localRef = useRef(null);
  const hlsRef = useRef(null);
  const fallbackSrc = playbackContentUrl(item);
  const hlsUrl = item?.content_kind === "VIDEO" ? String(item?.hls_url || "") : "";

  useEffect(() => {
    const video = localRef.current;
    if (!video) return undefined;
    let cancelled = false;
    let usingFallback = false;

    function fallbackToMp4() {
      if (cancelled || usingFallback || !fallbackSrc) return;
      usingFallback = true;
      video.removeEventListener("error", fallbackToMp4);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.src = fallbackSrc;
      video.load();
    }

    if (!hlsUrl) {
      fallbackToMp4();
      return () => {
        cancelled = true;
      };
    }

    video.addEventListener("error", fallbackToMp4);
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.load();
      return () => {
        cancelled = true;
        video.removeEventListener("error", fallbackToMp4);
      };
    }

    loadHlsLibrary()
      .then((Hls) => {
        if (cancelled) return;
        if (!Hls?.isSupported?.()) {
          fallbackToMp4();
          return;
        }
        const hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal) fallbackToMp4();
        });
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
      })
      .catch(fallbackToMp4);

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeEventListener("error", fallbackToMp4);
    };
  }, [hlsUrl, fallbackSrc]);

  return (
    <video
      {...props}
      ref={(node) => {
        localRef.current = node;
        setForwardedRef(forwardedRef, node);
      }}
    />
  );
});

function loadHlsLibrary() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.__hlsLoaderPromise) return window.__hlsLoaderPromise;
  window.__hlsLoaderPromise = import("hls.js").then((module) => module.default || module);
  return window.__hlsLoaderPromise;
}

function setForwardedRef(ref, value) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

function releaseMediaElement(video) {
  if (!video) return;
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    // Some embedded TV browsers throw while tearing down media; the next render can continue.
  }
}

function tvPlayableItem(item, tvToken) {
  if (!item?.webhard_file_id || !tvToken) return item;
  return {
    ...item,
    content_url: `${API_BASE}/api/karaoke/tv/session/${encodeURIComponent(tvToken)}/media/${item.webhard_file_id}/content-file/?quality=1080`,
    hls_url: ""
  };
}

function playMediaElement(video, onBlocked) {
  if (!video) return;
  const result = video.play();
  if (!result || typeof result.catch !== "function") return;
  result.catch((error) => {
    const message = error?.name === "NotAllowedError"
      ? "브라우저가 자동 재생을 막았습니다. 재생 버튼을 한 번 더 눌러주세요."
      : "영상 재생을 시작하지 못했습니다.";
    if (onBlocked) onBlocked(message);
  });
}

function readStoredKaraokeQueue() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KARAOKE_QUEUE_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item?.webhard_file_id).slice(0, 50) : [];
  } catch {
    return [];
  }
}

function writeStoredKaraokeQueue(queue) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KARAOKE_QUEUE_STORAGE_KEY, JSON.stringify((queue || []).slice(0, 50)));
  } catch {
    // localStorage can be blocked on some embedded TV browsers.
  }
}

function formatTimeTagDraft(tags) {
  return (tags || []).filter(isTimeTag).join("\n");
}

function isTimeTag(tag) {
  return parseTimeTags([tag]).length > 0;
}

function normalizeTimeTagLine(line) {
  const text = String(line || "").trim();
  const seconds = parseTimeInput(text.split(/\s+/)[0]);
  if (seconds == null) {
    const parsed = parseTimeTags([text])[0];
    return parsed ? text : "";
  }
  const label = text.replace(/^\S+/, "").trim();
  return label ? `${formatMediaTime(seconds)} ${label}` : formatMediaTime(seconds);
}

function uniqueTags(tags) {
  const result = [];
  for (const tag of tags || []) {
    const text = String(tag || "").trim();
    if (text && !result.includes(text)) {
      result.push(text);
    }
  }
  return result;
}

function parseTimeInput(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return clampMediaSeconds(Number(text));
  }
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((number) => !Number.isFinite(number))) {
    return null;
  }
  const seconds = numbers[numbers.length - 1];
  const minutes = numbers[numbers.length - 2];
  const hours = numbers.length === 3 ? numbers[0] : 0;
  if (seconds < 0 || seconds >= 60 || minutes < 0 || minutes >= 60 || hours < 0) {
    return null;
  }
  return clampMediaSeconds((hours * 3600) + (minutes * 60) + seconds);
}

function parseTimeTags(tags) {
  const result = [];
  const seen = new Set();
  for (const tag of tags || []) {
    const raw = String(tag || "").trim();
    const match = raw.match(/(?:^|[^\d])(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d(?:\.\d{1,3})?)(?!\d)/);
    if (!match) continue;
    const seconds = timeMatchToSeconds(match);
    if (seconds == null) continue;
    const key = String(Math.round(seconds * 1000));
    if (seen.has(key)) continue;
    seen.add(key);
    const label = raw.replace(match[0], " ").replace(/\s+/g, " ").trim() || raw;
    result.push({ raw, label, seconds });
  }
  return result.sort((left, right) => left.seconds - right.seconds);
}

function timeMatchToSeconds(match) {
  const seconds = Number(match[3]);
  const minutes = Number(match[2]);
  const hours = match[1] == null ? 0 : Number(match[1]);
  if (![hours, minutes, seconds].every((value) => Number.isFinite(value))) {
    return null;
  }
  return clampMediaSeconds((hours * 3600) + (minutes * 60) + seconds);
}

function activeTimeTagIndex(timeTags, currentTime) {
  let activeIndex = -1;
  for (let index = 0; index < timeTags.length; index += 1) {
    if (timeTags[index].seconds <= currentTime + 0.2) {
      activeIndex = index;
    }
  }
  return activeIndex;
}

function formatMediaTime(value) {
  const totalSeconds = Math.max(Number(value || 0), 0);
  const wholeSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function clampMediaSeconds(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 24 * 60 * 60);
}

createRoot(document.getElementById("root")).render(<App />);
