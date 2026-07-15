import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { getBookingsForDate, getAllSessionsForDate, getBookingsForDateRange, getSessionsForDateRange } from "./api/firestore";

const DataContext = createContext(null);

export function useData() {
  return useContext(DataContext);
}

function nDaysAgoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function DataProvider({ children }) {
  const [bookingRows,  setBookingRows]  = useState([]);
  const [examSessions, setExamSessions] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [dataLoading,  setDataLoading]  = useState(false);

  // Load last 3 days in 2 range queries (1 for bookings, 1 for sessions)
  const loadDefault = useCallback(async () => {
    setDataLoading(true);
    try {
      const from = nDaysAgoDate(2); // 2 days ago
      const to   = nDaysAgoDate(0); // today
      const [bookings, sessions] = await Promise.all([
        getBookingsForDateRange(from, to),
        getSessionsForDateRange(from, to),
      ]);
      setBookingRows(bookings || []);
      setExamSessions(sessions || []);
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
