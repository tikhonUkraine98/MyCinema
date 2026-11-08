"use strict";
(function () {
  const byId = (id) => document.getElementById(id);
  const TOKEN_KEY = "mycinema_tmdb_token_v1";
  const REGION_KEY = "mycinema_tmdb_region_v1";
  const FAVORITES_KEY = "mycinema_favorites_v1";
  const API = "https://api.themoviedb.org/3";
  let searchSerial = 0;
  let detailSerial = 0;
  let currentDetail = null;
  let favorites = readFavorites();

  function getItem(key, fallback) {
    try { return localStorage.getItem(key) || fallback; }
    catch (_) { return fallback; }
  }
  function setItem(key, value) {
    try { localStorage.setItem(key, value); }
    catch (_) { alert("Не вдалося зберегти дані в браузері. Перевір режим приватного перегляду."); }
  }
  function readFavorites() {
    try {
      const value = JSON.parse(getItem(FAVORITES_KEY, "[]"));
      if (!Array.isArray(value)) return [];
      return value.filter((item) =>
        Number.isInteger(item.id) && typeof item.name === "string"
      ).slice(0, 100).map((item) => ({
        id: item.id,
        name: item.name.slice(0, 160),
        overview: String(item.overview || "").slice(0, 1500),
        poster_path: String(item.poster_path || ""),
        first_air_date: String(item.first_air_date || "")
      }));
    } catch (_) { return []; }
  }
  function saveFavorites() {
    setItem(FAVORITES_KEY, JSON.stringify(favorites));
    renderFavorites();
  }
  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }
  function imageSrc(path, width) {
    if (typeof path !== "string" || !/^\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp)$/i.test(path)) return "";
    return "https://image.tmdb.org/t/p/" + width + path;
  }
  function setStatus(message, error) {
    const target = byId("searchStatus");
    target.textContent = message;
    target.style.color = error ? "#ffb3a3" : "";
  }
  function token() { return getItem(TOKEN_KEY, "").trim(); }
  function region() { return getItem(REGION_KEY, "UA"); }

  async function tmdb(path, argumentsMap) {
    const auth = token();
    if (!auth) throw Error("Спочатку введи особистий TMDB API-ключ у налаштуваннях.");
    const url = new URL(API + path);
    url.searchParams.set("language", "uk-UA");
    for (const entry of Object.entries(argumentsMap || {})) url.searchParams.set(entry[0], String(entry[1]));
    const options = {headers: {accept: "application/json"}};
    if (auth.length > 50 || auth.split(".").length === 3) {
      options.headers.Authorization = "Bearer " + auth;
    } else {
      url.searchParams.set("api_key", auth);
    }
    const controller = new AbortController();
    options.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try { response = await fetch(url.toString(), options); }
    catch (error) {
      if (error.name === "AbortError") throw Error("TMDB не відповів протягом 15 секунд.");
      throw Error("Немає з'єднання з TMDB. Перевір інтернет та мережеві обмеження.");
    } finally { clearTimeout(timer); }
    if (response.status === 401 || response.status === 403) throw Error("TMDB відхилив ключ. Перевір API Key або Read Access Token.");
    if (response.status === 429) throw Error("Забагато запитів до TMDB. Спробуй пізніше.");
    if (!response.ok) throw Error("TMDB відповів кодом " + response.status + ".");
    return response.json();
  }

  function openSearch() {
    byId("catalogExploreScreen").hidden = true;
    saveProgress();
    player.pause();
    byId("libraryScreen").hidden = true;
    byId("watchScreen").hidden = true;
    byId("searchScreen").hidden = false;
    renderFavorites();
    if (!token()) setStatus("Натисни «API-ключ» і введи ключ TMDB. Без нього працює ручна бібліотека.", false);
    byId("tmdbQuery").focus();
    document.title = "Пошук серіалів — MyCinema";
    window.scrollTo(0, 0);
  }
  byId("openSearch").addEventListener("click", openSearch);

  function openSettings() {
    byId("settingsError").textContent = "";
    byId("tmdbToken").value = token();
    byId("providerRegion").value = region();
    byId("settingsDialog").showModal();
  }
  byId("openSettings").addEventListener("click", openSettings);
  byId("openTmdbSettings").addEventListener("click", openSettings);
  byId("cancelSettings").addEventListener("click", () => byId("settingsDialog").close());
  byId("clearTmdbToken").addEventListener("click", () => {
    try { localStorage.removeItem(TOKEN_KEY); }
    catch (_) { /* ignore */ }
    byId("tmdbToken").value = "";
    byId("settingsDialog").close();
    setStatus("TMDB-ключ видалено з локального сховища.", false);
  });
  byId("settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = byId("tmdbToken").value.trim();
    if (value && (value.length < 12 || value.length > 2000)) {
      byId("settingsError").textContent = "Надто короткий або некоректний ключ.";
      return;
    }
    if (value) setItem(TOKEN_KEY, value);
    else {
      try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
    }
    setItem(REGION_KEY, byId("providerRegion").value);
    byId("settingsDialog").close();
    setStatus(value ? "Ключ збережено локально. Тепер введи назву серіалу." : "Ключ видалено.", false);
  });

  function makePoster(row) {
    const path = imageSrc(row.poster_path, "w342");
    if (!path) return el("div", "discovery-poster discovery-placeholder", "Постер відсутній");
    const image = el("img", "discovery-poster");
    image.loading = "lazy";
    image.alt = "Постер: " + (row.name || "");
    image.src = path;
    image.onerror = () => image.replaceWith(el("div", "discovery-poster discovery-placeholder", "Без постера"));
    return image;
  }
  function tile(row) {
    const button = el("button", "discovery-item");
    button.type = "button";
    button.append(makePoster(row));
    button.append(el("strong", "discovery-name", row.name || row.original_name || "Без назви"));
    button.append(el("span", "discovery-year", (row.first_air_date || "").slice(0, 4) || "Рік невідомий"));
    button.addEventListener("click", () => showDetails(row));
    return button;
  }
  function renderFavorites() {
    const root = byId("tmdbFavorites");
    root.replaceChildren();
    byId("favoritesCount").textContent = String(favorites.length);
    if (!favorites.length) {
      root.append(el("p", "micro", "Поки порожньо. Знайди серіал і натисни «В обране»."));
      return;
    }
    for (const show of favorites) root.append(tile(show));
  }
  renderFavorites();

  byId("tmdbSearchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = byId("tmdbQuery").value.trim();
    if (query.length < 2) return;
    const serial = ++searchSerial;
    byId("tmdbDetails").hidden = true;
    byId("tmdbResults").replaceChildren();
    setStatus("Шукаю «" + query + "»…", false);
    try {
      const data = await tmdb("/search/tv", {query: query, include_adult: false, page: 1});
      if (serial !== searchSerial) return;
      const found = (data.results || []).slice(0, 20).filter((r) => Number.isInteger(r.id));
      if (!found.length) {
        setStatus("Нічого не знайдено. Спробуй оригінальну назву серіалу.", false);
      } else {
        for (const row of found) byId("tmdbResults").append(tile(row));
        setStatus("Знайдено: " + (data.total_results || found.length) + ". Натисни на картку для подробиць.", false);
      }
    } catch (error) {
      if (serial === searchSerial) setStatus(error.message || "Помилка пошуку.", true);
    }
  });

  function action(text, callback, primary) {
    const button = el("button", "action" + (primary ? " primary" : ""), text);
    button.type = "button";
    button.addEventListener("click", callback);
    return button;
  }

  async function showDetails(row) {
    const serial = ++detailSerial;
    const root = byId("tmdbDetails");
    root.hidden = false;
    root.replaceChildren(el("p", "micro", "Завантажую інформацію та офіційні платформи…"));
    root.scrollIntoView({behavior:"smooth",block:"start"});
    try {
      const data = await Promise.all([
        tmdb("/tv/" + row.id, {}),
        tmdb("/tv/" + row.id + "/watch/providers", {})
      ]);
      if (serial !== detailSerial) return;
      const show = data[0];
      const availability = data[1];
      currentDetail = show;
      root.replaceChildren();
      const header = el("div", "discovery-detail-head");
      header.append(makePoster(show));
      const column = el("div");
      column.append(el("h2", "", show.name || show.original_name || "Серіал"));
      column.append(el("p", "", ((show.first_air_date || "").slice(0,4) || "Рік невідомий") +
        " · " + (show.number_of_seasons || 0) + " сезонів · " + (show.number_of_episodes || 0) + " серій"));
      column.append(el("p", "", show.overview || "Опис українською наразі відсутній."));
      const toolbar = el("div", "discovery-toolbar");
      const favoriteButton = action("", () => {
        if (favorites.some((s) => s.id === show.id)) {
          favorites = favorites.filter((s) => s.id !== show.id);
        } else {
          favorites.unshift({
            id: show.id,
            name: show.name || show.original_name || "Серіал",
            first_air_date: show.first_air_date || "",
            poster_path: show.poster_path || "",
            overview: show.overview || ""
          });
          favorites = favorites.slice(0,100);
        }
        favoriteButton.textContent = favorites.some((s) => s.id === show.id) ? "✓ В обраному" : "☆ В обране";
        saveFavorites();
      }, false);
      favoriteButton.textContent = favorites.some((s) => s.id === show.id) ? "✓ В обраному" : "☆ В обране";
      toolbar.append(favoriteButton);
      toolbar.append(action("+ Додати відеоджерело", () => {
        openEditor();
        byId("seriesName").value = show.name || show.original_name || "";
        const ss = (show.seasons || []).find((s) => s.season_number > 0);
        if (ss) {
          byId("seasonNumber").value = ss.season_number;
          byId("episodeTotal").value = Math.min(ss.episode_count || 8, 60);
        }
      }, true));
      toolbar.append(action("Знайти доступні MP4/WebM",()=>{
        window.MyCinemaSources?.openWithTitle(show.original_name||show.name||"");
      },false));
      const link = el("a", "action", "Відкрити на TMDB");
      link.href = "https://www.themoviedb.org/tv/" + show.id;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      toolbar.append(link);
      column.append(toolbar);
      header.append(column);
      root.append(header);
      renderProviders(root, availability, show.id);
      const seasonBox = el("section", "discovery-section");
      seasonBox.append(el("h3", "", "Сезони та епізоди"));
      const tabs = el("div", "discovery-season-tabs");
      const episodes = el("div", "discovery-episodes");
      seasonBox.append(tabs, episodes);
      root.append(seasonBox);
      const validSeasons = (show.seasons || []).filter((s) => s.season_number > 0);
      if (!validSeasons.length) {
        episodes.append(el("p", "micro", "Інформація про сезони відсутня."));
      } else {
        let seasonSerial = 0;
        for (const season of validSeasons) {
          const button = action("Сезон " + season.season_number, async () => {
            const localSerial = ++seasonSerial;
            for (const child of tabs.children) child.classList.remove("active");
            button.classList.add("active");
            episodes.replaceChildren(el("p", "micro", "Завантажую серії…"));
            try {
              const result = await tmdb("/tv/" + show.id + "/season/" + season.season_number, {});
              if (localSerial !== seasonSerial || serial !== detailSerial) return;
              episodes.replaceChildren();
              const all = result.episodes || [];
              if (!all.length) episodes.append(el("p", "micro", "Список серій відсутній."));
              for (const ep of all) {
                const item = el("div", "discovery-episode");
                item.append(el("strong", "", String(ep.episode_number || 0).padStart(2,"0")));
                item.append(el("strong", "", ep.name || "Серія " + ep.episode_number));
                item.append(el("small", "", ep.runtime ? ep.runtime + " хв" : (ep.air_date || "")));
                episodes.append(item);
              }
            } catch (error) {
              if (localSerial === seasonSerial) episodes.replaceChildren(el("p","micro",error.message));
            }
          });
          tabs.append(button);
        }
        tabs.firstElementChild.click();
      }
    } catch (error) {
      if (serial === detailSerial) root.replaceChildren(el("p", "micro", error.message || "Не вдалося отримати дані."));
    }
  }

  function renderProviders(root, payload, showId) {
    const section = el("section", "discovery-section");
    const zone = region();
    section.append(el("h3", "", "Де дивитися легально · " + zone));
    const data = (payload.results || {})[zone];
    if (!data) {
      section.append(el("p", "micro", "TMDB не має інформації про доступні платформи в цій країні."));
      root.append(section);
      return;
    }
    const providers = [];
    const seen = new Set();
    for (const category of ["flatrate", "free", "ads", "rent", "buy"]) {
      for (const provider of (data[category] || [])) {
        const key = String(provider.provider_id);
        if (!seen.has(key)) {
          seen.add(key);
          providers.push(provider);
        }
      }
    }
    const chips = el("div", "provider-row");
    for (const provider of providers) {
      const chip = el("span", "provider-chip");
      const url = imageSrc(provider.logo_path, "w92");
      if (url) {
        const logo = el("img");
        logo.src = url;
        logo.alt = "";
        chip.append(logo);
      }
      chip.append(el("span", "", provider.provider_name || "Платформа"));
      chips.append(chip);
    }
    if (providers.length) section.append(chips);
    else section.append(el("p", "micro", "Провайдерів не вказано."));
    const info = el("p", "provider-note", "Дані JustWatch через TMDB. Список не є прямими відеопосиланнями; ціни й доступність перевіряй на сайті сервісу.");
    section.append(info);
    const link = el("a", "action", "Переглянути варіанти перегляду");
    link.href = data.link && /^https:\/\//.test(data.link) ? data.link : "https://www.themoviedb.org/tv/" + showId + "/watch";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    section.append(link);
    root.append(section);
  }
  // Read-only functions shared with the verified streaming catalog.
  window.MyCinemaDiscovery = {tmdb, showDetails, openSearch, region, imageSrc};
})();
