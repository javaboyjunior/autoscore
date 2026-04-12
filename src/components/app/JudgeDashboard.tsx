import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useCollection, api } from '@/lib/api';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { ScoringDialog } from './ScoringDialog';
import { CheckCircle2, LogOut, Star, Loader2, WifiOff, Lock } from 'lucide-react';

// ── Offline queue helpers ─────────────────────────────────────────────────────
const QUEUE_KEY = 'autoscore_offline_queue';
interface QueuedScore {
  queueId: string; carId: string; judgeId: string; eventId: string;
  score: number; notes: string; existingScoreId?: string;
}
function loadQueue(): QueuedScore[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function saveQueue(q: QueuedScore[]) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

type Event = { id: string; name: string; date: string; isCurrent?: boolean; scoringLocked?: boolean };
type Car = { id: string; eventId: string; registrationId: number; ownerInfo: string; make: string; model: string; year: number; color: string };
type Judge = { id: string; eventId: string; name: string; email: string; password?: string };
type Score = { id: string; carId: string; judgeId: string; eventId: string; score: number | null; notes: string };
type CarWithScore = Car & { score: Score | undefined };

export default function JudgeDashboard() {
  const [loggedInJudge, setLoggedInJudge] = useState<Judge | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnscoredOnly, setShowUnscoredOnly] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedJudgeId, setSelectedJudgeId] = useState('');
  const [isLoginDialogOpen, setLoginDialogOpen] = useState(false);
  const [scoringCar, setScoringCar] = useState<CarWithScore | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState<QueuedScore[]>(loadQueue);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const { data: events, isLoading: isLoadingEvents } = useCollection<Event>(
    '/api/events',
    { watchTables: ['events'] },
  );

  const currentEvent = useMemo(() => events?.find((e) => e.isCurrent), [events]);

  const { data: eventJudges, isLoading: isLoadingJudges } = useCollection<Judge>(
    selectedEventId ? `/api/judges?eventId=${selectedEventId}` : null,
    { watchTables: ['judges'], watchEventId: selectedEventId },
  );

  const { data: eventCars, isLoading: isLoadingCars } = useCollection<Car>(
    selectedEventId ? `/api/cars?eventId=${selectedEventId}` : null,
    { watchTables: ['cars'], watchEventId: selectedEventId },
  );

  const { data: judgeScores, isLoading: isLoadingScores } = useCollection<Score>(
    loggedInJudge && selectedEventId
      ? `/api/scores?eventId=${selectedEventId}&judgeId=${loggedInJudge.id}`
      : null,
    { watchTables: ['scores'], watchEventId: selectedEventId },
  );

  // ── Auto-select current event ─────────────────────────────────────────────
  useEffect(() => {
    if (currentEvent) { setSelectedEventId(currentEvent.id); return; }
    if (events && events.length > 0) {
      const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
      setSelectedEventId(sorted[0].id);
    }
  }, [currentEvent, events]);

  // Auto-focus password field
  useEffect(() => {
    if (isLoginDialogOpen) {
      setTimeout(() => passwordRef.current?.focus(), 100);
    }
  }, [isLoginDialogOpen]);

  // Online/offline detection + queue flush on reconnect
  useEffect(() => {
    const goOnline  = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    const q = loadQueue();
    if (!q.length) return;

    (async () => {
      const failed: QueuedScore[] = [];
      for (const item of q) {
        const { queueId, existingScoreId, ...scoreData } = item;
        try {
          if (existingScoreId) await api.putAwait(`/api/scores/${existingScoreId}`, scoreData);
          else                 await api.postAwait('/api/scores', scoreData);
        } catch { failed.push(item); }
      }
      setOfflineQueue(failed);
      saveQueue(failed);
      if (failed.length < q.length) {
        toast({ title: 'Scores synced', description: `${q.length - failed.length} offline score${q.length - failed.length !== 1 ? 's' : ''} submitted.` });
      }
    })();
  }, [isOnline]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const carsForScoring: CarWithScore[] = useMemo(() => {
    if (!loggedInJudge || !eventCars) return [];
    let cars = eventCars
      .map((car) => ({ ...car, score: judgeScores?.find((s) => s.carId === car.id) }))
      .sort((a, b) => a.registrationId - b.registrationId);
    if (showUnscoredOnly) cars = cars.filter((c) => !c.score);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      cars = cars.filter((c) =>
        String(c.registrationId).includes(q) ||
        c.make.toLowerCase().includes(q) ||
        c.model.toLowerCase().includes(q),
      );
    }
    return cars;
  }, [loggedInJudge, eventCars, judgeScores, searchQuery, showUnscoredOnly]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleLoginAttempt = () => {
    const judge = eventJudges?.find((j) => j.id === selectedJudgeId);
    const password = passwordRef.current?.value;
    if (!judge || !password) {
      toast({ variant: 'destructive', title: 'Login Failed', description: 'Please select your name and enter a password.' });
      return;
    }
    if (judge.password === password) {
      setLoggedInJudge(judge);
      setLoginDialogOpen(false);
      toast({ title: 'Login Successful', description: `Welcome, ${judge.name}!` });
    } else {
      toast({ variant: 'destructive', title: 'Login Failed', description: 'Incorrect password.' });
    }
  };

  const handleLogout = () => {
    setLoggedInJudge(null);
    setSelectedJudgeId('');
    toast({ title: 'Logged Out', description: 'You have been successfully logged out.' });
  };

  const handleJudgeSelection = (judgeId: string) => {
    setSelectedJudgeId(judgeId);
    if (eventJudges?.find((j) => j.id === judgeId)) setLoginDialogOpen(true);
  };

  const handleEventChange = (eventId: string) => {
    if (loggedInJudge) handleLogout();
    setSelectedEventId(eventId);
  };

  const onLoginDialogClose = (open: boolean) => {
    setLoginDialogOpen(open);
    if (!open && !loggedInJudge) setSelectedJudgeId('');
  };

  const handleScoreSave = async (carId: string, judgeId: string, newScore: number, newNotes: string) => {
    if (!selectedEventId) return;
    const existing = judgeScores?.find((s) => s.carId === carId && s.judgeId === judgeId);
    const scoreData = { carId, judgeId, eventId: selectedEventId, score: newScore, notes: newNotes };

    if (!navigator.onLine) {
      const entry: QueuedScore = { ...scoreData, queueId: crypto.randomUUID(), existingScoreId: existing?.id };
      setOfflineQueue((prev) => {
        const filtered = prev.filter((q) => !(q.carId === carId && q.judgeId === judgeId));
        const next = [...filtered, entry];
        saveQueue(next);
        return next;
      });
      toast({ title: 'Saved offline', description: 'Will sync automatically when connection returns.' });
      setScoringCar(null);
      return;
    }

    try {
      if (existing) await api.putAwait(`/api/scores/${existing.id}`, scoreData);
      else          await api.postAwait('/api/scores', scoreData);
      toast({ title: 'Score Saved', description: 'Your score has been recorded.' });
      setScoringCar(null);
    } catch (err: any) {
      if (err?.status === 423) {
        toast({ variant: 'destructive', title: 'Scoring Locked', description: 'The organiser has locked scoring for this event.' });
      } else {
        // Network hiccup — queue it
        const entry: QueuedScore = { ...scoreData, queueId: crypto.randomUUID(), existingScoreId: existing?.id };
        setOfflineQueue((prev) => {
          const filtered = prev.filter((q) => !(q.carId === carId && q.judgeId === judgeId));
          const next = [...filtered, entry];
          saveQueue(next);
          return next;
        });
        toast({ title: 'Saved offline', description: 'Will retry automatically.' });
        setScoringCar(null);
      }
    }
  };

  const isLoading = isLoadingEvents || isLoadingJudges || isLoadingCars || isLoadingScores;
  const selectedEvent = events?.find((e) => e.id === selectedEventId);
  const isLocked = selectedEvent?.scoringLocked ?? false;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Offline banner */}
      {(!isOnline || offlineQueue.length > 0) && (
        <div className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium ${!isOnline ? 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400' : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'}`}>
          <WifiOff className="h-4 w-4 shrink-0" />
          {!isOnline
            ? `You're offline. ${offlineQueue.length > 0 ? `${offlineQueue.length} score${offlineQueue.length !== 1 ? 's' : ''} queued — will sync on reconnect.` : 'Scores will be queued until you reconnect.'}`
            : `${offlineQueue.length} score${offlineQueue.length !== 1 ? 's' : ''} syncing…`}
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/80 backdrop-blur-sm px-4 md:px-6">
        <h1 className="text-xl font-bold font-headline text-primary">
          <Link to="/">AutoScore Live</Link>
        </h1>
        <div className="ml-auto flex items-center gap-4">
          {loggedInJudge ? (
            <>
              <span className="font-semibold">Welcome, {loggedInJudge.name}</span>
              <Button variant="ghost" size="icon" onClick={handleLogout}><LogOut className="h-4 w-4" /></Button>
            </>
          ) : (
            <>
              {currentEvent ? (
                <div className="flex items-center gap-2 text-sm font-medium border rounded-lg px-3 py-2 bg-muted">
                  <Star className="h-4 w-4 text-accent" />
                  <span>{currentEvent.name}</span>
                </div>
              ) : (
                events && (
                  <Select value={selectedEventId} onValueChange={handleEventChange}>
                    <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select an event" /></SelectTrigger>
                    <SelectContent>
                      {events.map((ev) => <SelectItem key={ev.id} value={ev.id}>{ev.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )
              )}
              <div className="w-full max-w-[200px]">
                {eventJudges && (
                  <Select value={selectedJudgeId} onValueChange={handleJudgeSelection} disabled={!selectedEventId}>
                    <SelectTrigger><SelectValue placeholder="Select Your Name" /></SelectTrigger>
                    <SelectContent>
                      {eventJudges.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      <main className="p-4 md:p-6">
        {isLoading && (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {/* Scoring locked banner */}
        {!isLoading && loggedInJudge && isLocked && (
          <div className="flex items-center gap-2 px-4 py-3 mb-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm font-medium">
            <Lock className="h-4 w-4 shrink-0" />
            Scoring is closed for this event. Your submitted scores have been recorded.
          </div>
        )}

        {!isLoading && loggedInJudge ? (
          <div>
            <div className="flex flex-col gap-3 mb-6 md:flex-row md:items-center md:justify-between">
              <h2 className="text-2xl font-bold">Cars to Score</h2>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                <div className="flex items-center space-x-2">
                  <Switch id="show-unscored" checked={showUnscoredOnly} onCheckedChange={setShowUnscoredOnly} />
                  <Label htmlFor="show-unscored">Show only unscored cars</Label>
                </div>
                <Input
                  className="w-full md:max-w-xs"
                  placeholder="Search by ID, make, or model..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {carsForScoring.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {carsForScoring.map((car) => (
                  <Card key={car.id} className="flex flex-col">
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle>{car.make} {car.model}</CardTitle>
                          <CardDescription>{car.year} - Reg. ID: {car.registrationId}</CardDescription>
                        </div>
                        {car.score && (
                          <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                            <CheckCircle2 className="mr-1 h-3 w-3" />Scored
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="flex-grow">
                      <p className="text-sm"><strong>Color:</strong> {car.color}</p>
                      {car.score && (
                        <div className="mt-4 p-3 bg-muted rounded-lg">
                          <p className="text-sm"><strong>Your Score:</strong> {car.score.score?.toFixed(1)}/10</p>
                          <p className="text-sm mt-1"><strong>Notes:</strong> {car.score.notes}</p>
                        </div>
                      )}
                    </CardContent>
                    <CardFooter>
                      <Button
                        className="w-full"
                        variant={car.score ? 'secondary' : 'default'}
                        onClick={() => setScoringCar(car)}
                        disabled={isLocked}
                      >
                        {isLocked ? <><Lock className="mr-2 h-3 w-3" />Locked</> : car.score ? 'Edit Score' : 'Score Car'}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 border-2 border-dashed rounded-lg">
                <h3 className="text-xl font-semibold text-muted-foreground">
                  {searchQuery ? 'No cars match your search.' : showUnscoredOnly ? 'All cars have been scored!' : 'No cars available for scoring'}
                </h3>
                <p className="text-muted-foreground mt-2">
                  {searchQuery ? 'Try a different search term.' : showUnscoredOnly ? 'Good job!' : 'There are no cars entered for this event yet.'}
                </p>
              </div>
            )}
          </div>
        ) : (
          !isLoading && (
            <div className="text-center py-16 border-2 border-dashed rounded-lg">
              <h3 className="text-xl font-semibold text-muted-foreground">Welcome, Judge!</h3>
              <p className="text-muted-foreground mt-2">Please select your event and name to login.</p>
            </div>
          )
        )}
      </main>

      <Dialog open={isLoginDialogOpen} onOpenChange={onLoginDialogClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Password</DialogTitle>
            <DialogDescription>
              Please enter the password for {eventJudges?.find((j) => j.id === selectedJudgeId)?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              ref={passwordRef}
              onKeyDown={(e) => e.key === 'Enter' && handleLoginAttempt()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onLoginDialogClose(false)}>Cancel</Button>
            <Button onClick={handleLoginAttempt}>Login</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {scoringCar && loggedInJudge && (
        <ScoringDialog
          car={scoringCar}
          judgeId={loggedInJudge.id}
          open={!!scoringCar}
          onOpenChange={(open) => !open && setScoringCar(null)}
          onSave={handleScoreSave}
        />
      )}
    </div>
  );
}
