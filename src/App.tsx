import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import Home from '@/pages/Home';
import AdminDashboard from '@/components/app/AdminDashboard';
import JudgeDashboard from '@/components/app/JudgeDashboard';
import Leaderboard from '@/components/app/Leaderboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/leaderboard" element={<Leaderboard />} />
          <Route path="/judge" element={<JudgeDashboard />} />
        </Routes>
      </ErrorBoundary>
      <Toaster />
    </BrowserRouter>
  );
}
