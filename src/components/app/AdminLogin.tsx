import React, { useState, useEffect } from 'react';
import AdminDashboard from './AdminDashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Lock } from 'lucide-react';

const TOKEN_KEY = 'autoscore_admin_token';

export default function AdminLogin() {
  const [status, setStatus]   = useState<'checking' | 'login' | 'authed'>('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) { setStatus('login'); return; }

    fetch('/api/admin/verify', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.ok) { setStatus('authed'); }
        else { sessionStorage.removeItem(TOKEN_KEY); setStatus('login'); }
      })
      .catch(() => { sessionStorage.removeItem(TOKEN_KEY); setStatus('login'); });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (r.ok) {
        const { token } = await r.json();
        sessionStorage.setItem(TOKEN_KEY, token);
        setStatus('authed');
      } else {
        setError('Invalid username or password.');
      }
    } catch {
      setError('Login failed — please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (status === 'authed') {
    return (
      <AdminDashboard
        onLogout={() => {
          sessionStorage.removeItem(TOKEN_KEY);
          setStatus('login');
          setUsername('');
          setPassword('');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl font-headline">Admin Access</CardTitle>
              <p className="text-sm text-muted-foreground">AutoScore Live</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <p className="text-sm font-medium text-destructive">{error}</p>
            )}
            <Button type="submit" disabled={loading} className="w-full mt-1">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign In
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
