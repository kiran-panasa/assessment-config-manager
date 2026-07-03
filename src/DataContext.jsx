import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { getBookings, getSessions } from "./api/firestore";

const DataContext = createContext(null);

export function useData() {
  return useContext(DataContext);
}

export function DataProvider({ children }) {
  const [bookingRows,  setBookingRows]  = useState(null);
  const [examSessions, setExamSessions] = useState(null);

  const refreshData = useCallback(async () => {
    const [bookings, sessions] = await Promise.all([getBookings(), getSessions()]);
    setBookingRows(bookings  || []);
    setExamSessions(sessions || []);
  }, []);

  useEffect(() => { refreshData(); }, [refreshData]);

  const value = useMemo(() => ({
    bookingRows:  bookingRows  ?? [],
    examSessions: examSessions ?? [],
    dataLoading:  bookingRows === null || examSessions === null,
    setBookingRows,
    setExamSessions,
    refreshData,
  }), [bookingRows, examSessions, refreshData]);

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}
