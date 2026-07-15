import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

const DataContext = createContext(null);

export function useData() {
  return useContext(DataContext);
}

// 30-day window for the UI — enough for active work, 3× fewer reads than 90 days
function uiCutoffDate() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function DataProvider({ children }) {
  const [bookingRows,  setBookingRows]  = useState(null);
  const [examSessions, setExamSessions] = useState(null);

  // Live listener for bookingRows — eliminates repeated getBookings() fetches on refreshData
  useEffect(() => {
    const q = query(
      collection(db, "bookingRows"),
      where("contestDate", ">=", uiCutoffDate()),
      orderBy("contestDate", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => setBookingRows(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      ()     => setBookingRows([])
    );
    return unsub;
  }, []);

  // Live listener for examSessions — auto-reflects any write from any component
  useEffect(() => {
    const q = query(
      collection(db, "examSessions"),
      where("dateOfAssessment", ">=", uiCutoffDate()),
      orderBy("dateOfAssessment", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => setExamSessions(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      ()     => setExamSessions([])
    );
    return unsub;
  }, []);

  // No-op: both collections are kept live by onSnapshot — no re-fetch needed
  const refreshData = useCallback(() => Promise.resolve(), []);

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
