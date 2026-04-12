import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import Home from '@/pages/Home';
import AdminLogin from '@/components/app/AdminLogin';
import JudgeDashboard from '@/components/app/JudgeDashboard';
import Leaderboard from '@/components/app/Leaderboard';
import PublicLeaderboard from '@/components/app/PublicLeaderboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/leaderboard" element={<Leaderboard />} />
          <Route path="/judge" element={<JudgeDashboard />} />
          <Route path="/results" element={<PublicLeaderboard />} />
          <Route path="/results/:eventId" element={<PublicLeaderboard />} />
        </Routes>
      </ErrorBoundary>
      <Toaster />
    </BrowserRouter>
  );
}
