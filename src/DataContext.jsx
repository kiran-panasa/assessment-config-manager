import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { getBookingsForDate, getAllSessionsForDate } from "./api/firestore";

const DataContext = createContext(null);

export function useData() {
  return useContext(DataContext);
}

export function DataProvider({ children }) {
  const [bookingRows,  setBookingRows]  = useState([]);
  const [examSessions, setExamSessions] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [dataLoading,  setDataLoading]  = useState(false);

  // Fetch data only for the requested date — zero reads when no date is selected
  const loadForDate = useCallback(async (date) => {
    if (!date) {
      setBookingRows([]);
      setExamSessions([]);
      setSelectedDate("");
      return;
    }
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
  }, []);

  // Re-fetch the currently selected date (used after writes)
  const refreshData = useCallback(() => {
    if (selectedDate) return loadForDate(selectedDate);
    return Promise.resolve();
  }, [selectedDate, loadForDate]);

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
