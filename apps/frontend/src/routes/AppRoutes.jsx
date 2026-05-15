import { Navigate, Route, Routes } from 'react-router-dom'
import AdminPage from '../pages/AdminPage.jsx'
import MainDisplayPage from '../pages/MainDisplayPage.jsx'
import StationPage from '../pages/StationPage.jsx'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/main" replace />} />
      <Route path="/main" element={<MainDisplayPage />} />
      <Route path="/station" element={<StationPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/main" replace />} />
    </Routes>
  )
}

export default AppRoutes
