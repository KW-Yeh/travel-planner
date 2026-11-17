import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { parseShareUrl } from "../../shared/maps-links";
import type { StopKind } from "../../shared/schema";
import { apiRequest } from "../api/client";
import { matchPlaces, type TripPlace } from "../data/tripPlaces";
import { mapsLibrary, useMapsConfig, useOnline } from "../maps/google";
import { KindIcon, PinIcon, SearchIcon } from "./icons";
import styles from "./PlaceSearch.module.css";

export type PickedPlace = {
  placeId: string | null;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** Set when reusing a trip place: its original fetch time and kind. */
  fetchedAt?: number | null;
  kind?: StopKind;
};

const QUICK_LIMIT = 8;
const MATCH_LIMIT = 5;

type Suggestion = { prediction: google.maps.places.PlacePrediction; main: string; secondary: string };

// Only Essentials fields: displayName is a Pro field, so the name comes from the suggestion text.
const DETAIL_FIELDS = ["location", "formattedAddress"];
const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

async function details(key: string, place: google.maps.places.Place): Promise<{ address: string | null; lat: number | null; lng: number | null }> {
  await mapsLibrary(key, "places");
  const { place: filled } = await place.fetchFields({ fields: DETAIL_FIELDS });
  return { address: filled.formattedAddress ?? null, lat: filled.location?.lat() ?? null, lng: filled.location?.lng() ?? null };
}

type Props = {
  bias: { lat: number; lng: number } | null;
  onPick: (place: PickedPlace) => void;
  /** Places already used in this trip, offered as quick picks (no Google call). */
  quick?: TripPlace[];
};

type Option = { type: "trip"; place: TripPlace } | { type: "google"; s: Suggestion };

export function PlaceSearch({ bias, onPick, quick = [] }: Props) {
  const config = useMapsConfig();
  const online = useOnline();
  const ids = useId();
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [message, setMessage] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [searching, setSearching] = useState(false);
  const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const key = config?.mapsBrowserKey ?? null;
  const searchable = Boolean(key && online);
  const looksLikeLink = /^https?:\/\//i.test(text.trim());
  const biasLat = bias?.lat ?? null;
  const biasLng = bias?.lng ?? null;

  useEffect(() => {
    if (!key || !online || looksLikeLink || text.trim().length < MIN_CHARS) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      void (async () => {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = await mapsLibrary(key, "places");
        token.current ??= new AutocompleteSessionToken();
        const request: google.maps.places.AutocompleteRequest = { input: text.trim(), sessionToken: token.current, language: "zh-TW" };
        if (biasLat !== null && biasLng !== null) request.locationBias = { center: { lat: biasLat, lng: biasLng }, radius: 50_000 };
        const { suggestions: found } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        if (cancelled) return;
        setSuggestions(
          found.flatMap((s) =>
            s.placePrediction
              ? [{ prediction: s.placePrediction, main: s.placePrediction.mainText?.text ?? s.placePrediction.text.text, secondary: s.placePrediction.secondaryText?.text ?? "" }]
              : [],
          ),
        );
        setActive(-1);
      })()
        .catch(() => {
          if (!cancelled) setMessage("搜尋失敗，請稍後再試或直接輸入名稱。");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setSearching(false);
    };
  }, [key, online, looksLikeLink, text, biasLat, biasLng]);

  const matches = looksLikeLink ? [] : matchPlaces(quick, text).slice(0, MATCH_LIMIT);
  const options: Option[] = [
    ...matches.map((place): Option => ({ type: "trip", place })),
    // A Google result for a place already in the trip is shown once, as the trip place.
    ...suggestions
      .filter((s) => !matches.some((m) => m.placeId === s.prediction.placeId))
      .map((s): Option => ({ type: "google", s })),
  ];

  function pickTrip(p: TripPlace) {
    onPick({ placeId: p.placeId, name: p.name, address: p.address, lat: p.lat, lng: p.lng, fetchedAt: p.fetchedAt, kind: p.kind });
    setText("");
    setSuggestions([]);
    setMessage(null);
  }

  function chooseOption(o: Option) {
    if (o.type === "trip") pickTrip(o.place);
    else void choose(o.s);
  }

  async function choose(s: Suggestion) {
    if (!key) return;
    setSuggestions([]);
    setMessage("帶入中…");
    try {
      const d = await details(key, s.prediction.toPlace());
      onPick({ placeId: s.prediction.placeId, name: s.main, ...d });
      setText("");
      setMessage(null);
    } catch {
      setMessage("無法取得地點資料，請再試一次。");
    } finally {
      // fetchFields ended the billing session; the next search starts a new one.
      token.current = null;
    }
  }

  async function applyLink() {
    setMessage("讀取連結中…");
    try {
      let url = text.trim();
      if (/^https:\/\/(maps\.app\.)?goo\.gl\//.test(url)) {
        url = (await apiRequest<{ url: string }>("/api/links/resolve", { json: { url } })).url;
      }
      const parsed = parseShareUrl(url);
      if (!parsed) {
        setMessage("看不懂這個連結，請改用搜尋或直接輸入名稱。");
        return;
      }
      let extra = { address: null as string | null, lat: parsed.lat, lng: parsed.lng };
      if (parsed.placeId && key) {
        const { Place } = await mapsLibrary(key, "places");
        extra = await details(key, new Place({ id: parsed.placeId }));
      }
      onPick({ placeId: parsed.placeId, name: parsed.name, ...extra });
      setText("");
      setMessage(null);
    } catch {
      setMessage("無法讀取這個連結，請確認網路後再試。");
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      // The search box sits inside the stop form; Enter here must never submit it.
      e.preventDefault();
      const o = options[active];
      if (o) chooseOption(o);
      else if (looksLikeLink) void applyLink();
    } else if (e.key === "Escape") {
      setSuggestions([]);
    }
  }

  const open = options.length > 0 && !looksLikeLink;
  return (
    <div className={styles.wrap}>
      <label htmlFor={`${ids}-q`} className="field-label">
        {searchable ? "搜尋地點（Google 地點）或貼上 Google Maps 連結" : "貼上 Google Maps 連結"}
      </label>
      <div className={`${styles.box} glass`}>
        <SearchIcon size={18} />
        <input
          id={`${ids}-q`}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${ids}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${ids}-opt-${active}` : undefined}
          autoComplete="off"
          className={styles.input}
          value={text}
          placeholder={searchable ? "例如 清水寺" : "https://maps.app.goo.gl/…"}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
            setActive(-1);
            if (e.target.value.trim().length < MIN_CHARS) setSuggestions([]);
          }}
          onKeyDown={onKeyDown}
        />
        {searching && <span className={`spinner ${styles.spinner}`} role="status" aria-label="搜尋中" />}
      </div>
      {looksLikeLink && (
        <button type="button" className="btn btn-outline" onClick={() => void applyLink()}>
          使用這個連結
        </button>
      )}
      <ul id={`${ids}-list`} role="listbox" aria-label="搜尋結果" className={styles.list} hidden={!open}>
        {options.map((o, i) => (
          <li
            key={o.type === "trip" ? `trip:${o.place.key}` : o.s.prediction.placeId}
            id={`${ids}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className={styles.option}
            onPointerDown={(e) => {
              e.preventDefault();
              chooseOption(o);
            }}
          >
            {o.type === "trip" ? <KindIcon kind={o.place.kind} size={18} /> : <PinIcon size={18} />}
            <span>
              <strong>{o.type === "trip" ? o.place.name : o.s.main}</strong>
              {o.type === "trip" ? (
                <small>
                  <em className={styles.tripTag}>旅程中</em>
                  {o.place.address ?? ""}
                </small>
              ) : (
                o.s.secondary && <small>{o.s.secondary}</small>
              )}
            </span>
          </li>
        ))}
      </ul>
      {!text && quick.length > 0 && (
        <div className={styles.quick}>
          <span className={styles.quickLabel}>這趟旅程的地點</span>
          <div className={styles.chips}>
            {(showAll ? quick : quick.slice(0, QUICK_LIMIT)).map((p) => (
              <button key={p.key} type="button" className={styles.chip} title={p.address ?? undefined} onClick={() => { pickTrip(p); }}>
                <KindIcon kind={p.kind} size={14} />
                {p.name}
              </button>
            ))}
            {quick.length > QUICK_LIMIT && (
              <button type="button" className={`${styles.chip} ${styles.more}`} onClick={() => { setShowAll((v) => !v); }}>
                {showAll ? "收合" : `顯示全部（${quick.length}）`}
              </button>
            )}
          </div>
        </div>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      {config && !config.mapsBrowserKey && <p className="hint">尚未設定 Google 地圖金鑰，無法搜尋；可直接輸入名稱或貼上含座標的連結。</p>}
      {config?.mapsBrowserKey && !online && <p className="hint">離線中，暫時無法搜尋地點。</p>}
    </div>
  );
}
