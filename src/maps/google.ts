import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useState } from "react";
import type { ConfigResponse } from "../../shared/routes";
import { NetworkError, apiRequest } from "../api/client";
import { db } from "../db/db";

const CONFIG_KEY = "mapsConfig";
const EMPTY: ConfigResponse = { mapsBrowserKey: null, mapId: null, routesEnabled: false };

let configPromise: Promise<ConfigResponse> | null = null;

/** Server-provided Maps settings; the last known copy is used offline. */
export function loadMapsConfig(): Promise<ConfigResponse> {
  configPromise ??= apiRequest<ConfigResponse>("/api/config")
    .then(async (config) => {
      await db.setMeta(CONFIG_KEY, config);
      return config;
    })
    .catch(async (error: unknown) => {
      configPromise = null;
      if (error instanceof NetworkError) return (await db.getMeta<ConfigResponse>(CONFIG_KEY)) ?? EMPTY;
      return EMPTY;
    });
  return configPromise;
}

export function useMapsConfig(): ConfigResponse | undefined {
  const [config, setConfig] = useState<ConfigResponse>();
  useEffect(() => {
    let cancelled = false;
    void loadMapsConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}

let configuredKey: string | null = null;

/** Loads a Maps JS library with the browser key; the key is set once per page. */
export function mapsLibrary<T extends keyof google.maps.ImportLibraryMap>(key: string, name: T): Promise<google.maps.ImportLibraryMap[T]> {
  if (configuredKey === null) {
    setOptions({ key, v: "weekly", language: "zh-TW" });
    configuredKey = key;
  }
  return importLibrary(name);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => {
      setOnline(true);
    };
    const off = () => {
      setOnline(false);
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
