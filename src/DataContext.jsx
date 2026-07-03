import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { getBookings, cutoffDate } from "./api/firestore";

const DataContext = createContext(null);

export function useData() {
  return useContext(DataContext);
}

export function DataProvider({ children }) {
  const [bookingRows,  setBookingRows]  = useState(null);
  const [examSessions, setExamSessions] = useState(null);

  // One-shot fetch for bookings (mutated locally via optimistic updates)
  const refreshBookings = useCallback(async () => {
    const data = await getBookings();
    setBookingRows(data || []);
  }, []);

  useEffect(() => {
    refreshBookings();
  }, [refreshBookings]);

  // Live Firestore listener for exam sessions — auto-reflects any write from any component
  useEffect(() => {
    const q = query(
      collection(db, "examSessions"),
      where("dateOfAssessment", ">=", cutoffDate()),
      orderBy("dateOfAssessment", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => setExamSessions(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      ()     => setExamSessions([])
    );
    return unsub;
  }, []);

  // refreshData refreshes bookings; sessions refresh automatically via the listener
  const refreshData = useCallback(async () => {
    const data = await getBookings();
    setBookingRows(data || []);
  }, []);

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
