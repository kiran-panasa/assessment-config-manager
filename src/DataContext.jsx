import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { getBookingsForDate, getAllSessionsForDate } from "./api/firestore";

const DataContext = createContext(null);

export function useData() {
  return useContext(DataContext);
}

function lastNDates(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });
}

export function DataProvider({ children }) {
  const [bookingRows,  setBookingRows]  = useState([]);
  const [examSessions, setExamSessions] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [dataLoading,  setDataLoading]  = useState(false);

  // Load last 3 days — called on mount and when the date picker is cleared
  const loadDefault = useCallback(async () => {
    setDataLoading(true);
    try {
      const dates = lastNDates(3);
      const results = await Promise.all([
        ...dates.map(d => getBookingsForDate(d)),
        ...dates.map(d => getAllSessionsForDate(d)),
      ]);
      setBookingRows(results.slice(0, 3).flat().filter(Boolean));
      setExamSessions(results.slice(3).flat().filter(Boolean));
      setSelectedDate("");
    } catch { /* silent */ }
    setDataLoading(false);
  }, []);

  // Auto-load last 3 days on mount
  useEffect(() => { loadDefault(); }, [loadDefault]);

  // Load a specific date; clearing the picker reloads the 3-day default
  const loadForDate = useCallback(async (date) => {
    if (!date) return loadDefault();
    setDataLoading(true);
    try {
      const [bookings, sessions] = await Promise.all([
        getBookingsForDate(date),
        getAllSessionsForDate(date),
      ]);
      setBookingRows(bookings || []);
      setExamSessions(sessions || []);
      setSelectedDate(date);
    } catch { /* silent */ }
    setDataLoading(false);
  }, [loadDefault]);

  // Re-fetch whatever is currently shown (specific date or 3-day default)
  const refreshData = useCallback(() => {
    if (selectedDate) return loadForDate(selectedDate);
    return loadDefault();
  }, [selectedDate, loadForDate, loadDefault]);

  const value = useMemo(() => ({
    bookingRows,
    examSessions,
    selectedDate,
    dataLoading,
    setBookingRows,
    setExamSessions,
    loadForDate,
    refreshData,
  }), [bookingRows, examSessions, selectedDate, dataLoading, loadForDate, refreshData]);

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}
