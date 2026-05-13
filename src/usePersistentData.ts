import { useEffect, useMemo, useState } from "react";
import type { AppData } from "./data";
import { seedData } from "./data";

const STORAGE_KEY = "jordan-water-station-v1";

const emptyData: AppData = {
  customers: [],
  sales: [],
  payments: [],
  closings: [],
};

function loadData(): AppData {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return emptyData;

  try {
    return JSON.parse(stored) as AppData;
  } catch {
    return emptyData;
  }
}

export function usePersistentData() {
  const [data, setData] = useState<AppData>(() => loadData());

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  return useMemo(
    () => ({
      data,
      setData,
      resetDemoData: () => setData(seedData),
      clearData: () =>
        setData({
          customers: [],
          sales: [],
          payments: [],
          closings: [],
        }),
    }),
    [data],
  );
}
